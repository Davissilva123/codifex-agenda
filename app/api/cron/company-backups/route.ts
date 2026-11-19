import { createCompanyBackup, removeExpiredCompanyBackups } from "@/lib/company-backups";
import { createSupabaseAdminClient } from "@/lib/supabase-server";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error("CRON_SECRET não configurado.");
    return Response.json({ error: "Agendamento não configurado." }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "Acesso não autorizado." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  const { data: companies, error } = await admin.from("empresas").select("id").eq("status", "ativa");
  if (error) {
    console.error("Não foi possível carregar empresas para o backup diário.", error);
    return Response.json({ error: "Falha ao carregar empresas." }, { status: 500 });
  }

  const failed: { empresa_id: string; erro: string }[] = [];
  let created = 0;
  for (const company of companies || []) {
    try {
      const { backup, summary } = await createCompanyBackup(admin, company.id, "automatico", null);
      const { error: auditError } = await admin.from("auditoria").insert({
        empresa_id: company.id,
        acao: "backup.automatico_criado",
        detalhes: { backup_id: backup.id, resumo: summary },
      });
      if (auditError) throw auditError;
      created++;
    } catch (backupError) {
      const message = backupError instanceof Error ? backupError.message : "Erro inesperado.";
      console.error(`Falha no backup automático da empresa ${company.id}.`, backupError);
      failed.push({ empresa_id: company.id, erro: message });
    }
  }

  try {
    await removeExpiredCompanyBackups(admin);
  } catch (retentionError) {
    console.error("Falha na retenção dos backups expirados.", retentionError);
    failed.push({
      empresa_id: "retencao",
      erro: retentionError instanceof Error ? retentionError.message : "Erro inesperado.",
    });
  }

  return Response.json({ criados: created, falhas: failed }, { status: failed.length ? 207 : 200 });
}
