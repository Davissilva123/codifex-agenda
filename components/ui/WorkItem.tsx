"use client";

import { useMemo, useState } from "react";
import type { Appointment, Priority } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { extractMeetingUrl } from "@/lib/meeting";
import { isAppointmentOverdue } from "@/lib/appointmentStatus";
import { useClock } from "@/lib/useClock";

export function PriorityPill({ priority }: { priority: Priority }) {
  const styles: Record<Priority, string> = {
    urgente: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200 border border-red-300 dark:border-red-900",
    alta: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200 border border-orange-300 dark:border-orange-900",
    normal: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200 border border-blue-300 dark:border-blue-900",
    baixa: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300 border border-gray-300 dark:border-gray-700",
  };
  const labels: Record<Priority, string> = { urgente: "Urgente", alta: "Alta", normal: "Normal", baixa: "Baixa" };
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold tracking-wide ${styles[priority || "normal"]}`}>{labels[priority || "normal"]}</span>;
}

type TaskIcon = "calendar" | "alert" | "user" | "clock" | "repeat" | "briefcase" | "pin" | "video";

const taskIconPaths: Record<TaskIcon, string[]> = {
  calendar: ["M8 3v4m8-4v4M3 9h18", "M5 5h14a2 2 0 0 1 2 2v12H3V7a2 2 0 0 1 2-2Z"],
  alert: ["M12 9v4m0 4h.01", "M10.3 3.9 1.8 18.5A1.7 1.7 0 0 0 3.3 21h17.4a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a2 2 0 0 0-3.4 0Z"],
  user: ["M20 21a8 8 0 0 0-16 0", "M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z"],
  clock: ["M12 8v4l3 2", "M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z"],
  repeat: ["M17 2l4 4-4 4", "M3 11V9a3 3 0 0 1 3-3h15", "M7 22l-4-4 4-4", "M21 13v2a3 3 0 0 1-3 3H3"],
  briefcase: ["M3 7h18v13H3z", "M8 7V4h8v3", "M3 12h18", "M10 12v2h4v-2"],
  pin: ["M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z", "M12 10a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z"],
  video: ["m16 10 5-3v10l-5-3", "M3 7h13v10H3z"],
};

function TaskMetaIcon({ name }: { name: TaskIcon }) {
  return (
    <svg className="work-item-task-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {taskIconPaths[name].map((path) => <path key={path} d={path} />)}
    </svg>
  );
}

interface WorkItemProps {
  item: Appointment;
  onComplete: (item: Appointment) => void;
  onEdit: (item: Appointment) => void;
  onDelete?: (item: Appointment) => void;
  showDate?: boolean;
  taskMode?: boolean;
  dayMode?: boolean;
  monthMode?: boolean;
}

export function WorkItem({
  item,
  onComplete,
  onEdit,
  onDelete,
  showDate = false,
  taskMode = false,
  dayMode = false,
  monthMode = false,
}: WorkItemProps) {
  const now = useClock();
  const [showFullDesc, setShowFullDesc] = useState(false);
  const overdue = isAppointmentOverdue(item, now);
  const isMedical = item.tipo === "compromisso" && item.categoria === "Saúde";
  const canEditOrDelete = !item.concluido || (!dayMode && !monthMode);

  const meetingUrl = useMemo(() => {
    if (item.tipo === "compromisso" && item.categoria === "Saúde") return null;
    return extractMeetingUrl(item.local) || extractMeetingUrl(item.descricao);
  }, [item.tipo, item.categoria, item.local, item.descricao]);

  return (
    <article
      className={`work-item${taskMode ? " work-item-task" : ""}${dayMode ? " work-item-day" : ""}${monthMode ? " work-item-month" : ""} rounded-xl border line p-3.5 transition-all hover:shadow-md ${
        item.concluido ? "opacity-60 bg-black/[0.02] dark:bg-white/[0.02]" : ""
      }`}
      style={{ borderLeftWidth: "4px", borderLeftColor: item.cor || "#6858d8" }}
    >
      <div className="work-item-layout flex items-start gap-3">
        <input
          type="checkbox"
          aria-label={item.concluido ? "Marcar como pendente" : "Marcar como concluído"}
          checked={item.concluido}
          onChange={() => onComplete(item)}
          className={`mt-1 cursor-pointer ${taskMode ? "work-item-task-checkbox" : monthMode ? "work-item-month-checkbox" : "h-4 w-4 rounded accent-violet-600"}`}
        />

        <div className="min-w-0 flex-1">
          <div className="work-item-heading flex flex-wrap items-center gap-2">
            <strong className={`work-item-title text-sm sm:text-base font-semibold ${item.concluido ? "line-through text-muted" : ""}`}>
              {item.titulo}
            </strong>
            {taskMode && item.prioridade === "urgente" ? (
              <span className="work-item-task-urgent">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m13 2-3 8h7l-6 12 1-9H5l8-11Z" /></svg>
                Urgente
              </span>
            ) : <PriorityPill priority={item.prioridade || "normal"} />}
            <span
              className={`work-item-category rounded-full border px-2 py-0.5 text-[10px] font-semibold${taskMode || monthMode ? " is-task" : ""}`}
              style={{
                backgroundColor: `color-mix(in srgb, ${item.cor || "#6858d8"} 16%, var(--surface))`,
                borderColor: `color-mix(in srgb, ${item.cor || "#6858d8"} 40%, transparent)`,
                color: item.cor || "#6858d8",
              }}
            >
              {(taskMode || monthMode) && <span className="work-item-category-dot" style={{ backgroundColor: item.cor || "#6858d8" }} aria-hidden="true" />}
              {item.categoria}
            </span>
          </div>

          <div className="work-item-meta muted mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {showDate && (
              <span className={`work-item-date font-medium ${overdue ? "text-red-600 dark:text-red-400 font-bold" : ""}`}>
                {(taskMode || dayMode || monthMode) && <TaskMetaIcon name={overdue ? "alert" : "calendar"} />}
                {!taskMode && !dayMode && !monthMode && (overdue ? "⚠️ " : "")}
                {overdue && !dayMode ? "Atrasada · " : "Prazo · "}
                {formatDate(item.data)}
              </span>
            )}
            {isMedical && item.responsavel && <span>{(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="user" /> : "👤 "}{item.responsavel}</span>}
            {item.hora_inicio && (
              <span className="font-medium text-foreground">
                {(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="clock" /> : "⏰ "}{item.hora_inicio.slice(0, 5)}
                {item.hora_fim ? ` – ${item.hora_fim.slice(0, 5)}` : ""}
              </span>
            )}
            {item.recorrencia && item.recorrencia !== "none" && (
              <span>
                {(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="repeat" /> : "🔁 "}{
                  ({ daily: "Diário", weekly: "Semanal", monthly: "Mensal", yearly: "Anual" } as Record<string, string>)[
                    item.recorrencia
                  ]
                }
              </span>
            )}
            {item.cliente && (
              <span>{(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="briefcase" /> : isMedical ? `🏥 ` : `💼 `}{item.cliente}</span>
            )}
            {!isMedical && item.responsavel && <span>{(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="user" /> : "👤 "}{item.responsavel}</span>}
            {item.concluido && <span className={`work-item-state${dayMode || monthMode ? " is-complete" : ""}`}>Concluído</span>}
            {overdue && <span className={`work-item-state${dayMode || monthMode ? " is-overdue" : ""}`}>Atrasado</span>}
            {item.local && !meetingUrl && (
              <span>{(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="pin" /> : isMedical ? `📍 Endereço: ` : `📍 `}{isMedical && (taskMode || monthMode) ? "Endereço: " : ""}{item.local}</span>
            )}
          </div>

          {/* Botão de Entrar na Reunião (Vídeo / Videoconferência) */}
          {meetingUrl && (
            <div className="mt-2.5">
              <a
                href={meetingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1 text-xs font-semibold shadow-xs transition-colors"
              >
                <span>{(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="video" /> : "📹"}</span>
                <span>Entrar na Reunião</span>
                {taskMode || monthMode
                  ? <svg className="work-item-task-meta-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 4h6v6m0-6-9 9" /><path d="M18 13v6H4V5h6" /></svg>
                  : <span className="text-[10px] opacity-75">↗</span>}
              </a>
              {item.local && item.local !== meetingUrl && (
                <span className="muted ml-2 text-xs">{(taskMode || dayMode || monthMode) ? <TaskMetaIcon name="pin" /> : "📍 "}{item.local}</span>
              )}
            </div>
          )}

          {item.descricao && (
            <div className={`work-item-description mt-2 text-xs sm:text-sm`}>
              <p className={`${showFullDesc ? "whitespace-pre-wrap" : "line-clamp-3 whitespace-pre-wrap"}`}>
                {item.descricao}
              </p>
              {item.descricao.length > 180 && (
                <button
                  type="button"
                  onClick={() => setShowFullDesc(!showFullDesc)}
                  className="text-violet-600 dark:text-violet-400 font-medium text-xs mt-1 hover:underline"
                >
                  {showFullDesc ? "Ver menos" : "Ver mais..."}
                </button>
              )}
            </div>
          )}
        </div>

        {/* Ações */}
        {canEditOrDelete && (
          <div className={`work-item-actions flex items-center gap-1 shrink-0${taskMode ? " work-item-task-actions" : ""}${dayMode ? " work-item-day-actions" : ""}${monthMode ? " work-item-month-actions" : ""}`}>
            <button
              type="button"
              className={`btn btn-ghost px-2.5 py-1 text-xs${taskMode || dayMode || monthMode ? " work-item-task-action" : ""}`}
              aria-label={`Editar ${item.tipo === "tarefa" ? "tarefa" : "compromisso"} ${item.titulo}`}
              title="Editar"
              onClick={() => onEdit(item)}
            >
              {taskMode || dayMode || monthMode ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15l-.8 5Z" /></svg> : "Editar"}
            </button>
            {onDelete && (
              <button
                type="button"
                aria-label={`Excluir ${item.tipo === "tarefa" ? "tarefa" : "compromisso"} ${item.titulo}`}
                title="Excluir"
                className={`btn btn-ghost px-2.5 py-1 text-xs text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40${taskMode || dayMode || monthMode ? " work-item-task-action" : ""}`}
                onClick={() => onDelete(item)}
              >
                {taskMode || dayMode || monthMode ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" /></svg> : "Excluir"}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
