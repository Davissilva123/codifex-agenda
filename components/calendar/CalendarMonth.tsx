"use client";

import { useMemo } from "react";
import type { Appointment, Contact } from "@/lib/types";
import {
  birthdayOn,
  brazilianHolidays,
  dateKey,
  formatDate,
  MONTHS,
  monthGrid,
  occurrenceOn,
  shiftDate,
  todayInSaoPaulo,
  WEEKDAYS,
} from "@/lib/dates";

interface CalendarMonthProps {
  year: number;
  month: number;
  maxYear: number;
  appointments: Appointment[];
  contacts: Contact[];
  observations: Record<string, string>;
  selected: string;
  onSelect: (date: string) => void;
  onOpenMonth?: () => void;
  compact?: boolean;
}

export function CalendarMonth({
  year,
  month,
  maxYear,
  appointments,
  contacts,
  observations,
  selected,
  onSelect,
  onOpenMonth,
  compact = false,
}: CalendarMonthProps) {
  const holidayMap = useMemo(() => brazilianHolidays(year), [year]);
  const days = useMemo(() => monthGrid(year, month), [year, month]);
  const today = todayInSaoPaulo();
  const monthAppointmentCount = useMemo(
    () => days.reduce((count, day) => {
      if (day.getMonth() !== month) return count;
      const key = dateKey(day);
      return count + appointments.filter((item) => item.tipo !== "tarefa" && occurrenceOn(item, key)).length;
    }, 0),
    [appointments, days, month]
  );

  return (
    <section className={compact ? "calendar-month-compact min-w-0" : "card p-3 sm:p-5"}>
      {compact && (
        <div className="calendar-month-heading">
          <button type="button" className="calendar-month-title" onClick={onOpenMonth}>
            {MONTHS[month]}
          </button>
          {monthAppointmentCount > 0 && (
            <span className="calendar-month-count">
              {monthAppointmentCount} {monthAppointmentCount === 1 ? "compromisso" : "compromissos"}
            </span>
          )}
        </div>
      )}
      {!compact && <div className="mb-3 text-center font-semibold">{MONTHS[month]}</div>}
      <div className={`calendar-month-grid${compact ? " is-compact" : ""}`} aria-label={`${MONTHS[month]} ${year}`}>
        {WEEKDAYS.map((day) => (
          <div key={day} className="calendar-weekday muted">
            {compact ? day.toUpperCase() : day}
          </div>
        ))}
        {days.map((day) => {
          const key = dateKey(day);
          const sameMonth = day.getMonth() === month;
          const available = Number(key.slice(0, 4)) <= maxYear;
          const dayAppointments = sameMonth
            ? appointments
                .filter((item) => item.tipo !== "tarefa" && occurrenceOn(item, key))
                .sort((a, b) => (a.hora_inicio || "").localeCompare(b.hora_inicio || "") || a.titulo.localeCompare(b.titulo, "pt-BR"))
            : [];
          const events = dayAppointments.length > 0;
          const tasks = appointments.some((a) => a.tipo === "tarefa" && occurrenceOn(a, key));
          const birthday = contacts.some((c) => birthdayOn(c, key));
          const note = Boolean(observations[key]?.trim());
          const holiday = holidayMap.get(key);
          const isWeekend = day.getDay() === 0 || day.getDay() === 6;
          const tooltip = [
            ...dayAppointments.slice(0, 3).map((item) => `${item.hora_inicio ? `${item.hora_inicio.slice(0, 5)} · ` : ""}${item.titulo}`),
            dayAppointments.length > 3 ? `+${dayAppointments.length - 3}` : "",
          ].filter(Boolean).join("\n");
          const selectedMonth = selected.slice(0, 7) === `${year}-${String(month + 1).padStart(2, "0")}`;
          const focusDate = selectedMonth
            ? selected
            : today.slice(0, 7) === `${year}-${String(month + 1).padStart(2, "0")}`
            ? today
            : dateKey(new Date(year, month, 1, 12));
          const visibleAppointments = dayAppointments.slice(0, 3);

          return (
            <button
              key={key}
              type="button"
              data-calendar-date={key}
              tabIndex={key === focusDate ? 0 : -1}
              disabled={!available}
              onClick={() => onSelect(key)}
              onKeyDown={compact ? (event) => {
                const offsets: Record<string, number> = {
                  ArrowLeft: -1,
                  ArrowRight: 1,
                  ArrowUp: -7,
                  ArrowDown: 7,
                };
                const offset = offsets[event.key];
                if (!offset) return;
                event.preventDefault();
                event.stopPropagation();
                const nextDate = shiftDate(key, offset);
                const selector = `[data-calendar-date="${nextDate}"]`;
                const localTarget = event.currentTarget.closest(".calendar-month-compact")?.querySelector<HTMLButtonElement>(selector);
                const target = localTarget || document.querySelector<HTMLButtonElement>(selector);
                target?.focus();
              } : undefined}
              aria-pressed={key === selected}
              title={sameMonth ? tooltip || undefined : undefined}
              aria-label={`${formatDate(key)}${holiday ? `, ${holiday}` : ""}${events ? ", compromisso" : ""}${
                tasks ? ", tarefa" : ""
              }${note ? ", observação" : ""}${birthday ? ", aniversário" : ""}`}
              className={`calendar-day${sameMonth ? "" : compact ? " is-adjacent" : " is-outside-month"}${isWeekend ? " is-weekend" : ""}${key === selected ? " is-selected" : ""}${key === today ? " is-today" : ""}`}
            >
              <span className="calendar-day-number">{day.getDate()}</span>
              <span className="calendar-day-markers" aria-hidden="true">
                {compact ? (
                  <>
                    {visibleAppointments.map((item) => (
                      <i key={item.id} style={{ backgroundColor: item.cor || "var(--primary)" }} />
                    ))}
                    {dayAppointments.length > 3 && <small>+</small>}
                  </>
                ) : (
                  <>
                    {holiday && <i title={holiday} className="is-holiday" />}
                    {events && <i title="Compromisso" className="is-appointment" />}
                    {tasks && <i title="Tarefa" className="is-task" />}
                    {birthday && <i title="Aniversário" className="is-birthday" />}
                    {note && <i title="Observação" className="is-note" />}
                  </>
                )}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
