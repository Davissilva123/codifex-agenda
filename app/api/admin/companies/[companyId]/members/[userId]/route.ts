import { jsonError, withSuperAdmin, writeAdminAudit } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string; userId: string }> }
) {
  const { companyId, userId } = await params;
  return withSuperAdmin("atualizar membro da empresa", async ({ admin, user, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para gerenciar os membros desta empresa.", 403);
    }
    const body = (await request.json().catch(() => ({}))) as {
      papel?: "usuario" | "admin_empresa";
      status?: "ativo" | "bloqueado";
    };

    if (userId === user.id && body.papel === "usuario") {
      return jsonError("Você não pode alterar o seu próprio papel.", 400);
    }
    if (userId === user.id && body.status === "bloqueado") {
      return jsonError("Você não pode bloquear o seu próprio acesso.", 400);
    }

    const updates: Record<string, unknown> = {};
    if (body.papel === "usuario" || body.papel === "admin_empresa") updates.papel = body.papel;
    if (body.status === "ativo" || body.status === "bloqueado") updates.status = body.status;

    if (Object.keys(updates).length === 0) {
      return jsonError("Nenhum campo para atualizar.", 400);
    }

    const { data, error } = await admin
      .from("membros")
      .update(updates)
      .eq("empresa_id", companyId)
      .eq("user_id", userId)
      .select("user_id,papel,status")
      .single();

    if (error) throw error;

    // Registrar em auditoria
    if (body.papel) {
      await writeAdminAudit(admin, {
        userId: user.id,
        empresaId: companyId,
        acao: "membro.papel_alterado",
        detalhes: { membro_id: userId, novo_papel: body.papel },
      });
    }
    if (body.status) {
      await writeAdminAudit(admin, {
        userId: user.id,
        empresaId: companyId,
        acao: body.status === "bloqueado" ? "membro.bloqueado" : "membro.desbloqueado",
        detalhes: { membro_id: userId, novo_status: body.status },
      });
    }

    return Response.json({ membro: data });
  }, request);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ companyId: string; userId: string }> }
) {
  const { companyId, userId } = await params;
  return withSuperAdmin("remover membro da empresa", async ({ admin, user, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para gerenciar os membros desta empresa.", 403);
    }
    // 1. Bloquear remover o próprio acesso
    if (userId === user.id) {
      return jsonError("Você não pode remover o seu próprio acesso.", 400);
    }

    // 2. Bloquear remover o último administrador da empresa
    const { data: admins } = await admin
      .from("membros")
      .select("user_id")
      .eq("empresa_id", companyId)
      .eq("papel", "admin_empresa")
      .eq("status", "ativo");

    if (admins && admins.some((a) => a.user_id === userId) && admins.length <= 1) {
      return jsonError("A empresa precisa ter pelo menos um administrador.", 400);
    }

    const { error } = await admin
      .from("membros")
      .delete()
      .eq("empresa_id", companyId)
      .eq("user_id", userId);

    if (error) throw error;

    await writeAdminAudit(admin, {
      userId: user.id,
      empresaId: companyId,
      acao: "membro.removido",
      detalhes: { membro_id: userId },
    });

    return Response.json({ success: true, message: "Membro removido da empresa." });
  }, request);
}
