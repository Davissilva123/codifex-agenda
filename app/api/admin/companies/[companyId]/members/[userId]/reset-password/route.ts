import { jsonError, withSuperAdmin, writeAdminAudit } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ companyId: string; userId: string }> }
) {
  const { companyId, userId } = await params;
  return withSuperAdmin("resetar senha de membro", async ({ admin, user, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para gerenciar os membros desta empresa.", 403);
    }
    // 1. Obter e-mail do usuário pelo Auth Admin
    const { data: authUser, error: getUserError } = await admin.auth.admin.getUserById(userId);

    if (getUserError || !authUser?.user?.email) {
      return jsonError("Usuário não encontrado no serviço de autenticação.", 404);
    }

    const email = authUser.user.email;

    // 2. Disparar link de redefinição / e-mail de recuperação
    let actionLink: string | undefined;

    try {
      const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
        type: "recovery",
        email,
      });

      if (!linkError && linkData?.properties?.action_link) {
        actionLink = linkData.properties.action_link;
      }
    } catch {
      // Ignora erro se generateLink falhar e tenta resetPasswordForEmail
    }

    const { error: resetError } = await admin.auth.resetPasswordForEmail(email);

    if (resetError && !actionLink) {
      throw new Error(`Não foi possível enviar o e-mail de redefinição: ${resetError.message}`);
    }

    // 3. Registrar auditoria
    await writeAdminAudit(admin, {
      userId: user.id,
      empresaId: companyId,
      acao: "membro.senha_resetada",
      detalhes: {
        membro_id: userId,
        email,
      },
    });

    return Response.json({
      success: true,
      message: "Instruções de redefinição de senha processadas com sucesso.",
      action_link: actionLink,
    });
  }, request);
}
