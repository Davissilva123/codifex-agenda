import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { writeAdminAudit } from "@/lib/admin-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET não configurado.");
    return Response.json({ error: "Agendamento não configurado." }, { status: 503 });
  }

  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();

  // Obter data de hoje em formato YYYY-MM-DD
  const todayStr = new Date().toISOString().slice(0, 10);

  // Consultar empresas ativas com vencimento anterior a hoje
  let query = admin
    .from("empresas")
    .select("id,nome,plano,vencimento,status,nao_suspender_automaticamente")
    .eq("status", "ativa")
    .not("vencimento", "is", null)
    .lt("vencimento", todayStr);

  const { data: expiredCompanies, error: queryError } = await query;

  if (queryError) {
    // Caso a coluna nao_suspender_automaticamente ainda não exista no banco, tenta sem ela
    const fbQuery = await admin
      .from("empresas")
      .select("id,nome,plano,vencimento,status")
      .eq("status", "ativa")
      .not("vencimento", "is", null)
      .lt("vencimento", todayStr);

    if (fbQuery.error) {
      console.error("Erro ao consultar empresas vencidas:", fbQuery.error);
      return Response.json({ error: "Falha ao consultar empresas vencidas." }, { status: 500 });
    }

    const toSuspend = fbQuery.data || [];
    const suspendedList: string[] = [];

    for (const company of toSuspend) {
      const { error: updateError } = await admin
        .from("empresas")
        .update({ status: "suspensa" })
        .eq("id", company.id);

      if (!updateError) {
        suspendedList.push(company.nome);
        await writeAdminAudit(admin, {
          userId: null,
          empresaId: company.id,
          acao: "empresa.suspensa",
          detalhes: {
            motivo: "vencimento_plano",
            automatico: true,
            vencimento: company.vencimento,
            empresa_nome: company.nome,
          },
        });
      }
    }

    return Response.json({
      success: true,
      data_execucao: todayStr,
      empresas_suspensas: suspendedList.length,
      lista: suspendedList,
    });
  }

  // Filtrar quem tem permissão para exceção (não_suspender_automaticamente === true)
  const toSuspend = (expiredCompanies || []).filter(
    (c) => !(c as { nao_suspender_automaticamente?: boolean }).nao_suspender_automaticamente
  );

  const suspendedList: string[] = [];

  for (const company of toSuspend) {
    const { error: updateError } = await admin
      .from("empresas")
      .update({ status: "suspensa" })
      .eq("id", company.id);

    if (!updateError) {
      suspendedList.push(company.nome);
      await writeAdminAudit(admin, {
        userId: null,
        empresaId: company.id,
        acao: "empresa.suspensa",
        detalhes: {
          motivo: "vencimento_plano",
          automatico: true,
          vencimento: company.vencimento,
          empresa_nome: company.nome,
        },
      });
    } else {
      console.error(`Falha ao suspender empresa vencida ${company.nome}:`, updateError);
    }
  }

  return Response.json({
    success: true,
    data_execucao: todayStr,
    empresas_analisadas: expiredCompanies?.length || 0,
    empresas_suspensas: suspendedList.length,
    lista: suspendedList,
  });
}
