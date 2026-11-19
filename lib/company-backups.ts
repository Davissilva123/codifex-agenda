import { strToU8, strFromU8, zipSync, unzipSync } from "fflate";
import type { SupabaseClient } from "@supabase/supabase-js";

export const COMPANY_BACKUP_BUCKET = "empresa-backups";
export const BACKUP_TABLES = [
  "agendamentos",
  "categorias",
  "tipos_agendamento",
  "observacoes",
  "contatos",
  "telefones",
  "push_subscriptions",
  "aniversario_alertas_enviados",
  "notas",
] as const;

export type CompanyBackupType = "automatico" | "manual" | "pre_restauracao";

async function loadCompanyRows(client: SupabaseClient, fallback: SupabaseClient, table: string, empresaId: string) {
  const rows: Record<string, unknown>[] = [];
  const pageSize = 1000;
  for (let offset = 0; ; offset += pageSize) {
    let { data, error } = await client
      .from(table)
      .select("*")
      .eq("empresa_id", empresaId)
      .range(offset, offset + pageSize - 1);

    if (error && client !== fallback) {
      const fb = await fallback
        .from(table)
        .select("*")
        .eq("empresa_id", empresaId)
        .range(offset, offset + pageSize - 1);
      data = fb.data;
      error = fb.error;
    }

    if (error) {
      console.warn(`Aviso ao ler tabela ${table} para backup:`, error.message);
      return rows;
    }

    rows.push(...(data || []) as Record<string, unknown>[]);
    if (!data || data.length < pageSize) return rows;
  }
}

export async function createCompanyBackup(
  client: SupabaseClient,
  empresaId: string,
  type: CompanyBackupType,
  actorId: string | null,
  fallbackClient?: SupabaseClient
) {
  const fb = fallbackClient || client;

  // 1. Obter dados da empresa
  let { data: company, error: companyError } = await client
    .from("empresas")
    .select("id,nome,status,plano,vencimento")
    .eq("id", empresaId)
    .maybeSingle();

  if (!company && client !== fb) {
    const fbComp = await fb
      .from("empresas")
      .select("id,nome,status,plano,vencimento")
      .eq("id", empresaId)
      .maybeSingle();
    company = fbComp.data;
    companyError = fbComp.error;
  }

  if (companyError) throw new Error(companyError.message);
  if (!company) {
    throw new Error("Empresa não encontrada no banco de dados.");
  }

  // 2. Carregar registros de todas as tabelas da empresa
  const tableRows = await Promise.all(BACKUP_TABLES.map((table) =>
    loadCompanyRows(client, fb, table, empresaId)
  ));
  const tables = Object.fromEntries(BACKUP_TABLES.map((table, index) => [table, tableRows[index]]));
  const summary = Object.fromEntries(BACKUP_TABLES.map((table) => [
    table,
    (tables[table] as unknown[]).length,
  ]));

  const createdAt = new Date();
  const date = createdAt.toISOString().slice(0, 10);
  const clock = createdAt.toISOString().slice(11, 16).replace(":", "");
  const backupId = crypto.randomUUID();
  const objectPath = `backups/${empresaId}/${date}_${clock}-${backupId.slice(0, 8)}.zip`;
  const metadata = {
    format_version: 1,
    schema_version: 1,
    created_at: createdAt.toISOString(),
    empresa: company,
    summary,
  };

  const archive = zipSync({
    "metadata.json": strToU8(JSON.stringify(metadata, null, 2)),
    ...Object.fromEntries(BACKUP_TABLES.map((table) => [
      `tables/${table}.json`,
      strToU8(JSON.stringify(tables[table], null, 2)),
    ])),
  });

  if (archive.byteLength > 50 * 1024 * 1024) {
    throw new Error("O backup excede o limite de 50 MB configurado para o armazenamento.");
  }

  // 3. Upload para o Supabase Storage
  let storage = client.storage.from(COMPANY_BACKUP_BUCKET);
  let { error: uploadError } = await storage.upload(objectPath, archive, {
    contentType: "application/zip",
    upsert: true,
  });

  if (uploadError && client !== fb) {
    storage = fb.storage.from(COMPANY_BACKUP_BUCKET);
    const fbUpload = await storage.upload(objectPath, archive, {
      contentType: "application/zip",
      upsert: true,
    });
    uploadError = fbUpload.error;
  }

  if (uploadError) {
    throw new Error(`Falha no upload do arquivo de backup para o Storage: ${uploadError.message}. Verifique se o bucket "${COMPANY_BACKUP_BUCKET}" existe.`);
  }

  // 4. Inserir registro na tabela backups
  let { data: backup, error: backupError } = await client
    .from("backups")
    .insert({
      id: backupId,
      empresa_id: empresaId,
      arquivo: objectPath,
      tipo: type,
      tamanho_bytes: archive.byteLength,
      resumo: summary,
      criado_por: actorId,
    })
    .select("id,empresa_id,arquivo,tipo,tamanho_bytes,resumo,criado_por,created_at")
    .maybeSingle();

  if ((backupError || !backup) && client !== fb) {
    const fbInsert = await fb
      .from("backups")
      .insert({
        id: backupId,
        empresa_id: empresaId,
        arquivo: objectPath,
        tipo: type,
        tamanho_bytes: archive.byteLength,
        resumo: summary,
        criado_por: actorId,
      })
      .select("id,empresa_id,arquivo,tipo,tamanho_bytes,resumo,criado_por,created_at")
      .maybeSingle();
    backup = fbInsert.data;
    backupError = fbInsert.error;
  }

  if (backupError) {
    await storage.remove([objectPath]).catch(() => {});
    throw new Error(`Não foi possível registrar o backup na tabela: ${backupError.message}`);
  }

  return { backup: backup || { id: backupId, arquivo: objectPath, created_at: createdAt.toISOString() }, summary };
}

export async function removeExpiredCompanyBackups(admin: SupabaseClient) {
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  for (;;) {
    const { data: expired, error } = await admin
      .from("backups")
      .select("id,empresa_id,arquivo,created_at")
      .lt("created_at", cutoff)
      .order("created_at")
      .limit(1000);
    if (error) throw error;
    if (!expired?.length) return;

    for (const backup of expired) {
      try {
        await admin.storage.from(COMPANY_BACKUP_BUCKET).remove([backup.arquivo]);
      } catch {}
      try {
        await admin.from("backups").delete().eq("id", backup.id);
      } catch {}
    }
  }
}

export async function restoreCompanyBackup(
  admin: SupabaseClient,
  empresaId: string,
  backupId: string,
  actorId: string | null
) {
  // 1. Obter informações da empresa e do backup
  const { data: company, error: companyErr } = await admin
    .from("empresas")
    .select("id,nome")
    .eq("id", empresaId)
    .single();

  if (companyErr || !company) {
    throw new Error("Empresa não encontrada.");
  }

  const { data: backup, error: backupErr } = await admin
    .from("backups")
    .select("id,empresa_id,arquivo,tipo,created_at")
    .eq("id", backupId)
    .single();

  if (backupErr || !backup) {
    throw new Error("Backup não encontrado.");
  }

  if (backup.empresa_id !== empresaId) {
    throw new Error("O arquivo de backup selecionado não pertence a esta empresa.");
  }

  // 2. Criar backup automático de segurança pré-restauração
  const preRestore = await createCompanyBackup(
    admin,
    empresaId,
    "pre_restauracao",
    actorId
  );

  // 3. Baixar o arquivo ZIP do Storage
  const { data: fileBlob, error: downloadError } = await admin.storage
    .from(COMPANY_BACKUP_BUCKET)
    .download(backup.arquivo);

  if (downloadError || !fileBlob) {
    throw new Error(`Falha ao baixar o backup do storage: ${downloadError?.message || "Arquivo indisponível"}`);
  }

  const zipBytes = new Uint8Array(await fileBlob.arrayBuffer());
  const unzipped = unzipSync(zipBytes);

  // 4. Tabelas e ordens de dependência
  const INSERT_ORDER = [
    "categorias",
    "tipos_agendamento",
    "observacoes",
    "agendamentos",
    "contatos",
    "telefones",
    "push_subscriptions",
    "aniversario_alertas_enviados",
    "notas",
  ] as const;

  const DELETE_ORDER = [
    "aniversario_alertas_enviados",
    "telefones",
    "contatos",
    "agendamentos",
    "observacoes",
    "tipos_agendamento",
    "categorias",
    "push_subscriptions",
    "notas",
  ] as const;

  const tablesData: Record<string, Record<string, unknown>[]> = {};
  for (const table of INSERT_ORDER) {
    const filename = `tables/${table}.json`;
    if (unzipped[filename]) {
      try {
        const jsonStr = strFromU8(unzipped[filename]);
        const rows = JSON.parse(jsonStr);
        if (Array.isArray(rows)) {
          // Garantir isolamento estrito por empresa_id
          tablesData[table] = rows.map((r: Record<string, unknown>) => ({
            ...r,
            empresa_id: empresaId,
          }));
        } else {
          tablesData[table] = [];
        }
      } catch {
        tablesData[table] = [];
      }
    } else {
      tablesData[table] = [];
    }
  }

  // 5. Aplicador de dados filtrado por empresa_id
  async function applyTables(dataToApply: Record<string, Record<string, unknown>[]>) {
    // A. Deletar registros atuais SOMENTE desta empresa
    for (const table of DELETE_ORDER) {
      const { error: delErr } = await admin
        .from(table)
        .delete()
        .eq("empresa_id", empresaId);
      if (delErr) {
        throw new Error(`Erro ao limpar tabela ${table}: ${delErr.message}`);
      }
    }

    // B. Inserir registros restaurados em lotes
    const summary: Record<string, number> = {};
    for (const table of INSERT_ORDER) {
      const rows = dataToApply[table] || [];
      summary[table] = rows.length;
      if (rows.length > 0) {
        const chunkSize = 500;
        for (let i = 0; i < rows.length; i += chunkSize) {
          const chunk = rows.slice(i, i + chunkSize);
          const { error: insErr } = await admin
            .from(table)
            .insert(chunk);
          if (insErr) {
            throw new Error(`Erro ao restaurar dados na tabela ${table}: ${insErr.message}`);
          }
        }
      }
    }
    return summary;
  }

  // 6. Execução com proteção de reversão (Rollback)
  try {
    const summary = await applyTables(tablesData);
    return {
      success: true,
      backupId,
      preRestoreBackupId: preRestore.backup.id,
      summary,
    };
  } catch (error) {
    console.error("Falha na restauração do backup. Revertendo para backup de segurança pré-restauração...", error);
    try {
      const { data: preBlob } = await admin.storage
        .from(COMPANY_BACKUP_BUCKET)
        .download(preRestore.backup.arquivo);
      if (preBlob) {
        const preZip = unzipSync(new Uint8Array(await preBlob.arrayBuffer()));
        const rollbackData: Record<string, Record<string, unknown>[]> = {};
        for (const table of INSERT_ORDER) {
          const fn = `tables/${table}.json`;
          if (preZip[fn]) {
            rollbackData[table] = JSON.parse(strFromU8(preZip[fn]));
          }
        }
        await applyTables(rollbackData);
      }
    } catch (rbError) {
      console.error("Erro ao aplicar rollback de segurança:", rbError);
    }
    const msg = error instanceof Error ? error.message : "Erro desconhecido durante a restauração.";
    throw new Error(`Falha na restauração: ${msg}. Os dados originais da empresa foram restaurados com segurança.`);
  }
}
