"use client";

import { useMemo } from "react";
import type { Appointment, Contact } from "@/lib/types";
import { formatDate, parseDate, todayInSaoPaulo } from "@/lib/dates";
import { WorkItem } from "@/components/ui/WorkItem";

interface DayViewProps {
  selectedDate: string;
  yearLimit: number;
  today: string;
  appointments: Appointment[];
  overdueCount: number;
  contacts: Contact[];
  holiday: string | undefined;
  noteValue: string;
  savingNote: boolean;
  onSelectDate: (date: string) => void;
  onShowOverdue: () => void;
  onNewAppointment: (date: string) => void;
  onToggleComplete: (item: Appointment) => void;
  onDeleteAppointment: (item: Appointment) => void;
  onEditAppointment: (item: Appointment) => void;
  onNoteChange: (newNote: string) => void;
}

export function DayView({
  selectedDate,
  yearLimit,
  today,
  appointments,
  overdueCount,
  contacts,
  holiday,
  noteValue,
  savingNote,
  onSelectDate,
  onShowOverdue,
  onNewAppointment,
  onToggleComplete,
  onDeleteAppointment,
  onEditAppointment,
  onNoteChange,
}: DayViewProps) {
  const selectedContacts = useMemo(() => {
    return contacts.filter((c) => {
      if (!c.aniversario) return false;
      const [, m, d] = c.aniversario.slice(0, 10).split("-");
      const [, tm, td] = selectedDate.split("-");
      return m === tm && d === td;
    });
  }, [contacts, selectedDate]);

  const weekdayName = useMemo(() => {
    return new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(parseDate(selectedDate));
  }, [selectedDate]);

  return (
    <section className="day-workspace">
      {/* Barra de Navegação do Dia */}
      <div className="card day-toolbar">
        <div className="day-toolbar-navigation">
          <button
            type="button"
            className="day-nav-button"
            aria-label="Ir para o dia anterior"
            onClick={() => {
              const date = parseDate(selectedDate);
              date.setDate(date.getDate() - 1);
              const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
                date.getDate()
              ).padStart(2, "0")}`;
              onSelectDate(key);
            }}
          >
            <span className="day-nav-arrow" aria-hidden="true">‹</span>
            <span className="day-nav-label">Dia anterior</span>
          </button>

          <div className="day-toolbar-date">
            <p className="muted text-sm capitalize">{weekdayName}</p>
            <h2 className="text-xl font-bold">{formatDate(selectedDate)}</h2>
          </div>

          <button
            type="button"
            className="day-nav-button"
            aria-label="Ir para o próximo dia"
            disabled={
              selectedDate === `${yearLimit}-12-31` || parseDate(selectedDate).getFullYear() > yearLimit
            }
            onClick={() => {
              const date = parseDate(selectedDate);
              date.setDate(date.getDate() + 1);
              if (date.getFullYear() <= yearLimit) {
                const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
                  date.getDate()
                ).padStart(2, "0")}`;
                onSelectDate(key);
              }
            }}
          >
            <span className="day-nav-label">Próximo dia</span>
            <span className="day-nav-arrow" aria-hidden="true">›</span>
          </button>
        </div>

        <button
          type="button"
          className="day-today-button"
          onClick={() => onSelectDate(today)}
          disabled={selectedDate === today}
        >
          Hoje
        </button>
      </div>

      {/* Duas Colunas: Itens do Dia e Observações */}
      <div className="day-columns">
        {/* Coluna 1: Compromissos e Tarefas */}
        <section className="card min-w-0 p-4 sm:p-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="muted text-xs font-semibold uppercase tracking-wider">Sua rotina</p>
              <h2 className="mt-1 text-xl font-bold">Compromissos do dia</h2>
              <div className="day-agenda-summary">
                <p className="muted mt-1 text-sm">
                  {appointments.length} {appointments.length === 1 ? "item" : "itens"} na agenda
                </p>
                {overdueCount > 0 && (
                  <button type="button" className="agenda-overdue-count" onClick={onShowOverdue}>
                    {overdueCount} {overdueCount === 1 ? "atrasado" : "atrasados"}
                  </button>
                )}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onNewAppointment(selectedDate)}
            >
              ＋ Novo compromisso
            </button>
          </div>

          {holiday && (
            <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">
              🇧🇷 {holiday}
            </div>
          )}

          {selectedContacts.map((contact) => (
            <div
              key={contact.id}
              className="mb-3 rounded-lg bg-pink-50 p-3 text-sm text-pink-800 dark:bg-pink-950 dark:text-pink-100"
            >
              🎂 Aniversário de {contact.nome}
            </div>
          ))}

          <div className="space-y-3">
            {appointments.map((item) => (
              <WorkItem
                key={item.id}
                item={item}
                showDate={item.tipo === "tarefa"}
                dayMode
                onComplete={onToggleComplete}
                onDelete={onDeleteAppointment}
                onEdit={onEditAppointment}
              />
            ))}

            {!appointments.length && (
              <div className="rounded-xl border border-dashed line p-8 text-center">
                <svg className="mx-auto mb-3 h-9 w-9 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18M12 14v4m-2-2h4" />
                </svg>
                <p className="font-semibold">Dia livre</p>
                <p className="muted mt-1 text-sm">Adicione um compromisso para organizar sua rotina.</p>
                <button type="button" className="btn btn-primary mt-4" onClick={() => onNewAppointment(selectedDate)}>+ Novo compromisso</button>
              </div>
            )}
          </div>
        </section>

        {/* Coluna 2: Observações do Dia */}
        <aside className="card day-notes p-4 sm:p-6 flex flex-col justify-between">
          <div>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <p className="muted text-xs font-semibold uppercase tracking-wider">Anotações do Dia</p>
                <h2 className="mt-1 text-xl font-bold">Observações</h2>
              </div>
              <span className="muted pt-1 text-xs">{savingNote ? "Salvando..." : "Salvo"}</span>
            </div>

            <p className="muted mb-2 text-xs">Vinculadas somente a {formatDate(selectedDate)}.</p>
            <textarea
              className="field day-note-input text-sm leading-relaxed"
              placeholder="Anotações para este dia..."
              value={noteValue}
              onChange={(e) => onNoteChange(e.target.value)}
            />
          </div>

          <p className="muted mt-3 text-xs">Salvamento automático após uma breve pausa.</p>
        </aside>
      </div>
    </section>
  );
}
