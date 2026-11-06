import type { Appointment, AppointmentKind, Priority, Recurrence } from "./types";

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function formatIcsDateTime(dateStr: string, timeStr: string | null): string {
  const [year, month, day] = dateStr.slice(0, 10).split("-");
  if (!timeStr) {
    // Dia inteiro
    return `;VALUE=DATE:${year}${month}${day}`;
  }
  const [h, m] = timeStr.slice(0, 5).split(":");
  return `:${year}${month}${day}T${h}${m}00`;
}

function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function unescapeIcsText(text: string): string {
  let result = "";
  for (let index = 0; index < text.length; index++) {
    if (text[index] !== "\\" || index === text.length - 1) {
      result += text[index];
      continue;
    }

    const escaped = text[++index];
    if (escaped === "n" || escaped === "N") result += "\n";
    else result += escaped;
  }
  return result;
}

function firstIcsListValue(value: string): string {
  for (let index = 0; index < value.length; index++) {
    if (value[index] === "\\") {
      index++;
    } else if (value[index] === ",") {
      return unescapeIcsText(value.slice(0, index)).trim();
    }
  }
  return unescapeIcsText(value).trim();
}

function foldIcsLine(line: string): string {
  const encoder = new TextEncoder();
  const segments: string[] = [];
  let segment = "";
  let byteLength = 0;

  for (const character of line) {
    const characterLength = encoder.encode(character).length;
    if (byteLength + characterLength > 75 && segment) {
      segments.push(segment);
      segment = " ";
      byteLength = 1;
    }
    segment += character;
    byteLength += characterLength;
  }

  segments.push(segment);
  return segments.join("\r\n");
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isValidTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function exportToIcs(appointments: Appointment[]): string {
  const now = new Date();
  const dtstamp = `${now.getUTCFullYear()}${pad2(now.getUTCMonth() + 1)}${pad2(now.getUTCDate())}T${pad2(now.getUTCHours())}${pad2(now.getUTCMinutes())}${pad2(now.getUTCSeconds())}Z`;

  const lines: string[] = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//CODIFEX//MINHA AGENDA//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Minha Agenda",
  ];

  for (const item of appointments) {
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${item.id}@minhaagenda`);
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART${formatIcsDateTime(item.data, item.hora_inicio)}`);

    if (item.hora_inicio && item.hora_fim) {
      lines.push(`DTEND${formatIcsDateTime(item.data, item.hora_fim)}`);
    }

    lines.push(`SUMMARY:${escapeIcsText(item.titulo)}`);
    if (item.descricao) {
      lines.push(`DESCRIPTION:${escapeIcsText(item.descricao)}`);
    }
    if (item.local) {
      lines.push(`LOCATION:${escapeIcsText(item.local)}`);
    }
    if (item.categoria) {
      lines.push(`CATEGORIES:${escapeIcsText(item.categoria)}`);
    }

    if (item.recorrencia && item.recorrencia !== "none") {
      const rruleFreq: Record<Recurrence, string> = {
        daily: "DAILY",
        weekly: "WEEKLY",
        monthly: "MONTHLY",
        yearly: "YEARLY",
        none: "",
      };
      if (rruleFreq[item.recorrencia]) {
        lines.push(`RRULE:FREQ=${rruleFreq[item.recorrencia]}`);
      }
    }

    lines.push("STATUS:CONFIRMED");
    lines.push(`X-CODIFEX-TIPO:${item.tipo}`);
    lines.push(`X-CODIFEX-PRIORIDADE:${item.prioridade}`);
    lines.push(`X-CODIFEX-CLIENTE:${escapeIcsText(item.cliente)}`);
    lines.push(`X-CODIFEX-RESPONSAVEL:${escapeIcsText(item.responsavel)}`);
    lines.push(`X-CODIFEX-CONCLUIDO:${item.concluido ? "TRUE" : "FALSE"}`);

    lines.push("END:VEVENT");
  }

  lines.push("END:VCALENDAR");
  return lines.map(foldIcsLine).join("\r\n");
}

export interface ParsedIcsEvent {
  titulo: string;
  data: string;
  hora_inicio: string | null;
  hora_fim: string | null;
  descricao: string;
  local: string;
  categoria: string;
  recorrencia: Recurrence;
  tipo: AppointmentKind;
  prioridade: Priority;
  cliente: string;
  responsavel: string;
  concluido: boolean;
}

export function parseIcs(icsText: string): ParsedIcsEvent[] {
  const events: ParsedIcsEvent[] = [];
  // Unfold folded lines (RFC 5545 lines that start with space or tab continue previous line)
  const unfolded = icsText.replace(/\r?\n[ \t]/g, "");
  const lines = unfolded.split(/\r?\n/);

  let inEvent = false;
  let current: Partial<ParsedIcsEvent> = {};
  let endDate: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "BEGIN:VEVENT") {
      inEvent = true;
      endDate = null;
      current = {
        titulo: "",
        data: "",
        hora_inicio: null,
        hora_fim: null,
        descricao: "",
        local: "",
        categoria: "Geral",
        recorrencia: "none",
        tipo: "compromisso",
        prioridade: "normal",
        cliente: "",
        responsavel: "",
        concluido: false,
      };
      continue;
    }

    if (trimmed === "END:VEVENT") {
      if (current.hora_fim && (!current.hora_inicio || endDate !== current.data || current.hora_fim <= current.hora_inicio)) {
        current.hora_fim = null;
      }
      if (inEvent && current.titulo?.trim() && current.data && isValidDate(current.data)) {
        events.push(current as ParsedIcsEvent);
      }
      inEvent = false;
      endDate = null;
      current = {};
      continue;
    }

    if (!inEvent) continue;

    const colonIndex = line.indexOf(":");
    if (colonIndex === -1) continue;

    const propHeader = line.slice(0, colonIndex).toUpperCase();
    const propValue = line.slice(colonIndex + 1);

    if (propHeader.startsWith("SUMMARY")) {
      current.titulo = unescapeIcsText(propValue);
    } else if (propHeader.startsWith("DESCRIPTION")) {
      current.descricao = unescapeIcsText(propValue);
    } else if (propHeader.startsWith("LOCATION")) {
      current.local = unescapeIcsText(propValue);
    } else if (propHeader.startsWith("CATEGORIES")) {
      current.categoria = firstIcsListValue(propValue) || "Geral";
    } else if (propHeader.startsWith("RRULE")) {
      if (/FREQ=DAILY/i.test(propValue)) current.recorrencia = "daily";
      else if (/FREQ=WEEKLY/i.test(propValue)) current.recorrencia = "weekly";
      else if (/FREQ=MONTHLY/i.test(propValue)) current.recorrencia = "monthly";
      else if (/FREQ=YEARLY/i.test(propValue)) current.recorrencia = "yearly";
    } else if (propHeader === "X-CODIFEX-TIPO") {
      if (propValue === "tarefa" || propValue === "compromisso") current.tipo = propValue;
    } else if (propHeader === "X-CODIFEX-PRIORIDADE") {
      if (["baixa", "normal", "alta", "urgente"].includes(propValue)) {
        current.prioridade = propValue as Priority;
      }
    } else if (propHeader === "X-CODIFEX-CLIENTE") {
      current.cliente = unescapeIcsText(propValue);
    } else if (propHeader === "X-CODIFEX-RESPONSAVEL") {
      current.responsavel = unescapeIcsText(propValue);
    } else if (propHeader === "X-CODIFEX-CONCLUIDO") {
      current.concluido = /^true$/i.test(propValue);
    } else if (propHeader === "STATUS") {
      current.concluido = /^completed$/i.test(propValue);
    } else if (propHeader.startsWith("DTSTART")) {
      const match = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(propValue);
      if (match) {
        const [, year, month, day, hour, minute] = match;
        const eventDate = `${year}-${month}-${day}`;
        if (isValidDate(eventDate)) {
          current.data = eventDate;
          if (hour && minute) {
            const eventTime = `${hour}:${minute}`;
            current.hora_inicio = isValidTime(eventTime) ? eventTime : null;
          }
        }
      }
    } else if (propHeader.startsWith("DTEND")) {
      const match = /(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2}))?/.exec(propValue);
      if (match) {
        const [, year, month, day, hour, minute] = match;
        endDate = `${year}-${month}-${day}`;
        if (hour && minute) {
          const endTime = `${hour}:${minute}`;
          current.hora_fim = isValidDate(endDate) && isValidTime(endTime) ? endTime : null;
        }
      }
    }
  }

  return events;
}
