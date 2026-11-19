import { jsonError, withSuperAdmin, writeAdminAudit } from "@/lib/admin-server";
import { restoreCompanyBackup } from "@/lib/company-backups";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ backupId: string }> }
) {
  const { backupId } = await params;
  return withSuperAdmin("restaurar backup de empresa", async ({ admin, user, isSuperAdmin, adminCompanyIds }) => {
    const body = (await request.json().catch(() => ({}))) as {
      empresa_id?: string;
      confirm_nome?: string;
    };

    const empresaId = body.empresa_id?.trim();
    if (!empresaId) {
      return jsonError("ID da empresa não informado.", 400);
    }

    if (!isSuperAdmin && !adminCompanyIds.includes(empresaId)) {
      return jsonError("Você não tem permissão para restaurar backups desta empresa.", 403);
    }

    // 1. Validar nome da empresa para confirmação estrita
    const { data: company, error: compErr } = await admin
      .from("empresas")
      .select("id,nome")
      .eq("id", empresaId)
      .single();

    if (compErr || !company) {
      return jsonError("Empresa não encontrada.", 404);
    }

    const typedName = (body.confirm_nome || "").trim();
    if (typedName !== company.nome.trim()) {
      return jsonError("O nome digitado não confere exatamente com o nome da empresa.", 400);
    }

    // 2. Executar restauração segura com backup prévio de segurança
    const result = await restoreCompanyBackup(admin, empresaId, backupId, user.id);

    // 3. Registrar auditoria
    await writeAdminAudit(admin, {
      userId: user.id,
      empresaId,
      acao: "backup.restaurado",
      detalhes: {
        backup_id: backupId,
        pre_restauracao_id: result.preRestoreBackupId,
        resumo: result.summary,
        empresa_nome: company.nome,
      },
    });

    return Response.json({
      success: true,
      message: `Restauração concluída com sucesso para a empresa "${company.nome}".`,
      summary: result.summary,
      pre_restore_backup_id: result.preRestoreBackupId,
    });
  }, request);
}
