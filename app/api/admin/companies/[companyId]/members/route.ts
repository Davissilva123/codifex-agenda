import { jsonError, withSuperAdmin, writeAdminAudit } from "@/lib/admin-server";

// Cache em memória de perfis de auth para evitar chamadas de rede repetidas à API de Auth do Supabase
const userProfileCache = new Map<string, { email: string; last_sign_in_at: string | null }>();

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  return withSuperAdmin("listar membros da empresa", async ({ admin, userClient, user, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para gerenciar os membros desta empresa.", 403);
    }
    type MemberItem = {
      user_id: string;
      email: string;
      papel: "usuario" | "admin_empresa";
      status: "ativo" | "bloqueado";
      ultimo_acesso: string | null;
      created_at?: string;
    };

    // 1. Tentar primeiro a RPC dedicada listar_membros_empresa com o client admin (SECURITY DEFINER, 0ms RLS)
    try {
      const { data: rpcData, error: rpcError } = await admin.rpc("listar_membros_empresa", {
        p_empresa_id: companyId,
      });

      if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
        const membros: MemberItem[] = rpcData.map((row: Record<string, unknown>) => {
          let email = typeof row.email === "string" ? row.email : "";
          const uid = String(row.user_id || "");
          if ((!email || email === "Email não encontrado") && uid === user.id && user.email) {
            email = user.email;
          }
          if (email && email !== "Email não encontrado") {
            userProfileCache.set(uid, {
              email,
              last_sign_in_at: (row.ultimo_acesso as string) || null,
            });
          }
          return {
            user_id: uid,
            email: email || "Email não encontrado",
            papel: (row.papel === "admin_empresa" ? "admin_empresa" : "usuario"),
            status: (row.status === "bloqueado" ? "bloqueado" : "ativo"),
            ultimo_acesso: (row.ultimo_acesso as string) || null,
            created_at: (row.created_at as string) || undefined,
          };
        });

        const hasEmails = membros.some((m) => m.email && m.email !== "Email não encontrado");
        if (hasEmails) {
          return Response.json({ membros });
        }
      }
    } catch {
      // Falha ao rodar RPC, continua para a busca direta
    }

    // 2. Fallback: buscar na tabela membros diretamente com admin
    const { data: memberRows, error } = await admin
      .from("membros")
      .select("user_id,papel,status,created_at")
      .eq("empresa_id", companyId)
      .order("created_at", { ascending: true });

    if (error) throw new Error(error.message);

    // Mapa de usuários do auth (preenche a partir do cache)
    const userMap = new Map<string, { email: string; last_sign_in_at: string | null }>();
    const missingUserIds: string[] = [];

    for (const m of memberRows || []) {
      if (m.user_id === user.id && user.email) {
        userMap.set(m.user_id, { email: user.email, last_sign_in_at: user.last_sign_in_at || null });
      } else if (userProfileCache.has(m.user_id)) {
        userMap.set(m.user_id, userProfileCache.get(m.user_id)!);
      } else {
        missingUserIds.push(m.user_id);
      }
    }

    // Se houver membros sem perfil em cache, buscar em paralelo
    if (missingUserIds.length > 0) {
      // Se forem muitos (>= 5), tentar listUsers uma vez
      if (missingUserIds.length >= 5) {
        try {
          const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 });
          if (authData?.users) {
            for (const u of authData.users) {
              const info = { email: u.email || "", last_sign_in_at: u.last_sign_in_at || null };
              userProfileCache.set(u.id, info);
              if (missingUserIds.includes(u.id)) {
                userMap.set(u.id, info);
              }
            }
          }
        } catch {
          // Ignora erro do listUsers
        }
      }

      // Buscar os restantes em paralelo
      const stillMissing = missingUserIds.filter((id) => !userMap.has(id));
      if (stillMissing.length > 0) {
        await Promise.all(
          stillMissing.map(async (uid) => {
            try {
              const { data: singleUser } = await admin.auth.admin.getUserById(uid);
              if (singleUser?.user) {
                const info = {
                  email: singleUser.user.email || "",
                  last_sign_in_at: singleUser.user.last_sign_in_at || null,
                };
                userProfileCache.set(uid, info);
                userMap.set(uid, info);
              }
            } catch {
              // Ignorar erro individual
            }
          })
        );
      }
    }

    const membros: MemberItem[] = (memberRows || []).map((m) => {
      const authInfo = userMap.get(m.user_id);
      let memberEmail = authInfo?.email;
      if ((!memberEmail || memberEmail === "Email não encontrado") && m.user_id === user.id && user.email) {
        memberEmail = user.email;
      }
      return {
        user_id: m.user_id,
        email: memberEmail || "Email não encontrado",
        papel: m.papel as "usuario" | "admin_empresa",
        status: m.status as "ativo" | "bloqueado",
        ultimo_acesso: authInfo?.last_sign_in_at || null,
        created_at: m.created_at,
      };
    });

    return Response.json({ membros });
  }, request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  return withSuperAdmin("vincular ou convidar membro", async ({ admin, userClient, user: adminActor, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para gerenciar os membros desta empresa.", 403);
    }
    const client = userClient || admin;

    const body = (await request.json().catch(() => ({}))) as {
      email?: string;
      papel?: "usuario" | "admin_empresa";
      metodo?: "convite" | "senha_provisoria";
      senha_provisoria?: string;
    };

    const email = (body.email || "").trim().toLowerCase();
    if (!email) {
      return jsonError("Informe um e-mail.", 400);
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return jsonError("Esse e-mail não parece válido.", 400);
    }

    if (!body.papel || (body.papel !== "usuario" && body.papel !== "admin_empresa")) {
      return jsonError("Escolha um papel válido (usuario ou admin_empresa).", 400);
    }

    // Checar limite de membros pelo plano da empresa
    const { data: compData } = await client
      .from("empresas")
      .select("plano,nome")
      .eq("id", companyId)
      .maybeSingle();

    const planLower = (compData?.plano || "padrão").toLowerCase().trim();
    const PLAN_LIMITS: Record<string, number> = {
      básico: 3,
      basico: 3,
      gratuito: 2,
      grátis: 2,
      gratis: 2,
      padrão: 10,
      padrao: 10,
      profissional: 25,
      pro: 25,
      empresarial: 50,
    };
    const maxMembers = PLAN_LIMITS[planLower] || 10;

    const { count: currentMemberCount } = await admin
      .from("membros")
      .select("user_id", { count: "exact", head: true })
      .eq("empresa_id", companyId)
      .eq("status", "ativo");

    if (currentMemberCount !== null && currentMemberCount >= maxMembers) {
      return jsonError(`Esse plano permite até ${maxMembers} membros ativos.`, 400);
    }

    // 1. Verificar se o usuário já existe no Supabase Auth
    const { data: authData, error: authListError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (authListError) throw new Error(authListError.message);

    const existingAuthUser = authData.users.find((u) => (u.email || "").toLowerCase() === email);

    // CASO A: Usuário já possui cadastro no Supabase Auth
    if (existingAuthUser) {
      // Verificar se já é membro desta empresa
      const { data: existingMember } = await admin
        .from("membros")
        .select("user_id,status,papel")
        .eq("empresa_id", companyId)
        .eq("user_id", existingAuthUser.id)
        .maybeSingle();

      if (existingMember) {
        if (existingMember.status === "ativo") {
          return jsonError("Esse e-mail já é membro desta empresa.", 409);
        } else {
          // Reativar membro anteriormente bloqueado
          const { error: reactivateError } = await admin
            .from("membros")
            .update({ status: "ativo", papel: body.papel })
            .eq("empresa_id", companyId)
            .eq("user_id", existingAuthUser.id);

          if (reactivateError) throw reactivateError;

          await writeAdminAudit(admin, {
            userId: adminActor.id,
            empresaId: companyId,
            acao: "membro.reativado",
            detalhes: {
              membro_id: existingAuthUser.id,
              email,
              papel: body.papel,
            },
          });

          return Response.json({
            success: true,
            message: "Membro reativado com sucesso.",
            membro: {
              user_id: existingAuthUser.id,
              email,
              papel: body.papel,
              status: "ativo",
              ultimo_acesso: existingAuthUser.last_sign_in_at || null,
            },
          });
        }
      }

      // Verificar se o usuário já pertence a outra empresa (regra de isolamento)
      const { count: otherCompaniesCount } = await admin
        .from("membros")
        .select("empresa_id", { count: "exact", head: true })
        .eq("user_id", existingAuthUser.id)
        .eq("status", "ativo")
        .neq("empresa_id", companyId);

      if (otherCompaniesCount && otherCompaniesCount > 0) {
        return jsonError("O usuário deste e-mail já pertence a outra empresa no sistema.", 409);
      }

      // Vincular o usuário existente à empresa
      const { error: insertMemberError } = await admin.from("membros").insert({
        empresa_id: companyId,
        user_id: existingAuthUser.id,
        papel: body.papel,
        status: "ativo",
      });

      if (insertMemberError) throw insertMemberError;

      await writeAdminAudit(admin, {
        userId: adminActor.id,
        empresaId: companyId,
        acao: "membro.vinculado",
        detalhes: {
          membro_id: existingAuthUser.id,
          email,
          papel: body.papel,
        },
      });

      return Response.json({
        success: true,
        message: "Usuário vinculado à empresa com sucesso.",
        membro: {
          user_id: existingAuthUser.id,
          email,
          papel: body.papel,
          status: "ativo",
          ultimo_acesso: existingAuthUser.last_sign_in_at || null,
        },
      }, { status: 201 });
    }

    // CASO B: Usuário NÃO existe no Supabase Auth -> Criar conta pelo servidor
    let newUserId: string;
    let tempPasswordShown: string | undefined;

    if (body.metodo === "senha_provisoria") {
      // Opção B: Criar conta com senha provisória
      const generatedPassword = body.senha_provisoria?.trim() || `Agenda#${Math.floor(100000 + Math.random() * 900000)}`;
      tempPasswordShown = generatedPassword;

      const { data: createData, error: createError } = await admin.auth.admin.createUser({
        email,
        password: generatedPassword,
        email_confirm: true,
        user_metadata: {
          force_password_change: true,
          empresa_id: companyId,
        },
      });

      if (createError || !createData?.user) {
        throw new Error(createError?.message || "Não foi possível criar o usuário no sistema.");
      }

      newUserId = createData.user.id;

      const { error: insertErr } = await admin.from("membros").insert({
        empresa_id: companyId,
        user_id: newUserId,
        papel: body.papel,
        status: "ativo",
      });

      if (insertErr) throw insertErr;

      await writeAdminAudit(admin, {
        userId: adminActor.id,
        empresaId: companyId,
        acao: "membro.criado",
        detalhes: {
          membro_id: newUserId,
          email,
          papel: body.papel,
          metodo: "senha_provisoria",
        },
      });

      return Response.json({
        success: true,
        message: "Usuário criado com sucesso com senha provisória.",
        senha_provisoria: tempPasswordShown,
        membro: {
          user_id: newUserId,
          email,
          papel: body.papel,
          status: "ativo",
          ultimo_acesso: null,
        },
      }, { status: 201 });
    } else {
      // Opção A: Convidar usuário por e-mail (inviteUserByEmail)
      const confirmationRedirectUrl = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "https://davissilva123.github.io/codifex-agenda/";
      const { data: inviteData, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
        redirectTo: confirmationRedirectUrl,
        data: {
          empresa_id: companyId,
        },
      });

      if (inviteError || !inviteData?.user) {
        return jsonError(
          `Não foi possível enviar o convite por e-mail: ${inviteError?.message || "Erro no serviço de e-mail"}. Você pode utilizar a opção "Criar com senha provisória".`,
          400
        );
      }

      newUserId = inviteData.user.id;

      const { error: insertErr } = await admin.from("membros").insert({
        empresa_id: companyId,
        user_id: newUserId,
        papel: body.papel,
        status: "ativo",
      });

      if (insertErr) throw insertErr;

      await writeAdminAudit(admin, {
        userId: adminActor.id,
        empresaId: companyId,
        acao: "membro.convidado",
        detalhes: {
          membro_id: newUserId,
          email,
          papel: body.papel,
          metodo: "convite_email",
        },
      });

      return Response.json({
        success: true,
        message: "Convite enviado por e-mail e usuário vinculado à empresa.",
        membro: {
          user_id: newUserId,
          email,
          papel: body.papel,
          status: "ativo",
          ultimo_acesso: null,
        },
      }, { status: 201 });
    }
  }, request);
}
