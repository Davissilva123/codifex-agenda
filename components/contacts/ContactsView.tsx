"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Contact } from "@/lib/types";
import { formatDate } from "@/lib/dates";
import { formatBrazilianPhone, normalizePhoneNumber } from "@/lib/contacts";

interface DuplicatePair {
  first: Contact;
  second: Contact;
  reasons: string[];
}

interface ContactsViewProps {
  contacts: Contact[];
  trashedContacts: Contact[];
  lastTrashedContactIds: string[];
  onNewContact: () => void;
  onEditContact: (contact: Contact) => void;
  onDeleteContact: (contact: Contact) => void;
  onDeleteContacts: (ids: string[]) => void;
  onUndoTrash: () => void;
  onRestoreContact: (contact: Contact) => void;
  onDeletePermanently: (contact: Contact) => void;
  onMergeContacts: (primary: Contact, duplicate: Contact) => Promise<void>;
  onToggleFavorite: (contact: Contact) => void;
  onImportCsv: (file: File) => void;
  onExportCsv: () => void;
}

function contactInitial(name: string): string {
  return (name.trim().normalize("NFD").replace(/[\u0300-\u036f]/g, "")[0] || "#").toUpperCase();
}

function contactMonogram(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts.length > 1
    ? `${contactInitial(parts[0])}${contactInitial(parts[parts.length - 1])}`
    : contactInitial(name);
}

function normalizedEmail(email: string): string {
  return email.trim().toLocaleLowerCase("pt-BR");
}

function findDuplicates(contacts: Contact[]): DuplicatePair[] {
  const pairs = new Map<string, DuplicatePair>();
  const byEmail = new Map<string, Contact[]>();
  const byPhone = new Map<string, Contact[]>();

  for (const contact of contacts) {
    const email = normalizedEmail(contact.email);
    if (email) byEmail.set(email, [...(byEmail.get(email) || []), contact]);

    const phones = new Set((contact.telefones || []).map((phone) => normalizePhoneNumber(phone.numero)).filter(Boolean));
    for (const phone of phones) byPhone.set(phone, [...(byPhone.get(phone) || []), contact]);
  }

  const addPairs = (groups: Map<string, Contact[]>, reason: string) => {
    for (const group of groups.values()) {
      for (let firstIndex = 0; firstIndex < group.length; firstIndex++) {
        for (let secondIndex = firstIndex + 1; secondIndex < group.length; secondIndex++) {
          const first = group[firstIndex];
          const second = group[secondIndex];
          const key = [first.id, second.id].sort().join(":");
          const pair = pairs.get(key) || { first, second, reasons: [] };
          if (!pair.reasons.includes(reason)) pair.reasons.push(reason);
          pairs.set(key, pair);
        }
      }
    }
  };

  addPairs(byEmail, "mesmo e-mail");
  addPairs(byPhone, "mesmo telefone");
  return Array.from(pairs.values());
}

export function ContactsView({
  contacts,
  trashedContacts,
  lastTrashedContactIds,
  onNewContact,
  onEditContact,
  onDeleteContact,
  onDeleteContacts,
  onUndoTrash,
  onRestoreContact,
  onDeletePermanently,
  onMergeContacts,
  onToggleFavorite,
  onImportCsv,
  onExportCsv,
}: ContactsViewProps) {
  const [contactLetter, setContactLetter] = useState("");
  const [search, setSearch] = useState("");
  const [viewMode, setViewMode] = useState<"cards" | "list">("list");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filtersRef = useRef<HTMLDivElement>(null);
  const [actionsOpen, setActionsOpen] = useState(false);
  const actionsRef = useRef<HTMLDivElement>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [mergePair, setMergePair] = useState<DuplicatePair | null>(null);
  const [primaryId, setPrimaryId] = useState("");
  const [mergeError, setMergeError] = useState("");
  const [merging, setMerging] = useState(false);
  const [showTrashNotice, setShowTrashNotice] = useState(false);

  useEffect(() => {
    if (!lastTrashedContactIds.length) {
      setShowTrashNotice(false);
      return;
    }

    setShowTrashNotice(true);
    const timer = window.setTimeout(() => setShowTrashNotice(false), 6000);
    return () => window.clearTimeout(timer);
  }, [lastTrashedContactIds]);

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

  useEffect(() => {
    if (!actionsOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!actionsRef.current?.contains(event.target as Node)) setActionsOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActionsOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [actionsOpen]);

  const letterCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const contact of contacts) {
      const letter = contactInitial(contact.nome);
      counts.set(letter, (counts.get(letter) || 0) + 1);
    }
    return counts;
  }, [contacts]);

  const displayedContacts = useMemo(() => {
    return contacts
      .filter((contact) => {
        if (contactLetter && contactInitial(contact.nome) !== contactLetter) return false;
        if (search.trim()) {
          const query = search.toLocaleLowerCase("pt-BR").trim();
          const matchName = contact.nome.toLocaleLowerCase("pt-BR").includes(query);
          const matchEmail = contact.email.toLocaleLowerCase("pt-BR").includes(query);
          const matchCompany = contact.empresa.toLocaleLowerCase("pt-BR").includes(query);
          const matchNotes = contact.observacoes.toLocaleLowerCase("pt-BR").includes(query);
          const matchPhones = (contact.telefones || []).some((phone) => phone.numero.includes(query));
          if (!matchName && !matchEmail && !matchCompany && !matchNotes && !matchPhones) return false;
        }
        return true;
      })
      .sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR"));
  }, [contacts, contactLetter, search]);

  const duplicatePairs = useMemo(() => findDuplicates(contacts), [contacts]);
  const activeFilters = contactLetter ? 1 : 0;
  const availableLetters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").filter(
    (letter) => letterCounts.has(letter) || contactLetter === letter
  );
  const visibleIds = displayedContacts.map((contact) => contact.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  function toggleSelected(id: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleVisibleSelection() {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (allVisibleSelected) visibleIds.forEach((id) => next.delete(id));
      else visibleIds.forEach((id) => next.add(id));
      return next;
    });
  }

  async function confirmMerge() {
    if (!mergePair) return;
    const primary = mergePair.first.id === primaryId ? mergePair.first : mergePair.second;
    const duplicate = mergePair.first.id === primaryId ? mergePair.second : mergePair.first;
    setMerging(true);
    setMergeError("");
    try {
      await onMergeContacts(primary, duplicate);
      setMergePair(null);
    } catch (error) {
      setMergeError(error instanceof Error ? error.message : "Não foi possível mesclar os contatos.");
    } finally {
      setMerging(false);
    }
  }

  const contactCard = (contact: Contact) => (
    <article
      key={contact.id}
      className={`contact-card rounded-xl border line p-4 flex flex-col justify-between transition-shadow hover:shadow-md ${
        contact.favorito ? "bg-amber-50/10 border-amber-300 dark:border-amber-800" : "bg-surface"
      }`}
    >
      <div>
        <div className="flex items-start gap-2">
          <input
            type="checkbox"
            aria-label={`Selecionar ${contact.nome}`}
            checked={selectedIds.has(contact.id)}
            onChange={() => toggleSelected(contact.id)}
            className="mt-1 h-4 w-4 accent-violet-600"
          />
          <div className="min-w-0 flex-1">
            <div className="flex justify-between items-start gap-2">
              <div className="flex items-center gap-2">
                <span className="contact-avatar" aria-hidden="true">{contactMonogram(contact.nome)}</span>
                <div>
                <h3 className="font-bold text-base">{contact.nome}</h3>
                {contact.empresa && <p className="muted text-xs sm:text-sm">{contact.empresa}</p>}
                </div>
              </div>
              <button
                type="button"
                aria-label={contact.favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                className={`contact-favorite ${contact.favorito ? "is-favorite" : ""}`}
                onClick={() => onToggleFavorite(contact)}
                title={contact.favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}
              >
                {contact.favorito ? "★" : "☆"}
              </button>
            </div>

            {contact.email && (
              <p className="contact-detail mt-2.5 text-xs sm:text-sm">
                <a className="text-violet-600 dark:text-violet-400 hover:underline" href={`mailto:${contact.email}`}>
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                {contact.email}
                </a>
              </p>
            )}
            {(contact.telefones || []).map((phone) => (
              <p key={phone.id || phone.numero} className="contact-detail muted mt-1 text-xs sm:text-sm">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 11.2 19a19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.7a2 2 0 0 1-.6 1.8L7.7 9.5a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 1.8-.6l2.7.5a2 2 0 0 1 1.7 1.8Z" /></svg>
              <span className="capitalize">{phone.rotulo}</span>
              <a
                className="text-violet-600 dark:text-violet-400 hover:underline font-medium"
                href={`tel:${phone.numero.replace(/[^\d+]/g, "")}`}
                >
                  {formatBrazilianPhone(phone.numero)}
                </a>
              </p>
            ))}
            {contact.endereco && <p className="contact-detail muted mt-2 text-xs"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 10c0 5-8 12-8 12S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></svg>{contact.endereco}</p>}
            {contact.aniversario && <p className="contact-detail muted mt-2 text-xs"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>{formatDate(contact.aniversario)}</p>}
            {contact.observacoes && (
              <p className="muted mt-2 text-xs whitespace-pre-wrap line-clamp-2 border-t line pt-2 italic">
                {contact.observacoes}
              </p>
            )}
          </div>
        </div>
      </div>
      <div className="contact-actions mt-4 flex justify-end gap-2 border-t line pt-3">
        <button type="button" aria-label={`Editar contato ${contact.nome}`} title="Editar" className="contact-icon-action" onClick={() => onEditContact(contact)}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15l-.8 5Z" /></svg>
        </button>
        <button
          type="button"
          aria-label={`Mover ${contact.nome} para a lixeira`}
          title="Mover para a lixeira"
          className="contact-icon-action is-danger"
          onClick={() => onDeleteContact(contact)}
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" /></svg>
        </button>
      </div>
    </article>
  );

  return (
    <section className="card p-4 sm:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl sm:text-2xl font-bold">{showTrash ? "Lixeira" : "Agenda telefônica"}</h2>
          <p className="muted text-sm">
            {showTrash
              ? `${trashedContacts.length} contato(s) na lixeira`
              : `${contacts.length} contato(s) cadastrado(s)`}
          </p>
        </div>
        <div className="contact-header-actions flex flex-wrap items-center gap-2">
          {showTrash ? (
            <button type="button" className="btn btn-ghost contact-secondary-action" onClick={() => {
              setShowTrash(false);
              setSelectedIds(new Set());
              setActionsOpen(false);
            }}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 18-6-6 6-6" /><path d="M9 12h12" /></svg>
              Voltar aos contatos
            </button>
          ) : (
            <>
              <div className="contact-actions-menu" ref={actionsRef}>
                <button
                  type="button"
                  className={`btn btn-ghost contact-secondary-action${actionsOpen ? " is-open" : ""}`}
                  aria-haspopup="menu"
                  aria-expanded={actionsOpen}
                  onClick={() => setActionsOpen((open) => !open)}
                >
                  Ações
                  <svg className="contact-actions-chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
                </button>
                {actionsOpen && (
                  <div className="contact-actions-dropdown" role="menu" aria-label="Ações dos contatos">
                    <button type="button" role="menuitem" className="contact-actions-item" onClick={() => {
                      setShowTrash(true);
                      setSelectedIds(new Set());
                      setActionsOpen(false);
                    }}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2" /><path d="M10 11v5m4-5v5" /></svg>
                      <span>Lixeira{trashedContacts.length ? ` (${trashedContacts.length})` : ""}</span>
                    </button>
                    <div className="contact-actions-divider" role="separator" />
                    <label className="contact-actions-item" role="menuitem">
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M5 14v6h14v-6" /></svg>
                      <span>Importar CSV</span>
                      <input
                        className="hidden"
                        type="file"
                        accept=".csv,text/csv"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) onImportCsv(file);
                          event.currentTarget.value = "";
                          setActionsOpen(false);
                        }}
                      />
                    </label>
                    <button type="button" role="menuitem" className="contact-actions-item" onClick={() => {
                      setActionsOpen(false);
                      onExportCsv();
                    }}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 8v12m-5-5 5 5 5-5" /><path d="M5 10V4h14v6" /></svg>
                      <span>Exportar CSV</span>
                    </button>
                  </div>
                )}
              </div>
              <button type="button" className="btn btn-primary text-xs sm:text-sm" onClick={onNewContact}>
                ＋ Novo contato
              </button>
            </>
          )}
        </div>
      </div>

      {showTrashNotice && !!lastTrashedContactIds.length && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/30">
          <span>{lastTrashedContactIds.length} contato(s) movido(s) para a lixeira.</span>
          <button type="button" className="btn btn-ghost text-violet-700 dark:text-violet-300" onClick={() => {
            setShowTrashNotice(false);
            onUndoTrash();
          }}>
            Desfazer
          </button>
        </div>
      )}

      {showTrash ? (
        <div className="space-y-2">
          {trashedContacts.map((contact) => (
            <article key={contact.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border line p-3">
              <div>
                <strong>{contact.nome}</strong>
                <p className="muted text-xs">
                  {contact.email || contact.telefones?.[0]?.numero || "Sem e-mail ou telefone"}
                  {contact.deleted_at && ` · Excluído em ${formatDate(contact.deleted_at)}`}
                </p>
              </div>
              <div className="flex gap-2">
                <button type="button" className="btn btn-ghost text-xs" onClick={() => onRestoreContact(contact)}>
                  Restaurar
                </button>
                <button
                  type="button"
                  className="btn btn-ghost text-xs text-red-600"
                  onClick={() => onDeletePermanently(contact)}
                >
                  Excluir permanentemente
                </button>
              </div>
            </article>
          ))}
          {!trashedContacts.length && <p className="muted py-12 text-center">A lixeira está vazia.</p>}
        </div>
      ) : (
        <>
          <div className="contact-search-tools mb-4 flex flex-wrap items-center gap-2">
            <input
              type="text"
              placeholder="Buscar por nome, telefone, empresa..."
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setSelectedIds(new Set());
              }}
              className="field py-1.5 text-xs sm:text-sm contact-search"
            />
            <div className="contact-filters-menu" ref={filtersRef}>
              <button
                type="button"
                className={`agenda-filter-trigger${filtersOpen ? " is-open" : ""}${activeFilters ? " is-filtered" : ""}`}
                aria-label={`Filtros de contatos, ${activeFilters} ativos`}
                title="Filtros de contatos"
                aria-expanded={filtersOpen}
                aria-haspopup="dialog"
                onClick={() => setFiltersOpen((open) => !open)}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 5h16l-6.5 7.5V19l-3 1v-7.5L4 5Z" />
                </svg>
                {activeFilters > 0 && <span className="agenda-filter-badge" aria-hidden="true">{activeFilters}</span>}
              </button>
              {filtersOpen && (
                <section className="contact-filters-popover" role="dialog" aria-label="Filtros de contatos">
                  <div className="contact-filter-section">
                    <h3 className="agenda-filter-heading">Exibição</h3>
                    <div className="contact-view-switch" role="group" aria-label="Modo de exibição">
                      <button type="button" aria-pressed={viewMode === "cards"} onClick={() => setViewMode("cards")}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="8" height="8" rx="1.5" /><rect x="13" y="3" width="8" height="8" rx="1.5" /><rect x="3" y="13" width="8" height="8" rx="1.5" /><rect x="13" y="13" width="8" height="8" rx="1.5" /></svg>
                        Cards
                      </button>
                      <button type="button" aria-pressed={viewMode === "list"} onClick={() => setViewMode("list")}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" /></svg>
                        Lista
                      </button>
                    </div>
                  </div>

                  <div className="contact-filter-section">
                    <h3 className="agenda-filter-heading">Filtrar por letra</h3>
                    <div className="contact-filter-letters" aria-label="Filtro alfabético">
                      <button
                        type="button"
                        aria-pressed={!contactLetter}
                        className={!contactLetter ? "selected" : ""}
                        onClick={() => {
                          setContactLetter("");
                          setSelectedIds(new Set());
                        }}
                      >
                        Todos <span>{contacts.length}</span>
                      </button>
                      {availableLetters.map((letter) => (
                        <button
                          key={letter}
                          type="button"
                          aria-label={`${letter}: ${letterCounts.get(letter) || 0} contato(s)`}
                          aria-pressed={contactLetter === letter}
                          className={contactLetter === letter ? "selected" : ""}
                          onClick={() => {
                            setContactLetter(letter);
                            setSelectedIds(new Set());
                          }}
                        >
                          {letter}<span>{letterCounts.get(letter) || 0}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="agenda-filter-footer">
                    <button type="button" className="agenda-clear-filters" disabled={!contactLetter} onClick={() => {
                      setContactLetter("");
                      setSelectedIds(new Set());
                    }}>Limpar filtros</button>
                  </div>
                </section>
              )}
            </div>
          </div>

          {displayedContacts.length > 0 && (
            <div className="contact-selection-bar mb-3 flex flex-wrap items-center justify-between gap-2 border-y line py-2">
              <label className="flex items-center gap-2 text-xs">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleVisibleSelection} />
                Selecionar todos os contatos
              </label>
              <span className="muted text-xs">{selectedIds.size} selecionado(s)</span>
              {selectedIds.size > 0 && (
                <button
                  type="button"
                  className="btn btn-ghost text-xs text-red-600"
                  onClick={() => {
                    onDeleteContacts(Array.from(selectedIds));
                    setSelectedIds(new Set());
                  }}
                >
                  Mover seleção para a lixeira
                </button>
              )}
            </div>
          )}

          {duplicatePairs.length > 0 && (
            <section className="mb-5 rounded-xl border border-amber-300 bg-amber-50/50 p-3 dark:border-amber-900 dark:bg-amber-950/20">
              <h3 className="mb-2 font-semibold">Possíveis duplicados ({duplicatePairs.length})</h3>
              <div className="space-y-2">
                {duplicatePairs.map((pair) => (
                  <div key={`${pair.first.id}:${pair.second.id}`} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span>
                      {pair.first.nome} e {pair.second.nome}
                      <span className="muted ml-2 text-xs">({pair.reasons.join(", ")})</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost px-2 py-1 text-xs"
                      onClick={() => {
                        setMergePair(pair);
                        setPrimaryId(pair.first.id);
                        setMergeError("");
                      }}
                    >
                      Mesclar
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {viewMode === "cards" ? (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {displayedContacts.map(contactCard)}
            </div>
          ) : (
            <div className="contact-list divide-y divide-black/10 dark:divide-white/10">
              {displayedContacts.map((contact) => (
                <div key={contact.id} className={`contact-row${contact.favorito ? " is-favorite" : ""}`}>
                  <input
                    type="checkbox"
                    aria-label={`Selecionar ${contact.nome}`}
                    checked={selectedIds.has(contact.id)}
                    onChange={() => toggleSelected(contact.id)}
                    className="contact-select h-4 w-4 accent-violet-600"
                  />
                  <button
                    type="button"
                    aria-label={contact.favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}
                    className={`contact-row-favorite ${contact.favorito ? "is-favorite" : ""}`}
                    onClick={() => onToggleFavorite(contact)}
                  >
                    {contact.favorito ? "★" : "☆"}
                  </button>
                  <span className="contact-avatar" aria-hidden="true">{contactMonogram(contact.nome)}</span>
                  <div className="contact-row-name">
                    <strong className="block text-sm">{contact.nome}</strong>
                    <span className="muted text-xs">{contact.empresa || "Sem empresa"}</span>
                  </div>
                  <div className="contact-row-details">
                    {contact.email ? (
                      <a className="contact-row-email" href={`mailto:${contact.email}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3 7 9 6 9-6" /></svg>
                        {contact.email}
                      </a>
                    ) : <span className="muted text-xs">Sem e-mail</span>}
                    {(contact.telefones || []).map((phone) => (
                      <a key={phone.id || phone.numero} className="contact-row-phone" href={`tel:${phone.numero.replace(/[^\d+]/g, "")}`}>
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2A19.8 19.8 0 0 1 11.2 19a19.4 19.4 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7l.5 2.7a2 2 0 0 1-.6 1.8L7.7 9.5a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 1.8-.6l2.7.5a2 2 0 0 1 1.7 1.8Z" /></svg>
                        {formatBrazilianPhone(phone.numero)}
                      </a>
                    ))}
                    {!contact.telefones?.length && <span className="muted text-xs">Sem telefone</span>}
                  </div>
                  <div className="contact-row-actions">
                    <button type="button" aria-label={`Editar contato ${contact.nome}`} title="Editar" className="contact-icon-action" onClick={() => onEditContact(contact)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m16 4 4 4M4 20l4-.8L19 8a2.8 2.8 0 0 0-4-4L4 15l-.8 5Z" /></svg>
                    </button>
                    <button type="button" aria-label={`Mover ${contact.nome} para a lixeira`} title="Mover para a lixeira" className="contact-icon-action is-danger" onClick={() => onDeleteContact(contact)}>
                      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!displayedContacts.length && (
            <div className="rounded-xl border border-dashed line py-12 text-center">
              <svg className="mx-auto mb-3 h-9 w-9 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1a5.5 5.5 0 0 1 11 0v1zM16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8V20h-3" />
              </svg>
              <p className="font-semibold">{contacts.length ? "Nenhum contato encontrado." : "Sua lista de contatos está vazia."}</p>
              <p className="muted mt-1 text-xs">{contacts.length ? "Ajuste a busca ou o filtro alfabético, ou cadastre um novo contato." : "Adicione seu primeiro contato para encontrá-lo rapidamente."}</p>
              {(!contacts.length || search.trim() || contactLetter) && <button type="button" className="btn btn-primary mt-4" onClick={onNewContact}>+ Novo contato</button>}
            </div>
          )}
        </>
      )}

      {mergePair && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true">
          <section className="surface w-full max-w-lg rounded-2xl p-5 shadow-2xl">
            <h2 className="text-lg font-bold">Mesclar contatos</h2>
            <p className="muted mt-1 text-sm">
              Os dados vazios do contato escolhido serão preenchidos com os do outro. Telefones serão unidos sem duplicar;
              o segundo contato ficará na lixeira.
            </p>
            <fieldset className="mt-4 space-y-2">
              <legend className="mb-2 text-sm font-medium">Manter como contato principal:</legend>
              {[mergePair.first, mergePair.second].map((contact) => (
                <label key={contact.id} className="flex cursor-pointer items-center gap-2 rounded-lg border line p-3 text-sm">
                  <input
                    type="radio"
                    name="primary-contact"
                    checked={primaryId === contact.id}
                    onChange={() => setPrimaryId(contact.id)}
                  />
                  <span>
                    <strong>{contact.nome}</strong>
                    <span className="muted ml-2">{contact.email || contact.telefones?.[0]?.numero || "Sem contato"}</span>
                  </span>
                </label>
              ))}
            </fieldset>
            {mergeError && <p className="mt-3 text-sm text-red-600" role="alert">{mergeError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" disabled={merging} onClick={() => setMergePair(null)}>
                Cancelar
              </button>
              <button type="button" className="btn btn-primary" disabled={merging} onClick={confirmMerge}>
                {merging ? "Mesclando..." : "Mesclar contatos"}
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
