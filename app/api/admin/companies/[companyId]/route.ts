import { jsonError, withSuperAdmin, writeAdminAudit } from "@/lib/admin-server";

export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  return withSuperAdmin("atualizar empresa", async ({ admin, userClient, user, isSuperAdmin, adminCompanyIds }) => {
    if (!isSuperAdmin && !adminCompanyIds.includes(companyId)) {
      return jsonError("Você não tem permissão para gerenciar esta empresa.", 403);
    }
    const client = userClient || admin;

    const body = (await request.json().catch(() => ({}))) as {
      nome?: string;
      plano?: string;
      vencimento?: string | null;
      status?: "ativa" | "suspensa";
      nao_suspender_automaticamente?: boolean;
    };

    const updates: Record<string, unknown> = {};
    if ("nome" in body) {
      const nome = (body.nome || "").trim();
      if (!nome) return jsonError("Informe o nome da empresa.", 400);
      if (nome.length < 3) return jsonError("O nome precisa ter pelo menos 3 caracteres.", 400);

      // Verificar duplicidade de nome em outra empresa
      const { data: existing } = await client
        .from("empresas")
        .select("id")
        .ilike("nome", nome)
        .neq("id", companyId)
        .maybeSingle();

      if (existing) {
        return jsonError("Já existe uma empresa com esse nome.", 409);
      }
      updates.nome = nome;
    }

    if ("plano" in body) {
      const plano = (body.plano || "").trim();
      if (!plano) return jsonError("Escolha um plano.", 400);
      updates.plano = plano;
    }

    if ("vencimento" in body) updates.vencimento = body.vencimento || null;
    if (body.status === "ativa" || body.status === "suspensa") updates.status = body.status;
    if ("nao_suspender_automaticamente" in body) {
      updates.nao_suspender_automaticamente = Boolean(body.nao_suspender_automaticamente);
    }

    if (Object.keys(updates).length === 0) {
      return jsonError("Nenhum dado válido para atualização fornecido.", 400);
    }

    let { data: updated, error } = await client
      .from("empresas")
      .update(updates)
      .eq("id", companyId)
      .select("id,nome,status,plano,vencimento,nao_suspender_automaticamente,created_at")
      .single();

    if (error && client !== admin) {
      const fb = await admin
        .from("empresas")
        .update(updates)
        .eq("id", companyId)
        .select("id,nome,status,plano,vencimento,nao_suspender_automaticamente,created_at")
        .single();
      updated = fb.data;
      error = fb.error;
    }

    // Fallback sem a coluna nao_suspender_automaticamente caso ela não exista
    if (error && "nao_suspender_automaticamente" in updates) {
      const safeUpdates = { ...updates };
      delete safeUpdates.nao_suspender_automaticamente;
      const retry = await (client !== admin ? admin : client)
        .from("empresas")
        .update(safeUpdates)
        .eq("id", companyId)
        .select("id,nome,status,plano,vencimento,created_at")
        .single();
      updated = retry.data ? { ...retry.data, nao_suspender_automaticamente: false } : null;
      error = retry.error;
    }

    if (error) throw new Error(error.message);

    // Registro em auditoria
    if (body.status === "suspensa" || body.status === "ativa") {
      await writeAdminAudit(admin, {
        userId: user.id,
        empresaId: companyId,
        acao: body.status === "suspensa" ? "empresa.suspensa" : "empresa.reativada",
        detalhes: {
          nome: updated?.nome,
          status: body.status,
        },
      });
    } else {
      await writeAdminAudit(admin, {
        userId: user.id,
        empresaId: companyId,
        acao: "empresa.atualizada",
        detalhes: {
          nome: updated?.nome,
          campos: Object.keys(updates),
        },
      });
    }

    return Response.json({ empresa: updated });
  }, request);
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ companyId: string }> }
) {
  const { companyId } = await params;
  return withSuperAdmin("excluir empresa", async ({ admin, userClient, user, isSuperAdmin }) => {
    if (!isSuperAdmin) {
      return jsonError("Apenas o Super Admin pode excluir empresas.", 403);
    }
    const client = userClient || admin;

    // 1. Bloquear apenas se for a única empresa ativa em todo o sistema
    const { count: activeCount } = await admin
      .from("empresas")
      .select("id", { count: "exact", head: true })
      .eq("status", "ativa");

    if (activeCount !== null && activeCount <= 1) {
      const { data: targetComp } = await admin
        .from("empresas")
        .select("status")
        .eq("id", companyId)
        .maybeSingle();
      if (targetComp?.status === "ativa") {
        return jsonError("Não é possível excluir a empresa em uso.", 400);
      }
    }

    // 2. Bloquear apenas se for a empresa ativa em uso informada pelo cliente
    const activeCompanyHeader = request.headers.get("x-active-company-id");
    if (activeCompanyHeader && activeCompanyHeader === companyId) {
      return jsonError("Não é possível excluir a empresa em uso.", 400);
    }

    // 3. Excluir a empresa
    let deleted = false;

    // Estratégia A: RPC com SECURITY DEFINER (ignora RLS mesmo com anon key)
    try {
      const { data: rpcRes, error: rpcErr } = await client.rpc("excluir_empresa_admin", {
        p_empresa_id: companyId,
      });
      if (!rpcErr && rpcRes && (rpcRes as { success?: boolean }).success) {
        deleted = true;
      }
    } catch {
      // Ignora erro se RPC não foi criada ainda
    }

    // Estratégia B: DELETE direto com select para confirmar linhas afetadas
    if (!deleted) {
      const { data: delUser } = await client
        .from("empresas")
        .delete()
        .eq("id", companyId)
        .select("id");

      if (delUser && delUser.length > 0) {
        deleted = true;
      } else {
        const { data: delAdmin, error: adminErr } = await admin
          .from("empresas")
          .delete()
          .eq("id", companyId)
          .select("id");

        if (delAdmin && delAdmin.length > 0) {
          deleted = true;
        } else if (adminErr) {
          throw new Error(adminErr.message);
        }
      }
    }

    if (!deleted) {
      return jsonError(
        "A empresa não pôde ser excluída. Execute o script SQL no Supabase para conceder permissão de exclusão.",
        400
      );
    }

    await writeAdminAudit(admin, {
      userId: user.id,
      empresaId: companyId,
      acao: "empresa.excluida",
      detalhes: { empresa_id: companyId },
    });

    return Response.json({ success: true, message: "Empresa excluída com sucesso." });
  }, request);
}
