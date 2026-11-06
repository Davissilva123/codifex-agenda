"use client";

import { useEffect, useRef, useState } from "react";
import type { AgendaCategory } from "@/lib/types";

export type AppointmentStatusFilter = "all" | "pending" | "completed" | "overdue";

interface AgendaFiltersProps {
  categories: AgendaCategory[];
  selectedCategoryIds: string[];
  status: AppointmentStatusFilter;
  className?: string;
  onToggleCategory: (id: string) => void;
  onStatusChange: (status: AppointmentStatusFilter) => void;
  onClear: () => void;
}

const STATUSES: { id: AppointmentStatusFilter; label: string }[] = [
  { id: "all", label: "Todos" },
  { id: "pending", label: "Pendentes" },
  { id: "completed", label: "Feitos" },
  { id: "overdue", label: "Atrasados" },
];

export function AgendaFilters({
  categories,
  selectedCategoryIds,
  status,
  className = "",
  onToggleCategory,
  onStatusChange,
  onClear,
}: AgendaFiltersProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const activeFilters = selectedCategoryIds.length + (status === "all" ? 0 : 1);

  useEffect(() => {
    if (!open) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={`agenda-filter-menu ${className}`} ref={menuRef}>
      <button
        type="button"
        className={`agenda-filter-trigger${open ? " is-open" : ""}${activeFilters > 0 ? " is-filtered" : ""}`}
        aria-label={`Filtros, ${activeFilters} ativos`}
        title="Filtros"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((value) => !value)}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5Z" />
        </svg>
        {activeFilters > 0 && <span className="agenda-filter-badge" aria-hidden="true">{activeFilters}</span>}
      </button>
      {open && (
        <section className="agenda-filter-popover" role="dialog" aria-label="Filtros da agenda">
          <div className="agenda-filter-section">
            <h2 className="agenda-filter-heading">Categorias</h2>
            <div className="agenda-category-grid">
              {categories.map((category) => {
                const selected = selectedCategoryIds.includes(category.id);
                return (
                  <button
                    key={category.id}
                    type="button"
                    className={`agenda-category-filter${selected ? " selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => onToggleCategory(category.id)}
                  >
                    <span className="agenda-category-dot" style={{ backgroundColor: category.cor }} />
                    <span className="agenda-category-name">{category.nome}</span>
                  </button>
                );
              })}
              {!categories.length && <span className="muted text-sm">Nenhuma categoria cadastrada.</span>}
            </div>
          </div>

          <div className="agenda-filter-section">
            <h2 className="agenda-filter-heading">Status</h2>
            <div className="agenda-status-segment" role="group" aria-label="Filtrar por status">
              {STATUSES.map((option) => (
                <button key={option.id} type="button" aria-pressed={status === option.id} onClick={() => onStatusChange(option.id)}>
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="agenda-filter-footer">
            <button type="button" className="agenda-clear-filters" onClick={onClear}>Limpar</button>
          </div>
        </section>
      )}
    </div>
  );
}
