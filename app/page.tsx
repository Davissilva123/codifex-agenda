"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import {
  appointmentSort,
  brazilianHolidays,
  birthdayOn,
  dateKey,
  formatDate,
  MONTHS,
  occurrenceOn,
  parseDate,
  shiftDate,
  todayInSaoPaulo,
  WEEKDAYS,
} from "@/lib/dates";
import type {
  AgendaCategory,
  AgendaAppointmentType,
  AppointmentBaseType,
  Appointment,
  AppointmentKind,
  AppointmentReminder,
  Contact,
  FreeNote,
  Observation,
  Phone,
  Priority,
  Recurrence,
  View,
} from "@/lib/types";
import {
  isNetworkError,
  queueOfflineMutation,
  readLocalAgenda,
  readPendingCount,
  saveLocalAgenda,
  syncOfflineMutations,
  type LocalAgendaData,
  type OfflineTable,
} from "@/lib/offline";
import { exportToIcs, parseIcs } from "@/lib/ical";
import { isAppointmentOverdue, isAppointmentPastEnd } from "@/lib/appointmentStatus";
import { formatBrazilianPhone, isValidBrazilianPhone, isValidEmail, normalizePhoneNumber } from "@/lib/contacts";

import { CalendarWeek } from "@/components/calendar/CalendarWeek";
import { DayView } from "@/components/calendar/DayView";
import { CalendarMonth } from "@/components/calendar/CalendarMonth";
import { TasksView } from "@/components/tasks/TasksView";
import { ContactsView } from "@/components/contacts/ContactsView";
import { NotesView } from "@/components/notes/NotesView";
import {
  AppointmentFormModal,
  COLORS,
  type AppointmentFormValues,
} from "@/components/modals/AppointmentFormModal";
import { ContactFormModal, EMPTY_CONTACT } from "@/components/modals/ContactFormModal";
import { WorkItem, PriorityPill } from "@/components/ui/WorkItem";
import { BrazilianDateField, BrazilianTimeField } from "@/components/ui/BrazilianFields";
import { AgendaHeader, type AgendaNotice } from "@/components/agenda/AgendaHeader";
import type { AppointmentStatusFilter } from "@/components/agenda/AgendaFilters";
import { CategoryManagerModal } from "@/components/modals/CategoryManagerModal";
import { AppointmentTypeManagerModal } from "@/components/modals/AppointmentTypeManagerModal";

const PRIORITY_ORDER: Record<Priority, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
const DEFAULT_APPOINTMENT_TYPES: { tipo_base: AppointmentBaseType; nome: string }[] = [
  { tipo_base: "compromisso", nome: "Compromisso / reunião" },
  { tipo_base: "medico", nome: "Médico" },
  { tipo_base: "tarefa", nome: "Tarefa / prazo" },
];

const EMPTY_APPOINTMENT: AppointmentFormValues = {
  titulo: "",
  data: todayInSaoPaulo(),
  hora_inicio: "",
  hora_fim: "",
  descricao: "",
  local: "",
  categoria: "Normal",
  cor: COLORS[0],
  alerta_minutos: "15",
  alertas_minutos: ["15"],
  recorrencia: "none" as Recurrence,
  tipo: "compromisso" as AppointmentKind,
  tipo_personalizado: "",
  prioridade: "normal" as Priority,
  cliente: "",
  responsavel: "",
};

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function isPhoneRow(value: Record<string, unknown>): value is Record<string, unknown> & Phone & { contato_id: string } {
  return (
    typeof value.contato_id === "string" &&
    typeof value.numero === "string" &&
    (value.rotulo === "celular" || value.rotulo === "casa" || value.rotulo === "trabalho")
  );
}

function isObservation(value: Record<string, unknown>): value is Record<string, unknown> & Observation {
  return (
    typeof value.id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.data === "string" &&
    typeof value.anotacao === "string"
  );
}

function isAppointment(value: Record<string, unknown>): value is Record<string, unknown> & Appointment {
  return (
    typeof value.id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.titulo === "string" &&
    typeof value.data === "string" &&
    (typeof value.hora_inicio === "string" || value.hora_inicio === null) &&
    (typeof value.hora_fim === "string" || value.hora_fim === null) &&
    typeof value.descricao === "string" &&
    typeof value.local === "string" &&
    typeof value.categoria === "string" &&
    typeof value.cor === "string" &&
    (value.tipo === "compromisso" || value.tipo === "tarefa") &&
    (typeof value.tipo_personalizado === "string" || value.tipo_personalizado === null || value.tipo_personalizado === undefined) &&
    (value.prioridade === "baixa" ||
      value.prioridade === "normal" ||
      value.prioridade === "alta" ||
      value.prioridade === "urgente") &&
    typeof value.cliente === "string" &&
    (typeof value.responsavel === "string" || value.responsavel === undefined) &&
    (typeof value.alerta_minutos === "number" || value.alerta_minutos === null) &&
    (value.recorrencia === "none" ||
      value.recorrencia === "daily" ||
      value.recorrencia === "weekly" ||
      value.recorrencia === "monthly" ||
      value.recorrencia === "yearly") &&
    typeof value.concluido === "boolean" &&
    (typeof value.alerta_enviado_em === "string" || value.alerta_enviado_em === null) &&
    (typeof value.alerta_enviado_para === "string" || value.alerta_enviado_para === null) &&
    (typeof value.adiado_ate === "string" || value.adiado_ate === null) &&
    typeof value.created_at === "string"
  );
}

function isCategory(value: Record<string, unknown>): value is Record<string, unknown> & AgendaCategory {
  return typeof value.id === "string" && typeof value.user_id === "string" &&
    typeof value.nome === "string" && typeof value.cor === "string";
}

function isAppointmentType(value: Record<string, unknown>): value is Record<string, unknown> & AgendaAppointmentType {
  return typeof value.id === "string" && typeof value.user_id === "string" && typeof value.nome === "string" &&
    (value.tipo_base === undefined || value.tipo_base === null ||
      value.tipo_base === "compromisso" || value.tipo_base === "medico" || value.tipo_base === "tarefa");
}

function isContact(value: Record<string, unknown>): value is Record<string, unknown> & Contact {
  return (
    typeof value.id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.nome === "string" &&
    typeof value.email === "string" &&
    typeof value.empresa === "string" &&
    typeof value.endereco === "string" &&
    (typeof value.aniversario === "string" || value.aniversario === null) &&
    typeof value.observacoes === "string" &&
    typeof value.favorito === "boolean" &&
    (typeof value.deleted_at === "string" || value.deleted_at === null || value.deleted_at === undefined)
  );
}

function isFreeNote(value: Record<string, unknown>): value is Record<string, unknown> & FreeNote {
  return (
    typeof value.id === "string" &&
    typeof value.user_id === "string" &&
    typeof value.titulo === "string" &&
    typeof value.conteudo === "string"
  );
}

function isEditable(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName));
}

function download(name: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escapeCsv(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') {
      cell += '"';
      i++;
    } else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) {
      row.push(cell);
      cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("O CSV contém aspas sem fechamento.");
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function formatBrazilianDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function isElectronApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
}

function decodeVapidPublicKey(value: string): Uint8Array {
  const key = value.trim();
  if (!key || /^(SUA_CHAVE|YOUR_|<)/i.test(key)) {
    throw new Error(
      "A chave pública VAPID ainda não foi configurada. Gere um par de chaves VAPID e atualize NEXT_PUBLIC_VAPID_PUBLIC_KEY antes de empacotar o aplicativo."
    );
  }

  try {
    const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Uint8Array.from(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      (char) => char.charCodeAt(0)
    );
    if (decoded.length !== 65 || decoded[0] !== 4) throw new Error("Formato de chave incorreto.");
    return decoded;
  } catch {
    throw new Error(
      "A chave pública VAPID é inválida. Use a chave pública completa gerada com `npx --yes web-push generate-vapid-keys`."
    );
  }
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authRetry, setAuthRetry] = useState(0);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [passwordVisible, setPasswordVisible] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [categories, setCategories] = useState<AgendaCategory[]>([]);
  const [appointmentTypes, setAppointmentTypes] = useState<AgendaAppointmentType[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<FreeNote[]>([]);
  const [dataLoaded, setDataLoaded] = useState(false);

  const [view, setView] = useState<View>("day");
  const [selectedDate, setSelectedDate] = useState(todayInSaoPaulo());
  const [shownYear, setShownYear] = useState(parseDate(todayInSaoPaulo()).getFullYear());
  const [shownMonth, setShownMonth] = useState(parseDate(todayInSaoPaulo()).getMonth());
  const [yearFilterOpen, setYearFilterOpen] = useState(false);
  const yearFilterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!yearFilterOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!yearFilterRef.current?.contains(event.target as Node)) setYearFilterOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setYearFilterOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [yearFilterOpen]);

  const [appointmentForm, setAppointmentForm] = useState<(AppointmentFormValues & { id?: string }) | null>(null);
  const [contactForm, setContactForm] = useState<Contact | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<AgendaNotice | null>(null);
  const [search, setSearch] = useState("");
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [appointmentTypeManagerOpen, setAppointmentTypeManagerOpen] = useState(false);
  const [categoryFilterIds, setCategoryFilterIds] = useState<string[]>([]);
  const [statusFilter, setStatusFilter] = useState<AppointmentStatusFilter>("all");
  const [helpOpen, setHelpOpen] = useState(false);
  const [reminderToasts, setReminderToasts] = useState<{ key: string; item: Appointment; minutes: number | null; date: string; kind: "reminder" | "overdue"; snoozeOpen?: boolean }[]>([]);
  const [undoToast, setUndoToast] = useState<Appointment | null>(null);
  const [undoCompletionToast, setUndoCompletionToast] = useState<Appointment | null>(null);
  const [isBackupBusy, setIsBackupBusy] = useState(false);
  const [isImportBusy, setIsImportBusy] = useState(false);

  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [localAlerts, setLocalAlerts] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const [generatedYear, setGeneratedYear] = useState(0);
  const [lastTrashedContactIds, setLastTrashedContactIds] = useState<string[]>([]);

  const searchRef = useRef<HTMLInputElement>(null);
  const icalInputRef = useRef<HTMLInputElement>(null);
  const localSent = useRef(new Set<string>());
  const noticeTimer = useRef<number | null>(null);
  const pendingDelete = useRef<{ item: Appointment; timer: number } | null>(null);
  const undoCompletionTimer = useRef<number | null>(null);
  const overdueSent = useRef(new Set<string>());
  const automaticCompletionAttempts = useRef(new Set<string>());
  const currentYear = parseDate(todayInSaoPaulo()).getFullYear();
  const yearLimit = Math.max(currentYear, generatedYear);
  const activeContacts = useMemo(() => contacts.filter((contact) => !contact.deleted_at), [contacts]);
  const managedAppointmentTypes = useMemo(() => [
    ...DEFAULT_APPOINTMENT_TYPES.map((defaultType) => ({
      id: `default:${defaultType.tipo_base}`,
      user_id: session?.user.id || "",
      nome: appointmentTypes.find((type) => type.tipo_base === defaultType.tipo_base)?.nome || defaultType.nome,
      tipo_base: defaultType.tipo_base,
    })),
    ...appointmentTypes.filter((type) => !type.tipo_base),
  ], [appointmentTypes, session?.user.id]);

  const showDate = useCallback((value: string) => {
    setSelectedDate(value);
    setShownYear(parseDate(value).getFullYear());
    setShownMonth(parseDate(value).getMonth());
  }, []);

  const notify = useCallback((
    text: string,
    kind: AgendaNotice["kind"] = "success"
  ) => {
    if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
    setNotice({ text, kind });
    noticeTimer.current = window.setTimeout(() => {
      setNotice(null);
      noticeTimer.current = null;
    }, 4500);
  }, []);

  const runMutation = useCallback(
    async (
      table: OfflineTable,
      operation: "insert" | "update" | "delete" | "upsert",
      record?: Record<string, unknown>,
      filters?: Record<string, string>
    ) => {
      if (!session) throw new Error("Entre na sua conta para salvar alterações.");
      const mutation = { table, operation, record, filters };
      if (!navigator.onLine) {
        queueOfflineMutation(session.user.id, mutation);
        setPendingSync(readPendingCount(session.user.id));
        return;
      }
      if (readPendingCount(session.user.id) > 0) {
        try {
          await syncOfflineMutations(session.user.id, getSupabase());
          setPendingSync(readPendingCount(session.user.id));
        } catch (error) {
          if (!isNetworkError(error)) throw error;
          queueOfflineMutation(session.user.id, mutation);
          setPendingSync(readPendingCount(session.user.id));
          setIsOnline(false);
          return;
        }
      }
      const supabase = getSupabase();
      const entries = Object.entries(filters || {});
      let mutationError: string | null = null;
      try {
        if (operation === "insert") {
          let query = supabase.from(table).insert(record || {});
          for (const [column, value] of entries) query = query.eq(column, value);
          mutationError = (await query).error?.message || null;
        } else if (operation === "upsert") {
          let query = supabase
            .from(table)
            .upsert(record || {}, { onConflict: table === "observacoes" ? "user_id,data" : "id" });
          for (const [column, value] of entries) query = query.eq(column, value);
          mutationError = (await query).error?.message || null;
        } else if (operation === "update") {
          let query = supabase.from(table).update(record || {});
          for (const [column, value] of entries) query = query.eq(column, value);
          mutationError = (await query).error?.message || null;
        } else {
          let query = supabase.from(table).delete();
          for (const [column, value] of entries) query = query.eq(column, value);
          mutationError = (await query).error?.message || null;
        }
      } catch (err: unknown) {
        mutationError = err instanceof Error ? err.message : String(err);
      }

      if (mutationError) {
        // Se a tabela 'notas' ainda não foi criada no banco remoto, apenas guarda local
        if (table === "notas" && /relation.*does not exist|schema cache/i.test(mutationError)) {
          console.warn("Tabela notas ainda não existe no Supabase. Gravando apenas no cache local.");
          return;
        }
        const error = new Error(mutationError);
        if (!isNetworkError(error)) throw error;
        queueOfflineMutation(session.user.id, mutation);
        setPendingSync(readPendingCount(session.user.id));
        setIsOnline(false);
      }
    },
    [session]
  );

  const loadData = useCallback(async () => {
    const supabase = getSupabase();
    const userId = session?.user.id;
    if (!userId) return;
    const local = readLocalAgenda(userId);

    const hydrate = (data: LocalAgendaData) => {
      const phoneRows = data.telefones.filter(isPhoneRow);
      const obsMap: Record<string, string> = {};
      const validAppointments = data.agendamentos.filter(isAppointment);
      const validCategories = (data.categorias || []).filter(isCategory);
      const validAppointmentTypes = (data.tipos_agendamento || []).filter(isAppointmentType);
      const validContacts = data.contatos.filter(isContact);
      const validObservations = data.observacoes.filter(isObservation);
      const validNotes = (data.notas || []).filter(isFreeNote);

      for (const obs of validObservations) obsMap[obs.data] = obs.anotacao;
      setAppointments(validAppointments.map((item) => ({
        ...item,
        responsavel: item.responsavel || "",
        alertas: item.alertas || (item.alerta_minutos === null ? [] : [{
          minutos: item.alerta_minutos,
          disparado_em: item.alerta_enviado_em,
          disparado_para: item.alerta_enviado_para,
          adiado_ate: item.adiado_ate,
        }]),
      })));
      setCategories(validCategories);
      setAppointmentTypes(validAppointmentTypes);
      setContacts(
        validContacts.map((contact) => ({
          ...contact,
          deleted_at: contact.deleted_at || null,
          telefones: phoneRows.filter((phone) => phone.contato_id === contact.id),
        }))
      );
      setObservations(obsMap);
      setNotes(validNotes);
      setDataLoaded(true);
    };

    hydrate(local);
    setPendingSync(readPendingCount(userId));
    if (!navigator.onLine) return;

    try {
      await syncOfflineMutations(userId, supabase);

      // Carrega agendamentos, contatos, observações e notas
      const [eventsResult, contactsResult, notesResult, freeNotesResult, categoriesResult, appointmentTypesResult] = await Promise.all([
        supabase.from("agendamentos").select("*").order("data").order("hora_inicio"),
        supabase.from("contatos").select("*").order("nome"),
        supabase.from("observacoes").select("*"),
        supabase.from("notas").select("*").order("updated_at", { ascending: false }),
        supabase.from("categorias").select("*").order("nome"),
        supabase.from("tipos_agendamento").select("*").order("nome"),
      ]);

      const schemaError = appointmentTypesResult.error || eventsResult.error;
      if (schemaError && /tipos_agendamento|tipo_personalizado|schema cache|does not exist/i.test(schemaError.message)) {
        throw new Error("Atualize o banco do Supabase executando supabase/migration-tipos-agendamento.sql.");
      }
      const error = eventsResult.error || contactsResult.error || notesResult.error || categoriesResult.error || appointmentTypesResult.error;
      if (error) throw error;

      let categoryRows = (categoriesResult.data || []) as AgendaCategory[];
      const appointmentTypeRows = (appointmentTypesResult.data || []) as AgendaAppointmentType[];
      if (!categoryRows.length) {
        const defaults = [
          { id: crypto.randomUUID(), user_id: userId, nome: "Normal", cor: "#3676c8" },
          { id: crypto.randomUUID(), user_id: userId, nome: "Médico", cor: "#e2537d" },
        ];
        const { data, error: defaultCategoriesError } = await supabase
          .from("categorias")
          .upsert(defaults, { onConflict: "user_id,nome" })
          .select("*")
          .order("nome");
        if (defaultCategoriesError) throw defaultCategoriesError;
        categoryRows = (data || []) as AgendaCategory[];
      }

      const contactRows = (contactsResult.data || []) as Contact[];
      let phoneRows: (Phone & { contato_id: string })[] = [];
      if (contactRows.length) {
        const { data, error: phoneError } = await supabase
          .from("telefones")
          .select("id,contato_id,numero,rotulo")
          .in(
            "contato_id",
            contactRows.map((contact) => contact.id)
          );
        if (phoneError) throw phoneError;
        phoneRows = (data || []) as (Phone & { contato_id: string })[];
      }

      // Notas livres do Supabase (ou array vazio se tabela ainda não existe)
      const fetchedFreeNotes = freeNotesResult.data && !freeNotesResult.error ? (freeNotesResult.data as unknown as Record<string, unknown>[]) : (local.notas || []);

      const next: LocalAgendaData = {
        agendamentos: (eventsResult.data || []) as unknown as Record<string, unknown>[],
        contatos: contactRows as unknown as Record<string, unknown>[],
        telefones: phoneRows as unknown as Record<string, unknown>[],
        observacoes: (notesResult.data || []) as unknown as Record<string, unknown>[],
        notas: fetchedFreeNotes,
        categorias: categoryRows as unknown as Record<string, unknown>[],
        tipos_agendamento: appointmentTypeRows as unknown as Record<string, unknown>[],
      };

      saveLocalAgenda(userId, next);
      hydrate(next);
      setPendingSync(readPendingCount(userId));
    } catch (error) {
      if (!isNetworkError(error)) throw error;
      setIsOnline(false);
      setPendingSync(readPendingCount(userId));
    }
  }, [session]);

  useEffect(() => {
    let active = true;
    let timeout: number | undefined;
    setAuthReady(false);
    setAuthError("");
    try {
      const supabase = getSupabase();
      timeout = window.setTimeout(() => {
        if (!active) return;
        setAuthError("A verificação da sessão está demorando. Confira sua conexão e tente novamente.");
        setAuthReady(true);
      }, 12000);

      supabase.auth
        .getSession()
        .then(({ data, error }) => {
          if (!active) return;
          if (timeout) window.clearTimeout(timeout);
          if (error) setAuthError(`Não foi possível verificar sua sessão: ${error.message}`);
          else setAuthError("");
          if (active) {
            setSession(data.session);
            setAuthReady(true);
          }
        })
        .catch((error: unknown) => {
          if (!active) return;
          if (timeout) window.clearTimeout(timeout);
          setAuthError(`Não foi possível verificar sua sessão: ${messageOf(error)}`);
          setAuthReady(true);
        });

      const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        if (nextSession) setDataLoaded(false);
        else {
          setAppointments([]);
          setCategories([]);
          setContacts([]);
          setObservations({});
          setNotes([]);
          setDataLoaded(false);
        }
      });

      if ("serviceWorker" in navigator) {
        navigator.serviceWorker
          .register("/sw.js")
          .catch((error: unknown) => notify(`Não foi possível registrar o service worker: ${messageOf(error)}`, "error"));
      }

      return () => {
        active = false;
        if (timeout) window.clearTimeout(timeout);
        listener.subscription.unsubscribe();
      };
    } catch (error) {
      active = false;
      if (timeout) window.clearTimeout(timeout);
      setAuthReady(true);
      setAuthError(messageOf(error));
    }
  }, [authRetry, notify]);

  useEffect(() => {
    const updateConnection = () => setIsOnline(navigator.onLine);
    updateConnection();

    const synchronize = async () => {
      if (!session) return;
      const count = readPendingCount(session.user.id);
      setIsOnline(true);
      try {
        await loadData();
        if (count > 0) notify(`${count} alteração(ões) sincronizada(s).`);
      } catch (error) {
        notify(`Falha ao sincronizar: ${messageOf(error)}`, "error");
      }
    };

    window.addEventListener("online", synchronize);
    window.addEventListener("offline", updateConnection);
    return () => {
      window.removeEventListener("online", synchronize);
      window.removeEventListener("offline", updateConnection);
    };
  }, [session, loadData, notify]);

  useEffect(() => {
    if (!session || !dataLoaded) return;
    try {
      const phoneRows = contacts.flatMap((contact) =>
        (contact.telefones || []).map((phone) => ({
          ...phone,
          contato_id: contact.id,
          user_id: session.user.id,
        }))
      );
      const snapshot: LocalAgendaData = {
        agendamentos: appointments as unknown as Record<string, unknown>[],
        contatos: contacts.map(({ telefones: _phones, ...contact }) => contact) as unknown as Record<string, unknown>[],
        telefones: phoneRows as unknown as Record<string, unknown>[],
        observacoes: Object.entries(observations).map(([data, anotacao]) => ({
          user_id: session.user.id,
          data,
          anotacao,
        })),
        notas: notes as unknown as Record<string, unknown>[],
        categorias: categories as unknown as Record<string, unknown>[],
        tipos_agendamento: appointmentTypes as unknown as Record<string, unknown>[],
      };
      saveLocalAgenda(session.user.id, snapshot);
    } catch (error) {
      notify(`Não foi possível guardar a cópia offline: ${messageOf(error)}`, "error");
    }
  }, [session, dataLoaded, appointments, contacts, observations, notes, categories, appointmentTypes, notify]);

  useEffect(() => {
    if (!session) return;
    loadData().catch((error: unknown) => notify(messageOf(error), "error"));
    if (isElectronApp()) {
      setLocalAlerts(
        typeof Notification !== "undefined" &&
          Notification.permission === "granted" &&
          localStorage.getItem("minha-agenda-local-alerts") === "1"
      );
      return;
    }
    navigator.serviceWorker?.ready
      .then(async (registration) => {
        const subscription = await registration.pushManager.getSubscription();
        setPushEnabled(Boolean(subscription));
      })
      .catch((error: unknown) => notify(messageOf(error), "error"));
  }, [session, loadData, notify]);

  useEffect(() => {
    if (!session || !dataLoaded) return;

    const completeElapsedAppointments = () => {
      for (const item of appointments) {
        if (!isAppointmentPastEnd(item) || automaticCompletionAttempts.current.has(item.id)) continue;
        automaticCompletionAttempts.current.add(item.id);
        runMutation("agendamentos", "update", { concluido: true }, { id: item.id })
          .then(() => {
            setAppointments((all) => all.map((current) => (current.id === item.id ? { ...current, concluido: true } : current)));
          })
          .catch((error: unknown) => {
            notify(`Não foi possível concluir automaticamente "${item.titulo}": ${messageOf(error)}`, "error");
          });
      }
    };

    completeElapsedAppointments();
    const timer = window.setInterval(completeElapsedAppointments, 30000);
    return () => window.clearInterval(timer);
  }, [session, dataLoaded, appointments, runMutation, notify]);

  useEffect(() => {
    const systemTheme = window.matchMedia("(prefers-color-scheme: dark)");
    const stored = localStorage.getItem("minha-agenda-theme");
    const hasSavedPreference = stored === "dark" || stored === "light";
    const initial: "light" | "dark" = stored === "dark" ? "dark" : stored === "light" ? "light" : systemTheme.matches ? "dark" : "light";
    setTheme(initial);
    document.documentElement.setAttribute("data-theme", initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    document.body.classList.toggle("dark", initial === "dark");
    const syncSystemTheme = (event: MediaQueryListEvent) => {
      if (hasSavedPreference) return;
      const next = event.matches ? "dark" : "light";
      setTheme(next);
      document.documentElement.setAttribute("data-theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
      document.body.classList.toggle("dark", next === "dark");
    };
    systemTheme.addEventListener("change", syncSystemTheme);
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      systemTheme.removeEventListener("change", syncSystemTheme);
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, []);

  useEffect(() => {
    const storedYear = Number(localStorage.getItem("minha-agenda-generated-year"));
    if (Number.isInteger(storedYear) && storedYear > currentYear && storedYear <= 9999) {
      setGeneratedYear(storedYear);
    } else {
      setGeneratedYear(currentYear);
      localStorage.removeItem("minha-agenda-generated-year");
    }
  }, [currentYear]);

  function generateNextYear() {
    const nextYear = yearLimit + 1;
    if (nextYear > 9999) return;
    localStorage.setItem("minha-agenda-generated-year", String(nextYear));
    setGeneratedYear(nextYear);
    setShownYear(nextYear);
    setShownMonth(0);
    showDate(`${nextYear}-01-01`);
  }

  useEffect(() => {
    if (!session) return;
    try {
      const saved = JSON.parse(localStorage.getItem(`minha-agenda-filtros:${session.user.id}`) || "{}") as {
        categories?: string[];
        status?: AppointmentStatusFilter;
      };
      setCategoryFilterIds(Array.isArray(saved.categories) ? saved.categories : []);
      setStatusFilter(["all", "pending", "completed", "overdue"].includes(saved.status || "")
        ? saved.status as AppointmentStatusFilter
        : "all");
    } catch (error) {
      notify(`Não foi possível carregar os filtros salvos: ${messageOf(error)}`, "error");
    }
  }, [session, notify]);

  useEffect(() => {
    if (!session) return;
    try {
      localStorage.setItem(`minha-agenda-filtros:${session.user.id}`, JSON.stringify({
        categories: categoryFilterIds,
        status: statusFilter,
      }));
    } catch (error) {
      notify(`Não foi possível salvar os filtros: ${messageOf(error)}`, "error");
    }
  }, [session, categoryFilterIds, statusFilter, notify]);

  useEffect(() => {
    if (!reminderToasts.some((toast) => toast.snoozeOpen)) return;
    const closeSnoozeMenu = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest(".agenda-snooze-root")) return;
      setReminderToasts((all) => all.map((toast) => ({ ...toast, snoozeOpen: false })));
    };
    document.addEventListener("pointerdown", closeSnoozeMenu);
    return () => document.removeEventListener("pointerdown", closeSnoozeMenu);
  }, [reminderToasts]);

  useEffect(() => {
    function shortcuts(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === "f") {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key === "Escape" && (helpOpen || categoryManagerOpen || appointmentTypeManagerOpen || appointmentForm || contactForm !== undefined)) {
        event.preventDefault();
        setHelpOpen(false);
        setCategoryManagerOpen(false);
        setAppointmentTypeManagerOpen(false);
        setAppointmentForm(null);
        setContactForm(undefined);
        return;
      }
      if (event.key === "Escape" && reminderToasts.some((toast) => toast.snoozeOpen)) {
        event.preventDefault();
        setReminderToasts((all) => all.map((toast) => ({ ...toast, snoozeOpen: false })));
        return;
      }
      if (appointmentForm || contactForm !== undefined || categoryManagerOpen || appointmentTypeManagerOpen || helpOpen) return;
      if (isEditable(event.target)) return;

      const key = event.key.toLowerCase();
      if (key === "n" || (event.ctrlKey && key === "n")) {
        event.preventDefault();
        setAppointmentForm({
          ...EMPTY_APPOINTMENT,
          data: selectedDate,
          ...(view === "tasks" ? { tipo: "tarefa" as const, alerta_minutos: "none", alertas_minutos: [] } : {}),
        });
        return;
      }
      if (key === "t") {
        event.preventDefault();
        showDate(todayInSaoPaulo());
        return;
      }
      if (key === "d" || key === "s" || key === "m" || key === "a") {
        event.preventDefault();
        setView(({ d: "day", s: "week", m: "month", a: "year" } as const)[key]);
        return;
      }
      if (event.key === "?") {
        event.preventDefault();
        setHelpOpen(true);
        return;
      }
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.key === "ArrowLeft" ? -1 : 1;
        if (view === "day") {
          const next = new Date(`${selectedDate}T12:00:00`);
          next.setDate(next.getDate() + step);
          if (next.getFullYear() <= yearLimit) showDate(dateKey(next));
        } else if (view === "week") {
          const nextDate = shiftDate(selectedDate, step * 7);
          if (parseDate(nextDate).getFullYear() <= yearLimit) showDate(nextDate);
        } else if (view === "year") {
          const nextYear = shownYear + step;
          if (nextYear <= yearLimit && nextYear >= 1900) {
            setShownYear(nextYear);
            showDate(`${nextYear}-01-01`);
          }
        } else if (view === "month") {
          const next = new Date(shownYear, shownMonth + step, 1, 12);
          if (next.getFullYear() <= yearLimit) {
            setShownYear(next.getFullYear());
            setShownMonth(next.getMonth());
            setView("month");
          }
        }
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [shownMonth, shownYear, selectedDate, view, yearLimit, showDate, helpOpen, categoryManagerOpen, appointmentTypeManagerOpen, appointmentForm, contactForm, reminderToasts]);

  useEffect(() => {
    if (!session) return;
    const snoozeId = new URLSearchParams(window.location.search).get("snooze");
    if (!snoozeId) return;
    const snooze = async () => {
      const item = appointments.find((appointment) => appointment.id === snoozeId);
      if (!item) throw new Error("O compromisso deste lembrete não foi encontrado.");
      const occurrenceDate = todayInSaoPaulo();
      const snoozedUntil = new Date(Date.now() + 5 * 60000).toISOString();
      const nextReminders = (item.alertas || []).map((reminder) => {
        const existing = reminder.disparos?.find((dispatch) => dispatch.data === occurrenceDate);
        const dispatches = (reminder.disparos || []).filter((dispatch) => dispatch.data !== occurrenceDate);
        dispatches.push({
          data: occurrenceDate,
          disparado_em: existing?.disparado_em || reminder.disparado_em || new Date().toISOString(),
          adiado_ate: snoozedUntil,
        });
        return { ...reminder, adiado_ate: snoozedUntil, disparos: dispatches };
      });
      await runMutation("agendamentos", "update", {
        alertas: nextReminders,
        adiado_ate: snoozedUntil,
      }, { id: snoozeId });
      setAppointments((all) => all.map((current) => current.id === snoozeId
        ? { ...current, alertas: nextReminders, adiado_ate: snoozedUntil }
        : current));
      notify(
        navigator.onLine
          ? "Lembrete adiado por 5 minutos."
          : "Adiamento salvo; será sincronizado quando a internet voltar."
      );
      window.history.replaceState({}, "", window.location.pathname);
    };
    snooze().catch((error: unknown) => notify(messageOf(error), "error"));
  }, [session, appointments, notify, runMutation]);

  useEffect(() => {
    if (!session || !dataLoaded) return;
    const electron = isElectronApp();
    const check = () => {
      const now = new Date();
      const today = todayInSaoPaulo();
      const tomorrow = shiftDate(today, 1);

      for (const item of appointments) {
        if (item.concluido) continue;
        const reminders = item.alertas || (item.alerta_minutos === null ? [] : [{
          minutos: item.alerta_minutos,
          disparado_em: item.alerta_enviado_em,
          disparado_para: item.alerta_enviado_para,
          adiado_ate: item.adiado_ate,
        }]);
        if (item.hora_inicio) {
          let nextReminders: AppointmentReminder[] = reminders;
          let changed = false;
          for (const reminder of reminders) {
            for (const occurrenceDate of [today, tomorrow]) {
              if (!occurrenceOn(item, occurrenceDate)) continue;
              const key = `${item.id}-${occurrenceDate}-${reminder.minutos}`;
              if (localSent.current.has(key)) continue;
              const savedOccurrence = reminder.disparos?.find((entry) => entry.data === occurrenceDate);
              const legacyOccurrence = !savedOccurrence &&
                (reminder.disparado_para === occurrenceDate ||
                  (item.alerta_minutos === reminder.minutos && item.alerta_enviado_para === occurrenceDate))
                ? {
                    disparado_em: reminder.disparado_em || item.alerta_enviado_em,
                    adiado_ate: reminder.adiado_ate || item.adiado_ate,
                  }
                : null;
              const occurrenceState = savedOccurrence || legacyOccurrence;
              const snoozeUntil = occurrenceState?.adiado_ate ? new Date(occurrenceState.adiado_ate).getTime() : 0;
              if (snoozeUntil > now.getTime()) continue;
              const eventTime = new Date(`${occurrenceDate}T${item.hora_inicio.slice(0, 5)}:00-03:00`).getTime();
              const scheduled = eventTime - reminder.minutos * 60000;
              if (now.getTime() < scheduled || (occurrenceState?.disparado_em && !snoozeUntil)) continue;

              localSent.current.add(key);
              changed = true;
              const firedAt = now.toISOString();
              nextReminders = nextReminders.map((entry) => {
                if (entry.minutos !== reminder.minutos) return entry;
                const keepDispatchesFrom = shiftDate(today, -1);
                const dispatches = (entry.disparos || []).filter((dispatch) =>
                  dispatch.data !== occurrenceDate && dispatch.data >= keepDispatchesFrom
                );
                dispatches.push({ data: occurrenceDate, disparado_em: firedAt, adiado_ate: null });
                return {
                  ...entry,
                  disparado_em: occurrenceDate === today ? firedAt : entry.disparado_em,
                  disparado_para: occurrenceDate === today ? today : entry.disparado_para,
                  adiado_ate: occurrenceDate === today ? null : entry.adiado_ate,
                  disparos: dispatches,
                };
              });
              setReminderToasts((all) => all.some((toast) => toast.key === key)
                ? all
                : [...all, { key, item, minutes: reminder.minutos, date: occurrenceDate, kind: "reminder" }]);

              if (electron && localAlerts && typeof Notification !== "undefined" && Notification.permission === "granted") {
                try {
                  const notification = new Notification("Lembrete: CODIFEX AGENDAS", {
                    body: `${item.titulo} • ${item.hora_inicio.slice(0, 5)}`,
                    icon: "/icon.png",
                  });
                  notification.onclick = () => window.focus();
                } catch (error) {
                  notify(`Não foi possível exibir a notificação do sistema: ${messageOf(error)}`, "error");
                }
              }
            }
          }
          if (changed) {
            const primaryOccurrence = nextReminders
              .find((reminder) => reminder.minutos === item.alerta_minutos)
              ?.disparos?.find((dispatch) => dispatch.data === today);
            const legacyState = primaryOccurrence
              ? { alerta_enviado_em: primaryOccurrence.disparado_em, alerta_enviado_para: today, adiado_ate: primaryOccurrence.adiado_ate }
              : {};
            setAppointments((all) => all.map((current) => current.id === item.id
              ? { ...current, alertas: nextReminders, ...legacyState }
              : current));
            runMutation("agendamentos", "update", { alertas: nextReminders, ...legacyState }, { id: item.id })
              .catch((error: unknown) => notify(`Não foi possível salvar o estado do lembrete: ${messageOf(error)}`, "error"));
          }
        }

        const overdueKey = `${item.id}-overdue`;
        if (isAppointmentOverdue(item, now) && !item.atrasado_notificado_em && !overdueSent.current.has(overdueKey)) {
          overdueSent.current.add(overdueKey);
          const notifiedAt = now.toISOString();
          setAppointments((all) => all.map((current) => current.id === item.id
            ? { ...current, atrasado_notificado_em: notifiedAt }
            : current));
          runMutation("agendamentos", "update", { atrasado_notificado_em: notifiedAt }, { id: item.id })
            .catch((error: unknown) => notify(`Não foi possível salvar o aviso de atraso: ${messageOf(error)}`, "error"));
          setReminderToasts((all) => all.some((toast) => toast.key === overdueKey)
            ? all
            : [...all, { key: overdueKey, item, minutes: null, date: today, kind: "overdue" }]);
          if (typeof Notification !== "undefined" && Notification.permission === "granted" && (electron ? localAlerts : pushEnabled)) {
            try {
              new Notification("Atrasado: CODIFEX AGENDAS", {
                body: item.titulo,
                icon: "/icon.png",
              });
            } catch (error) {
              notify(`Não foi possível exibir a notificação do sistema: ${messageOf(error)}`, "error");
            }
          }
        }
      }

      for (const contact of activeContacts) {
        const key = `birthday-${contact.id}-${today}`;
        if (typeof Notification !== "undefined" && Notification.permission === "granted" &&
          (electron ? localAlerts : pushEnabled) && birthdayOn(contact, today) && !localSent.current.has(key)) {
          new Notification("Aniversário: CODIFEX AGENDAS", {
            body: `Hoje é aniversário de ${contact.nome}.`,
            icon: "/icon.png",
          });
          localSent.current.add(key);
        }
      }
    };
    check();
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [session, dataLoaded, appointments, activeContacts, pushEnabled, localAlerts, runMutation, notify]);

  useEffect(() => {
    if (!session || !dataLoaded) return;
    setSavingNote(true);
    const timer = window.setTimeout(async () => {
      try {
        const value = observations[selectedDate] || "";
        if (value.trim()) {
          await runMutation("observacoes", "upsert", {
            user_id: session.user.id,
            data: selectedDate,
            anotacao: value,
          });
        } else {
          await runMutation("observacoes", "delete", undefined, {
            data: selectedDate,
            user_id: session.user.id,
          });
        }
      } catch (error) {
        notify(`Falha ao salvar observação: ${messageOf(error)}`, "error");
      } finally {
        setSavingNote(false);
      }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [observations, selectedDate, session, notify, dataLoaded, runMutation]);

  async function authenticate(event: FormEvent) {
    event.preventDefault();
    setAuthBusy(true);
    setAuthError("");
    try {
      const supabase = getSupabase();
      const result =
        authMode === "login"
          ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
          : await supabase.auth.signUp({
              email: email.trim(),
              password,
              options: { emailRedirectTo: window.location.origin },
            });
      if (result.error) throw result.error;
      if (authMode === "signup" && !result.data.session)
        setAuthError("Conta criada. Confirme seu e-mail para entrar.");
    } catch (error) {
      setAuthError(messageOf(error));
    } finally {
      setAuthBusy(false);
    }
  }

  async function saveAppointment(values: AppointmentFormValues, id?: string) {
    setBusy(true);
    try {
      const appointmentId = id || crypto.randomUUID();
      const selectedCategory = categories.find((category) => category.nome === values.categoria);
      const selectedMinutes = values.alertas_minutos || (values.alerta_minutos === "none" ? [] : [values.alerta_minutos]);
      const previousAppointment = appointments.find((item) => item.id === id);
      const scheduleUnchanged = previousAppointment?.data === values.data &&
        previousAppointment.hora_inicio === (values.hora_inicio || null);
      const existingReminders = scheduleUnchanged ? previousAppointment?.alertas || [] : [];
      const reminders: AppointmentReminder[] = selectedMinutes.map((value) => {
        const minutes = Number(value);
        const existing = existingReminders.find((reminder) => reminder.minutos === minutes);
        return existing || { minutos: minutes, disparado_em: null, disparado_para: null, adiado_ate: null, disparos: [] };
      });
      const primaryReminder = reminders[0];
      const record = {
        id: appointmentId,
        user_id: session!.user.id,
        titulo: values.titulo.trim(),
        data: values.data,
        hora_inicio: values.hora_inicio || null,
        hora_fim: values.hora_fim || null,
        descricao: values.descricao,
        local: values.local,
        categoria: values.categoria,
        categoria_id: selectedCategory?.id || null,
        cor: selectedCategory?.cor || values.cor,
        tipo: values.tipo,
        tipo_personalizado: values.tipo_personalizado?.trim() || null,
        prioridade: values.prioridade,
        cliente: values.cliente.trim(),
        responsavel: values.responsavel.trim(),
        alerta_minutos: reminders[0]?.minutos ?? null,
        alertas: reminders,
        recorrencia: values.recorrencia,
        alerta_enviado_em: primaryReminder?.disparado_em || null,
        alerta_enviado_para: scheduleUnchanged && primaryReminder?.disparado_em ? previousAppointment?.alerta_enviado_para || null : null,
        adiado_ate: primaryReminder?.adiado_ate || null,
        atrasado_notificado_em: null,
      };
      const { id: _id, user_id: _userId, ...updates } = record;
      if (id) await runMutation("agendamentos", "update", updates, { id });
      else await runMutation("agendamentos", "insert", record);

      setAppointments((all) =>
        id
          ? all.map((item) => (item.id === id ? { ...item, ...updates } : item))
          : [...all, { ...record, concluido: false, created_at: new Date().toISOString() } as Appointment]
      );
      setAppointmentForm(null);
      notify(
        navigator.onLine
          ? values.tipo === "compromisso" ? "Compromisso salvo" : "Tarefa salva"
          : "Salvo neste dispositivo. Será sincronizado quando a internet voltar."
      );
    } catch (error) {
      notify(messageOf(error), "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function saveCategory(name: string, color: string, id?: string) {
    if (!session) throw new Error("Entre na sua conta para gerenciar categorias.");
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("Informe o nome da categoria.");
    if (categories.some((category) => category.nome.toLocaleLowerCase("pt-BR") === normalizedName.toLocaleLowerCase("pt-BR") && category.id !== id)) {
      throw new Error("Já existe uma categoria com esse nome.");
    }

    const previous = categories.find((category) => category.id === id);
    const category: AgendaCategory = {
      id: id || crypto.randomUUID(),
      user_id: session.user.id,
      nome: normalizedName,
      cor: color,
      created_at: previous?.created_at || new Date().toISOString(),
    };
    if (id) {
      await runMutation("categorias", "update", { nome: normalizedName, cor: color }, { id });
      const affected = appointments.filter((item) => item.categoria_id === id || item.categoria === previous?.nome);
      for (const item of affected) {
        await runMutation("agendamentos", "update", { categoria: normalizedName, cor: color, categoria_id: id }, { id: item.id });
      }
      setAppointments((all) => all.map((item) =>
        item.categoria_id === id || item.categoria === previous?.nome
          ? { ...item, categoria: normalizedName, cor: color, categoria_id: id }
          : item
      ));
      setCategories((all) => all.map((current) => current.id === id ? category : current));
    } else {
      await runMutation("categorias", "insert", category as unknown as Record<string, unknown>);
      setCategories((all) => [...all, category].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    }
  }

  async function saveAppointmentType(name: string, id?: string, tipoBase?: AppointmentBaseType) {
    if (!session) throw new Error("Entre na sua conta para gerenciar tipos.");
    const normalizedName = name.trim();
    if (!normalizedName) throw new Error("Informe o nome do tipo.");
    if (normalizedName.length > 60) throw new Error("O nome do tipo deve ter no máximo 60 caracteres.");
    const normalizeName = (value: string) => value.toLocaleLowerCase("pt-BR");
    const collidesWithAnotherDefault = DEFAULT_APPOINTMENT_TYPES.some((defaultType) => {
      if (defaultType.tipo_base === tipoBase) return false;
      const currentName = appointmentTypes.find((type) => type.tipo_base === defaultType.tipo_base)?.nome || defaultType.nome;
      return normalizeName(currentName) === normalizeName(normalizedName);
    });
    const collidesWithSavedType = appointmentTypes.some((type) =>
      normalizeName(type.nome) === normalizeName(normalizedName) &&
      (tipoBase ? type.tipo_base !== tipoBase : type.id !== id)
    );
    if (collidesWithAnotherDefault || collidesWithSavedType) {
      throw new Error("Já existe um tipo com esse nome.");
    }

    const previous = appointmentTypes.find((type) => tipoBase ? type.tipo_base === tipoBase : type.id === id);
    const appointmentType: AgendaAppointmentType = {
      id: previous?.id || crypto.randomUUID(),
      user_id: session.user.id,
      nome: normalizedName,
      tipo_base: tipoBase || null,
      created_at: previous?.created_at || new Date().toISOString(),
    };
    if (previous) {
      await runMutation("tipos_agendamento", "update", { nome: normalizedName }, { id: previous.id });
      setAppointmentTypes((all) => all.map((type) => type.id === previous.id ? appointmentType : type));
    } else {
      await runMutation("tipos_agendamento", "insert", appointmentType as unknown as Record<string, unknown>);
      setAppointmentTypes((all) => [...all, appointmentType].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
    }
  }

  async function deleteAppointmentType(id: string) {
    const appointmentType = appointmentTypes.find((type) => type.id === id);
    if (!appointmentType) throw new Error("Tipo não encontrado.");
    if (appointmentType.tipo_base) throw new Error("As opções padrão não podem ser excluídas.");
    await runMutation("tipos_agendamento", "delete", undefined, { id });
    setAppointmentTypes((all) => all.filter((type) => type.id !== id));
  }

  async function deleteCategory(id: string, moveToId?: string) {
    const category = categories.find((item) => item.id === id);
    if (!category) throw new Error("Categoria não encontrada.");
    const target = categories.find((item) => item.id === moveToId);
    const related = appointments.filter((item) => item.categoria_id === id || item.categoria === category.nome);
    if (related.length && !target) throw new Error("Escolha uma categoria para receber os compromissos.");

    if (target) {
      for (const item of related) {
        await runMutation("agendamentos", "update", {
          categoria: target.nome,
          categoria_id: target.id,
          cor: target.cor,
        }, { id: item.id });
      }
      setAppointments((all) => all.map((item) =>
        related.some((relatedItem) => relatedItem.id === item.id)
          ? { ...item, categoria: target.nome, categoria_id: target.id, cor: target.cor }
          : item
      ));
    }

    await runMutation("categorias", "delete", undefined, { id });
    setCategories((all) => all.filter((item) => item.id !== id));
    setCategoryFilterIds((all) => all.filter((categoryId) => categoryId !== id));
  }

  async function toggleComplete(item: Appointment) {
    try {
      await runMutation("agendamentos", "update", { concluido: !item.concluido }, { id: item.id });
      setAppointments((all) =>
        all.map((event) => (event.id === item.id ? { ...event, concluido: !event.concluido } : event))
      );
      if (item.tipo === "tarefa") {
        if (undoCompletionTimer.current !== null) window.clearTimeout(undoCompletionTimer.current);
        setUndoCompletionToast(item);
        undoCompletionTimer.current = window.setTimeout(() => {
          setUndoCompletionToast(null);
          undoCompletionTimer.current = null;
        }, 6000);
      } else {
        notify(item.concluido ? "Item reaberto." : "Item concluído!");
      }
    } catch (error) {
      notify(messageOf(error), "error");
    }
  }

  async function undoTaskCompletion(item: Appointment) {
    if (undoCompletionTimer.current !== null) window.clearTimeout(undoCompletionTimer.current);
    undoCompletionTimer.current = null;
    try {
      await runMutation("agendamentos", "update", { concluido: item.concluido }, { id: item.id });
      setAppointments((all) => all.map((event) => event.id === item.id ? { ...event, concluido: item.concluido } : event));
      setUndoCompletionToast(null);
      notify("Alteração desfeita.");
    } catch (error) {
      notify(`Não foi possível desfazer a alteração: ${messageOf(error)}`, "error");
    }
  }

  async function moveAppointment(item: Appointment, date: string) {
    if (item.data === date) return;
    const previousDate = item.data;
    const resetReminders = (item.alertas || []).map((reminder) => ({
      ...reminder,
      disparado_em: null,
      disparado_para: null,
      adiado_ate: null,
      disparos: [],
    }));
    const updates = { data: date, alerta_enviado_em: null, alerta_enviado_para: null, adiado_ate: null, alertas: resetReminders };
    setAppointments((all) => all.map((current) => current.id === item.id ? { ...current, ...updates } : current));

    try {
      await runMutation("agendamentos", "update", updates, { id: item.id });
      notify(`"${item.titulo}" movido para ${formatDate(date)}.`);
    } catch (error) {
      setAppointments((all) => all.map((current) => current.id === item.id && current.data === date
        ? {
            ...current,
            data: previousDate,
            alerta_enviado_em: item.alerta_enviado_em,
            alerta_enviado_para: item.alerta_enviado_para,
            adiado_ate: item.adiado_ate,
            alertas: item.alertas,
          }
        : current));
      notify(`Não foi possível mover "${item.titulo}": ${messageOf(error)}`, "error");
    }
  }

  async function commitAppointmentDelete(item: Appointment) {
    try {
      await runMutation("agendamentos", "delete", undefined, { id: item.id });
    } catch (error) {
      setUndoToast(null);
      setAppointments((all) => [...all.filter((event) => event.id !== item.id), item].sort(appointmentSort));
      notify(messageOf(error), "error");
    }
  }

  function undoAppointmentDelete(id: string) {
    const pending = pendingDelete.current;
    if (!pending || pending.item.id !== id) return;
    window.clearTimeout(pending.timer);
    pendingDelete.current = null;
    setUndoToast(null);
    setAppointments((all) => [...all.filter((event) => event.id !== id), pending.item].sort(appointmentSort));
    notify("Exclusão desfeita.");
  }

  function deleteAppointment(item: Appointment) {
    if (undoCompletionToast?.id === item.id) {
      if (undoCompletionTimer.current !== null) window.clearTimeout(undoCompletionTimer.current);
      undoCompletionTimer.current = null;
      setUndoCompletionToast(null);
    }
    if (pendingDelete.current) {
      window.clearTimeout(pendingDelete.current.timer);
      setUndoToast(null);
      void commitAppointmentDelete(pendingDelete.current.item);
    }
    setAppointments((all) => all.filter((event) => event.id !== item.id));
    const timer = window.setTimeout(() => {
      if (pendingDelete.current?.item.id !== item.id) return;
      pendingDelete.current = null;
      setUndoToast(null);
      void commitAppointmentDelete(item);
    }, 6000);
    pendingDelete.current = { item, timer };
    setUndoToast(item);
  }

  async function snoozeReminderToast(toast: (typeof reminderToasts)[number], snoozeMinutes: number) {
    if (toast.minutes === null) return;
    const item = appointments.find((current) => current.id === toast.item.id);
    if (!item) return;
    const snoozedUntil = new Date(Date.now() + snoozeMinutes * 60000).toISOString();
    const nextReminders = (item.alertas || []).map((reminder) => {
      if (reminder.minutos !== toast.minutes) return reminder;
      const currentDispatch = reminder.disparos?.find((dispatch) => dispatch.data === toast.date);
      const dispatches = (reminder.disparos || []).filter((dispatch) => dispatch.data !== toast.date);
      dispatches.push({
        data: toast.date,
        disparado_em: currentDispatch?.disparado_em || reminder.disparado_em || new Date().toISOString(),
        adiado_ate: snoozedUntil,
      });
      return {
        ...reminder,
        adiado_ate: toast.date === todayInSaoPaulo() ? snoozedUntil : reminder.adiado_ate,
        disparos: dispatches,
      };
    });
    const snoozedReminder = nextReminders.find((reminder) => reminder.minutos === toast.minutes);
    const legacyState = toast.minutes === item.alerta_minutos && toast.date === todayInSaoPaulo()
      ? { adiado_ate: snoozedUntil }
      : {};
    try {
      await runMutation("agendamentos", "update", { alertas: nextReminders, ...legacyState }, { id: item.id });
      setAppointments((all) => all.map((current) => current.id === item.id ? { ...current, alertas: nextReminders, ...legacyState } : current));
      localSent.current.delete(toast.key);
      setReminderToasts((all) => all.filter((current) => current.key !== toast.key));
      notify(`Lembrete adiado por ${snoozeMinutes} minutos.`);
    } catch (error) {
      notify(`Não foi possível adiar o lembrete: ${messageOf(error)}`, "error");
    }
  }

  async function completeReminderToast(toast: (typeof reminderToasts)[number]) {
    setReminderToasts((all) => all.filter((current) => current.item.id !== toast.item.id));
    const item = appointments.find((current) => current.id === toast.item.id);
    if (item && !item.concluido) await toggleComplete(item);
  }

  async function saveContact(values: typeof EMPTY_CONTACT, phones: Phone[], id?: string) {
    setBusy(true);
    try {
      if (values.email.trim() && !isValidEmail(values.email)) {
        throw new Error("Informe um e-mail válido.");
      }
      const invalidPhone = phones.find((phone) => phone.numero.trim() && !isValidBrazilianPhone(phone.numero));
      if (invalidPhone) throw new Error(`O telefone "${invalidPhone.numero}" deve conter DDD e 8 ou 9 dígitos.`);
      const contactId = id || crypto.randomUUID();
      const record = {
        id: contactId,
        ...values,
        nome: values.nome.trim(),
        email: values.email.trim(),
        aniversario: values.aniversario || null,
        deleted_at: null,
        user_id: session!.user.id,
      };
      const { id: _id, user_id: _userId, ...updates } = record;
      if (id) await runMutation("contatos", "update", updates, { id });
      else await runMutation("contatos", "insert", record);

      if (id) {
        await runMutation("telefones", "delete", undefined, { contato_id: contactId, user_id: session!.user.id });
      }

      if (phones.length) {
        const phoneRecords = phones.map((phone) => ({
          ...phone,
          numero: phone.numero.trim(),
          id: crypto.randomUUID(),
          contato_id: contactId,
          user_id: session!.user.id,
        }));
        await runMutation("telefones", "insert", phoneRecords as unknown as Record<string, unknown>);
        const updatedContact = { ...record, telefones: phoneRecords };
        setContacts((all) => (id ? all.map((c) => (c.id === id ? updatedContact : c)) : [...all, updatedContact]));
      } else {
        const updatedContact = { ...record, telefones: [] };
        setContacts((all) => (id ? all.map((c) => (c.id === id ? updatedContact : c)) : [...all, updatedContact]));
      }

      setContactForm(undefined);
      notify(
        navigator.onLine
          ? "Contato salvo."
          : "Contato salvo neste dispositivo; será sincronizado quando a internet voltar."
      );
    } catch (error) {
      notify(messageOf(error), "error");
      throw error;
    } finally {
      setBusy(false);
    }
  }

  async function moveContactsToTrash(ids: string[]): Promise<boolean> {
    const uniqueIds = [...new Set(ids)].filter((id) => contacts.some((contact) => contact.id === id && !contact.deleted_at));
    if (!uniqueIds.length) return true;
    const deletedAt = new Date().toISOString();
    const trashedIds: string[] = [];
    let failureMessage = "";

    for (const id of uniqueIds) {
      try {
        await runMutation("contatos", "update", { deleted_at: deletedAt }, { id });
        setContacts((all) =>
          all.map((contact) => (contact.id === id ? { ...contact, deleted_at: deletedAt } : contact))
        );
        trashedIds.push(id);
      } catch (error) {
        failureMessage = messageOf(error);
        break;
      }
    }

    setLastTrashedContactIds(trashedIds);
    if (trashedIds.length) {
      if (failureMessage) {
        notify(`${trashedIds.length} contato(s) movido(s). O restante não foi movido: ${failureMessage}`, "error");
      } else notify(`${trashedIds.length} contato(s) movido(s) para a lixeira.`);
    }
    return trashedIds.length === uniqueIds.length;
  }

  async function trashContact(contact: Contact) {
    if (!window.confirm(`Mover ${contact.nome} para a lixeira?`)) return;
    await moveContactsToTrash([contact.id]);
  }

  async function trashContacts(ids: string[]) {
    if (!window.confirm(`Mover ${ids.length} contato(s) selecionado(s) para a lixeira?`)) return;
    await moveContactsToTrash(ids);
  }

  async function restoreContacts(ids: string[]) {
    const restoredIds: string[] = [];
    let failureMessage = "";
    for (const id of ids) {
      try {
        await runMutation("contatos", "update", { deleted_at: null }, { id });
        setContacts((all) => all.map((contact) => (contact.id === id ? { ...contact, deleted_at: null } : contact)));
        restoredIds.push(id);
      } catch (error) {
        failureMessage = messageOf(error);
        break;
      }
    }
    setLastTrashedContactIds((all) => all.filter((id) => !restoredIds.includes(id)));
    if (failureMessage) {
      notify(`${restoredIds.length} contato(s) restaurado(s). O restante não foi alterado: ${failureMessage}`, "error");
    } else if (restoredIds.length) notify(`${restoredIds.length} contato(s) restaurado(s).`);
  }

  async function permanentlyDeleteContact(contact: Contact) {
    if (!window.confirm(`Excluir permanentemente ${contact.nome}? Esta ação não pode ser desfeita.`)) return;
    try {
      await runMutation("contatos", "delete", undefined, { id: contact.id });
      setContacts((all) => all.filter((item) => item.id !== contact.id));
      setLastTrashedContactIds((all) => all.filter((id) => id !== contact.id));
      notify("Contato excluído permanentemente.");
    } catch (error) {
      notify(messageOf(error), "error");
    }
  }

  async function mergeContacts(primary: Contact, duplicate: Contact) {
    const phonesByNumber = new Map<string, Phone>();
    for (const phone of [...(primary.telefones || []), ...(duplicate.telefones || [])]) {
      const normalized = normalizePhoneNumber(phone.numero);
      if (!normalized || phonesByNumber.has(normalized)) continue;
      phonesByNumber.set(normalized, { numero: phone.numero, rotulo: phone.rotulo });
    }
    const mergedValues = {
      nome: primary.nome || duplicate.nome,
      email: primary.email || duplicate.email,
      empresa: primary.empresa || duplicate.empresa,
      endereco: primary.endereco || duplicate.endereco,
      aniversario: primary.aniversario || duplicate.aniversario || "",
      observacoes: [primary.observacoes, duplicate.observacoes].filter(Boolean).join("\n\n"),
      favorito: primary.favorito || duplicate.favorito,
    };

    await saveContact(mergedValues, [...phonesByNumber.values()], primary.id);
    const duplicateArchived = await moveContactsToTrash([duplicate.id]);
    if (!duplicateArchived) {
      throw new Error("Os dados principais foram atualizados, mas o contato duplicado não foi movido para a lixeira.");
    }
    notify(`Contatos mesclados. Os dados complementares foram mantidos e ${duplicate.nome} foi para a lixeira.`);
  }

  async function toggleFavorite(contact: Contact) {
    try {
      await runMutation("contatos", "update", { favorito: !contact.favorito }, { id: contact.id });
      setContacts((all) => (all.map((item) => (item.id === contact.id ? { ...item, favorito: !item.favorito } : item))));
    } catch (error) {
      notify(messageOf(error), "error");
    }
  }

  // Ações para Notas Livres
  async function saveFreeNote(
    noteValues: Omit<FreeNote, "id" | "user_id" | "created_at" | "updated_at">,
    id?: string
  ) {
    setBusy(true);
    try {
      const noteId = id || crypto.randomUUID();
      const now = new Date().toISOString();
      const record = {
        id: noteId,
        user_id: session!.user.id,
        ...noteValues,
        updated_at: now,
      };

      if (id) {
        await runMutation("notas", "update", record, { id });
        setNotes((all) => all.map((n) => (n.id === id ? { ...n, ...record } : n)));
      } else {
        const newNote: FreeNote = { ...record, created_at: now };
        await runMutation("notas", "insert", newNote as unknown as Record<string, unknown>);
        setNotes((all) => [newNote, ...all]);
      }
      notify("Anotação salva!");
    } catch (err) {
      notify(`Erro ao salvar anotação: ${messageOf(err)}`, "error");
    } finally {
      setBusy(false);
    }
  }

  async function deleteFreeNote(note: FreeNote) {
    if (!window.confirm(`Excluir anotação "${note.titulo}"?`)) return;
    try {
      await runMutation("notas", "delete", undefined, { id: note.id });
      setNotes((all) => all.filter((n) => n.id !== note.id));
      notify("Anotação excluída.");
    } catch (err) {
      notify(`Erro ao excluir: ${messageOf(err)}`, "error");
    }
  }

  async function togglePinFreeNote(note: FreeNote) {
    try {
      const updatedPin = !note.fixada;
      await runMutation("notas", "update", { fixada: updatedPin }, { id: note.id });
      setNotes((all) => all.map((n) => (n.id === note.id ? { ...n, fixada: updatedPin } : n)));
    } catch (err) {
      notify(`Erro ao fixar/desafixar: ${messageOf(err)}`, "error");
    }
  }

  async function enablePush() {
    setPushBusy(true);
    try {
      if (isElectronApp()) {
        if (typeof Notification === "undefined") throw new Error("Notificações não estão disponíveis neste ambiente.");
        const localPermission = await Notification.requestPermission();
        if (localPermission !== "granted") throw new Error("Permissão de notificações não concedida.");
        localStorage.setItem("minha-agenda-local-alerts", "1");
        setLocalAlerts(true);
        new Notification("CODIFEX AGENDAS", { body: "Lembretes ativados neste computador.", icon: "/icon.png" });
        notify("Lembretes ativados neste computador.");
        return;
      }
      if (!("serviceWorker" in navigator) || !("PushManager" in window))
        throw new Error("Este navegador não oferece suporte a notificações push.");
      const applicationServerKey = decodeVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Permissão de notificações não concedida.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey as BufferSource,
      });
      const { error } = await getSupabase()
        .from("push_subscriptions")
        .upsert(
          {
            user_id: session!.user.id,
            endpoint: subscription.endpoint,
            subscription: subscription.toJSON(),
            user_agent: navigator.userAgent,
          },
          { onConflict: "endpoint" }
        );
      if (error) throw error;
      setPushEnabled(true);
      notify("Notificações ativadas neste dispositivo.");
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function disablePush() {
    setPushBusy(true);
    try {
      if (isElectronApp()) {
        localStorage.removeItem("minha-agenda-local-alerts");
        setLocalAlerts(false);
        notify("Lembretes desativados neste computador.");
        return;
      }
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const { error } = await getSupabase().from("push_subscriptions").delete().eq("endpoint", subscription.endpoint);
        if (error) throw error;
        await subscription.unsubscribe();
      }
      setPushEnabled(false);
      notify("Notificações desativadas neste dispositivo.");
    } catch (error) {
      notify(messageOf(error), "error");
    } finally {
      setPushBusy(false);
    }
  }

  async function exportBackup() {
    if (isBackupBusy) return;
    setIsBackupBusy(true);
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    try {
      download(
        `codifex-agendas-backup-${todayInSaoPaulo()}.json`,
        JSON.stringify(
          {
            exportado_em: new Date().toISOString(),
            fuso: "America/Sao_Paulo",
            agendamentos: appointments,
            categorias: categories,
            tipos_agendamento: appointmentTypes,
            observacoes: Object.entries(observations).map(([data, anotacao]) => ({ data, anotacao })),
            contatos: contacts,
            telefones: contacts.flatMap((contact) =>
              (contact.telefones || []).map((phone) => ({ ...phone, contato_id: contact.id }))
            ),
            notas: notes,
          },
          null,
          2
        ),
        "application/json;charset=utf-8"
      );
      notify("Backup concluído");
    } catch (error) {
      notify(`Não foi possível concluir o backup: ${messageOf(error)}`, "error");
    } finally {
      setIsBackupBusy(false);
    }
  }

  function exportIcal() {
    try {
      const ics = exportToIcs(appointments);
      download(`minha-agenda-${todayInSaoPaulo()}.ics`, ics, "text/calendar;charset=utf-8");
      notify("Agenda exportada em formato iCal (.ics)!");
    } catch (err) {
      notify(`Erro ao exportar iCal: ${messageOf(err)}`, "error");
    }
  }

  async function importIcalFile(file: File) {
    if (isImportBusy) return;
    setIsImportBusy(true);
    let importedCount = 0;
    let totalCount = 0;
    try {
      const text = await file.text();
      const parsedEvents = parseIcs(text);
      if (!parsedEvents.length) {
        throw new Error("Nenhum compromisso válido foi encontrado no arquivo .ics selecionado.");
      }

      totalCount = parsedEvents.length;
      const importedCategories = [...categories];
      for (const ev of parsedEvents) {
        const categoryName = ev.categoria || "Geral";
        let category = importedCategories.find((item) => item.nome.toLocaleLowerCase("pt-BR") === categoryName.toLocaleLowerCase("pt-BR"));
        if (!category) {
          category = {
            id: crypto.randomUUID(),
            user_id: session!.user.id,
            nome: categoryName,
            cor: COLORS[0],
          };
          await runMutation("categorias", "insert", category as unknown as Record<string, unknown>);
          importedCategories.push(category);
          setCategories((all) => [...all, category!].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")));
        }
        const record = {
          id: crypto.randomUUID(),
          user_id: session!.user.id,
          titulo: ev.titulo,
          data: ev.data,
          hora_inicio: ev.hora_inicio || null,
          hora_fim: ev.hora_fim || null,
          descricao: ev.descricao || "",
          local: ev.local || "",
          categoria: category.nome,
          categoria_id: category.id,
          cor: category.cor,
          tipo: ev.tipo,
          prioridade: ev.prioridade,
          cliente: ev.cliente,
          responsavel: ev.responsavel,
          alerta_minutos: ev.hora_inicio ? 15 : null,
          alertas: ev.hora_inicio ? [{ minutos: 15, disparado_em: null, adiado_ate: null }] : [],
          recorrencia: ev.recorrencia || "none",
          concluido: ev.concluido,
          alerta_enviado_em: null,
          alerta_enviado_para: null,
          adiado_ate: null,
          atrasado_notificado_em: null,
        };

        await runMutation("agendamentos", "insert", record);
        setAppointments((all) => [...all, { ...record, created_at: new Date().toISOString() } as Appointment]);
        importedCount++;
      }

      notify(`Importação concluída: ${importedCount} compromissos adicionados`);
    } catch (err) {
      const partialProgress = totalCount
        ? ` ${importedCount} de ${totalCount} item(ns) já foram importados.`
        : "";
      notify(`Erro ao importar iCal: ${messageOf(err)}${partialProgress}`, "error");
    } finally {
      setIsImportBusy(false);
    }
  }

  function exportContacts() {
    const rows = [["nome", "telefones", "email", "empresa", "endereco", "aniversario", "observacoes"]];
    for (const contact of activeContacts)
      rows.push([
        contact.nome,
        (contact.telefones || []).map((p) => `${p.rotulo}:${p.numero}`).join(" | "),
        contact.email,
        contact.empresa,
        contact.endereco,
        contact.aniversario || "",
        contact.observacoes,
      ]);
    download(
      "contatos.csv",
      `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`,
      "text/csv;charset=utf-8"
    );
  }

  async function importContacts(file: File) {
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("O CSV precisa conter cabeçalho e pelo menos um contato.");
      const headers = rows[0].map((value) => value.trim().toLowerCase());
      const nameIndex = headers.indexOf("nome");
      if (nameIndex < 0) throw new Error("A coluna obrigatória 'nome' não foi encontrada.");
      const records = rows
        .slice(1)
        .map((row) => {
          const get = (column: string) => row[headers.indexOf(column)] || "";
          return {
            nome: row[nameIndex]?.trim(),
            email: get("email"),
            empresa: get("empresa"),
            endereco: get("endereco"),
            aniversario: get("aniversario") || null,
            observacoes: get("observacoes"),
            favorito: false,
            deleted_at: null,
            user_id: session!.user.id,
            telefones: get("telefones")
              .split(" | ")
              .filter(Boolean)
              .map((entry) => {
                const separator = entry.indexOf(":");
                const rotulo = separator >= 0 ? entry.slice(0, separator).trim().toLowerCase() : "celular";
                const rawNumber = separator >= 0 ? entry.slice(separator + 1).trim() : entry.trim();
                return {
                  numero: formatBrazilianPhone(rawNumber),
                  rotulo: (["celular", "casa", "trabalho"].includes(rotulo) ? rotulo : "celular") as Phone["rotulo"],
                };
              })
              .filter((phone) => phone.numero),
          };
        })
        .filter((record) => record.nome);

      if (!records.length) throw new Error("Nenhum contato válido foi encontrado.");
      for (const record of records) {
        if (record.email && !isValidEmail(record.email)) {
          throw new Error(`O e-mail "${record.email}" não é válido.`);
        }
        const invalidPhone = record.telefones.find((phone) => phone.numero && !isValidBrazilianPhone(phone.numero));
        if (invalidPhone) throw new Error(`O telefone "${invalidPhone.numero}" não contém DDD e 8 ou 9 dígitos.`);
      }
      for (const record of records) {
        const { telefones, ...contact } = record;
        const contactId = crypto.randomUUID();
        await runMutation("contatos", "insert", { ...contact, id: contactId });
        if (telefones.length) {
          const phoneRecords = telefones.map((phone) => ({
            ...phone,
            id: crypto.randomUUID(),
            contato_id: contactId,
            user_id: session!.user.id,
          }));
          await runMutation("telefones", "insert", phoneRecords as unknown as Record<string, unknown>);
        }
        setContacts((all) => [
          ...all,
          {
            ...contact,
            id: contactId,
            telefones: telefones.map((phone) => ({ ...phone, id: crypto.randomUUID() })),
          } as Contact,
        ]);
      }
      notify(
        `${records.length} contato(s) importado(s).${navigator.onLine ? "" : " Serão sincronizados quando a internet voltar."}`
      );
    } catch (error) {
      notify(messageOf(error), "error");
    }
  }

  function changeTheme() {
    const next = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", next);
    document.documentElement.classList.toggle("dark", next === "dark");
    document.body.classList.toggle("dark", next === "dark");
    setTheme(next);
    try {
      localStorage.setItem("minha-agenda-theme", next);
    } catch (error) {
      notify(`Tema alterado, mas não foi possível salvar a preferência neste dispositivo: ${messageOf(error)}`, "error");
    }
  }

  const searchTerm = normalizeSearch(search);
  const filteredAppointments = useMemo(
    () =>
      appointments.filter((item) =>
        normalizeSearch(
          `${item.titulo} ${item.descricao} ${item.local} ${item.categoria} ${item.tipo_personalizado || ""} ${item.cliente} ${item.responsavel} ${item.prioridade} ${item.tipo} ${formatBrazilianDate(
            item.data
          )}`
        ).includes(searchTerm)
      ),
    [appointments, searchTerm]
  );

  const calendarAppointments = useMemo(() => {
    const now = new Date();
    return filteredAppointments.filter((item) => {
      if (categoryFilterIds.length && !categoryFilterIds.includes(item.categoria_id || "")) return false;
      if (statusFilter === "pending" && item.concluido) return false;
      if (statusFilter === "completed" && !item.concluido) return false;
      if (statusFilter === "overdue" && !isAppointmentOverdue(item, now)) return false;
      return true;
    });
  }, [filteredAppointments, categoryFilterIds, statusFilter]);

  const filteredContacts = useMemo(
    () =>
      activeContacts.filter((contact) =>
        normalizeSearch(
          `${contact.nome} ${contact.email} ${contact.empresa} ${contact.endereco} ${contact.observacoes} ${
            contact.aniversario ? formatBrazilianDate(contact.aniversario) : ""
          } ${(contact.telefones || []).map((phone) => `${phone.rotulo} ${phone.numero}`).join(" ")}`
        ).includes(searchTerm)
      ),
    [activeContacts, searchTerm]
  );

  const filteredNotesList = useMemo(
    () =>
      Object.entries(observations).filter(
        ([date, note]) => note.trim() && normalizeSearch(`${formatBrazilianDate(date)} ${note}`).includes(searchTerm)
      ),
    [observations, searchTerm]
  );

  const filteredFreeNotesList = useMemo(
    () =>
      notes.filter(
        (n) => normalizeSearch(`${n.titulo} ${n.conteudo}`).includes(searchTerm)
      ),
    [notes, searchTerm]
  );

  const selectedEvents = calendarAppointments.filter((item) => occurrenceOn(item, selectedDate)).sort(appointmentSort);
  const selectedOverdueCount = filteredAppointments.filter((item) =>
    (!categoryFilterIds.length || categoryFilterIds.includes(item.categoria_id || "")) &&
    occurrenceOn(item, selectedDate) &&
    isAppointmentOverdue(item)
  ).length;
  const visibleMonthHasAppointments = useMemo(() => {
    const daysInMonth = new Date(shownYear, shownMonth + 1, 0).getDate();
    return calendarAppointments.some((item) => Array.from({ length: daysInMonth }, (_, index) => {
      const date = `${shownYear}-${String(shownMonth + 1).padStart(2, "0")}-${String(index + 1).padStart(2, "0")}`;
      return occurrenceOn(item, date);
    }).some(Boolean));
  }, [calendarAppointments, shownMonth, shownYear]);
  const today = todayInSaoPaulo();

  const archivedYears = [...new Set([
    yearLimit,
    currentYear,
    currentYear - 1,
    ...appointments.map((item) => Number(item.data.slice(0, 4))),
    ...Object.keys(observations).map((date) => Number(date.slice(0, 4))),
  ])]
    .filter((year) => year <= yearLimit && year >= 1900)
    .sort((a, b) => b - a);
  const hasArchivedYearSelected = shownYear !== currentYear;

  const holidays = brazilianHolidays(parseDate(selectedDate).getFullYear());
  const selectedHoliday = holidays.get(selectedDate);
  const alertsOn = pushEnabled || localAlerts;
  const pageTitle =
    view === "contacts"
      ? "Contatos da agenda"
      : view === "tasks"
      ? "Tarefas"
      : view === "notes"
      ? "Anotações"
      : view === "week"
      ? "Visão Semanal"
      : view === "year"
      ? `Agenda ${shownYear}`
      : view === "month"
      ? `${MONTHS[shownMonth]} ${shownYear}`
      : "Agenda do dia";
  const hasSearchResults = Boolean(
    filteredAppointments.length || filteredContacts.length || filteredFreeNotesList.length || filteredNotesList.length
  );

  if (!authReady) {
    return (
      <main className="flex min-h-screen items-center justify-center p-4">
        <div className="text-center">
          <div
            className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600"
            role="status"
            aria-label="Carregando"
          />
          <p className="muted">Conectando à sua agenda...</p>
        </div>
      </main>
    );
  }

  if (!session) {
    return (
      <main className="auth-page flex min-h-screen items-center justify-center p-4">
        <div className="auth-page-decoration" aria-hidden="true">
          <span className="auth-calendar-shape auth-calendar-shape-one" />
          <span className="auth-calendar-shape auth-calendar-shape-two" />
          <span className="auth-calendar-shape auth-calendar-shape-three" />
        </div>
        <form onSubmit={authenticate} className="card auth-card w-full max-w-md p-7 shadow-lg">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center">
              <img src="/icon.png" alt="CODIFEX AGENDAS" className="h-16 w-16 rounded-2xl object-contain shadow-md" />
            </div>
            <h1 className="text-2xl font-bold">CODIFEX AGENDAS</h1>
            <p className="muted mt-2">Compromissos, tarefas e prazos do escritório em um só lugar.</p>
          </div>
          <label className="mb-3 block text-sm font-medium">
            E-mail
            <input
              className="field mt-1"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <label className="block text-sm font-medium">
            Senha
            <span className="auth-password-field">
              <input
                className="field mt-1"
                type={passwordVisible ? "text" : "password"}
                minLength={6}
                required
                autoComplete={authMode === "login" ? "current-password" : "new-password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="auth-password-toggle"
                aria-label={passwordVisible ? "Ocultar senha" : "Mostrar senha"}
                aria-pressed={passwordVisible}
                onClick={() => setPasswordVisible((visible) => !visible)}
              >
                {passwordVisible ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8" />
                    <path d="M9.9 5.2A10.8 10.8 0 0 1 12 5c5.2 0 8.6 4.1 9.5 6-.4.8-1.2 1.8-2.3 2.8M6.2 6.2C3.9 7.6 2.7 9.5 2.5 11c.9 1.9 4.3 6 9.5 6 1 0 1.9-.2 2.8-.5" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M2.5 12s3.4-7 9.5-7 9.5 7 9.5 7-3.4 7-9.5 7-9.5-7-9.5-7Z" />
                    <circle cx="12" cy="12" r="3" />
                  </svg>
                )}
              </button>
            </span>
          </label>
          {authError && <p className="mt-3 text-sm text-red-600" role="alert">{authError}</p>}
          {authError && (
            <button
              type="button"
              className="btn btn-ghost mt-2 w-full"
              onClick={() => {
                setAuthReady(false);
                setAuthRetry((attempt) => attempt + 1);
              }}
            >
              Tentar conectar novamente
            </button>
          )}
          <button disabled={authBusy} className="btn btn-primary mt-5 w-full">
            {authBusy ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}
          </button>
          <button
            type="button"
            className="btn btn-ghost mt-2 w-full"
            onClick={() => {
              setAuthMode(authMode === "login" ? "signup" : "login");
              setPasswordVisible(false);
              setAuthError("");
            }}
          >
            {authMode === "login" ? "Ainda não tem conta? Criar conta" : "Já tem conta? Entrar"}
          </button>
          <p className="muted mt-4 text-center text-xs">
            O primeiro acesso precisa de internet. Depois, use a agenda instalada offline neste dispositivo.
          </p>
        </form>
      </main>
    );
  }

  return (
    <main className="min-h-screen">
      {/* Input oculto para importação iCal */}
      <input
        ref={icalInputRef}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) importIcalFile(file);
          e.currentTarget.value = "";
        }}
      />

      <AgendaHeader
        title={pageTitle}
        subtitle={view === "day" ? formatDate(selectedDate) : `Olá, ${session.user.email}`}
        view={view}
        onViewChange={setView}
        categories={categories}
        selectedCategoryIds={categoryFilterIds}
        statusFilter={statusFilter}
        onToggleCategory={(id) => setCategoryFilterIds((all) => all.includes(id) ? all.filter((value) => value !== id) : [...all, id])}
        onStatusFilterChange={setStatusFilter}
        onClearFilters={() => {
          setCategoryFilterIds([]);
          setStatusFilter("all");
        }}
        onManageCategories={() => setCategoryManagerOpen(true)}
        search={search}
        onSearchChange={setSearch}
        searchInputRef={searchRef}
        onHome={() => {
          setView("day");
          setSearch("");
          showDate(today);
        }}
        onNewItem={() =>
          setAppointmentForm({
            ...EMPTY_APPOINTMENT,
            data: selectedDate,
            ...(view === "tasks" ? { tipo: "tarefa" as const, alerta_minutos: "none" } : {}),
          })
        }
        newItemLabel={view === "tasks" ? "Nova tarefa" : "Novo compromisso"}
        onManageAppointmentTypes={() => setAppointmentTypeManagerOpen(true)}
        userName={
          typeof session.user.user_metadata.full_name === "string"
            ? session.user.user_metadata.full_name
            : typeof session.user.user_metadata.name === "string"
              ? session.user.user_metadata.name
              : session.user.email ?? ""
        }
        userEmail={session.user.email ?? ""}
        notificationCount={reminderToasts.length}
        onExportIcal={exportIcal}
        onImportIcal={() => icalInputRef.current?.click()}
        onExportBackup={exportBackup}
        theme={theme}
        onToggleTheme={changeTheme}
        alertsOn={alertsOn}
        pushBusy={pushBusy}
        onToggleNotifications={alertsOn ? disablePush : enablePush}
        installPrompt={installPrompt}
        onInstall={() => {
          const promptEvent = installPrompt as Event & { prompt?: () => Promise<void> };
          promptEvent.prompt?.();
          setInstallPrompt(null);
        }}
        onSignOut={() => {
          void getSupabase().auth.signOut();
        }}
        isOnline={isOnline}
        pendingSync={pendingSync}
        notice={notice}
        backupBusy={isBackupBusy}
        importBusy={isImportBusy}
        onDismissNotice={() => {
          if (noticeTimer.current !== null) window.clearTimeout(noticeTimer.current);
          noticeTimer.current = null;
          setNotice(null);
        }}
      />

      <div className="mx-auto max-w-[1400px] p-4 sm:p-6">
        {/* Visão de Busca Global */}
        {search ? (
          <section className="card p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-bold">Resultados da busca por “{search}”</h2>
            {!filteredAppointments.length && !filteredContacts.length && !filteredFreeNotesList.length && !filteredNotesList.length && (
              <div className="rounded-xl border border-dashed line p-8 text-center">
                <svg className="mx-auto mb-3 h-8 w-8 muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
                </svg>
                <p className="font-semibold">Nada encontrado</p>
                <p className="muted mt-1 text-sm">Tente outro termo ou verifique a ortografia.</p>
              </div>
            )}
            {hasSearchResults && <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h3 className="mb-2 font-semibold">Compromissos e Tarefas ({filteredAppointments.length})</h3>
                <div className="space-y-2">
                  {filteredAppointments.slice(0, 30).map((item) => (
                    <WorkItem
                      key={item.id}
                      item={item}
                      showDate
                      onComplete={toggleComplete}
                      onDelete={deleteAppointment}
                      onEdit={(evt) =>
                        setAppointmentForm({
                          ...evt,
                          hora_inicio: evt.hora_inicio || "",
                          hora_fim: evt.hora_fim || "",
                          alerta_minutos: evt.alertas?.[0] ? String(evt.alertas[0].minutos) : evt.alerta_minutos === null ? "none" : String(evt.alerta_minutos),
                          alertas_minutos: evt.alertas?.map((reminder) => String(reminder.minutos)),
                        })
                      }
                    />
                  ))}
                  {!filteredAppointments.length && <p className="muted text-sm">Nenhum item correspondente.</p>}
                </div>
              </div>

              <div className="space-y-6">
                <div>
                  <h3 className="mb-2 font-semibold">Contatos ({filteredContacts.length})</h3>
                  {filteredContacts.slice(0, 20).map((contact) => (
                    <button
                      key={contact.id}
                      className="mb-2 block w-full rounded-lg border line p-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      onClick={() => {
                        setView("contacts");
                        setSearch("");
                      }}
                    >
                      <strong>{contact.nome}</strong>
                      <span className="muted ml-2 text-sm">{contact.email || (contact.telefones?.[0]?.numero ?? "")}</span>
                    </button>
                  ))}
                  {!filteredContacts.length && <p className="muted text-sm">Nenhum contato correspondente.</p>}
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Anotações Livres ({filteredFreeNotesList.length})</h3>
                  {filteredFreeNotesList.slice(0, 15).map((note) => (
                    <button
                      key={note.id}
                      className="mb-2 block w-full rounded-lg border line p-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      onClick={() => {
                        setView("notes");
                        setSearch("");
                      }}
                    >
                      <strong>{note.titulo}</strong>
                      <p className="muted mt-1 line-clamp-2 text-xs">{note.conteudo}</p>
                    </button>
                  ))}
                  {!filteredFreeNotesList.length && <p className="muted text-sm">Nenhuma anotação livre correspondente.</p>}
                </div>

                <div>
                  <h3 className="mb-2 font-semibold">Observações Diárias ({filteredNotesList.length})</h3>
                  {filteredNotesList.slice(0, 20).map(([date, note]) => (
                    <button
                      key={date}
                      className="mb-2 block w-full rounded-lg border line p-3 text-left hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                      onClick={() => {
                        setSelectedDate(date);
                        setShownYear(parseDate(date).getFullYear());
                        setShownMonth(parseDate(date).getMonth());
                        setView("day");
                        setSearch("");
                      }}
                    >
                      <strong>{formatDate(date)}</strong>
                      <p className="muted mt-1 line-clamp-2 text-sm">{note}</p>
                    </button>
                  ))}
                  {!filteredNotesList.length && <p className="muted text-sm">Nenhuma observação correspondente.</p>}
                </div>
              </div>
            </div>}
          </section>
        ) : view === "contacts" ? (
          <ContactsView
            contacts={activeContacts}
            onNewContact={() => setContactForm(null)}
            onEditContact={(contact) => setContactForm(contact)}
            trashedContacts={contacts.filter((contact) => Boolean(contact.deleted_at))}
            lastTrashedContactIds={lastTrashedContactIds}
            onDeleteContact={trashContact}
            onDeleteContacts={trashContacts}
            onUndoTrash={() => restoreContacts(lastTrashedContactIds)}
            onRestoreContact={(contact) => restoreContacts([contact.id])}
            onDeletePermanently={permanentlyDeleteContact}
            onMergeContacts={mergeContacts}
            onToggleFavorite={toggleFavorite}
            onImportCsv={importContacts}
            onExportCsv={exportContacts}
          />
        ) : view === "tasks" ? (
          <TasksView
            shownYear={shownYear}
            yearLimit={yearLimit}
            appointments={appointments}
            onYearChange={(year) => {
              setShownYear(year);
              setShownMonth(0);
              showDate(`${year}-01-01`);
            }}
            onNewTask={() =>
              setAppointmentForm({
                ...EMPTY_APPOINTMENT,
                data: shownYear === currentYear ? today : `${shownYear}-01-01`,
                tipo: "tarefa",
                alerta_minutos: "none",
                alertas_minutos: [],
              })
            }
            onToggleComplete={toggleComplete}
            onDeleteTask={deleteAppointment}
            onEditTask={(evt) =>
              setAppointmentForm({
                ...evt,
                hora_inicio: evt.hora_inicio || "",
                hora_fim: evt.hora_fim || "",
                alerta_minutos: evt.alertas?.[0] ? String(evt.alertas[0].minutos) : evt.alerta_minutos === null ? "none" : String(evt.alerta_minutos),
                alertas_minutos: evt.alertas?.map((reminder) => String(reminder.minutos)),
              })
            }
          />
        ) : view === "notes" ? (
          <NotesView
            notes={notes}
            onSaveNote={saveFreeNote}
            onDeleteNote={deleteFreeNote}
            onTogglePin={togglePinFreeNote}
            busy={busy}
          />
        ) : view === "week" ? (
          <CalendarWeek
            currentDate={selectedDate}
            maxYear={yearLimit}
            appointments={calendarAppointments}
            contacts={activeContacts}
            observations={observations}
            onSelectDate={(date) => showDate(date)}
            onOpenDayView={(date) => {
              showDate(date);
              setView("day");
            }}
            onNewAppointment={(date) => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: date })}
            onEditAppointment={(evt) =>
              setAppointmentForm({
                ...evt,
                hora_inicio: evt.hora_inicio || "",
                hora_fim: evt.hora_fim || "",
                alerta_minutos: evt.alertas?.[0] ? String(evt.alertas[0].minutos) : evt.alerta_minutos === null ? "none" : String(evt.alerta_minutos),
                alertas_minutos: evt.alertas?.map((reminder) => String(reminder.minutos)),
              })
            }
            onToggleComplete={toggleComplete}
            onMoveAppointment={moveAppointment}
          />
        ) : view === "day" ? (
          <DayView
            selectedDate={selectedDate}
            yearLimit={yearLimit}
            today={today}
            appointments={selectedEvents}
            overdueCount={selectedOverdueCount}
            contacts={activeContacts}
            holiday={selectedHoliday}
            noteValue={observations[selectedDate] || ""}
            savingNote={savingNote}
            onSelectDate={showDate}
            onShowOverdue={() => setStatusFilter("overdue")}
            onNewAppointment={(date) => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: date })}
            onToggleComplete={toggleComplete}
            onDeleteAppointment={deleteAppointment}
            onEditAppointment={(evt) =>
              setAppointmentForm({
                ...evt,
                hora_inicio: evt.hora_inicio || "",
                hora_fim: evt.hora_fim || "",
                alerta_minutos: evt.alertas?.[0] ? String(evt.alertas[0].minutos) : evt.alerta_minutos === null ? "none" : String(evt.alerta_minutos),
                alertas_minutos: evt.alertas?.map((reminder) => String(reminder.minutos)),
              })
            }
            onNoteChange={(newNote) => setObservations((all) => ({ ...all, [selectedDate]: newNote }))}
          />
        ) : (
          <div className={`${view === "year" ? "calendar-year-layout " : ""}month-layout grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_400px]`}>
            <section>
              {view === "year" ? (
                <>
                  <div className="year-view-toolbar">
                    <div className="year-navigation">
                      <button
                        type="button"
                        className="year-navigation-arrow"
                        aria-label="Ano anterior"
                        title="Ano anterior"
                        onClick={() => {
                          const year = shownYear - 1;
                          setShownYear(year);
                          setShownMonth(0);
                          showDate(`${year}-01-01`);
                        }}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 18-6-6 6-6" /></svg>
                      </button>
                      <strong className="year-navigation-current">{shownYear}</strong>
                      {shownYear < yearLimit ? (
                        <button
                          type="button"
                          className="year-navigation-arrow"
                          aria-label="Próximo ano"
                          title="Próximo ano"
                          onClick={() => {
                            const year = Math.min(shownYear + 1, yearLimit);
                            setShownYear(year);
                            setShownMonth(0);
                            showDate(`${year}-01-01`);
                          }}
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 18 6-6-6-6" /></svg>
                        </button>
                      ) : (
                        <span className="year-navigation-end" aria-hidden="true">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="m9 18 6-6-6-6" /></svg>
                        </span>
                      )}
                    </div>
                    {shownYear === yearLimit && yearLimit < 9999 && (
                      <button className="btn btn-primary year-generate-button" onClick={generateNextYear}>
                        <span aria-hidden="true">＋</span> Gerar {yearLimit + 1}
                      </button>
                    )}
                    <div className="year-filter-menu" ref={yearFilterRef}>
                      <button
                        type="button"
                        className={`year-filter-trigger${yearFilterOpen ? " is-open" : ""}${hasArchivedYearSelected ? " is-filtered" : ""}`}
                        aria-label={hasArchivedYearSelected ? `Anos arquivados, ${shownYear} selecionado` : "Anos arquivados"}
                        title="Consultar ano arquivado"
                        aria-expanded={yearFilterOpen}
                        aria-haspopup="dialog"
                        onClick={() => setYearFilterOpen((open) => !open)}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <path d="M3 7h6l2 2h10v10H3z" /><path d="M3 7V5h7l2 2" />
                        </svg>
                        <span>Arquivados</span>
                        {hasArchivedYearSelected && <span className="year-filter-badge" aria-hidden="true">1</span>}
                      </button>
                    {yearFilterOpen && (
                      <section className="year-filter-popover" role="dialog" aria-label="Consultar ano arquivado">
                        <label className="year-filter-label" htmlFor="archived-year-select">Ano</label>
                        <select
                          id="archived-year-select"
                          className="field year-archive-select"
                          value={shownYear}
                          onChange={(event) => {
                            const year = Math.min(Number(event.target.value), yearLimit);
                            setShownYear(year);
                            setShownMonth(0);
                            showDate(`${year}-01-01`);
                            setYearFilterOpen(false);
                          }}
                        >
                          {archivedYears.map((year) => (
                            <option key={year} value={year}>
                              {year}
                              {year === currentYear ? " (atual)" : ""}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="agenda-clear-filters year-filter-clear"
                          disabled={!hasArchivedYearSelected}
                          onClick={() => {
                            setShownYear(currentYear);
                            setShownMonth(0);
                            showDate(`${currentYear}-01-01`);
                            setYearFilterOpen(false);
                          }}
                        >
                          Voltar ao ano atual
                        </button>
                      </section>
                    )}
                    </div>
                  </div>

                  <div className="calendar-year-grid">
                    {MONTHS.map((month, index) => (
                      <div key={month} className="calendar-year-month card">
                        <CalendarMonth
                          year={shownYear}
                          month={index}
                          maxYear={yearLimit}
                          appointments={calendarAppointments}
                          contacts={activeContacts}
                          observations={observations}
                          selected={selectedDate}
                          onSelect={(date) => {
                            showDate(date);
                            setView("month");
                          }}
                          onOpenMonth={() => {
                            showDate(`${shownYear}-${String(index + 1).padStart(2, "0")}-01`);
                            setView("month");
                          }}
                          compact
                        />
                      </div>
                    ))}
                  </div>

                  <div className="calendar-year-legend muted">
                    <span><i className="is-today" />Hoje</span>
                    <span><i className="is-selected" />Selecionado</span>
                    <span><i className="has-events" />Com compromissos</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        const d = new Date(shownYear, shownMonth - 1, 1, 12);
                        if (d.getFullYear() <= yearLimit) showDate(dateKey(d));
                      }}
                    >
                      ← Anterior
                    </button>
                    <button
                      className="btn btn-ghost text-lg font-bold"
                      onClick={() => {
                        showDate(today);
                        setView("month");
                      }}
                    >
                      Ir para hoje
                    </button>
                    <button
                      disabled={shownYear === yearLimit && shownMonth === 11}
                      className="btn btn-ghost disabled:cursor-not-allowed disabled:opacity-40"
                      onClick={() => {
                        const d = new Date(shownYear, shownMonth + 1, 1, 12);
                        if (d.getFullYear() <= yearLimit) showDate(dateKey(d));
                      }}
                    >
                      Próximo →
                    </button>
                  </div>

                  <CalendarMonth
                    year={shownYear}
                    month={shownMonth}
                    maxYear={yearLimit}
                    appointments={calendarAppointments}
                    contacts={activeContacts}
                    observations={observations}
                    selected={selectedDate}
                    onSelect={showDate}
                  />

                  {!visibleMonthHasAppointments && (
                    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed line p-4">
                      <div className="flex items-center gap-3">
                        <svg className="h-8 w-8 shrink-0 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                          <rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" />
                        </svg>
                        <div><p className="font-semibold">Mês sem compromissos</p><p className="muted text-sm">Adicione um compromisso para este período.</p></div>
                      </div>
                      <button type="button" className="btn btn-primary" onClick={() => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: selectedDate })}>+ Novo compromisso</button>
                    </div>
                  )}

                  <div className="month-legend muted mt-4 flex flex-wrap gap-x-4 gap-y-2 text-xs">
                    <span><i className="month-legend-dot is-holiday" />Feriado</span>
                    <span><i className="month-legend-dot is-appointment" />Compromisso</span>
                    <span><i className="month-legend-dot is-task" />Tarefa</span>
                    <span><i className="month-legend-dot is-birthday" />Aniversário</span>
                    <span><i className="month-legend-dot is-note" />Observação</span>
                  </div>
                </>
              )}
            </section>

            <aside className="month-day-sidebar card p-4 sm:p-5 xl:sticky">
              <div className="month-day-heading mb-4 flex items-start justify-between">
                <div>
                  <div className="month-day-date-meta">
                    <span className="muted text-sm">
                      {new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "2-digit", month: "long" }).format(parseDate(selectedDate))}
                    </span>
                    {selectedDate === today && <span className="month-selected-badge">Hoje</span>}
                  </div>
                  <h2 className="month-day-year">{parseDate(selectedDate).getFullYear()}</h2>
                </div>
                <button
                  className="btn btn-primary month-new-button"
                  aria-label={`Novo compromisso em ${formatDate(selectedDate)}`}
                  aria-keyshortcuts="N"
                  title="Novo compromisso (N)"
                  onClick={() => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: selectedDate })}
                >
                  <span aria-hidden="true">＋</span> Novo
                </button>
              </div>

              {selectedHoliday && (
                <div className="month-special-day month-holiday">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3 21 19H3Z" /><path d="M12 9v4m0 3h.01" /></svg>
                  {selectedHoliday}
                </div>
              )}

              {activeContacts
                .filter((contact) => birthdayOn(contact, selectedDate))
                .map((contact) => (
                  <div
                    key={contact.id}
                    className="month-special-day month-birthday"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="13" rx="2" /><path d="M7 8V5m5 3V3m5 5V5M3 13h18" /></svg>
                    Aniversário de {contact.nome}
                  </div>
                ))}

              <div className="month-agenda-heading mb-2 flex items-center justify-between">
                <h3 className="font-semibold">Agenda do dia</h3>
                <span className="muted text-xs">{selectedEvents.length} item(ns)</span>
              </div>

              <div className="month-day-agenda space-y-2">
                {selectedEvents.map((item) => (
                  <WorkItem
                    key={item.id}
                    item={item}
                    showDate={item.tipo === "tarefa"}
                    monthMode
                    onComplete={toggleComplete}
                    onDelete={deleteAppointment}
                    onEdit={(evt) =>
                      setAppointmentForm({
                        ...evt,
                        hora_inicio: evt.hora_inicio || "",
                        hora_fim: evt.hora_fim || "",
                        alerta_minutos: evt.alertas?.[0] ? String(evt.alertas[0].minutos) : evt.alerta_minutos === null ? "none" : String(evt.alerta_minutos),
                        alertas_minutos: evt.alertas?.map((reminder) => String(reminder.minutos)),
                      })
                    }
                  />
                ))}
                {!selectedEvents.length && (
                  <div className="month-day-empty">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></svg>
                    <strong>Dia livre</strong>
                    <span className="muted">Nenhum compromisso agendado.</span>
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: selectedDate })}
                    >
                      ＋ Novo compromisso
                    </button>
                  </div>
                )}
              </div>

              <div className="mt-5 border-t line pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="font-semibold">Observações do dia</h3>
                  <span className="muted text-xs">{savingNote ? "Salvando..." : "Salvo"}</span>
                </div>
                <textarea
                  className="field min-h-24 resize-y text-sm"
                  placeholder="Anote algo importante para este dia..."
                  value={observations[selectedDate] || ""}
                  onChange={(e) => setObservations((all) => ({ ...all, [selectedDate]: e.target.value }))}
                />
              </div>
            </aside>
          </div>
        )}
      </div>

      {appointmentForm && (
        <AppointmentFormModal
          initial={appointmentForm}
          allAppointments={appointments}
          categories={categories}
          appointmentTypes={appointmentTypes}
          busy={busy}
          onClose={() => setAppointmentForm(null)}
          onSave={saveAppointment}
          DateField={BrazilianDateField}
          TimeField={BrazilianTimeField}
        />
      )}

      {contactForm !== undefined && (
        <ContactFormModal
          initial={contactForm}
          busy={busy}
          onClose={() => setContactForm(undefined)}
          onSave={saveContact}
          DateField={BrazilianDateField}
        />
      )}
      {categoryManagerOpen && (
        <CategoryManagerModal
          categories={categories}
          usageCount={appointments.reduce<Record<string, number>>((counts, item) => {
            const category = categories.find((candidate) => candidate.id === item.categoria_id || candidate.nome === item.categoria);
            if (category) counts[category.id] = (counts[category.id] || 0) + 1;
            return counts;
          }, {})}
          busy={busy}
          onSave={async (name, color, id) => {
            setBusy(true);
            try {
              await saveCategory(name, color, id);
              notify("Categoria salva.");
            } finally {
              setBusy(false);
            }
          }}
          onDelete={async (id, moveToId) => {
            setBusy(true);
            try {
              await deleteCategory(id, moveToId);
              notify("Categoria excluída.");
            } finally {
              setBusy(false);
            }
          }}
          onClose={() => setCategoryManagerOpen(false)}
        />
      )}
      {appointmentTypeManagerOpen && (
        <AppointmentTypeManagerModal
          appointmentTypes={managedAppointmentTypes}
          busy={busy}
          onSave={async (name, id, tipoBase) => {
            setBusy(true);
            try {
              await saveAppointmentType(name, id, tipoBase);
              notify("Tipo salvo.");
            } finally {
              setBusy(false);
            }
          }}
          onDelete={async (id) => {
            setBusy(true);
            try {
              await deleteAppointmentType(id);
              notify("Tipo excluído.");
            } finally {
              setBusy(false);
            }
          }}
          onClose={() => setAppointmentTypeManagerOpen(false)}
        />
      )}
      {helpOpen && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3" role="dialog" aria-modal="true" aria-labelledby="shortcuts-title">
          <section className="surface w-full max-w-md rounded-2xl p-5 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <h2 id="shortcuts-title" className="text-xl font-bold">Atalhos do teclado</h2>
              <button type="button" className="btn btn-ghost" onClick={() => setHelpOpen(false)} aria-label="Fechar">×</button>
            </div>
            <dl className="space-y-2 text-sm">
              {[["N", "Novo compromisso"], ["T", "Voltar para hoje"], ["← / →", "Navegar pelo período"], ["D", "Visão Dia"], ["S", "Visão Semana"], ["M", "Visão Mês"], ["A", "Visão Ano"], ["Ctrl + F", "Focar na busca"], ["Esc", "Fechar janela ou menu"], ["?", "Abrir esta ajuda"]].map(([key, description]) => (
                <div key={key} className="flex items-center justify-between gap-4 border-b line py-2">
                  <dt className="muted">{description}</dt>
                  <dd><kbd className="agenda-kbd">{key}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
      {(reminderToasts.length > 0 || undoToast || undoCompletionToast) && (
        <div className="fixed bottom-20 right-4 z-[65] flex max-h-[60vh] flex-col gap-2 overflow-y-auto sm:bottom-5" aria-live="assertive">
          {undoToast && (
            <section role="status" className="agenda-reminder-toast">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{undoToast.tipo === "tarefa" ? "Tarefa excluída" : "Compromisso excluído"}</p>
                  <p className="muted mt-0.5 truncate text-xs">{undoToast.titulo}</p>
                </div>
              </div>
              <button type="button" className="agenda-reminder-toast-action mt-3" onClick={() => undoAppointmentDelete(undoToast.id)}>Desfazer</button>
            </section>
          )}
          {undoCompletionToast && (
            <section role="status" className="agenda-reminder-toast">
              <div className="flex items-start gap-3">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{undoCompletionToast.concluido ? "Tarefa reaberta" : "Tarefa concluída"}</p>
                  <p className="muted mt-0.5 truncate text-xs">{undoCompletionToast.titulo}</p>
                </div>
              </div>
              <button type="button" className="agenda-reminder-toast-action mt-3" onClick={() => void undoTaskCompletion(undoCompletionToast)}>Desfazer</button>
            </section>
          )}
          {reminderToasts.map((toast) => (
            <section key={toast.key} role="status" className="agenda-reminder-toast">
              <div className="flex items-start gap-3">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${toast.kind === "overdue" ? "bg-red-500" : "bg-blue-500"}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-bold">{toast.kind === "overdue" ? "Compromisso atrasado" : "Lembrete de compromisso"}</p>
                  <p className="muted mt-0.5 truncate text-xs">{toast.item.titulo}{toast.item.hora_inicio ? ` · ${toast.item.hora_inicio.slice(0, 5)}` : ""}</p>
                </div>
                <button type="button" aria-label="Dispensar aviso" className="muted px-1" onClick={() => setReminderToasts((all) => all.filter((item) => item.key !== toast.key))}>×</button>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {toast.minutes !== null && (
                  <div className="agenda-snooze-root relative">
                    <button
                      type="button"
                      className="agenda-reminder-toast-action"
                      aria-expanded={Boolean(toast.snoozeOpen)}
                      onClick={() => setReminderToasts((all) => all.map((item) => item.key === toast.key ? { ...item, snoozeOpen: !item.snoozeOpen } : item))}
                    >
                      Soneca
                    </button>
                    {toast.snoozeOpen && (
                      <div className="agenda-snooze-menu" role="menu" aria-label="Adiar lembrete">
                        {[5, 10, 30].map((minutes) => (
                          <button key={minutes} type="button" role="menuitem" onClick={() => void snoozeReminderToast(toast, minutes)}>{minutes} min</button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
                <button type="button" className="agenda-reminder-toast-action" onClick={() => void completeReminderToast(toast)}>Concluir</button>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
