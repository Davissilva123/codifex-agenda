"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Appointment, Contact } from "@/lib/types";
import {
  birthdayOn,
  brazilianHolidays,
  formatDate,
  formatWeekRange,
  getWeekDays,
  occurrenceOn,
  parseDate,
  shiftDate,
  todayInSaoPaulo,
} from "@/lib/dates";
import { extractMeetingUrl } from "@/lib/meeting";
import { appointmentDurationMinutes, isTaskOverdue } from "@/lib/appointmentStatus";
import { useClock } from "@/lib/useClock";

interface CalendarWeekProps {
  currentDate: string;
  maxYear: number;
  appointments: Appointment[];
  contacts: Contact[];
  observations: Record<string, string>;
  onSelectDate: (date: string) => void;
  onOpenDayView: (date: string) => void;
  onNewAppointment: (date: string) => void;
  onEditAppointment: (item: Appointment) => void;
  onToggleComplete: (item: Appointment) => void;
  onMoveAppointment: (item: Appointment, date: string) => Promise<void>;
}

export function CalendarWeek({
  currentDate,
  maxYear,
  appointments,
  contacts,
  observations,
  onSelectDate,
  onOpenDayView,
  onNewAppointment,
  onEditAppointment,
  onToggleComplete,
  onMoveAppointment,
}: CalendarWeekProps) {
  const today = todayInSaoPaulo();
  const now = useClock();
  const [responsibleFilter, setResponsibleFilter] = useState("");
  const [responsibleFilterOpen, setResponsibleFilterOpen] = useState(false);
  const [expandedCompletedDays, setExpandedCompletedDays] = useState<Set<string>>(() => new Set());
  const [draggingDay, setDraggingDay] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const responsibleFilterRef = useRef<HTMLDivElement>(null);
  const year = parseDate(currentDate).getFullYear();
  const holidays = useMemo(() => brazilianHolidays(year), [year]);
  const weekDays = useMemo(() => getWeekDays(currentDate), [currentDate]);
  const weekHasAppointments = useMemo(
    () => appointments.some((item) => weekDays.some((day) => occurrenceOn(item, day.key))),
    [appointments, weekDays]
  );
  const responsibleNames = useMemo(
    () =>
      Array.from(new Set(appointments.map((item) => item.responsavel.trim()).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "pt-BR")
      ),
    [appointments]
  );

  useEffect(() => {
    if (!responsibleFilterOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!responsibleFilterRef.current?.contains(event.target as Node)) {
        setResponsibleFilterOpen(false);
      }
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setResponsibleFilterOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [responsibleFilterOpen]);

  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;
    const targetDate = weekDays.some((day) => day.key === today) ? today : currentDate;
    const target = container.querySelector<HTMLElement>(`[data-week-day="${targetDate}"]`);
    if (target) {
      container.scrollLeft = target.offsetLeft - (container.clientWidth - target.clientWidth) / 2;
    }
  }, [currentDate, today, weekDays]);

  const canGoNext = useMemo(() => {
    const nextWeekDate = shiftDate(currentDate, 7);
    return parseDate(nextWeekDate).getFullYear() <= maxYear;
  }, [currentDate, maxYear]);

  return (
    <section className="card p-3 sm:p-5">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b line pb-4">
        <div>
          <span className="muted text-xs uppercase font-semibold tracking-wider">Visão Semanal</span>
          <h2 className="text-xl sm:text-2xl font-bold mt-0.5">{formatWeekRange(currentDate)}</h2>
        </div>

        <div className="week-toolbar-actions">
          <div className="week-navigation">
            <button
              type="button"
              className="btn btn-ghost week-navigation-button"
              onClick={() => onSelectDate(shiftDate(currentDate, -7))}
              title="Semana anterior"
            >
              ← Anterior
            </button>
            <button
              type="button"
              className="btn btn-ghost week-navigation-button week-today-button"
              onClick={() => onSelectDate(today)}
            >
              Hoje
            </button>
            <button
              type="button"
              disabled={!canGoNext}
              className="btn btn-ghost week-navigation-button disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => onSelectDate(shiftDate(currentDate, 7))}
              title="Próxima semana"
            >
              Próxima →
            </button>
          </div>
          <div className="week-filter-menu" ref={responsibleFilterRef}>
            <button
              type="button"
              className={`week-filter-trigger${responsibleFilterOpen ? " is-open" : ""}`}
              aria-label={`Filtrar por responsável${responsibleFilter ? `, ${responsibleFilter} selecionado` : ""}`}
              title="Filtrar por responsável"
              aria-expanded={responsibleFilterOpen}
              aria-haspopup="dialog"
              onClick={() => setResponsibleFilterOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5Z" />
              </svg>
              <span>Filtrar</span>
              {responsibleFilter && <span className="week-filter-badge" aria-hidden="true">1</span>}
            </button>
            {responsibleFilterOpen && (
              <section className="week-filter-popover" role="dialog" aria-label="Filtro de responsável">
                <label className="week-filter-label" htmlFor="week-responsible-filter">Ver de</label>
                <select
                  id="week-responsible-filter"
                  className="field week-filter-select"
                  value={responsibleFilter}
                  onChange={(event) => setResponsibleFilter(event.target.value)}
                >
                  <option value="">Todos</option>
                  {responsibleNames.map((name) => <option key={name} value={name}>{name}</option>)}
                </select>
                <button
                  type="button"
                  className="agenda-clear-filters week-filter-clear"
                  disabled={!responsibleFilter}
                  onClick={() => setResponsibleFilter("")}
                >
                  Limpar filtro
                </button>
              </section>
            )}
          </div>
        </div>
      </div>

      {!weekHasAppointments && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed line p-4">
          <div className="flex items-center gap-3">
            <svg className="h-8 w-8 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
            </svg>
            <div><p className="font-semibold">Semana livre</p><p className="muted text-sm">Nenhum compromisso nesta semana.</p></div>
          </div>
          <button type="button" className="btn btn-primary" onClick={() => onNewAppointment(currentDate)}>+ Novo compromisso</button>
        </div>
      )}

      <div ref={scrollRef} className="week-scroll pb-2">
        <div className="week-days">
          {weekDays.map((day) => {
            const isToday = day.key === today;
            const isSelected = day.key === currentDate;
            const holiday = holidays.get(day.key);
            const birthdays = contacts.filter((contact) => birthdayOn(contact, day.key));
            const dayEvents = appointments
              .filter((item) => occurrenceOn(item, day.key))
              .filter((item) => !responsibleFilter || item.responsavel.trim() === responsibleFilter)
              .sort((a, b) => {
                if (a.concluido !== b.concluido) return Number(a.concluido) - Number(b.concluido);
                if (!a.hora_inicio && b.hora_inicio) return -1;
                if (a.hora_inicio && !b.hora_inicio) return 1;
                return (a.hora_inicio || "").localeCompare(b.hora_inicio || "") ||
                  a.titulo.localeCompare(b.titulo, "pt-BR");
              });
            const pendingEvents = dayEvents.filter((item) => !item.concluido);
            const completedEvents = dayEvents.filter((item) => item.concluido);
            const showCompleted = completedEvents.length < 2 || expandedCompletedDays.has(day.key);
            const note = observations[day.key]?.trim();

            return (
              <div
                key={day.key}
                data-week-day={day.key}
                onDragOver={(event) => {
                  event.preventDefault();
                  setDraggingDay(day.key);
                }}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                    setDraggingDay((current) => current === day.key ? "" : current);
                  }
                }}
                onDrop={(event) => {
                  event.preventDefault();
                  const itemId = event.dataTransfer.getData("text/plain");
                  const sourceDate = event.dataTransfer.getData("application/x-agenda-date");
                  const item = appointments.find((entry) => entry.id === itemId);
                  setDraggingDay("");
                  if (item && !item.concluido && sourceDate !== day.key && item.data !== day.key) {
                    void onMoveAppointment(item, day.key);
                  }
                }}
                className={`week-day flex flex-col rounded-xl border line transition-all min-w-0 ${
                  draggingDay === day.key ? "week-day-drop-target" : ""
                } ${
                  isToday
                    ? "bg-violet-50/40 dark:bg-violet-950/20 border-violet-300 dark:border-violet-800"
                    : isSelected
                    ? "bg-surface"
                    : "bg-surface/60"
                }`}
              >
                <div
                  className={`p-2.5 border-b line flex items-center justify-between gap-1 rounded-t-xl ${
                    isToday ? "bg-violet-100/70 dark:bg-violet-900/40 font-bold" : ""
                  } cursor-pointer`}
                  onClick={() => onOpenDayView(day.key)}
                >
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDayView(day.key);
                    }}
                    className="text-left group hover:opacity-80 transition-opacity"
                    title={`Abrir visão diária de ${formatDate(day.key)}`}
                  >
                    <p className="text-xs font-semibold text-muted group-hover:text-violet-600 dark:group-hover:text-violet-400">
                      {day.weekday}
                    </p>
                    <div className="flex items-center gap-1.5">
                      <span className={`text-base font-bold ${isToday ? "text-violet-700 dark:text-violet-300" : ""}`}>
                        {String(day.dayNumber).padStart(2, "0")}/{String(day.monthNumber).padStart(2, "0")}
                      </span>
                      <span className="text-[10px] font-normal text-muted" title="Concluídos / total">
                        {completedEvents.length}/{dayEvents.length}
                      </span>
                      {isToday && <span className="h-2 w-2 rounded-full bg-violet-600" title="Hoje" />}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onNewAppointment(day.key);
                    }}
                    className="btn btn-ghost h-7 w-7 p-0 text-sm font-bold text-violet-600 hover:bg-violet-100 dark:hover:bg-violet-900/50 rounded-full"
                    title={`Adicionar item em ${formatDate(day.key)}`}
                  >
                    ＋
                  </button>
                </div>

                <div className="px-2 pt-2 space-y-1">
                  {holiday && (
                    <div className="rounded bg-red-50 dark:bg-red-950/50 text-red-700 dark:text-red-300 px-1.5 py-0.5 text-[11px] font-medium truncate" title={holiday}>
                      🇧🇷 {holiday}
                    </div>
                  )}
                  {birthdays.map((contact) => (
                    <div key={contact.id} className="rounded bg-pink-50 dark:bg-pink-950/50 text-pink-700 dark:text-pink-300 px-1.5 py-0.5 text-[11px] font-medium truncate" title={`Aniversário de ${contact.nome}`}>
                      🎂 {contact.nome}
                    </div>
                  ))}
                </div>

                <div className="week-event-list p-2 space-y-2 flex flex-col justify-start">
                  {pendingEvents.map((item) => {
                    const meetingUrl = extractMeetingUrl(item.local) || extractMeetingUrl(item.descricao);
                    const duration = appointmentDurationMinutes(item);
                    return (
                      <div
                        key={item.id}
                        draggable="true"
                        onDragStart={(event) => {
                          event.dataTransfer.setData("text/plain", item.id);
                          event.dataTransfer.setData("application/x-agenda-date", day.key);
                          event.dataTransfer.effectAllowed = "move";
                        }}
                        className="group relative rounded-lg border line bg-surface p-2 text-xs transition-shadow hover:shadow-sm"
                        style={{
                          borderLeftWidth: "3px",
                          borderLeftColor: item.cor || "#6858d8",
                          minHeight: duration > 0 ? Math.max(34, (duration / 60) * 48) : 34,
                        }}
                      >
                        <div className="flex items-start gap-1.5">
                          <input
                            type="checkbox"
                            checked={item.concluido}
                            onChange={() => onToggleComplete(item)}
                            className="mt-0.5 h-3.5 w-3.5 rounded accent-violet-600 cursor-pointer shrink-0"
                            title="Marcar concluído"
                          />
                          <button
                            type="button"
                            onClick={() => onEditAppointment(item)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="week-event-title font-semibold" title={item.titulo}>{item.titulo}</p>
                            {item.hora_inicio && (
                              <p className="muted text-[11px]">
                                ⏰ {item.hora_inicio.slice(0, 5)}
                                {item.hora_fim ? ` - ${item.hora_fim.slice(0, 5)}` : ""}
                              </p>
                            )}
                            {item.tipo === "tarefa" && !item.hora_inicio && (
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium">✓ Tarefa</p>
                            )}
                            {item.responsavel && (
                              <p className="muted truncate text-[10px]">👤 {item.responsavel}</p>
                            )}
                            {item.tipo === "tarefa" && isTaskOverdue(item, now) && (
                              <p className="font-semibold text-red-600 dark:text-red-400">Atrasado</p>
                            )}
                          </button>
                        </div>
                        {meetingUrl && (
                          <div className="mt-1.5">
                            <a
                              href={meetingUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white px-1.5 py-0.5 text-[10px] font-semibold transition-colors"
                              title="Entrar na reunião"
                            >
                              <span>📹 Reunião</span><span>↗</span>
                            </a>
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {completedEvents.length >= 2 && (
                    <button
                      type="button"
                      onClick={() => setExpandedCompletedDays((current) => {
                        const next = new Set(current);
                        if (next.has(day.key)) next.delete(day.key);
                        else next.add(day.key);
                        return next;
                      })}
                      className="w-full text-left text-[11px] font-medium text-muted hover:text-foreground"
                    >
                      {completedEvents.length} concluídos {showCompleted ? "▴" : "▾"}
                    </button>
                  )}
                  {showCompleted && completedEvents.map((item) => (
                    <div
                      key={item.id}
                      className="week-completed-event group relative rounded-lg border line p-2 text-xs"
                      style={{ borderLeftWidth: "3px", borderLeftColor: item.cor || "#6858d8" }}
                    >
                      <div className="flex items-center gap-1.5">
                        <input
                          type="checkbox"
                          checked
                          onChange={() => onToggleComplete(item)}
                          className="h-3.5 w-3.5 shrink-0 cursor-pointer rounded accent-violet-600"
                          title="Marcar pendente"
                        />
                        <span
                          className="week-event-title week-completed-title min-w-0 flex-1 text-left font-semibold line-through"
                          title={item.titulo}
                        >
                          {item.titulo}
                        </span>
                      </div>
                    </div>
                  ))}
                  {!dayEvents.length && (
                    <button
                      type="button"
                      onClick={() => onNewAppointment(day.key)}
                      className="week-empty-area w-full rounded-lg border border-dashed line text-muted text-xs transition-all"
                      title="Novo compromisso"
                      aria-label={`Novo compromisso em ${formatDate(day.key)}`}
                    >
                      <span className="week-empty-icon" aria-hidden="true">＋</span>
                      <span>Adicionar item</span>
                    </button>
                  )}
                </div>

                {note && (
                  <div
                    onClick={() => onOpenDayView(day.key)}
                    className="border-t line p-2 text-[11px] bg-amber-50/60 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200 cursor-pointer rounded-b-xl hover:opacity-90"
                    title="Ver anotações do dia"
                  >
                    <span className="font-semibold">📝 Nota: </span>
                    <span className="line-clamp-1">{note}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
