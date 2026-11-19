import { jsonError, withSuperAdmin } from "@/lib/admin-server";
import { COMPANY_BACKUP_BUCKET } from "@/lib/company-backups";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ backupId: string }> }
) {
  const { backupId } = await params;
  return withSuperAdmin("baixar arquivo de backup", async ({ admin, userClient, isSuperAdmin, adminCompanyIds }) => {
    const client = userClient || admin;

    let { data: backup, error: backupError } = await client
      .from("backups")
      .select("id,empresa_id,arquivo,tipo,tamanho_bytes,created_at")
      .eq("id", backupId)
      .maybeSingle();

    if (!backup && client !== admin) {
      const fb = await admin
        .from("backups")
        .select("id,empresa_id,arquivo,tipo,tamanho_bytes,created_at")
        .eq("id", backupId)
        .maybeSingle();
      backup = fb.data;
      backupError = fb.error;
    }

    if (backupError || !backup) {
      return jsonError("Backup não encontrado.", 404);
    }

    if (!isSuperAdmin && !adminCompanyIds.includes(backup.empresa_id)) {
      return jsonError("Você não tem permissão para acessar este backup.", 403);
    }

    let { data: fileBlob, error: downloadError } = await client.storage
      .from(COMPANY_BACKUP_BUCKET)
      .download(backup.arquivo);

    if (downloadError && client !== admin) {
      const fbDown = await admin.storage
        .from(COMPANY_BACKUP_BUCKET)
        .download(backup.arquivo);
      fileBlob = fbDown.data;
      downloadError = fbDown.error;
    }

    if (downloadError || !fileBlob) {
      return jsonError(`Não foi possível carregar o arquivo do storage: ${downloadError?.message || "Arquivo indisponível"}`, 500);
    }

    const arrayBuffer = await fileBlob.arrayBuffer();
    const filename = backup.arquivo.split("/").pop() || `backup-${backupId}.zip`;

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": arrayBuffer.byteLength.toString(),
      },
    });
  }, request);
}
