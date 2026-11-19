import { withSuperAdmin, jsonError } from "@/lib/admin-server";
import { createCompanyBackup } from "@/lib/company-backups";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  return withSuperAdmin("listar backups da empresa", async ({ admin, userClient, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para acessar os backups desta empresa.", 403);
    }
    const client = admin;
    let { data: backups, error } = await client
      .from("backups")
      .select("id,empresa_id,arquivo,tipo,tamanho_bytes,resumo,created_at,criado_por")
      .eq("empresa_id", companyId)
      .order("created_at", { ascending: false });

    if (error && client !== admin) {
      const fb = await admin
        .from("backups")
        .select("id,empresa_id,arquivo,tipo,tamanho_bytes,resumo,created_at,criado_por")
        .eq("empresa_id", companyId)
        .order("created_at", { ascending: false });
      backups = fb.data;
      error = fb.error;
    }

    if (error) throw new Error(error.message);
    return Response.json({ backups: backups || [] });
  }, request);
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  return withSuperAdmin("gerar backup manual", async ({ admin, userClient, user, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para gerar backup desta empresa.", 403);
    }
    const client = admin;

    const { backup, summary } = await createCompanyBackup(
      client,
      companyId,
      "manual",
      user.id,
      admin
    );

    return Response.json({
      success: true,
      backup,
      summary,
    }, { status: 201 });
  }, request);
}
