import { jsonError, withSuperAdmin, writeAdminAudit } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withSuperAdmin("listar empresas", async ({ admin, userClient, isSuperAdmin, adminCompanyIds }) => {
    // Utiliza o client admin (service_role) com filtro estrito de id para evitar bloqueios de RLS
    const client = admin;

    let query = client
      .from("empresas")
      .select("id,nome,status,plano,vencimento,nao_suspender_automaticamente,created_at")
      .order("nome");

    // Se NÃO for Super Admin (davi@avisnet.com.br), visualiza SOMENTE as empresas em que é admin_empresa
    if (!isSuperAdmin) {
      query = query.in("id", adminCompanyIds);
    }

    let { data: companies, error: companiesError } = await query;

    if (companiesError) {
      // Fallback caso a coluna nao_suspender_automaticamente ainda não exista no banco
      let fbQuery = client
        .from("empresas")
        .select("id,nome,status,plano,vencimento,created_at")
        .order("nome");

      if (!isSuperAdmin) {
        fbQuery = fbQuery.in("id", adminCompanyIds);
      }

      const fb = await fbQuery;
      companies = (fb.data || []).map((c) => ({
        ...c,
        nao_suspender_automaticamente: false,
      }));
      companiesError = fb.error;
    }

    if (companiesError) {
      throw new Error(companiesError.message || "Erro ao consultar empresas.");
    }

    const companyIds = (companies || []).map((c) => c.id);

    let membersCounts: Record<string, number> = {};
    let lastBackups: Record<string, { id: string; created_at: string; tipo: string }> = {};

    if (companyIds.length > 0) {
      // Executa as consultas de contagem de membros e último backup em paralelo
      const [membersRes, backupsRes] = await Promise.all([
        client
          .from("membros")
          .select("empresa_id")
          .in("empresa_id", companyIds)
          .eq("status", "ativo"),
        client
          .from("backups")
          .select("id,empresa_id,created_at,tipo")
          .in("empresa_id", companyIds)
          .order("created_at", { ascending: false }),
      ]);

      if (!membersRes.error && membersRes.data) {
        membersCounts = membersRes.data.reduce((acc, m) => {
          acc[m.empresa_id] = (acc[m.empresa_id] || 0) + 1;
          return acc;
        }, {} as Record<string, number>);
      }

      if (!backupsRes.error && backupsRes.data) {
        for (const b of backupsRes.data) {
          if (!lastBackups[b.empresa_id]) {
            lastBackups[b.empresa_id] = { id: b.id, created_at: b.created_at, tipo: b.tipo };
          }
        }
      }
    }

    const result = (companies || []).map((company) => ({
      ...company,
      nao_suspender_automaticamente: Boolean((company as { nao_suspender_automaticamente?: boolean }).nao_suspender_automaticamente),
      membros_ativos: membersCounts[company.id] || 0,
      ultimo_backup: lastBackups[company.id] || null,
    }));

    return Response.json({ empresas: result });
  }, request);
}

export async function POST(request: Request) {
  return withSuperAdmin("criar empresa", async ({ admin, userClient, user, isSuperAdmin }) => {
    if (!isSuperAdmin) {
      return jsonError("Apenas o Super Admin pode criar novas empresas.", 403);
    }
    const client = userClient || admin;

    const body = (await request.json().catch(() => ({}))) as {
      nome?: string;
      plano?: string;
      vencimento?: string | null;
      nao_suspender_automaticamente?: boolean;
    };

    const nome = (body.nome || "").trim();
    if (!nome) {
      return jsonError("Informe o nome da empresa.", 400);
    }
    if (nome.length < 3) {
      return jsonError("O nome precisa ter pelo menos 3 caracteres.", 400);
    }

    const plano = (body.plano || "").trim();
    if (!plano) {
      return jsonError("Escolha um plano.", 400);
    }

    // Verificar duplicidade de nome (case-insensitive)
    const { data: existing } = await client
      .from("empresas")
      .select("id")
      .ilike("nome", nome)
      .maybeSingle();

    if (existing) {
      return jsonError("Já existe uma empresa com esse nome.", 409);
    }

    const vencimentoVal = body.vencimento && body.vencimento.trim() ? body.vencimento.trim() : null;
    const naoSuspender = Boolean(body.nao_suspender_automaticamente);

    let insertPayload: Record<string, unknown> = {
      nome,
      plano,
      vencimento: vencimentoVal,
      status: "ativa",
      nao_suspender_automaticamente: naoSuspender,
    };

    let { data: company, error: insertError } = await client
      .from("empresas")
      .insert(insertPayload)
      .select("id,nome,status,plano,vencimento,nao_suspender_automaticamente,created_at")
      .single();

    if (insertError && client !== admin) {
      const fallback = await admin
        .from("empresas")
        .insert(insertPayload)
        .select("id,nome,status,plano,vencimento,nao_suspender_automaticamente,created_at")
        .single();
      company = fallback.data;
      insertError = fallback.error;
    }

    if (insertError) {
      // Fallback sem a coluna caso ela não exista
      delete insertPayload.nao_suspender_automaticamente;
      const retry = await (client !== admin ? admin : client)
        .from("empresas")
        .insert(insertPayload)
        .select("id,nome,status,plano,vencimento,created_at")
        .single();
      company = retry.data ? { ...retry.data, nao_suspender_automaticamente: false } : null;
      insertError = retry.error;
    }

    if (insertError) {
      if (insertError.code === "23505") {
        return jsonError("Já existe uma empresa com esse nome.", 409);
      }
      throw new Error(insertError.message || "Falha ao inserir empresa.");
    }

    if (!company) {
      throw new Error("Não foi possível obter os dados da empresa criada.");
    }

    // Registrar auditoria
    await writeAdminAudit(admin, {
      userId: user.id,
      empresaId: company.id,
      acao: "empresa.criada",
      detalhes: {
        nome: company.nome,
        plano: company.plano,
        vencimento: company.vencimento,
      },
    });

    // Vincular o criador como membro admin da empresa
    let { error: memberError } = await client.from("membros").insert({
      empresa_id: company.id,
      user_id: user.id,
      papel: "admin_empresa",
      status: "ativo",
    });

    if (memberError && client !== admin) {
      const fb = await admin.from("membros").insert({
        empresa_id: company.id,
        user_id: user.id,
        papel: "admin_empresa",
        status: "ativo",
      });
      memberError = fb.error;
    }

    if (memberError && memberError.code !== "23505") {
      console.warn("Aviso ao vincular membro:", memberError.message);
    }

    return Response.json({ empresa: company }, { status: 201 });
  }, request);
}
