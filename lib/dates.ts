import type { Appointment, Contact, Recurrence } from "./types";

export const MONTHS = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
export const WEEKDAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

export function todayInSaoPaulo(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDate(value: string): Date {
  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

export function shiftDate(dateStr: string, amountOfDays: number): string {
  const date = parseDate(dateStr);
  date.setDate(date.getDate() + amountOfDays);
  return dateKey(date);
}

export interface WeekDayInfo {
  key: string;
  date: Date;
  weekday: string;
  dayNumber: number;
  monthNumber: number;
}

export function getWeekDays(dateStr: string): WeekDayInfo[] {
  const current = parseDate(dateStr);
  const dayOffset = (current.getDay() + 6) % 7; // Seg = 0, Dom = 6
  const monday = new Date(current.getFullYear(), current.getMonth(), current.getDate() - dayOffset, 12);

  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i, 12);
    return {
      key: dateKey(day),
      date: day,
      weekday: WEEKDAYS[i],
      dayNumber: day.getDate(),
      monthNumber: day.getMonth() + 1,
    };
  });
}

export function formatWeekRange(dateStr: string): string {
  const week = getWeekDays(dateStr);
  const start = week[0];
  const end = week[6];
  const startDay = String(start.dayNumber).padStart(2, "0");
  const endDay = String(end.dayNumber).padStart(2, "0");
  const startMonth = String(start.monthNumber).padStart(2, "0");
  const endMonth = String(end.monthNumber).padStart(2, "0");
  const year = end.date.getFullYear();

  if (startMonth === endMonth) {
    return `${startDay} a ${endDay} de ${MONTHS[end.monthNumber - 1]} de ${year}`;
  }
  return `${startDay}/${startMonth} a ${endDay}/${endMonth}/${year}`;
}

export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1, 12);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset, 12);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i, 12));
}

function easterSunday(year: number): Date {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day, 12);
}

function shiftDay(date: Date, amount: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount, 12);
}

export function brazilianHolidays(year: number): Map<string, string> {
  const holidays = new Map<string, string>();
  const fixed: [number, number, string][] = [
    [1, 1, "Confraternização Universal"], [4, 21, "Tiradentes"], [5, 1, "Dia do Trabalho"],
    [9, 7, "Independência do Brasil"], [10, 12, "Nossa Senhora Aparecida"],
    [11, 2, "Finados"], [11, 15, "Proclamação da República"], [11, 20, "Dia da Consciência Negra"],
    [12, 25, "Natal"],
  ];
  for (const [month, day, title] of fixed) holidays.set(dateKey(new Date(year, month - 1, day, 12)), title);
  const easter = easterSunday(year);
  holidays.set(dateKey(shiftDay(easter, -48)), "Carnaval");
  holidays.set(dateKey(shiftDay(easter, -47)), "Carnaval");
  holidays.set(dateKey(shiftDay(easter, -2)), "Sexta-feira Santa");
  holidays.set(dateKey(shiftDay(easter, 60)), "Corpus Christi");
  return holidays;
}

export function occurrenceOn(appointment: Appointment, date: string): boolean {
  if (date === appointment.data) return true;
  if (date < appointment.data || appointment.recorrencia === "none") return false;
  const start = parseDate(appointment.data), current = parseDate(date);
  const days = Math.round((current.getTime() - start.getTime()) / 86400000);
  const recurrence: Recurrence = appointment.recorrencia;
  if (recurrence === "daily") return true;
  if (recurrence === "weekly") return days % 7 === 0;
  if (recurrence === "monthly") return start.getDate() === current.getDate();
  return start.getMonth() === current.getMonth() && start.getDate() === current.getDate();
}

export function birthdayOn(contact: Contact, date: string): boolean {
  if (!contact.aniversario) return false;
  const [, month, day] = contact.aniversario.slice(0, 10).split("-");
  const [, targetMonth, targetDay] = date.split("-");
  return month === targetMonth && day === targetDay;
}

export function appointmentSort(a: Appointment, b: Appointment): number {
  return (a.hora_inicio || "").localeCompare(b.hora_inicio || "") || a.titulo.localeCompare(b.titulo, "pt-BR");
}
