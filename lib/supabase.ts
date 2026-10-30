import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Configure NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  let projectUrl: URL;
  try {
    projectUrl = new URL(url);
  } catch {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL não é uma URL válida. Informe a URL real do seu projeto Supabase.");
  }
  if (
    !["https:", "http:"].includes(projectUrl.protocol)
    || projectUrl.hostname.toLowerCase() === "seu-projeto.supabase.co"
    || projectUrl.hostname.toLowerCase() === "your-project.supabase.co"
  ) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL ainda está com o endereço de exemplo. Informe a URL real do seu projeto Supabase.");
  }
  if (/^(SUA_CHAVE|YOUR_KEY|YOUR_ANON_KEY|<)/i.test(key.trim())) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY ainda está com o valor de exemplo. Informe a chave pública anon/publishable do Supabase.");
  }
  if (!client) client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  return client;
}
