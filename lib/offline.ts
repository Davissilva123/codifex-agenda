import type { SupabaseClient } from "@supabase/supabase-js";

export type OfflineTable = "agendamentos" | "contatos" | "telefones" | "observacoes" | "notas" | "categorias" | "tipos_agendamento";
type Mutation = {
  id: string;
  table: OfflineTable;
  operation: "insert" | "update" | "delete" | "upsert";
  record?: Record<string, unknown> | Record<string, unknown>[];
  filters?: Record<string, string>;
};

export interface LocalAgendaData {
  agendamentos: Record<string, unknown>[];
  contatos: Record<string, unknown>[];
  telefones: Record<string, unknown>[];
  observacoes: Record<string, unknown>[];
  notas?: Record<string, unknown>[];
  categorias?: Record<string, unknown>[];
  tipos_agendamento?: Record<string, unknown>[];
}

const emptyData = (): LocalAgendaData => ({ agendamentos: [], contatos: [], telefones: [], observacoes: [], notas: [], categorias: [], tipos_agendamento: [] });
const key = (userId: string, suffix: string, empresaId?: string) =>
  `minha-agenda:${userId}:${empresaId || "legado"}:${suffix}`;
const legacyKey = (userId: string, suffix: string) => `minha-agenda:${userId}:${suffix}`;

function migrateLegacyKey(userId: string, suffix: string, empresaId?: string): string {
  const scopedKey = key(userId, suffix, empresaId);
  if (!empresaId || localStorage.getItem(scopedKey) !== null) return scopedKey;
  const legacy = localStorage.getItem(legacyKey(userId, suffix));
  if (legacy !== null) {
    localStorage.setItem(scopedKey, legacy);
    localStorage.removeItem(legacyKey(userId, suffix));
  }
  return scopedKey;
}

function migrateLegacyPendingKey(userId: string, empresaId?: string): string {
  const scopedKey = key(userId, "pending", empresaId);
  if (!empresaId || localStorage.getItem(scopedKey) !== null) return scopedKey;

  const legacy = localStorage.getItem(legacyKey(userId, "pending"));
  if (legacy === null) return scopedKey;
  try {
    const pending = JSON.parse(legacy) as Mutation[];
    const migrated = pending.map((mutation) => {
      const record = Array.isArray(mutation.record)
        ? mutation.record.map((row) => ({ ...row, empresa_id: empresaId }))
        : mutation.record ? { ...mutation.record, empresa_id: empresaId } : undefined;
      const filters = mutation.operation === "update" || mutation.operation === "delete"
        ? { ...(mutation.filters || {}), empresa_id: empresaId }
        : mutation.filters;
      return { ...mutation, record, filters };
    });
    localStorage.setItem(scopedKey, JSON.stringify(migrated));
    localStorage.removeItem(legacyKey(userId, "pending"));
  } catch (error) {
    console.error("Não foi possível migrar as alterações offline para a empresa ativa.", error);
  }
  return scopedKey;
}

function readJson<T>(storageKey: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch (error) {
    console.error("Não foi possível ler os dados locais da agenda.", error);
    return fallback;
  }
}

export function readLocalAgenda(userId: string, empresaId?: string): LocalAgendaData {
  const data = readJson(migrateLegacyKey(userId, "data", empresaId), emptyData());
  if (!data.notas) data.notas = [];
  if (!data.categorias) data.categorias = [];
  if (!data.tipos_agendamento) data.tipos_agendamento = [];
  return data;
}

export function saveLocalAgenda(userId: string, data: LocalAgendaData, empresaId?: string): void {
  if (!data.notas) data.notas = [];
  if (!data.categorias) data.categorias = [];
  if (!data.tipos_agendamento) data.tipos_agendamento = [];
  localStorage.setItem(key(userId, "data", empresaId), JSON.stringify(data));
}

export function readPendingCount(userId: string, empresaId?: string): number {
  return readJson<Mutation[]>(migrateLegacyPendingKey(userId, empresaId), []).length;
}

export function queueOfflineMutation(userId: string, mutation: Omit<Mutation, "id">, empresaId?: string): void {
  const storageKey = migrateLegacyPendingKey(userId, empresaId);
  const pending = readJson<Mutation[]>(storageKey, []);
  pending.push({ ...mutation, id: crypto.randomUUID() });
  localStorage.setItem(storageKey, JSON.stringify(pending));
}

export async function syncOfflineMutations(userId: string, supabase: SupabaseClient, empresaId?: string): Promise<number> {
  const storageKey = migrateLegacyPendingKey(userId, empresaId);
  const pending = readJson<Mutation[]>(storageKey, []);
  let synced = 0;
  for (const mutation of pending) {
    const filters = Object.entries(mutation.filters || {});
    let errorMessage: string | null = null;
    try {
      if (mutation.operation === "insert") {
        let query = supabase.from(mutation.table).insert(mutation.record || {});
        for (const [column, value] of filters) query = query.eq(column, value);
        errorMessage = (await query).error?.message || null;
      } else if (mutation.operation === "upsert") {
        const onConflict = mutation.table === "observacoes"
          ? "empresa_id,user_id,data"
          : mutation.table === "categorias" ? "empresa_id,user_id,nome" : "id";
        let query = supabase.from(mutation.table).upsert(mutation.record || {}, { onConflict });
        for (const [column, value] of filters) query = query.eq(column, value);
        errorMessage = (await query).error?.message || null;
      } else if (mutation.operation === "update") {
        let query = supabase.from(mutation.table).update(mutation.record || {});
        for (const [column, value] of filters) query = query.eq(column, value);
        errorMessage = (await query).error?.message || null;
      } else {
        let query = supabase.from(mutation.table).delete();
        for (const [column, value] of filters) query = query.eq(column, value);
        errorMessage = (await query).error?.message || null;
      }
    } catch (err: unknown) {
      errorMessage = err instanceof Error ? err.message : String(err);
    }

    if (errorMessage) {
      // Se a tabela 'notas' ainda não foi criada no banco remoto, não bloqueia outras sincronizações
      if (mutation.table === "notas" && /relation.*does not exist|schema cache/i.test(errorMessage)) {
        console.warn("A tabela 'notas' ainda não existe no Supabase. As notas permanecem salvas localmente.");
        continue;
      }
      throw new Error(errorMessage);
    }

    const latest = readJson<Mutation[]>(storageKey, []);
    localStorage.setItem(storageKey, JSON.stringify(latest.filter((item) => item.id !== mutation.id)));
    synced++;
  }
  return synced;
}

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!(error instanceof Error)) return false;
  return /failed to fetch|network error|fetch failed|networkerror|load failed|connection/i.test(error.message);
}
