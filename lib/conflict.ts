import { occurrenceOn } from "./dates";
import type { Appointment } from "./types";

function timeToMinutes(timeStr: string): number {
  const [h, m] = timeStr.slice(0, 5).split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export interface ConflictResult {
  conflictingItem: Appointment;
  message: string;
}

export function detectAppointmentConflict(
  appointments: Appointment[],
  candidate: {
    id?: string;
    data: string;
    hora_inicio: string | null;
    hora_fim: string | null;
    tipo: string;
    responsavel: string;
  }
): ConflictResult | null {
  if (candidate.tipo !== "compromisso" || !candidate.hora_inicio) {
    return null;
  }

  const candStart = timeToMinutes(candidate.hora_inicio);
  const candEnd = candidate.hora_fim ? timeToMinutes(candidate.hora_fim) : candStart;
  const responsible = candidate.responsavel.trim().toLocaleLowerCase("pt-BR");
  if (!responsible) return null;

  for (const item of appointments) {
    if (item.id === candidate.id) continue;
    if (item.tipo !== "compromisso") continue;
    if (item.concluido) continue;
    if (!item.hora_inicio) continue;
    if (item.responsavel.trim().toLocaleLowerCase("pt-BR") !== responsible) continue;
    if (!occurrenceOn(item, candidate.data)) continue;

    const itemStart = timeToMinutes(item.hora_inicio);
    const itemEnd = item.hora_fim ? timeToMinutes(item.hora_fim) : itemStart;

    const candidateIsReminder = candStart === candEnd;
    const itemIsReminder = itemStart === itemEnd;
    const overlaps = candidateIsReminder && itemIsReminder
      ? candStart === itemStart
      : candidateIsReminder
      ? candStart >= itemStart && candStart < itemEnd
      : itemIsReminder
      ? itemStart >= candStart && itemStart < candEnd
      : candStart < itemEnd && candEnd > itemStart;
    if (overlaps) {
      const timeDisplay = `${item.hora_inicio.slice(0, 5)}${item.hora_fim ? ` às ${item.hora_fim.slice(0, 5)}` : ""}`;
      return {
        conflictingItem: item,
        message: `já existe um compromisso nesse horário para este responsável: "${item.titulo}" (${timeDisplay}).`,
      };
    }
  }

  return null;
}
