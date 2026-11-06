"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Appointment, Priority } from "@/lib/types";
import { WorkItem } from "@/components/ui/WorkItem";
import { isTaskOverdue } from "@/lib/appointmentStatus";
import { useClock } from "@/lib/useClock";
import { todayInSaoPaulo } from "@/lib/dates";

const PRIORITY_ORDER: Record<Priority, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };

interface TasksViewProps {
  shownYear: number;
  yearLimit: number;
  appointments: Appointment[];
  onYearChange: (year: number) => void;
  onNewTask: () => void;
  onToggleComplete: (item: Appointment) => void;
  onDeleteTask: (item: Appointment) => void;
  onEditTask: (item: Appointment) => void;
}

export function TasksView({
  shownYear,
  yearLimit,
  appointments,
  onYearChange,
  onNewTask,
  onToggleComplete,
  onDeleteTask,
  onEditTask,
}: TasksViewProps) {
  const [taskFilter, setTaskFilter] = useState<"open" | "completed" | "overdue" | "all">("open");
  const [selectedClient, setSelectedClient] = useState<string>("all");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [selectedPriority, setSelectedPriority] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const now = useClock();
  const activeFilters =
    (taskFilter === "open" ? 0 : 1) +
    (selectedClient === "all" ? 0 : 1) +
    (selectedCategory === "all" ? 0 : 1) +
    (selectedPriority === "all" ? 0 : 1) +
    (searchQuery.trim() ? 1 : 0);

  useEffect(() => {
    if (!filtersOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!filtersRef.current?.contains(event.target as Node)) setFiltersOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFiltersOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [filtersOpen]);

  // Todas as tarefas do ano selecionado
  const yearTasks = useMemo(() => {
    return appointments.filter(
      (item) => item.tipo === "tarefa" && Number(item.data.slice(0, 4)) === shownYear
    );
  }, [appointments, shownYear]);

  // Lista única de clientes presentes nas tarefas
  const uniqueClients = useMemo(() => {
    const clients = new Set<string>();
    yearTasks.forEach((t) => {
      if (t.cliente && t.cliente.trim()) clients.add(t.cliente.trim());
    });
    return Array.from(clients).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [yearTasks]);

  // Lista única de categorias presentes nas tarefas
  const uniqueCategories = useMemo(() => {
    const cats = new Set<string>();
    yearTasks.forEach((t) => {
      if (t.categoria && t.categoria.trim()) cats.add(t.categoria.trim());
    });
    return Array.from(cats).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [yearTasks]);

  // Estatísticas rápidas
  const openTasks = useMemo(() => yearTasks.filter((item) => !item.concluido), [yearTasks]);
  const completedTasks = useMemo(() => yearTasks.filter((item) => item.concluido), [yearTasks]);
  const overdueTasks = useMemo(
    () => openTasks.filter((item) => isTaskOverdue(item, now)),
    [openTasks, now]
  );
  const upcomingTask = useMemo(() => {
    const orderedTasks = openTasks.slice().sort((a, b) => a.data.localeCompare(b.data) || a.titulo.localeCompare(b.titulo, "pt-BR"));
    return orderedTasks.find((item) => item.data >= todayInSaoPaulo()) || orderedTasks[0];
  }, [openTasks]);
  const daysUntilUpcomingTask = upcomingTask
    ? Math.round((Date.parse(`${upcomingTask.data}T12:00:00`) - Date.parse(`${todayInSaoPaulo()}T12:00:00`)) / 86400000)
    : null;

  // Filtragem e ordenação
  const filteredTasks = useMemo(() => {
    return yearTasks
      .filter((task) => {
        // Filtro de Status
        if (taskFilter === "open" && task.concluido) return false;
        if (taskFilter === "completed" && !task.concluido) return false;
        if (taskFilter === "overdue" && !isTaskOverdue(task, now)) return false;

        // Filtro de Cliente
        if (selectedClient !== "all" && task.cliente.trim() !== selectedClient) return false;

        // Filtro de Categoria
        if (selectedCategory !== "all" && task.categoria.trim() !== selectedCategory) return false;

        // Filtro de Prioridade
        if (selectedPriority !== "all" && task.prioridade !== selectedPriority) return false;

        // Busca por texto
        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase().trim();
          const matchTitle = task.titulo.toLowerCase().includes(q);
          const matchDesc = task.descricao.toLowerCase().includes(q);
          const matchClient = task.cliente.toLowerCase().includes(q);
          const matchCat = task.categoria.toLowerCase().includes(q);
          if (!matchTitle && !matchDesc && !matchClient && !matchCat) return false;
        }

        return true;
      })
      .sort((a, b) => {
        // Ordena: não concluídas primeiro, depois por prioridade (urgente -> baixa), depois data
        return (
          Number(a.concluido) - Number(b.concluido) ||
          PRIORITY_ORDER[a.prioridade] - PRIORITY_ORDER[b.prioridade] ||
          a.data.localeCompare(b.data) ||
          a.titulo.localeCompare(b.titulo, "pt-BR")
        );
      });
  }, [yearTasks, taskFilter, selectedClient, selectedCategory, selectedPriority, searchQuery, now]);

  function applySummaryFilter(filter: "open" | "completed" | "overdue" | "all") {
    setTaskFilter(filter);
  }

  return (
    <section className="task-view card p-4 sm:p-6">
      {/* Cabeçalho */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Tarefas</h2>
          <p className="muted mt-1 text-sm">
            {yearTasks.length} cadastrada(s) · {openTasks.length} em aberto ·{" "}
            <span className={overdueTasks.length ? "text-red-600 font-semibold" : ""}>
              {overdueTasks.length} atrasada(s)
            </span>
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="task-year-picker" aria-label="Navegar entre anos">
            <button type="button" className="task-year-arrow" aria-label="Ano anterior" disabled={shownYear <= 1900} onClick={() => onYearChange(shownYear - 1)}>‹</button>
            <span aria-live="polite">{shownYear}</span>
            <button type="button" className="task-year-arrow" aria-label="Próximo ano" disabled={shownYear >= yearLimit} onClick={() => onYearChange(shownYear + 1)}>›</button>
          </div>
          <button className="btn btn-primary" onClick={onNewTask}>
            ＋ Nova tarefa
          </button>
          <div className="task-filters-menu" ref={filtersRef}>
            <button
              type="button"
              className={`agenda-filter-trigger${filtersOpen ? " is-open" : ""}`}
              aria-label={`Filtros das tarefas, ${activeFilters} ativos`}
              title="Filtros"
              aria-haspopup="dialog"
              aria-expanded={filtersOpen}
              onClick={() => setFiltersOpen((open) => !open)}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5Z" />
              </svg>
              {activeFilters > 0 && <span className="agenda-filter-badge" aria-hidden="true">{activeFilters}</span>}
            </button>
            {filtersOpen && (
              <section className="task-filters-popover" role="dialog" aria-label="Filtros das tarefas">
                <label className="task-filter-field">
                  Filtrar por texto
                  <input
                    type="text"
                    className="field"
                    placeholder="Título, descrição, cliente..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </label>

                <div className="task-filter-section">
                  <h3 className="agenda-filter-heading">Status</h3>
                  <div className="task-status-options" role="group" aria-label="Filtrar tarefas por status">
                    {[
                      { id: "open", label: `A fazer (${openTasks.length})` },
                      { id: "completed", label: `Concluídas (${completedTasks.length})` },
                      { id: "overdue", label: `Atrasadas (${overdueTasks.length})` },
                      { id: "all", label: `Todas (${yearTasks.length})` },
                    ].map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        aria-pressed={taskFilter === filter.id}
                        onClick={() => setTaskFilter(filter.id as "open" | "completed" | "overdue" | "all")}
                      >
                        {filter.label}
                      </button>
                    ))}
                  </div>
                </div>

                <label className="task-filter-field">
                  Cliente
                  <select className="field" value={selectedClient} onChange={(e) => setSelectedClient(e.target.value)}>
                    <option value="all">Todos os clientes ({uniqueClients.length})</option>
                    {uniqueClients.map((client) => <option key={client} value={client}>{client}</option>)}
                  </select>
                </label>

                <label className="task-filter-field">
                  Área / Categoria
                  <select className="field" value={selectedCategory} onChange={(e) => setSelectedCategory(e.target.value)}>
                    <option value="all">Todas as áreas ({uniqueCategories.length})</option>
                    {uniqueCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                  </select>
                </label>

                <label className="task-filter-field">
                  Prioridade
                  <select className="field" value={selectedPriority} onChange={(e) => setSelectedPriority(e.target.value)}>
                    <option value="all">Todas as prioridades</option>
                    <option value="urgente">Urgente</option>
                    <option value="alta">Alta</option>
                    <option value="normal">Normal</option>
                    <option value="baixa">Baixa</option>
                  </select>
                </label>

                <div className="task-filter-footer">
                  <button type="button" className="agenda-clear-filters" onClick={() => {
                    setTaskFilter("open");
                    setSelectedClient("all");
                    setSelectedCategory("all");
                    setSelectedPriority("all");
                    setSearchQuery("");
                  }}>
                    Limpar filtros
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Cards de Resumo */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
        <button type="button" className="task-summary-card" aria-pressed={taskFilter === "open"} onClick={() => applySummaryFilter("open")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5h10v15H5V5h2m1 7 2 2 5-5M9 3h6v4H9z" /></svg>
          <span>A Fazer</span>
          <strong>{openTasks.length}</strong>
        </button>
        <button type="button" className="task-summary-card task-summary-completed" aria-pressed={taskFilter === "completed"} onClick={() => applySummaryFilter("completed")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z" /></svg>
          <span>Concluídas</span>
          <strong>{completedTasks.length}</strong>
          <span className="task-progress-track" aria-label={`${yearTasks.length ? Math.round(completedTasks.length / yearTasks.length * 100) : 0}% concluído`}>
            <span style={{ width: `${yearTasks.length ? completedTasks.length / yearTasks.length * 100 : 0}%` }} />
          </span>
        </button>
        <button type="button" className={`task-summary-card task-summary-overdue${overdueTasks.length ? " has-overdue" : ""}`} aria-pressed={taskFilter === "overdue"} onClick={() => applySummaryFilter("overdue")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18.5A1.7 1.7 0 0 0 3.3 21h17.4a1.7 1.7 0 0 0 1.5-2.5L13.7 3.9a2 2 0 0 0-3.4 0Z" /></svg>
          <span>Atrasadas</span>
          <strong>{overdueTasks.length}</strong>
        </button>
        <button type="button" className="task-summary-card" aria-pressed={taskFilter === "all"} onClick={() => applySummaryFilter("all")}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
          <span>Total</span>
          <strong>{yearTasks.length}</strong>
        </button>
      </div>

      {/* Lista de Tarefas */}
      <div className="tasks-content-layout">
        <div className="space-y-2.5">
          {filteredTasks.map((item) => (
            <WorkItem
              key={item.id}
              item={item}
              showDate
              taskMode
              onComplete={onToggleComplete}
              onDelete={onDeleteTask}
              onEdit={onEditTask}
            />
          ))}

          {!filteredTasks.length && (
            <div className="rounded-xl border border-dashed line p-8 text-center">
              <svg className="mx-auto mb-3 h-9 w-9 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M9 5h10v15H5V5h2" /><path d="m8 12 2 2 5-5M9 3h6v4H9z" />
              </svg>
              <p className="font-semibold text-base">
                {yearTasks.length === 0
                  ? `Nenhuma tarefa cadastrada em ${shownYear}.`
                  : taskFilter === "completed"
                  ? "Nenhuma tarefa concluída encontrada para estes filtros."
                  : taskFilter === "overdue"
                  ? overdueTasks.length ? "Nenhuma tarefa atrasada encontrada para estes filtros." : "Tudo em dia!"
                  : taskFilter === "open"
                  ? "Nenhuma tarefa em aberto encontrada para estes filtros."
                  : "Nenhuma tarefa corresponde aos filtros selecionados."}
              </p>
              <p className="muted mt-1 text-sm">
                {yearTasks.length === 0
                  ? "Clique em “Nova tarefa” para adicionar sua primeira tarefa."
                  : taskFilter === "overdue"
                  ? overdueTasks.length ? "Tente limpar os filtros para ver as tarefas atrasadas." : "Não há tarefas atrasadas neste ano."
                  : "Tente limpar os filtros ou a busca para ver mais itens."}
              </p>
              {yearTasks.length === 0 && (
                <button type="button" className="btn btn-primary mt-4" onClick={onNewTask}>+ Nova tarefa</button>
              )}
            </div>
          )}
        </div>

        <aside className="task-upcoming-card">
          <div className="task-upcoming-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
          </div>
          <div>
            <p className="muted text-xs font-semibold uppercase tracking-wider">Próximo prazo</p>
            {upcomingTask ? (
              <>
                <p className="mt-1 font-bold leading-snug">{upcomingTask.titulo}</p>
                <p className={`mt-2 text-sm font-semibold ${daysUntilUpcomingTask !== null && daysUntilUpcomingTask < 0 ? "text-red-600" : "text-primary"}`}>
                  {daysUntilUpcomingTask === 0 && !isTaskOverdue(upcomingTask, now)
                    ? "Hoje"
                    : daysUntilUpcomingTask !== null && (daysUntilUpcomingTask < 0 || isTaskOverdue(upcomingTask, now))
                    ? daysUntilUpcomingTask === 0
                      ? "Atrasada hoje"
                      : `Atrasada há ${Math.abs(daysUntilUpcomingTask)} ${Math.abs(daysUntilUpcomingTask) === 1 ? "dia" : "dias"}`
                    : `em ${daysUntilUpcomingTask} ${daysUntilUpcomingTask === 1 ? "dia" : "dias"}`}
                </p>
                <p className="muted mt-1 text-xs">{upcomingTask.data.split("-").reverse().join("/")}</p>
              </>
            ) : (
              <p className="mt-1 font-semibold">Nenhum prazo em aberto</p>
            )}
          </div>
          {upcomingTask && (
            <button type="button" className="task-upcoming-complete" aria-label={`Concluir ${upcomingTask.titulo}`} onClick={() => onToggleComplete(upcomingTask)}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4 4L19 6" /></svg>
            </button>
          )}
        </aside>
      </div>
    </section>
  );
}
