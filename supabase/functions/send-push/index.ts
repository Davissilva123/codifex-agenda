import webpush from "npm:web-push@3.6.7";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type Appointment = {
  id: string;
  user_id: string;
  titulo: string;
  tipo: "compromisso" | "tarefa";
  data: string;
  hora_inicio: string | null;
  alerta_minutos: number | null;
  recorrencia: "none" | "daily" | "weekly" | "monthly" | "yearly";
  concluido: boolean;
  alerta_enviado_em: string | null;
  alerta_enviado_para: string | null;
  adiado_ate: string | null;
};

function saoPauloDate(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const result = new Date(Date.UTC(year, month - 1, day + days));
  return `${result.getUTCFullYear()}-${String(result.getUTCMonth() + 1).padStart(2, "0")}-${String(result.getUTCDate()).padStart(2, "0")}`;
}

function occurrence(appointment: Appointment, date: string): boolean {
  if (date === appointment.data) return true;
  if (date < appointment.data || appointment.recorrencia === "none") return false;
  const [sy, sm, sd] = appointment.data.split("-").map(Number);
  const [cy, cm, cd] = date.split("-").map(Number);
  const start = Date.UTC(sy, sm - 1, sd), current = Date.UTC(cy, cm - 1, cd);
  const days = Math.round((current - start) / 86400000);
  if (appointment.recorrencia === "daily") return true;
  if (appointment.recorrencia === "weekly") return days % 7 === 0;
  if (appointment.recorrencia === "monthly") return sd === cd;
  return sm === cm && sd === cd;
}

function alertTime(appointment: Appointment, date: string): Date | null {
  if (!appointment.hora_inicio || appointment.alerta_minutos === null) return null;
  const [hour, minute] = appointment.hora_inicio.split(":").map(Number);
  const start = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-03:00`);
  return new Date(start.getTime() - appointment.alerta_minutos * 60000);
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "POST") return Response.json({ error: "Método não permitido." }, { status: 405, headers: corsHeaders });
  if (!Deno.env.get("CRON_SECRET") || request.headers.get("x-cron-secret") !== Deno.env.get("CRON_SECRET")) {
    return Response.json({ error: "Não autorizado." }, { status: 401, headers: corsHeaders });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!supabaseUrl || !serviceKey || !publicKey || !privateKey || !subject) {
    return Response.json({ error: "Segredos obrigatórios da função não configurados." }, { status: 500, headers: corsHeaders });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const now = new Date();
  const today = saoPauloDate(now);
  const tomorrow = addDays(today, 1);
  const { data: appointments, error: appointmentError } = await supabase
    .from("agendamentos")
    .select("id,user_id,titulo,tipo,data,hora_inicio,alerta_minutos,recorrencia,concluido,alerta_enviado_em,alerta_enviado_para,adiado_ate")
    .eq("concluido", false)
    .not("alerta_minutos", "is", null)
    .lte("data", tomorrow)
    .or(`recorrencia.neq.none,data.gte.${today}`);
  if (appointmentError) return Response.json({ error: appointmentError.message }, { status: 500, headers: corsHeaders });

  const results: { sent: number; failed: number } = { sent: 0, failed: 0 };
  for (const appointment of (appointments || []) as Appointment[]) {
    const snooze = appointment.adiado_ate ? new Date(appointment.adiado_ate) : null;
    const snoozeDue = Boolean(snooze && snooze <= now);
    const occurrenceDate = [today, tomorrow].find((date) => {
      if (!occurrence(appointment, date)) return false;
      if (snoozeDue && appointment.alerta_enviado_para === date) return true;
      const scheduled = alertTime(appointment, date);
      return Boolean(scheduled && scheduled <= now && now.getTime() - scheduled.getTime() < 24 * 60 * 60 * 1000 && appointment.alerta_enviado_para !== date);
    });
    if (!occurrenceDate) continue;

    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("push_subscriptions").select("id,subscription").eq("user_id", appointment.user_id);
    if (subscriptionsError) {
      console.error("Erro ao consultar inscrições push", appointment.id, subscriptionsError.message);
      results.failed++;
      continue;
    }
    if (!subscriptions?.length) continue;

    const previousState = {
      alerta_enviado_em: appointment.alerta_enviado_em,
      alerta_enviado_para: appointment.alerta_enviado_para,
      adiado_ate: appointment.adiado_ate,
    };
    const { data: claim, error: claimError } = await supabase
      .from("agendamentos")
      .update({ alerta_enviado_em: now.toISOString(), alerta_enviado_para: occurrenceDate, adiado_ate: null })
      .eq("id", appointment.id)
      .or(`alerta_enviado_para.is.null,alerta_enviado_para.neq.${occurrenceDate},adiado_ate.lte.${now.toISOString()}`)
      .select("id");
    if (claimError) {
      console.error("Erro ao reservar envio de lembrete", appointment.id, claimError.message);
      results.failed++;
      continue;
    }
    if (!claim?.length) continue;

    let deliverySucceeded = false;
    const snoozeUrl = `/?snooze=${encodeURIComponent(appointment.id)}`;
    const payload = JSON.stringify({
      title: "Lembrete: Minha Agenda",
      body: `${appointment.tipo === "tarefa" ? "Prazo" : "Compromisso"}: ${appointment.titulo}${appointment.hora_inicio ? ` • ${appointment.hora_inicio.slice(0, 5)}` : ""}`,
      tag: `agenda-${appointment.id}-${occurrenceDate}`,
      url: "/",
      snoozeUrl,
    });
    for (const subscription of subscriptions || []) {
      try {
        await webpush.sendNotification(subscription.subscription, payload);
        deliverySucceeded = true;
        results.sent++;
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode: unknown }).statusCode) : undefined;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
          if (deleteError) console.error("Não foi possível remover inscrição expirada", deleteError.message);
        } else {
          console.error("Falha ao enviar push", appointment.id, error);
          results.failed++;
        }
      }
    }
    if (!deliverySucceeded) {
      const { error: releaseError } = await supabase.from("agendamentos").update(previousState).eq("id", appointment.id);
      if (releaseError) {
        console.error("Falha ao liberar lembrete sem entrega", appointment.id, releaseError.message);
        results.failed++;
      }
    }
  }

  const { data: contacts, error: contactError } = await supabase
    .from("contatos")
    .select("id,user_id,nome,aniversario")
    .not("aniversario", "is", null);
  if (contactError) return Response.json({ error: contactError.message }, { status: 500, headers: corsHeaders });
  for (const contact of contacts || []) {
    const birthday = String(contact.aniversario).slice(5, 10) === today.slice(5, 10);
    if (!birthday) continue;
    const { data: subscriptions, error: subscriptionsError } = await supabase
      .from("push_subscriptions").select("id,subscription").eq("user_id", contact.user_id);
    if (subscriptionsError) {
      console.error("Erro ao consultar inscrições para aniversário", contact.id, subscriptionsError.message);
      results.failed++;
      continue;
    }
    if (!subscriptions?.length) continue;
    const { data: claim, error: claimError } = await supabase.from("aniversario_alertas_enviados")
      .upsert({ user_id: contact.user_id, contato_id: contact.id, data: today }, { onConflict: "contato_id,data", ignoreDuplicates: true })
      .select("id");
    if (claimError) {
      console.error("Erro ao reservar alerta de aniversário", contact.id, claimError.message);
      results.failed++;
      continue;
    }
    if (!claim?.length) continue;
    let deliverySucceeded = false;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification(subscription.subscription, JSON.stringify({
          title: "Aniversário: Minha Agenda",
          body: `Hoje é aniversário de ${contact.nome}.`,
          tag: `birthday-${contact.id}-${today}`,
          url: "/",
        }));
        deliverySucceeded = true;
        results.sent++;
      } catch (error) {
        const statusCode = typeof error === "object" && error !== null && "statusCode" in error
          ? Number((error as { statusCode: unknown }).statusCode) : undefined;
        if (statusCode === 404 || statusCode === 410) {
          const { error: deleteError } = await supabase.from("push_subscriptions").delete().eq("id", subscription.id);
          if (deleteError) console.error("Não foi possível remover inscrição expirada", deleteError.message);
        } else {
          console.error("Falha ao enviar alerta de aniversário", contact.id, error);
          results.failed++;
        }
      }
    }
    if (!deliverySucceeded) {
      const { error: releaseError } = await supabase.from("aniversario_alertas_enviados").delete()
        .eq("contato_id", contact.id).eq("data", today);
      if (releaseError) {
        console.error("Falha ao liberar alerta de aniversário sem entrega", contact.id, releaseError.message);
        results.failed++;
      }
    }
  }
  return Response.json({ ok: true, ...results }, { headers: corsHeaders });
});
