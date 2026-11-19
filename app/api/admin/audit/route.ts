import { withSuperAdmin } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withSuperAdmin("consultar auditoria", async ({ admin, isSuperAdmin, adminCompanyIds }) => {
    // A rota é protegida por withSuperAdmin/withAdmin.
    const client = admin;
    const { searchParams } = new URL(request.url);

    const empresaId = searchParams.get("empresa_id") || "";
    const acao = searchParams.get("acao") || "";
    const periodo = searchParams.get("periodo") || "todos";
    const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
    const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10)));

    let query = client
      .from("auditoria")
      .select("id,user_id,empresa_id,acao,detalhes,created_at", { count: "exact" });

    // Se NÃO for Super Admin, restringe aos registros das empresas em que é admin
    if (!isSuperAdmin) {
      query = query.in("empresa_id", adminCompanyIds);
    }

    // Filtro por empresa específica
    if (empresaId && empresaId !== "todas") {
      if (!isSuperAdmin && !adminCompanyIds.includes(empresaId)) {
        return Response.json({ registros: [], total: 0, page: 1, totalPages: 1 });
      }
      query = query.eq("empresa_id", empresaId);
    }

    // Filtro por ação
    if (acao && acao !== "todas") {
      query = query.eq("acao", acao);
    }

    // Filtro por período
    const now = new Date();
    if (periodo === "hoje") {
      const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
      query = query.gte("created_at", startOfDay);
    } else if (periodo === "7d") {
      const past7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", past7d);
    } else if (periodo === "30d") {
      const past30d = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
      query = query.gte("created_at", past30d);
    }

    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const { data: rows, count, error } = await query
      .order("created_at", { ascending: false })
      .range(from, to);

    if (error) {
      // Se a tabela auditoria ainda não existir no Postgres, retorna lista vazia segura
      if (
        error.code === "PGRST205" ||
        error.message?.includes("auditoria") ||
        error.message?.includes("schema cache")
      ) {
        console.warn("Aviso: Tabela 'auditoria' não encontrada no banco. Retornando vazio.");
        return Response.json({
          registros: [],
          total: 0,
          page: 1,
          pageSize,
          totalPages: 1,
          tableMissing: true,
        });
      }
      throw new Error(error.message);
    }

    // Mapear empresas
    const { data: companies } = await admin
      .from("empresas")
      .select("id,nome");
    const companyMap = new Map((companies || []).map((c) => [c.id, c.nome]));

    // Mapear usuários do Auth
    const { data: authData } = await admin.auth.admin.listUsers({ perPage: 1000 }).catch(() => ({ data: { users: [] } }));
    const userMap = new Map((authData?.users || []).map((u) => [u.id, u.email || ""]));

    const total = count || 0;
    const totalPages = Math.ceil(total / pageSize);

    const registros = (rows || []).map((row) => ({
      id: row.id,
      user_id: row.user_id,
      user_email: row.user_id ? userMap.get(row.user_id) || "Usuário não localizado" : "Sistema (Automático)",
      empresa_id: row.empresa_id,
      empresa_nome: row.empresa_id ? companyMap.get(row.empresa_id) || "Empresa não localizada" : "Geral / Sistema",
      acao: row.acao,
      detalhes: row.detalhes || {},
      created_at: row.created_at,
    }));

    return Response.json({
      registros,
      total,
      page,
      pageSize,
      totalPages,
    });
  }, request);
}
