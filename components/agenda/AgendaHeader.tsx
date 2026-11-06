"use client";

import { useEffect, useRef, useState, type RefObject } from "react";
import { AgendaFilters, type AppointmentStatusFilter } from "@/components/agenda/AgendaFilters";
import type { AgendaCategory, View } from "@/lib/types";

export interface AgendaNotice {
  kind: "success" | "error";
  text: string;
}

interface AgendaHeaderProps {
  title: string;
  subtitle: string;
  view: View;
  onViewChange: (view: View) => void;
  categories: AgendaCategory[];
  selectedCategoryIds: string[];
  statusFilter: AppointmentStatusFilter;
  onToggleCategory: (id: string) => void;
  onStatusFilterChange: (status: AppointmentStatusFilter) => void;
  onClearFilters: () => void;
  onManageCategories: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  onHome: () => void;
  onNewItem: () => void;
  newItemLabel: string;
  onManageAppointmentTypes: () => void;
  userName: string;
  userEmail: string;
  notificationCount: number;
  onExportIcal: () => void;
  onImportIcal: () => void;
  onExportBackup: () => void;
  backupBusy?: boolean;
  importBusy?: boolean;
  theme: "light" | "dark";
  onToggleTheme: () => void;
  alertsOn: boolean;
  pushBusy: boolean;
  onToggleNotifications: () => void;
  installPrompt: Event | null;
  onInstall: () => void;
  onSignOut: () => void;
  isOnline: boolean;
  pendingSync: number;
  notice: AgendaNotice | null;
  onDismissNotice: () => void;
}

const VIEW_TABS: { id: View; label: string }[] = [
  { id: "day", label: "Dia" },
  { id: "week", label: "Semana" },
  { id: "month", label: "Mês" },
  { id: "year", label: "Ano" },
];

const MODULE_TABS: { id: View; label: string; icon: "tasks" | "contacts" | "notes" }[] = [
  { id: "tasks", label: "Tarefas", icon: "tasks" },
  { id: "contacts", label: "Contatos", icon: "contacts" },
  { id: "notes", label: "Notas", icon: "notes" },
];

function ModuleIcon({ name }: { name: "tasks" | "contacts" | "notes" }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  if (name === "tasks") {
    return <svg viewBox="0 0 24 24" {...common}><path d="M9 5h10v15H5V5h2" /><path d="m8 12 2 2 5-5M9 3h6v4H9z" /></svg>;
  }
  if (name === "contacts") {
    return <svg viewBox="0 0 24 24" {...common}><circle cx="9" cy="8" r="3" /><path d="M3.5 20v-1a5.5 5.5 0 0 1 11 0v1zM16 5.5a3 3 0 0 1 0 5.8M17 14a5 5 0 0 1 3.5 4.8V20h-3" /></svg>;
  }
  return <svg viewBox="0 0 24 24" {...common}><path d="M6 3.5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-13a2 2 0 0 1 2-2zM8 8h8M8 12h8M8 16h5" /></svg>;
}

function HeaderIcon({ name }: { name: "plus" | "moon" | "sun" | "bell" | "download" | "logout" | "calendar" | "upload" | "backup" | "install" | "settings" }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true as const,
  };

  const paths = {
    plus: <><path d="M12 5v14M5 12h14" /></>,
    moon: <path d="M20.2 15.4A8.5 8.5 0 0 1 8.6 3.8 8.5 8.5 0 1 0 20.2 15.4Z" />,
    sun: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 17v3h14v-3" /></>,
    logout: <><path d="M10 17l5-5-5-5m5 5H3" /><path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7" /></>,
    calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
    upload: <><path d="M12 16V4m-5 5 5-5 5 5" /><path d="M5 14v6h14v-6" /></>,
    backup: <><path d="M12 8v8m-4-4h8" /><path d="M5 3h14l2 3v15H3V6l2-3Z" /><path d="M3 7h18" /></>,
    install: <><rect x="5" y="2.5" width="14" height="19" rx="2" /><path d="M12 7v7m-3-3 3 3 3-3M10 18h4" /></>,
    settings: <><path d="M12.22 2h-.44a2 2 0 0 0-1.99 1.84l-.07.77a2 2 0 0 1-1 1.73l-.8.46a2 2 0 0 1-1.99 0l-.65-.38a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.65.38a2 2 0 0 1 1 1.73v.92a2 2 0 0 1-1 1.73l-.65.38a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.65-.38a2 2 0 0 1 1.99 0l.8.46a2 2 0 0 1 1 1.73l.07.77A2 2 0 0 0 11.78 22h.44a2 2 0 0 0 1.99-1.84l.07-.77a2 2 0 0 1 1-1.73l.8-.46a2 2 0 0 1 1.99 0l.65.38a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.65-.38a2 2 0 0 1-1-1.73v-.92a2 2 0 0 1 1-1.73l.65-.38a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.65.38a2 2 0 0 1-1.99 0l-.8-.46a2 2 0 0 1-1-1.73l-.07-.77A2 2 0 0 0 12.22 2z" /><circle cx="12" cy="12" r="3" /></>,
  };

  return <svg viewBox="0 0 24 24" {...common}>{paths[name]}</svg>;
}

function ModuleTabs({ view, onViewChange, className = "" }: {
  view: View;
  onViewChange: (view: View) => void;
  className?: string;
}) {
  return (
    <div className={`agenda-modules ${className}`}>
      {MODULE_TABS.map(({ id, label, icon }) => (
        <button
          key={id}
          type="button"
          aria-current={view === id ? "true" : undefined}
          aria-pressed={view === id}
          className={`agenda-tab agenda-module-tab${view === id ? " ativa" : ""}`}
          onClick={() => onViewChange(id)}
        >
          <ModuleIcon name={icon} />
          <span>{label}</span>
        </button>
      ))}
    </div>
  );
}

export function AgendaHeader({
  title,
  subtitle,
  view,
  onViewChange,
  categories,
  selectedCategoryIds,
  statusFilter,
  onToggleCategory,
  onStatusFilterChange,
  onClearFilters,
  onManageCategories,
  search,
  onSearchChange,
  searchInputRef,
  onHome,
  onNewItem,
  newItemLabel,
  onManageAppointmentTypes,
  userName,
  userEmail,
  notificationCount,
  onExportIcal,
  onImportIcal,
  onExportBackup,
  backupBusy = false,
  importBusy = false,
  theme,
  onToggleTheme,
  alertsOn,
  pushBusy,
  onToggleNotifications,
  installPrompt,
  onInstall,
  onSignOut,
  isOnline,
  pendingSync,
  notice,
  onDismissNotice,
}: AgendaHeaderProps) {
  const [dataMenuOpen, setDataMenuOpen] = useState(false);
  const dataMenuRef = useRef<HTMLDivElement>(null);
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const settingsMenuRef = useRef<HTMLDivElement>(null);
  const displayName = userName.trim() || userEmail;
  const userInitials = displayName
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase("pt-BR"))
    .join("");

  useEffect(() => {
    if (!dataMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!dataMenuRef.current?.contains(event.target as Node)) setDataMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDataMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [dataMenuOpen]);

  useEffect(() => {
    if (!settingsMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) setSettingsMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [settingsMenuOpen]);

  const busyDataAction = useRef(false);
  useEffect(() => {
    if (backupBusy || importBusy) {
      busyDataAction.current = true;
      setDataMenuOpen(true);
    } else if (busyDataAction.current) {
      busyDataAction.current = false;
      setDataMenuOpen(false);
    }
  }, [backupBusy, importBusy]);

  const runDataAction = (action: () => void, keepMenuOpen = false) => {
    if (!keepMenuOpen) setDataMenuOpen(false);
    action();
  };
  const openDataMenu = () => {
    setSettingsMenuOpen(false);
    setDataMenuOpen((open) => !open);
  };
  const openUserMenu = () => {
    setDataMenuOpen(false);
    setSettingsMenuOpen((open) => !open);
  };

  return (
    <>
      <header className="surface sticky top-0 z-30 border-b line">
        <div className="agenda-header-content mx-auto max-w-[1400px] px-4 py-3 sm:px-6">
          <div className="agenda-heading">
            <button type="button" className="agenda-heading-title" onClick={onHome}>
              <span>{title}</span>
              <span className="agenda-heading-date">{subtitle}</span>
            </button>

            <div className="agenda-search-tools">
              <div className="app-header-search relative">
                <input
                  ref={searchInputRef}
                  className="field py-2 pl-9 pr-16"
                  placeholder="Buscar tarefas, compromissos, notas..."
                  value={search}
                  onChange={(event) => onSearchChange(event.target.value)}
                />
                <svg className="agenda-search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
                </svg>
                {!search && (
                  <kbd className="agenda-search-kbd" aria-hidden="true">
                    <span>Ctrl</span><span>F</span>
                  </kbd>
                )}
                {["day", "week", "month", "year"].includes(view) && (
                  <AgendaFilters
                    className="agenda-search-filter"
                    categories={categories}
                    selectedCategoryIds={selectedCategoryIds}
                    status={statusFilter}
                    onToggleCategory={onToggleCategory}
                    onStatusChange={onStatusFilterChange}
                    onClear={onClearFilters}
                  />
                )}
              </div>
            </div>

            <div className="app-header-actions">
              {!isOnline && <span className="agenda-status">Modo offline</span>}
              {pendingSync > 0 && <span className="agenda-status">{pendingSync} pendente(s)</span>}

              {view !== "month" && view !== "year" && (
                <>
                  <button type="button" title={`${newItemLabel} (N)`} className="btn btn-primary agenda-action agenda-new-action" onClick={onNewItem}>
                    <HeaderIcon name="plus" />
                    <span>{newItemLabel}</span>
                    <kbd className="agenda-kbd agenda-action-kbd">N</kbd>
                  </button>
                  <span className="agenda-action-divider" aria-hidden="true" />
                </>
              )}

              <div className="agenda-tool-actions">
                <button
                  type="button"
                  className="agenda-icon-button"
                  aria-label={theme === "light" ? "Tema escuro" : "Tema claro"}
                  title={theme === "light" ? "Tema escuro" : "Tema claro"}
                  onClick={onToggleTheme}
                >
                  <HeaderIcon name={theme === "light" ? "moon" : "sun"} />
                </button>

                <button
                  type="button"
                  disabled={pushBusy}
                  className={`agenda-icon-button${alertsOn ? " notifications-active" : ""}`}
                  aria-busy={pushBusy}
                  aria-label={notificationCount > 0 ? `Notificações, ${notificationCount} pendentes` : "Notificações"}
                  title="Notificações"
                  onClick={onToggleNotifications}
                >
                  <HeaderIcon name="bell" />
                  {notificationCount > 1 ? (
                    <span className="agenda-notification-count" aria-hidden="true">{notificationCount > 9 ? "9+" : notificationCount}</span>
                  ) : notificationCount === 1 ? (
                    <span className="agenda-notification-dot" aria-hidden="true" />
                  ) : null}
                </button>

                <div className="agenda-data-menu" ref={dataMenuRef}>
                  <button
                    type="button"
                    className="agenda-icon-button"
                    aria-label="Dados"
                    title="Dados"
                    aria-haspopup="menu"
                    aria-expanded={dataMenuOpen}
                    onClick={openDataMenu}
                  >
                    <HeaderIcon name="download" />
                  </button>
                  {dataMenuOpen && (
                    <div className="agenda-data-dropdown" role="menu" aria-label="Dados">
                      <p className="agenda-data-label">DADOS</p>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => runDataAction(onExportIcal)}
                        className="agenda-data-item"
                      >
                        <span className="agenda-data-icon agenda-data-icon-blue"><HeaderIcon name="calendar" /></span>
                        <span><strong>Exportar iCal</strong><small>Arquivo .ics para outros calendários</small></span>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        disabled={importBusy}
                        onClick={() => runDataAction(onImportIcal, true)}
                        className="agenda-data-item"
                      >
                        <span className="agenda-data-icon agenda-data-icon-green"><HeaderIcon name="upload" /></span>
                        <span><strong>{importBusy ? "Importando..." : "Importar iCal"}</strong><small>Trazer compromissos de um .ics</small></span>
                      </button>
                      <div className="agenda-data-divider" />
                      <button
                        type="button"
                        role="menuitem"
                        disabled={backupBusy}
                        onClick={() => runDataAction(onExportBackup, true)}
                        className="agenda-data-item"
                      >
                        <span className="agenda-data-icon agenda-data-icon-amber"><HeaderIcon name="backup" /></span>
                        <span><strong>{backupBusy ? "Preparando backup..." : "Backup JSON completo"}</strong><small>Salvar todos os seus dados</small></span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
              <span className="agenda-action-divider" aria-hidden="true" />
              <div className="agenda-settings-menu" ref={settingsMenuRef}>
                <button
                  type="button"
                  className="agenda-user-trigger"
                  aria-label={`Menu do usuário, ${displayName}`}
                  title={displayName}
                  aria-haspopup="menu"
                  aria-expanded={settingsMenuOpen}
                  onClick={openUserMenu}
                >
                  <span className="agenda-user-avatar" aria-hidden="true">{userInitials || "U"}</span>
                  <svg className="agenda-user-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 10 5 5 5-5" /></svg>
                </button>
                {settingsMenuOpen && (
                  <div className="agenda-data-dropdown agenda-settings-dropdown" role="menu" aria-label="Menu do usuário">
                    <div className="agenda-user-identity">
                      <strong>{displayName}</strong>
                      <span>{userEmail}</span>
                    </div>
                    <div className="agenda-data-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="agenda-data-item"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        onManageCategories();
                      }}
                    >
                      <span className="agenda-data-icon agenda-data-icon-blue"><HeaderIcon name="settings" /></span>
                      <span><strong>Gerenciar categorias</strong><small>Adicionar, editar ou excluir categorias</small></span>
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="agenda-data-item"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        onManageAppointmentTypes();
                      }}
                    >
                      <span className="agenda-data-icon agenda-data-icon-blue"><HeaderIcon name="calendar" /></span>
                      <span><strong>Gerenciar tipos</strong><small>Adicionar opções ao formulário</small></span>
                    </button>
                    {installPrompt && (
                      <button
                        type="button"
                        role="menuitem"
                        className="agenda-data-item"
                        onClick={() => {
                          setSettingsMenuOpen(false);
                          onInstall();
                        }}
                      >
                        <span className="agenda-data-icon agenda-data-icon-blue"><HeaderIcon name="install" /></span>
                        <span><strong>Instalar app</strong><small>Adicionar ao dispositivo</small></span>
                      </button>
                    )}
                    <div className="agenda-data-divider" />
                    <button
                      type="button"
                      role="menuitem"
                      className="agenda-data-item agenda-user-signout"
                      onClick={() => {
                        setSettingsMenuOpen(false);
                        onSignOut();
                      }}
                    >
                      <span className="agenda-data-icon agenda-data-icon-red"><HeaderIcon name="logout" /></span>
                      <span><strong>Sair da conta</strong></span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          <nav className="agenda-navigation" aria-label="Navegação da agenda">
            <div className="agenda-views" role="tablist" aria-label="Visões" data-active={view}>
              <span className="agenda-view-indicator" aria-hidden="true" />
              {VIEW_TABS.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={view === id}
                  className="agenda-tab agenda-view-tab"
                  onClick={() => onViewChange(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <ModuleTabs view={view} onViewChange={onViewChange} className="agenda-modules-desktop" />
          </nav>
        </div>
      </header>

      {notice && (
        <aside
          role="status"
          aria-live="polite"
          className={`fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-2xl px-5 py-3 text-sm text-white shadow-2xl transition-all ${
            notice.kind === "error" ? "bg-red-600" : "bg-emerald-600"
          }`}
        >
          <span>{notice.text}</span>
          <button type="button" onClick={onDismissNotice} className="opacity-80 hover:opacity-100">
            ✕
          </button>
        </aside>
      )}

    </>
  );
}
