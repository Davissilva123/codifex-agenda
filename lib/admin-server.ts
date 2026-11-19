import "server-only";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";
import { createSupabaseAdminClient, createSupabaseServerClient } from "@/lib/supabase-server";

export type AdminContext = {
  user: User;
  admin: ReturnType<typeof createSupabaseAdminClient>;
  userClient: SupabaseClient;
  isSuperAdmin: boolean;
  adminCompanyIds: string[];
};

export class AdminAccessError extends Error {
  constructor(message: string, readonly status: 401 | 403 = 403) {
    super(message);
    this.name = "AdminAccessError";
  }
}

export function jsonError(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

function extractErrorMessage(error: unknown): string {
  if (!error) return "Erro desconhecido.";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (typeof error === "object") {
    const err = error as Record<string, unknown>;
    if (typeof err.message === "string") return err.message;
    if (typeof err.error_description === "string") return err.error_description;
    if (typeof err.details === "string") return `${err.message || "Erro"}: ${err.details}`;
  }
  return String(error);
}

type CachedAuth = {
  user: User;
  isSuper: boolean;
  adminCompanyIds: string[];
  expiresAt: number;
};

// Cache em memória para autorização de Admin (TTL de 60 segundos)
// Evita requisições repetidas de rede ao Supabase Auth e Postgres a cada requisição da API
const superAdminTokenCache = new Map<string, CachedAuth>();

function pruneExpiredCache() {
  const now = Date.now();
  for (const [key, val] of superAdminTokenCache.entries()) {
    if (val.expiresAt <= now) {
      superAdminTokenCache.delete(key);
    }
  }
}

export async function requireSuperAdmin(request?: Request): Promise<AdminContext> {
  const admin = createSupabaseAdminClient();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Variáveis de ambiente do Supabase não configuradas no servidor.");
  }

  const authHeader = request?.headers.get("authorization") || "";
  let token = "";
  if (authHeader.startsWith("Bearer ")) {
    token = authHeader.slice(7).trim();
  }

  // 1. Verificar cache em memória para tokens Bearer válidos
  if (token) {
    const cached = superAdminTokenCache.get(token);
    if (cached && cached.expiresAt > Date.now()) {
      if (!cached.isSuper && cached.adminCompanyIds.length === 0) {
        throw new AdminAccessError("Usuário não possui privilégios de administrador.", 403);
      }

      const userClient = createClient(url, anonKey, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
        },
        global: {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        },
      });

      return {
        user: cached.user,
        admin,
        userClient,
        isSuperAdmin: cached.isSuper,
        adminCompanyIds: cached.adminCompanyIds,
      };
    }
  }

  // 2. Obter usuário autenticado via Bearer Token ou Cookie de Sessão
  let user: User | null = null;
  let userClient: SupabaseClient | null = null;

  if (token) {
    userClient = createClient(url, anonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const {
      data: { user: tokenUser },
      error: tokenError,
    } = await userClient.auth.getUser();

    if (tokenError || !tokenUser) {
      console.warn("Falha ao validar token Bearer de admin:", tokenError?.message);
    } else {
      user = tokenUser;
    }
  }

  if (!user) {
    // Tentar via cookie de sessão SSR
    try {
      const serverClient = await createSupabaseServerClient();
      const {
        data: { user: cookieUser },
        error: cookieError,
      } = await serverClient.auth.getUser();

      if (!cookieError && cookieUser) {
        user = cookieUser;
        userClient = serverClient;
      }
    } catch (cookieErr) {
      console.warn("Falha ao validar cookie de sessão de admin:", cookieErr);
    }
  }

  if (!user || !userClient) {
    throw new AdminAccessError("Autenticação necessária. Faça login para continuar.", 401);
  }

  // 3. Verificar se o usuário é Super Admin (davi@avisnet.com.br ou na tabela super_admins/RPC)
  let isSuper = false;
  const adminCompanyIds: string[] = [];

  // Davi sempre é Super Admin do sistema
  if (user.email?.toLowerCase() === "davi@avisnet.com.br") {
    isSuper = true;
  } else {
    try {
      const { data: superAdminRow, error: saError } = await admin
        .from("super_admins")
        .select("user_id")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!saError && superAdminRow?.user_id) {
        isSuper = true;
      } else {
        const { data: rpcAdmin } = await userClient.rpc("is_super_admin");
        if (rpcAdmin) {
          isSuper = true;
        }
      }
    } catch (dbErr) {
      console.warn("Erro ao checar tabela super_admins:", dbErr);
    }
  }

  // 4. Se não for Super Admin global, verificar em quais empresas ele é "admin_empresa"
  if (!isSuper) {
    try {
      const { data: memberships, error: memError } = await admin
        .from("membros")
        .select("empresa_id")
        .eq("user_id", user.id)
        .eq("papel", "admin_empresa")
        .eq("status", "ativo");

      if (memError) {
        console.warn("Erro ao buscar empresas do admin:", memError.message);
      } else if (memberships) {
        for (const m of memberships) {
          if (m.empresa_id && !adminCompanyIds.includes(m.empresa_id)) {
            adminCompanyIds.push(m.empresa_id);
          }
        }
      }
    } catch (memErr) {
      console.warn("Falha ao verificar empresas associadas:", memErr);
    }
  }

  // 5. Salva no cache se houver token Bearer
  if (token) {
    pruneExpiredCache();
    superAdminTokenCache.set(token, {
      user,
      isSuper,
      adminCompanyIds,
      expiresAt: Date.now() + 60_000,
    });
  }

  // Se não for super admin e não tiver nenhuma empresa vinculada como admin, nega o acesso
  if (!isSuper && adminCompanyIds.length === 0) {
    console.warn("Acesso administrativo negado para o usuário:", user.id, user.email);
    throw new AdminAccessError("Você não possui privilégios para acessar o painel administrativo.", 403);
  }

  return {
    user,
    admin,
    userClient,
    isSuperAdmin: isSuper,
    adminCompanyIds,
  };
}

export const requireAdmin = requireSuperAdmin;

export async function withSuperAdmin(
  action: string,
  handler: (context: AdminContext) => Promise<Response>,
  request?: Request
): Promise<Response> {
  try {
    const context = await requireSuperAdmin(request);
    return await handler(context);
  } catch (error) {
    if (error instanceof AdminAccessError) {
      return jsonError(error.message, error.status);
    }
    const msg = extractErrorMessage(error);
    console.error(`Erro na ação de super admin (${action}):`, error);
    return jsonError(`Erro ao executar ${action}: ${msg}`, 500);
  }
}

export const withAdmin = withSuperAdmin;

export async function writeAdminAudit(
  admin: SupabaseClient,
  params: {
    userId?: string | null;
    empresaId?: string | null;
    acao: string;
    detalhes?: Record<string, unknown>;
  }
) {
  try {
    const { error } = await admin.from("auditoria").insert({
      user_id: params.userId || null,
      empresa_id: params.empresaId || null,
      acao: params.acao,
      detalhes: params.detalhes || {},
    });
    if (error) {
      console.warn("Aviso ao gravar auditoria:", error.message);
    }
  } catch (err) {
    console.warn("Falha ao registrar auditoria:", err);
  }
}
