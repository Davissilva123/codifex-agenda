import type { Appointment } from "./types";

function saoPauloDateTime(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((entry) => entry.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}:${part("second")}`;
}

export function isTaskOverdue(item: Appointment, now: Date = new Date()): boolean {
  if (item.tipo !== "tarefa" || item.concluido || item.recorrencia !== "none") return false;
  const deadline = item.hora_fim || item.hora_inicio || "23:59:59";
  return `${item.data}T${deadline.length === 5 ? `${deadline}:00` : deadline}` < saoPauloDateTime(now);
}

export function isAppointmentOverdue(item: Appointment, now: Date = new Date()): boolean {
  if (item.concluido || item.recorrencia !== "none") return false;
  if (item.tipo === "tarefa") return isTaskOverdue(item, now);
  if (!item.hora_inicio) return false;
  const start = `${item.data}T${item.hora_inicio.slice(0, 5)}:00`;
  return start < saoPauloDateTime(now);
}

export function isAppointmentPastEnd(item: Appointment, now: Date = new Date()): boolean {
  if (
    item.tipo !== "compromisso" ||
    item.concluido ||
    item.recorrencia !== "none" ||
    !item.hora_inicio
  ) {
    return false;
  }
  const endTime = item.hora_fim || item.hora_inicio;
  const scheduledEnd = `${item.data}T${endTime}:00`;
  const createdAt = new Date(item.created_at);
  if (Number.isNaN(createdAt.getTime())) return false;
  const createdAtLocal = saoPauloDateTime(createdAt);
  return scheduledEnd > createdAtLocal && scheduledEnd < saoPauloDateTime(now);
}

export function appointmentDurationMinutes(item: Appointment): number {
  if (!item.hora_inicio || !item.hora_fim) return 0;
  const toMinutes = (time: string) => {
    const [hour, minute] = time.slice(0, 5).split(":").map(Number);
    return hour * 60 + minute;
  };
  return Math.max(0, toMinutes(item.hora_fim) - toMinutes(item.hora_inicio));
}
