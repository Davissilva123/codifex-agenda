import type { SupabaseClient } from "@supabase/supabase-js";

export type OfflineTable = "agendamentos" | "contatos" | "telefones" | "observacoes";
type Mutation = {
  id: string;
  table: OfflineTable;
  operation: "insert" | "update" | "delete" | "upsert";
  record?: Record<string, unknown>;
  filters?: Record<string, string>;
};

export interface LocalAgendaData {
  agendamentos: Record<string, unknown>[];
  contatos: Record<string, unknown>[];
  telefones: Record<string, unknown>[];
  observacoes: Record<string, unknown>[];
}

const emptyData = (): LocalAgendaData => ({ agendamentos: [], contatos: [], telefones: [], observacoes: [] });
const key = (userId: string, suffix: string) => `minha-agenda:${userId}:${suffix}`;

function readJson<T>(storageKey: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(storageKey);
    return raw ? JSON.parse(raw) as T : fallback;
  } catch (error) {
    console.error("Não foi possível ler os dados locais da agenda.", error);
    return fallback;
  }
}

export function readLocalAgenda(userId: string): LocalAgendaData {
  return readJson(key(userId, "data"), emptyData());
}

export function saveLocalAgenda(userId: string, data: LocalAgendaData): void {
  localStorage.setItem(key(userId, "data"), JSON.stringify(data));
}

export function readPendingCount(userId: string): number {
  return readJson<Mutation[]>(key(userId, "pending"), []).length;
}

export function queueOfflineMutation(userId: string, mutation: Omit<Mutation, "id">): void {
  const pending = readJson<Mutation[]>(key(userId, "pending"), []);
  pending.push({ ...mutation, id: crypto.randomUUID() });
  localStorage.setItem(key(userId, "pending"), JSON.stringify(pending));
}

export async function syncOfflineMutations(userId: string, supabase: SupabaseClient): Promise<number> {
  const storageKey = key(userId, "pending");
  const pending = readJson<Mutation[]>(storageKey, []);
  let synced = 0;
  for (const mutation of pending) {
    const filters = Object.entries(mutation.filters || {});
    let errorMessage: string | null = null;
    if (mutation.operation === "insert") {
      let query = supabase.from(mutation.table).insert(mutation.record || {});
      for (const [column, value] of filters) query = query.eq(column, value);
      errorMessage = (await query).error?.message || null;
    } else if (mutation.operation === "upsert") {
      let query = supabase.from(mutation.table).upsert(mutation.record || {}, { onConflict: "user_id,data" });
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

    if (errorMessage) throw new Error(errorMessage);

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
