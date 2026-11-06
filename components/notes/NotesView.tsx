"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FreeNote } from "@/lib/types";
import { MarkdownViewer } from "@/components/ui/MarkdownViewer";

const NOTE_COLORS = [
  "#6858d8", // Roxo clássico
  "#3676c8", // Azul
  "#238d78", // Esmeralda
  "#e68a32", // Âmbar / Laranja
  "#e2537d", // Rosa
  "#874eaa", // Lilás
  "#64748b", // Ardósia
];

interface NotesViewProps {
  notes: FreeNote[];
  onSaveNote: (note: Omit<FreeNote, "id" | "user_id" | "created_at" | "updated_at">, id?: string) => Promise<void>;
  onDeleteNote: (note: FreeNote) => Promise<void>;
  onTogglePin: (note: FreeNote) => Promise<void>;
  busy?: boolean;
}

export function NotesView({ notes, onSaveNote, onDeleteNote, onTogglePin, busy }: NotesViewProps) {
  const [search, setSearch] = useState("");
  const [editingNote, setEditingNote] = useState<FreeNote | null | "new">(null);
  const [formTitle, setFormTitle] = useState("");
  const [formContent, setFormContent] = useState("");
  const [formColor, setFormColor] = useState(NOTE_COLORS[0]);
  const [formPinned, setFormPinned] = useState(false);
  const [filterColor, setFilterColor] = useState<string>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const activeFilters = (filterColor === "all" ? 0 : 1) + (search.trim() ? 1 : 0);

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

  function openNew() {
    setFormTitle("");
    setFormContent("");
    setFormColor(NOTE_COLORS[0]);
    setFormPinned(false);
    setEditingNote("new");
  }

  function openEdit(note: FreeNote) {
    setFormTitle(note.titulo);
    setFormContent(note.conteudo);
    setFormColor(note.cor || NOTE_COLORS[0]);
    setFormPinned(note.fixada);
    setEditingNote(note);
  }

  async function handleFormSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!formTitle.trim() && !formContent.trim()) return;

    await onSaveNote(
      {
        titulo: formTitle.trim() || "Sem título",
        conteudo: formContent,
        cor: formColor,
        fixada: formPinned,
      },
      typeof editingNote === "object" && editingNote !== null ? editingNote.id : undefined
    );
    setEditingNote(null);
  }

  const filteredNotes = useMemo(() => {
    return notes
      .filter((n) => {
        if (filterColor !== "all" && n.cor !== filterColor) return false;
        if (search.trim()) {
          const q = search.toLowerCase().trim();
          const matchTitle = n.titulo.toLowerCase().includes(q);
          const matchContent = n.conteudo.toLowerCase().includes(q);
          if (!matchTitle && !matchContent) return false;
        }
        return true;
      })
      .sort((a, b) => {
        // Fixadas primeiro, depois data de atualização mais recente
        if (a.fixada !== b.fixada) return a.fixada ? -1 : 1;
        return (b.updated_at || b.created_at || "").localeCompare(a.updated_at || a.created_at || "");
      });
  }, [notes, search, filterColor]);

  const pinnedCount = useMemo(() => notes.filter((n) => n.fixada).length, [notes]);

  return (
    <section className="card p-4 sm:p-6">
      {/* Cabeçalho */}
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">Anotações</h2>
          <p className="muted mt-1 text-sm">
            {notes.length} {notes.length === 1 ? "anotação" : "anotações"}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={openNew}>
            ＋ Nova anotação
          </button>
          <div className="task-filters-menu" ref={filtersRef}>
            <button
              type="button"
              className={`agenda-filter-trigger${filtersOpen ? " is-open" : ""}`}
              aria-label={`Filtros das notas, ${activeFilters} ativos`}
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
              <section className="task-filters-popover notes-filters-popover" role="dialog" aria-label="Filtros das notas">
                <label className="task-filter-field">
                  Filtrar por texto
                  <input
                    type="text"
                    className="field"
                    placeholder="Título ou conteúdo..."
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </label>

                <div className="task-filter-section">
                  <h3 className="agenda-filter-heading">Cor</h3>
                  <div className="notes-filter-colors" role="group" aria-label="Filtrar notas por cor">
                    <button
                      type="button"
                      className={`notes-filter-color-all${filterColor === "all" ? " selected" : ""}`}
                      aria-pressed={filterColor === "all"}
                      onClick={() => setFilterColor("all")}
                    >
                      Todas
                    </button>
                    {NOTE_COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        className={`notes-filter-color${filterColor === color ? " selected" : ""}`}
                        style={{ "--note-color": color } as React.CSSProperties}
                        aria-label={`Filtrar pela cor ${color}`}
                        aria-pressed={filterColor === color}
                        title={`Filtrar pela cor ${color}`}
                        onClick={() => setFilterColor(filterColor === color ? "all" : color)}
                      />
                    ))}
                  </div>
                </div>

                <div className="task-filter-footer">
                  <button type="button" className="agenda-clear-filters" onClick={() => {
                    setSearch("");
                    setFilterColor("all");
                  }}>
                    Limpar filtros
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>
      </div>

      {/* Grid de Anotações */}
      <div className="notes-grid">
        {filteredNotes.map((note) => (
          <article
            key={note.id}
            className={`note-card rounded-xl border line p-4 flex flex-col transition-all hover:shadow-md ${
              note.fixada ? "bg-violet-50/20 dark:bg-violet-950/20 border-violet-300 dark:border-violet-800" : "bg-surface"
            }`}
            style={{ borderTopWidth: "4px", borderTopColor: note.cor || "#6858d8" }}
          >
            <div>
              <div className="note-card-heading">
                <h3 className="font-bold text-base line-clamp-2">{note.titulo}</h3>
                <button
                  type="button"
                  onClick={() => onTogglePin(note)}
                  className={`note-card-pin${note.fixada ? " is-pinned" : ""}`}
                  title={note.fixada ? "Desafixar nota" : "Fixar nota no topo"}
                  aria-label={note.fixada ? "Desafixar anotação" : "Fixar anotação no topo"}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m16 3 5 5-4 1-4 4v4l-2 2-1-5-5-5 2-2h4l1-4Z" />
                    <path d="m4 20 5-5" />
                  </svg>
                </button>
              </div>

              {/* Pré-visualização do conteúdo Markdown */}
              <div className="note-card-preview line-clamp-6">
                <MarkdownViewer content={note.conteudo} />
              </div>
            </div>

            {/* Rodapé da nota */}
            <div className="note-card-footer">
              <span className="note-card-date">
                {note.updated_at
                  ? new Date(note.updated_at).toLocaleDateString("pt-BR")
                  : new Date().toLocaleDateString("pt-BR")}
              </span>

              <div className="note-card-actions">
                <button
                  type="button"
                  className="note-card-action"
                  onClick={() => openEdit(note)}
                  aria-label="Editar anotação"
                  title="Editar"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m14 5 5 5M4 20l4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z" />
                  </svg>
                </button>
                <button
                  type="button"
                  className="note-card-action is-delete"
                  onClick={() => onDeleteNote(note)}
                  aria-label="Excluir anotação"
                  title="Excluir"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="M4 7h16M10 11v6m4-6v6M5 7l1 14h12l1-14M9 7V4h6v3" />
                  </svg>
                </button>
              </div>
            </div>
          </article>
        ))}
      </div>

      {!filteredNotes.length && (
        <div className="rounded-xl border border-dashed line p-12 text-center my-6">
          <svg className="mx-auto mb-3 h-9 w-9 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 3.5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM8 8h8M8 12h8M8 16h5" />
          </svg>
          <p className="font-semibold text-base">
            {notes.length === 0
              ? "Nenhuma anotação criada ainda."
              : "Nenhuma anotação corresponde aos filtros."}
          </p>
          <p className="muted mt-1 text-sm">
            {notes.length === 0
              ? "Clique em “Nova anotação” para registrar ideias, reuniões e rascunhos em Markdown."
              : "Tente limpar a busca ou os filtros de cor."}
          </p>
          {notes.length === 0 && (
            <button type="button" className="btn btn-primary mt-4" onClick={openNew}>
              ＋ Criar primeira nota
            </button>
          )}
        </div>
      )}

      {/* Modal de Criação / Edição de Nota */}
      {editingNote !== null && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
          role="dialog"
          aria-modal="true"
          aria-label={editingNote === "new" ? "Nova anotação" : "Editar anotação"}
        >
          <form
            onSubmit={handleFormSubmit}
            className="note-form-modal surface max-h-[92vh] w-full overflow-y-auto rounded-2xl shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setEditingNote(null)}
              className="btn btn-ghost note-form-close"
              aria-label="Fechar"
            >
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
            </button>

            <section className="note-form-section">
              <h2 className="note-form-section-title">Informações principais</h2>
              <label className="note-form-label">
                Título
                <input
                  autoFocus
                  className="field mt-1"
                  placeholder="Ex.: Ideias para o projeto, Pauta de reunião..."
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                  maxLength={200}
                />
              </label>
            </section>

            <section className="note-form-section note-form-content-section">
              <h2 className="note-form-section-title">Conteúdo</h2>
              <label className="note-form-label" htmlFor="note-content">
                Anotação
                <textarea
                  id="note-content"
                  className="field mt-1 note-form-content"
                  placeholder="Escreva sua anotação..."
                  value={formContent}
                  onChange={(e) => setFormContent(e.target.value)}
                />
              </label>
            </section>

            <section className="note-form-options">
              <div>
                <h2 className="note-form-section-title">Personalização</h2>
                <span className="muted mb-2 block text-xs">Cor de destaque</span>
                <div className="note-form-colors" role="group" aria-label="Cor de destaque">
                  {NOTE_COLORS.map((color, index) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setFormColor(color)}
                      className={`note-form-color${formColor === color ? " selected" : ""}`}
                      style={{ "--note-color": color } as React.CSSProperties}
                      aria-label={`Selecionar cor ${index + 1}`}
                      aria-pressed={formColor === color}
                    />
                  ))}
                </div>
              </div>

              <button
                type="button"
                aria-pressed={formPinned}
                onClick={() => setFormPinned((pinned) => !pinned)}
                className={`note-form-pin${formPinned ? " selected" : ""}`}
              >
                <span className="note-form-pin-copy">
                  <strong>Manter anotação no topo da lista</strong>
                  <small>{formPinned ? "Esta anotação ficará sempre no início." : "Dê prioridade a esta anotação na lista."}</small>
                </span>
                <span className="note-form-pin-indicator" aria-hidden="true">
                  {formPinned && <svg viewBox="0 0 24 24"><path d="m5 12 4 4L19 6" /></svg>}
                </span>
              </button>
            </section>

            <div className="note-form-footer flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingNote(null)}
                className="btn btn-ghost"
              >
                Cancelar
              </button>
              <button disabled={busy} className="btn btn-primary">
                {busy ? "Salvando..." : editingNote === "new" ? "Criar anotação" : "Salvar anotação"}
              </button>
            </div>
          </form>
        </div>
      )}
    </section>
  );
}
