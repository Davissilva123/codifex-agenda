"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { appointmentSort, brazilianHolidays, birthdayOn, dateKey, formatDate, MONTHS, monthGrid, occurrenceOn, parseDate, todayInSaoPaulo, WEEKDAYS } from "@/lib/dates";
import type { Appointment, AppointmentKind, Contact, Observation, Phone, Priority, Recurrence } from "@/lib/types";
import { isNetworkError, queueOfflineMutation, readLocalAgenda, readPendingCount, saveLocalAgenda, syncOfflineMutations, type LocalAgendaData, type OfflineTable } from "@/lib/offline";

type View = "day" | "tasks" | "year" | "month" | "contacts";
type Notice = { kind: "success" | "error"; text: string };
const COLORS = ["#6858d8", "#e2537d", "#e68a32", "#238d78", "#3676c8", "#874eaa"];
const PRIORITY_ORDER: Record<Priority, number> = { urgente: 0, alta: 1, normal: 2, baixa: 3 };
const ALERTS = [{ value: "5", label: "5 minutos" }, { value: "10", label: "10 minutos" }, { value: "15", label: "15 minutos" }, { value: "30", label: "30 minutos" }, { value: "60", label: "1 hora" }, { value: "1440", label: "1 dia" }, { value: "none", label: "Nenhum" }];
const EMPTY_APPOINTMENT = {
  titulo: "", data: todayInSaoPaulo(), hora_inicio: "", hora_fim: "", descricao: "", local: "",
  categoria: "Trabalho", cor: COLORS[0], alerta_minutos: "15", recorrencia: "none" as Recurrence,
  tipo: "compromisso" as AppointmentKind, prioridade: "normal" as Priority, cliente: "",
};
const EMPTY_CONTACT = { nome: "", email: "", empresa: "", endereco: "", aniversario: "", observacoes: "", favorito: false };

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Ocorreu um erro inesperado.";
}

function normalizeSearch(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR").trim();
}

function isPhoneRow(value: Record<string, unknown>): value is Record<string, unknown> & Phone & { contato_id: string } {
  return typeof value.contato_id === "string"
    && typeof value.numero === "string"
    && (value.rotulo === "celular" || value.rotulo === "casa" || value.rotulo === "trabalho");
}

function isObservation(value: Record<string, unknown>): value is Record<string, unknown> & Observation {
  return typeof value.id === "string"
    && typeof value.user_id === "string"
    && typeof value.data === "string"
    && typeof value.anotacao === "string";
}

function isAppointment(value: Record<string, unknown>): value is Record<string, unknown> & Appointment {
  return typeof value.id === "string"
    && typeof value.user_id === "string"
    && typeof value.titulo === "string"
    && typeof value.data === "string"
    && (typeof value.hora_inicio === "string" || value.hora_inicio === null)
    && (typeof value.hora_fim === "string" || value.hora_fim === null)
    && typeof value.descricao === "string"
    && typeof value.local === "string"
    && typeof value.categoria === "string"
    && typeof value.cor === "string"
    && (value.tipo === "compromisso" || value.tipo === "tarefa")
    && (value.prioridade === "baixa" || value.prioridade === "normal" || value.prioridade === "alta" || value.prioridade === "urgente")
    && typeof value.cliente === "string"
    && (typeof value.alerta_minutos === "number" || value.alerta_minutos === null)
    && (value.recorrencia === "none" || value.recorrencia === "daily" || value.recorrencia === "weekly" || value.recorrencia === "monthly" || value.recorrencia === "yearly")
    && typeof value.concluido === "boolean"
    && (typeof value.alerta_enviado_em === "string" || value.alerta_enviado_em === null)
    && (typeof value.alerta_enviado_para === "string" || value.alerta_enviado_para === null)
    && (typeof value.adiado_ate === "string" || value.adiado_ate === null)
    && typeof value.created_at === "string";
}

function isContact(value: Record<string, unknown>): value is Record<string, unknown> & Contact {
  return typeof value.id === "string"
    && typeof value.user_id === "string"
    && typeof value.nome === "string"
    && typeof value.email === "string"
    && typeof value.empresa === "string"
    && typeof value.endereco === "string"
    && (typeof value.aniversario === "string" || value.aniversario === null)
    && typeof value.observacoes === "string"
    && typeof value.favorito === "boolean";
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
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"' && quoted && text[i + 1] === '"') { cell += '"'; i++; }
    else if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) { row.push(cell); cell = ""; }
    else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((value) => value.length)) rows.push(row);
      row = [];
      cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("O CSV contém aspas sem fechamento.");
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function formatBrazilianDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function parseBrazilianDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText), month = Number(monthText), year = Number(yearText);
  const date = new Date(year, month - 1, day, 12);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return `${yearText}-${monthText}-${dayText}`;
}

function maskBrazilianDate(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function maskBrazilianTime(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

// Detecta se o app está rodando dentro do Electron (versão desktop).
// No Electron não existe Web Push (FCM), então os lembretes são locais.
function isElectronApp(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent.includes("Electron");
}

function decodeVapidPublicKey(value: string): Uint8Array {
  const key = value.trim();
  if (!key || /^(SUA_CHAVE|YOUR_|<)/i.test(key)) {
    throw new Error("A chave pública VAPID ainda não foi configurada. Gere um par de chaves VAPID e atualize NEXT_PUBLIC_VAPID_PUBLIC_KEY antes de empacotar o aplicativo.");
  }

  try {
    const base64 = key.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = Uint8Array.from(
      atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "=")),
      (char) => char.charCodeAt(0),
    );
    if (decoded.length !== 65 || decoded[0] !== 4) throw new Error("Formato de chave incorreto.");
    return decoded;
  } catch {
    throw new Error("A chave pública VAPID é inválida. Use a chave pública completa gerada com `npx --yes web-push generate-vapid-keys`.");
  }
}

function isBrazilianTime(value: string): boolean {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  return Boolean(match);
}

function BrazilianDateField({ value, onChange, required = false, className = "field mt-1" }: {
  value: string; onChange: (value: string) => void; required?: boolean; className?: string;
}) {
  const [displayValue, setDisplayValue] = useState(() => formatBrazilianDate(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDisplayValue(formatBrazilianDate(value)), [value]);

  function update(value: string) {
    const formatted = maskBrazilianDate(value);
    setDisplayValue(formatted);
    const parsed = parseBrazilianDate(formatted);
    const valid = parsed !== null || (!required && formatted === "");
    inputRef.current?.setCustomValidity(valid ? "" : "Informe uma data válida no formato dd/mm/aaaa.");
    if (parsed) onChange(parsed);
    else if (!formatted && !required) onChange("");
  }

  return <input ref={inputRef} className={className} type="text" inputMode="numeric" autoComplete="off" placeholder="dd/mm/aaaa" value={displayValue} onChange={(event) => update(event.target.value)} onBlur={() => {
    const valid = parseBrazilianDate(displayValue) !== null || (!required && displayValue === "");
    inputRef.current?.setCustomValidity(valid ? "" : "Informe uma data válida no formato dd/mm/aaaa.");
  }} required={required} maxLength={10} aria-label="Data no formato dia/mês/ano" />;
}

function BrazilianTimeField({ value, onChange, className = "field mt-1" }: {
  value: string; onChange: (value: string) => void; className?: string;
}) {
  const [displayValue, setDisplayValue] = useState(value.slice(0, 5));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDisplayValue(value.slice(0, 5)), [value]);

  function update(value: string) {
    const formatted = maskBrazilianTime(value);
    setDisplayValue(formatted);
    const valid = !formatted || isBrazilianTime(formatted);
    inputRef.current?.setCustomValidity(valid ? "" : "Informe um horário válido no formato 24 horas, HH:mm.");
    onChange(valid ? formatted : "");
  }

  return <input ref={inputRef} className={className} type="text" inputMode="numeric" autoComplete="off" placeholder="HH:mm" value={displayValue} onChange={(event) => update(event.target.value)} onBlur={() => {
    const valid = !displayValue || isBrazilianTime(displayValue);
    inputRef.current?.setCustomValidity(valid ? "" : "Informe um horário válido no formato 24 horas, HH:mm.");
  }} maxLength={5} aria-label="Horário no formato 24 horas" />;
}

function CalendarMonth({ year, month, maxYear, appointments, contacts, observations, selected, onSelect, compact = false }: {
  year: number; month: number; maxYear: number;
  appointments: Appointment[]; contacts: Contact[];
  observations: Record<string, string>; selected: string; onSelect: (date: string) => void; compact?: boolean;
}) {
  const holidayMap = useMemo(() => brazilianHolidays(year), [year]);
  const days = monthGrid(year, month);
  const today = todayInSaoPaulo();
  return (
    <section className={compact ? "min-w-0" : "card p-3 sm:p-5"}>
      {!compact && <div className="mb-3 text-center font-semibold">{MONTHS[month]}</div>}
      <div className="grid grid-cols-7 text-center">
        {WEEKDAYS.map((day) => <div key={day} className="muted py-1 text-[10px] font-semibold sm:text-xs">{day}</div>)}
        {days.map((day) => {
          const key = dateKey(day);
          const sameMonth = day.getMonth() === month;
          const available = Number(key.slice(0, 4)) <= maxYear;
          const events = appointments.some((a) => a.tipo !== "tarefa" && occurrenceOn(a, key));
          const tasks = appointments.some((a) => a.tipo === "tarefa" && occurrenceOn(a, key));
          const birthday = contacts.some((c) => birthdayOn(c, key));
          const note = Boolean(observations[key]?.trim());
          const holiday = holidayMap.get(key);
          return (
            <button key={key} type="button" disabled={!available} onClick={() => onSelect(key)}
              aria-label={`${formatDate(key)}${holiday ? `, ${holiday}` : ""}${events ? ", compromisso" : ""}${tasks ? ", tarefa" : ""}${note ? ", observação" : ""}${birthday ? ", aniversário" : ""}`}
              className={`calendar-day relative flex w-full flex-col items-center justify-start rounded-lg p-1 text-xs transition hover:bg-violet-50 sm:p-2 sm:text-sm ${!sameMonth ? "muted opacity-40" : ""} ${!available ? "cursor-not-allowed opacity-30" : ""} ${key === selected ? "bg-violet-100 text-violet-900 dark:bg-violet-950 dark:text-violet-100" : ""} ${key === today ? "font-bold ring-2 ring-violet-500 ring-inset" : ""}`}>
              <span>{day.getDate()}</span>
              <span className="mt-1 flex h-1.5 items-center gap-0.5">
                {holiday && <i title={holiday} className="h-1.5 w-1.5 rounded-full bg-red-500" />}
                {events && <i title="Compromisso" className="h-1.5 w-1.5 rounded-full bg-blue-600" />}
                {tasks && <i title="Tarefa" className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}
                {birthday && <i title="Aniversário" className="h-1.5 w-1.5 rounded-full bg-pink-500" />}
                {note && <i title="Observação" className="h-1.5 w-1.5 rounded-full bg-amber-500" />}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function AppointmentForm({ initial, onSave, onClose, busy }: {
  initial: typeof EMPTY_APPOINTMENT & { id?: string }; onSave: (values: typeof EMPTY_APPOINTMENT, id?: string) => Promise<void>;
  onClose: () => void; busy: boolean;
}) {
  const [values, setValues] = useState(initial);
  const [error, setError] = useState("");
  function set<K extends keyof typeof EMPTY_APPOINTMENT>(key: K, value: (typeof EMPTY_APPOINTMENT)[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!values.titulo.trim()) { setError("Informe o título do compromisso."); return; }
    if (values.hora_inicio && values.hora_fim && values.hora_fim <= values.hora_inicio) { setError("A hora de término deve ser posterior à hora de início."); return; }
    if (values.alerta_minutos !== "none" && !values.hora_inicio) { setError("Informe a hora de início para configurar um alerta."); return; }
    try { await onSave(values, initial.id); }
    catch (failure) { setError(messageOf(failure)); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true" aria-labelledby="event-title">
      <form onSubmit={submit} className="surface max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex items-center justify-between"><h2 id="event-title" className="text-xl font-bold">{initial.id ? "Editar item" : values.tipo === "tarefa" ? "Nova tarefa" : "Novo compromisso"}</h2><button type="button" onClick={onClose} className="btn btn-ghost" aria-label="Fechar">✕</button></div>
        <div className="mb-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">O que você vai fazer?<select className="field mt-1" value={values.tipo} onChange={(e) => {
            const tipo = e.target.value as AppointmentKind;
            set("tipo", tipo);
            if (tipo === "tarefa" && !values.hora_inicio) set("alerta_minutos", "none");
            else if (tipo === "compromisso" && values.alerta_minutos === "none") set("alerta_minutos", "15");
          }}><option value="compromisso">Compromisso / reunião</option><option value="tarefa">Tarefa / prazo</option></select></label>
          <label className="text-sm font-medium">Prioridade<select className="field mt-1" value={values.prioridade} onChange={(e) => set("prioridade", e.target.value as Priority)}><option value="urgente">🔴 Urgente</option><option value="alta">🟠 Alta</option><option value="normal">🔵 Normal</option><option value="baixa">⚪ Baixa</option></select></label>
        </div>
        <label className="mb-3 block text-sm font-medium">{values.tipo === "tarefa" ? "Tarefa" : "Assunto"} *<input autoFocus className="field mt-1" value={values.titulo} maxLength={200} placeholder={values.tipo === "tarefa" ? "Ex.: Enviar proposta ao cliente" : "Ex.: Reunião de alinhamento"} onChange={(e) => set("titulo", e.target.value)} required /></label>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="text-sm font-medium">{values.tipo === "tarefa" ? "Prazo" : "Data"}<BrazilianDateField value={values.data} onChange={(value) => set("data", value)} required /></label>
          <label className="text-sm font-medium">Início<BrazilianTimeField value={values.hora_inicio} onChange={(value) => set("hora_inicio", value)} /></label>
          <label className="text-sm font-medium">Término<BrazilianTimeField value={values.hora_fim} onChange={(value) => set("hora_fim", value)} /></label>
        </div>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Área / categoria<input className="field mt-1" value={values.categoria} maxLength={60} placeholder="Ex.: Financeiro, Comercial, Administrativo" onChange={(e) => set("categoria", e.target.value)} /></label>
          <label className="text-sm font-medium">Alerta<select className="field mt-1" value={values.alerta_minutos} onChange={(e) => set("alerta_minutos", e.target.value)}>{ALERTS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}</select></label>
        </div>
        <label className="mt-3 block text-sm font-medium">Cliente / projeto<input className="field mt-1" value={values.cliente} maxLength={200} placeholder="Opcional" onChange={(e) => set("cliente", e.target.value)} /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">Repetição<select className="field mt-1" value={values.recorrencia} onChange={(e) => set("recorrencia", e.target.value as Recurrence)}><option value="none">Não repetir</option><option value="daily">Diária</option><option value="weekly">Semanal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
          <label className="text-sm font-medium">Local<input className="field mt-1" value={values.local} maxLength={200} onChange={(e) => set("local", e.target.value)} /></label>
        </div>
        <div className="mt-3"><span className="text-sm font-medium">Cor</span><div className="mt-2 flex gap-2">{COLORS.map((color) => <button key={color} type="button" aria-label={`Cor ${color}`} onClick={() => set("cor", color)} className={`h-7 w-7 rounded-full ${values.cor === color ? "ring-2 ring-offset-2 ring-violet-600" : ""}`} style={{ backgroundColor: color }} />)}</div></div>
        <label className="mt-3 block text-sm font-medium">Descrição<textarea className="field mt-1 min-h-20" maxLength={4000} value={values.descricao} onChange={(e) => set("descricao", e.target.value)} /></label>
        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" onClick={onClose} className="btn btn-ghost">Cancelar</button><button disabled={busy} className="btn btn-primary">{busy ? "Salvando..." : "Salvar"}</button></div>
      </form>
    </div>
  );
}

function ContactForm({ initial, onSave, onClose, busy }: {
  initial: Contact | null; onSave: (values: typeof EMPTY_CONTACT, phones: Phone[], id?: string) => Promise<void>;
  onClose: () => void; busy: boolean;
}) {
  const [values, setValues] = useState(initial ? {
    nome: initial.nome, email: initial.email, empresa: initial.empresa, endereco: initial.endereco,
    aniversario: initial.aniversario || "", observacoes: initial.observacoes, favorito: initial.favorito,
  } : EMPTY_CONTACT);
  const [phones, setPhones] = useState<Phone[]>(initial?.telefones?.length ? initial.telefones : [{ numero: "", rotulo: "celular" }]);
  const [error, setError] = useState("");
  async function submit(event: FormEvent) {
    event.preventDefault();
    const validPhones = phones.filter((phone) => phone.numero.trim());
    try { await onSave(values, validPhones, initial?.id); }
    catch (failure) { setError(messageOf(failure)); }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true">
      <form onSubmit={submit} className="surface max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-7">
        <div className="mb-5 flex justify-between"><h2 className="text-xl font-bold">{initial ? "Editar contato" : "Novo contato"}</h2><button type="button" onClick={onClose} className="btn btn-ghost">✕</button></div>
        <label className="block text-sm font-medium">Nome *<input className="field mt-1" autoFocus required maxLength={200} value={values.nome} onChange={(e) => setValues({ ...values, nome: e.target.value })} /></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">E-mail<input className="field mt-1" type="email" value={values.email} onChange={(e) => setValues({ ...values, email: e.target.value })} /></label>
          <label className="text-sm font-medium">Empresa<input className="field mt-1" value={values.empresa} onChange={(e) => setValues({ ...values, empresa: e.target.value })} /></label>
          <label className="text-sm font-medium">Aniversário<BrazilianDateField value={values.aniversario} onChange={(aniversario) => setValues((current) => ({ ...current, aniversario }))} /></label>
          <label className="text-sm font-medium">Endereço<input className="field mt-1" value={values.endereco} onChange={(e) => setValues({ ...values, endereco: e.target.value })} /></label>
        </div>
        <div className="mt-4"><div className="mb-2 flex items-center justify-between text-sm font-medium">Telefones<button type="button" className="btn btn-ghost px-2 py-1 text-sm" onClick={() => setPhones([...phones, { numero: "", rotulo: "celular" }])}>+ Adicionar</button></div>
          {phones.map((phone, index) => <div key={index} className="mb-2 flex gap-2"><input className="field" placeholder="Número" value={phone.numero} onChange={(e) => setPhones(phones.map((p, i) => i === index ? { ...p, numero: e.target.value } : p))} /><select className="field max-w-36" value={phone.rotulo} onChange={(e) => setPhones(phones.map((p, i) => i === index ? { ...p, rotulo: e.target.value as Phone["rotulo"] } : p))}><option value="celular">Celular</option><option value="casa">Casa</option><option value="trabalho">Trabalho</option></select>{phones.length > 1 && <button type="button" aria-label="Remover telefone" className="btn btn-ghost" onClick={() => setPhones(phones.filter((_, i) => i !== index))}>✕</button>}</div>)}
        </div>
        <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={values.favorito} onChange={(e) => setValues({ ...values, favorito: e.target.checked })} />Favorito</label>
        <label className="mt-3 block text-sm font-medium">Observações<textarea className="field mt-1 min-h-20" value={values.observacoes} onChange={(e) => setValues({ ...values, observacoes: e.target.value })} /></label>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <div className="mt-5 flex justify-end gap-2"><button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button><button disabled={busy} className="btn btn-primary">{busy ? "Salvando..." : "Salvar contato"}</button></div>
      </form>
    </div>
  );
}

function PriorityPill({ priority }: { priority: Priority }) {
  const styles: Record<Priority, string> = {
    urgente: "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-200",
    alta: "bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-200",
    normal: "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-200",
    baixa: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300",
  };
  const labels: Record<Priority, string> = { urgente: "Urgente", alta: "Alta", normal: "Normal", baixa: "Baixa" };
  return <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${styles[priority || "normal"]}`}>{labels[priority || "normal"]}</span>;
}

function WorkItem({ item, onComplete, onEdit, onDelete, showDate = false }: {
  item: Appointment; onComplete: (item: Appointment) => void; onEdit: (item: Appointment) => void;
  onDelete?: (item: Appointment) => void; showDate?: boolean;
}) {
  const overdue = showDate && item.data < todayInSaoPaulo() && item.recorrencia === "none" && !item.concluido;
  return (
    <article className={`rounded-xl border line p-3 transition-shadow hover:shadow-md ${item.concluido ? "opacity-50" : ""}`}>
      <div className="flex items-start gap-3">
        <input type="checkbox" aria-label="Marcar como concluído" checked={item.concluido} onChange={() => onComplete(item)} className="mt-1 h-4 w-4 accent-blue-700" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong className={`text-sm ${item.concluido ? "line-through" : ""}`}>{item.titulo}</strong>
            <PriorityPill priority={item.prioridade || "normal"} />
          </div>
          <div className="muted mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
            {showDate && <span className={overdue ? "font-semibold text-red-600" : ""}>{overdue ? "Atrasada · " : "Prazo · "}{formatDate(item.data)}</span>}
            {item.hora_inicio && <span>{item.hora_inicio.slice(0, 5)}{item.hora_fim ? `–${item.hora_fim.slice(0, 5)}` : ""}</span>}
            <span>{item.categoria}</span>
            {item.cliente && <span>Cliente: {item.cliente}</span>}
            {item.local && <span>{item.local}</span>}
          </div>
          {item.descricao && <p className="muted mt-2 whitespace-pre-wrap break-words text-sm"><span className="font-semibold">Descrição: </span>{item.descricao}</p>}
        </div>
        <div className="flex items-center gap-1"><button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => onEdit(item)}>Editar</button>{onDelete && <button type="button" aria-label={`Excluir ${item.tipo === "tarefa" ? "tarefa" : "compromisso"} ${item.titulo}`} className="btn btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => onDelete(item)}>Excluir</button>}</div>
      </div>
    </article>
  );
}

export default function Home() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [authRetry, setAuthRetry] = useState(0);
  const [authMode, setAuthMode] = useState<"login" | "signup">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [authError, setAuthError] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [observations, setObservations] = useState<Record<string, string>>({});
  const [dataLoaded, setDataLoaded] = useState(false);
  const [view, setView] = useState<View>("day");
  const [selectedDate, setSelectedDate] = useState(todayInSaoPaulo());
  const [shownYear, setShownYear] = useState(parseDate(todayInSaoPaulo()).getFullYear());
  const [shownMonth, setShownMonth] = useState(parseDate(todayInSaoPaulo()).getMonth());
  const [appointmentForm, setAppointmentForm] = useState<(typeof EMPTY_APPOINTMENT & { id?: string }) | null>(null);
  const [contactForm, setContactForm] = useState<Contact | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [search, setSearch] = useState("");
  const [contactLetter, setContactLetter] = useState("");
  const [taskFilter, setTaskFilter] = useState<"open" | "completed" | "all">("open");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [pushEnabled, setPushEnabled] = useState(false);
  const [localAlerts, setLocalAlerts] = useState(false);
  const [pushBusy, setPushBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<Event | null>(null);
  const [savingNote, setSavingNote] = useState(false);
  const [isOnline, setIsOnline] = useState(true);
  const [pendingSync, setPendingSync] = useState(0);
  const [generatedYear, setGeneratedYear] = useState(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const localSent = useRef(new Set<string>());
  const currentYear = parseDate(todayInSaoPaulo()).getFullYear();
  const yearLimit = Math.max(currentYear, generatedYear);

  const showDate = useCallback((value: string) => {
    setSelectedDate(value);
    setShownYear(parseDate(value).getFullYear());
    setShownMonth(parseDate(value).getMonth());
  }, []);

  const notify = useCallback((text: string, kind: Notice["kind"] = "success") => {
    setNotice({ text, kind });
    window.setTimeout(() => setNotice(null), 4500);
  }, []);

  const runMutation = useCallback(async (table: OfflineTable, operation: "insert" | "update" | "delete" | "upsert", record?: Record<string, unknown>, filters?: Record<string, string>) => {
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
    if (operation === "insert") {
      let query = supabase.from(table).insert(record || {});
      for (const [column, value] of entries) query = query.eq(column, value);
      mutationError = (await query).error?.message || null;
    } else if (operation === "upsert") {
      let query = supabase.from(table).upsert(record || {}, { onConflict: "user_id,data" });
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
    if (mutationError) {
      const error = new Error(mutationError);
      if (!isNetworkError(error)) throw error;
      queueOfflineMutation(session.user.id, mutation);
      setPendingSync(readPendingCount(session.user.id));
      setIsOnline(false);
    }
  }, [session]);

  const loadData = useCallback(async () => {
    const supabase = getSupabase();
    const userId = session?.user.id;
    if (!userId) return;
    const local = readLocalAgenda(userId);
    const hydrate = (data: LocalAgendaData) => {
      const phoneRows = data.telefones.filter(isPhoneRow);
      const notes: Record<string, string> = {};
      const validAppointments = data.agendamentos.filter(isAppointment);
      const validContacts = data.contatos.filter(isContact);
      const validObservations = data.observacoes.filter(isObservation);
      const invalidRecordCount = data.agendamentos.length - validAppointments.length
        + data.contatos.length - validContacts.length
        + data.observacoes.length - validObservations.length
        + data.telefones.length - phoneRows.length;
      if (invalidRecordCount) {
        console.warn(`A cópia local da agenda contém ${invalidRecordCount} registro(s) inválido(s); esses registros foram ignorados.`);
      }
      for (const note of validObservations) notes[note.data] = note.anotacao;
      setAppointments(validAppointments);
      setContacts(validContacts.map((contact) => ({
        ...contact,
        telefones: phoneRows.filter((phone) => phone.contato_id === contact.id),
      })));
      setObservations(notes);
      setDataLoaded(true);
    };
    hydrate(local);
    setPendingSync(readPendingCount(userId));
    if (!navigator.onLine) return;
    try {
      await syncOfflineMutations(userId, supabase);
      const [eventsResult, contactsResult, notesResult] = await Promise.all([
        supabase.from("agendamentos").select("*").order("data").order("hora_inicio"),
        supabase.from("contatos").select("*").order("nome"),
        supabase.from("observacoes").select("*"),
      ]);
      const error = eventsResult.error || contactsResult.error || notesResult.error;
      if (error) throw error;
      const contactRows = (contactsResult.data || []) as Contact[];
      let phoneRows: (Phone & { contato_id: string })[] = [];
      if (contactRows.length) {
        const { data, error: phoneError } = await supabase.from("telefones").select("id,contato_id,numero,rotulo").in("contato_id", contactRows.map((contact) => contact.id));
        if (phoneError) throw phoneError;
        phoneRows = (data || []) as (Phone & { contato_id: string })[];
      }
      const next: LocalAgendaData = {
        agendamentos: (eventsResult.data || []) as unknown as Record<string, unknown>[],
        contatos: contactRows as unknown as Record<string, unknown>[],
        telefones: phoneRows as unknown as Record<string, unknown>[],
        observacoes: (notesResult.data || []) as unknown as Record<string, unknown>[],
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
      supabase.auth.getSession().then(({ data, error }) => {
        if (!active) return;
        if (timeout) window.clearTimeout(timeout);
        if (error) setAuthError(`Não foi possível verificar sua sessão: ${error.message}`);
        else setAuthError("");
        if (active) { setSession(data.session); setAuthReady(true); }
      }).catch((error: unknown) => {
        if (!active) return;
        if (timeout) window.clearTimeout(timeout);
        setAuthError(`Não foi possível verificar sua sessão: ${messageOf(error)}`);
        setAuthReady(true);
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        setSession(nextSession);
        if (nextSession) setDataLoaded(false);
        else { setAppointments([]); setContacts([]); setObservations({}); setDataLoaded(false); }
      });
      if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch((error: unknown) => notify(`Não foi possível registrar o service worker: ${messageOf(error)}`, "error"));
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
      const phoneRows = contacts.flatMap((contact) => (contact.telefones || []).map((phone) => ({
        ...phone,
        contato_id: contact.id,
        user_id: session.user.id,
      })));
      const snapshot: LocalAgendaData = {
        agendamentos: appointments as unknown as Record<string, unknown>[],
        contatos: contacts.map(({ telefones: _phones, ...contact }) => contact) as unknown as Record<string, unknown>[],
        telefones: phoneRows as unknown as Record<string, unknown>[],
        observacoes: Object.entries(observations).map(([data, anotacao]) => ({
          user_id: session.user.id,
          data,
          anotacao,
        })),
      };
      saveLocalAgenda(session.user.id, snapshot);
    } catch (error) {
      notify(`Não foi possível guardar a cópia offline: ${messageOf(error)}`, "error");
    }
  }, [session, dataLoaded, appointments, contacts, observations, notify]);

  useEffect(() => {
    if (!session) return;
    loadData().catch((error: unknown) => notify(messageOf(error), "error"));
    if (isElectronApp()) {
      // Desktop (Electron): não há Web Push; usa lembretes locais
      setLocalAlerts(
        typeof Notification !== "undefined"
        && Notification.permission === "granted"
        && localStorage.getItem("minha-agenda-local-alerts") === "1",
      );
      return;
    }
    navigator.serviceWorker?.ready.then(async (registration) => {
      const subscription = await registration.pushManager.getSubscription();
      setPushEnabled(Boolean(subscription));
    }).catch((error: unknown) => notify(messageOf(error), "error"));
  }, [session, loadData, notify]);

  useEffect(() => {
    const stored = localStorage.getItem("minha-agenda-theme");
    const initial = stored === "dark" ? "dark" : "light";
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    document.body.classList.toggle("dark", initial === "dark");
    const handler = (event: Event) => { event.preventDefault(); setInstallPrompt(event); };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
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
    function shortcuts(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === "n") {
        event.preventDefault();
        setAppointmentForm({ ...EMPTY_APPOINTMENT, data: view === "year" || view === "month" || view === "day" || view === "contacts" ? selectedDate : today, ...(view === "tasks" ? { tipo: "tarefa" as const, alerta_minutos: "none" } : {}) });
      }
      if (event.ctrlKey && event.key.toLowerCase() === "f") { event.preventDefault(); searchRef.current?.focus(); }
      if (isEditable(event.target)) return;
      if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const step = event.key === "ArrowLeft" ? -1 : 1;
        if (view === "day") {
          const next = new Date(`${selectedDate}T12:00:00`);
          next.setDate(next.getDate() + step);
          if (next.getFullYear() <= yearLimit) showDate(dateKey(next));
        } else {
          const next = new Date(shownYear, shownMonth + step, 1, 12);
          if (next.getFullYear() <= yearLimit) {
            setShownYear(next.getFullYear()); setShownMonth(next.getMonth());
            if (view !== "year") setView("month");
          }
        }
      }
    }
    window.addEventListener("keydown", shortcuts);
    return () => window.removeEventListener("keydown", shortcuts);
  }, [shownMonth, shownYear, selectedDate, view, currentYear, yearLimit, showDate]);

  useEffect(() => {
    if (!session) return;
    const snoozeId = new URLSearchParams(window.location.search).get("snooze");
    if (!snoozeId) return;
    const snooze = async () => {
      await runMutation("agendamentos", "update", { adiado_ate: new Date(Date.now() + 5 * 60000).toISOString() }, { id: snoozeId });
      notify(navigator.onLine ? "Lembrete adiado por 5 minutos." : "Adiamento salvo; será sincronizado quando a internet voltar.");
      window.history.replaceState({}, "", window.location.pathname);
    };
    snooze().catch((error: unknown) => notify(messageOf(error), "error"));
  }, [session, notify, runMutation]);

  useEffect(() => {
    if (!session || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const electron = isElectronApp();
    // No Electron só roda se o usuário ativou os lembretes locais; no navegador só roda se o push não está ativo
    if (electron ? !localAlerts : pushEnabled) return;
    const check = () => {
      // No Electron o alerta deve funcionar mesmo com a janela minimizada/na bandeja
      if (!electron && document.visibilityState !== "visible") return;
      const now = new Date();
      for (const item of appointments) {
        if (item.concluido || item.alerta_minutos === null || !item.hora_inicio) continue;
        const date = todayInSaoPaulo();
        if (!occurrenceOn(item, date)) continue;
        const [h, m] = item.hora_inicio.split(":").map(Number);
        const reminder = new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00-03:00`);
        reminder.setTime(reminder.getTime() - item.alerta_minutos * 60000);
        const key = `${item.id}-${date}`;
        if (now >= reminder && now.getTime() - reminder.getTime() < 60000 && !localSent.current.has(key)) {
          new Notification("Lembrete: CODIFEX AGENDAS", { body: `${item.titulo}${item.hora_inicio ? ` • ${item.hora_inicio.slice(0, 5)}` : ""}`, icon: "/icon.png" });
          localSent.current.add(key);
        }
      }
      for (const contact of contacts) {
        const key = `birthday-${contact.id}-${today}`;
        if (birthdayOn(contact, today) && !localSent.current.has(key)) {
          new Notification("Aniversário: CODIFEX AGENDAS", { body: `Hoje é aniversário de ${contact.nome}.`, icon: "/icon.png" });
          localSent.current.add(key);
        }
      }
    };
    check();
    const timer = window.setInterval(check, 30000);
    return () => window.clearInterval(timer);
  }, [session, appointments, contacts, pushEnabled, localAlerts]);

  useEffect(() => {
    if (!session || !dataLoaded) return;
    setSavingNote(true);
    const timer = window.setTimeout(async () => {
      try {
        const value = observations[selectedDate] || "";
        if (value.trim()) {
          await runMutation("observacoes", "upsert", { user_id: session.user.id, data: selectedDate, anotacao: value });
        } else {
          await runMutation("observacoes", "delete", undefined, { data: selectedDate, user_id: session.user.id });
        }
      } catch (error) { notify(`Falha ao salvar observação: ${messageOf(error)}`, "error"); }
      finally { setSavingNote(false); }
    }, 700);
    return () => window.clearTimeout(timer);
  }, [observations, selectedDate, session, notify, dataLoaded, runMutation]);

  async function authenticate(event: FormEvent) {
    event.preventDefault(); setAuthBusy(true); setAuthError("");
    try {
      const supabase = getSupabase();
      const result = authMode === "login"
        ? await supabase.auth.signInWithPassword({ email: email.trim(), password })
        : await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
      if (result.error) throw result.error;
      if (authMode === "signup" && !result.data.session) setAuthError("Conta criada. Confirme seu e-mail para entrar.");
    } catch (error) { setAuthError(messageOf(error)); }
    finally { setAuthBusy(false); }
  }

  async function saveAppointment(values: typeof EMPTY_APPOINTMENT, id?: string) {
    setBusy(true);
    try {
      const appointmentId = id || crypto.randomUUID();
      const record = {
        id: appointmentId,
        user_id: session!.user.id,
        titulo: values.titulo.trim(), data: values.data, hora_inicio: values.hora_inicio || null,
        hora_fim: values.hora_fim || null, descricao: values.descricao, local: values.local,
        categoria: values.categoria, cor: values.cor, tipo: values.tipo, prioridade: values.prioridade,
        cliente: values.cliente.trim(),
        alerta_minutos: values.alerta_minutos === "none" ? null : Number(values.alerta_minutos),
        recorrencia: values.recorrencia, alerta_enviado_em: null, alerta_enviado_para: null, adiado_ate: null,
      };
      const { id: _id, user_id: _userId, ...updates } = record;
      if (id) await runMutation("agendamentos", "update", updates, { id });
      else await runMutation("agendamentos", "insert", record);
      setAppointments((all) => id
        ? all.map((item) => item.id === id ? { ...item, ...updates } : item)
        : [...all, { ...record, concluido: false, created_at: new Date().toISOString() } as Appointment]);
      setAppointmentForm(null);
      notify(navigator.onLine ? "Item salvo." : "Salvo neste dispositivo. Será sincronizado quando a internet voltar.");
    } catch (error) { notify(messageOf(error), "error"); throw error; }
    finally { setBusy(false); }
  }

  async function toggleComplete(item: Appointment) {
    try {
      await runMutation("agendamentos", "update", { concluido: !item.concluido }, { id: item.id });
      setAppointments((all) => all.map((event) => event.id === item.id ? { ...event, concluido: !event.concluido } : event));
      notify(item.concluido ? "Item reaberto." : "Item concluído.");
    } catch (error) { notify(messageOf(error), "error"); }
  }

  async function deleteAppointment(item: Appointment) {
    if (!window.confirm(`Excluir "${item.titulo}"?`)) return;
    try {
      await runMutation("agendamentos", "delete", undefined, { id: item.id });
      setAppointments((all) => all.filter((event) => event.id !== item.id));
      notify("Item excluído.");
    } catch (error) { notify(messageOf(error), "error"); }
  }

  async function saveContact(values: typeof EMPTY_CONTACT, phones: Phone[], id?: string) {
    setBusy(true);
    try {
      const contactId = id || crypto.randomUUID();
      const record = { id: contactId, ...values, nome: values.nome.trim(), aniversario: values.aniversario || null, user_id: session!.user.id };
      const { id: _id, user_id: _userId, ...updates } = record;
      if (id) await runMutation("contatos", "update", updates, { id });
      else await runMutation("contatos", "insert", record);
      if (id) {
        await runMutation("telefones", "delete", undefined, { contato_id: contactId, user_id: session!.user.id });
      }
      if (phones.length) {
        const phoneRecords = phones.map((phone) => ({ ...phone, id: phone.id || crypto.randomUUID(), contato_id: contactId, user_id: session!.user.id }));
        await runMutation("telefones", "insert", phoneRecords as unknown as Record<string, unknown>);
        const updatedContact = { ...record, telefones: phoneRecords };
        setContacts((all) => id ? all.map((contact) => contact.id === id ? updatedContact : contact) : [...all, updatedContact]);
      } else {
        const updatedContact = { ...record, telefones: [] };
        setContacts((all) => id ? all.map((contact) => contact.id === id ? updatedContact : contact) : [...all, updatedContact]);
      }
      setContactForm(undefined);
      notify(navigator.onLine ? "Contato salvo." : "Contato salvo neste dispositivo; será sincronizado quando a internet voltar.");
    } catch (error) { notify(messageOf(error), "error"); throw error; }
    finally { setBusy(false); }
  }

  async function deleteContact(contact: Contact) {
    if (!window.confirm(`Excluir o contato ${contact.nome}?`)) return;
    try {
      await runMutation("contatos", "delete", undefined, { id: contact.id });
      setContacts((all) => all.filter((item) => item.id !== contact.id));
      notify("Contato excluído.");
    } catch (error) { notify(messageOf(error), "error"); }
  }

  async function toggleFavorite(contact: Contact) {
    try {
      await runMutation("contatos", "update", { favorito: !contact.favorito }, { id: contact.id });
      setContacts((all) => all.map((item) => item.id === contact.id ? { ...item, favorito: !item.favorito } : item));
    } catch (error) { notify(messageOf(error), "error"); }
  }

  async function enablePush() {
    setPushBusy(true);
    try {
      // Desktop (Electron): lembretes locais, sem Web Push
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
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("Este navegador não oferece suporte a notificações push.");
      const applicationServerKey = decodeVapidPublicKey(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "");
      const permission = await Notification.requestPermission();
      if (permission !== "granted") throw new Error("Permissão de notificações não concedida.");
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey as BufferSource });
      const { error } = await getSupabase().from("push_subscriptions").upsert({
        user_id: session!.user.id, endpoint: subscription.endpoint, subscription: subscription.toJSON(), user_agent: navigator.userAgent,
      }, { onConflict: "endpoint" });
      if (error) throw error;
      setPushEnabled(true); notify("Notificações ativadas neste dispositivo.");
    } catch (error) { notify(messageOf(error), "error"); }
    finally { setPushBusy(false); }
  }

  async function disablePush() {
    setPushBusy(true);
    try {
      // Desktop (Electron): desliga os lembretes locais
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
      setPushEnabled(false); notify("Notificações desativadas neste dispositivo.");
    } catch (error) { notify(messageOf(error), "error"); }
    finally { setPushBusy(false); }
  }

  async function exportBackup() {
    download(`codifex-agendas-backup-${todayInSaoPaulo()}.json`, JSON.stringify({
      exportado_em: new Date().toISOString(), fuso: "America/Sao_Paulo",
      agendamentos: appointments, observacoes: Object.entries(observations).map(([data, anotacao]) => ({ data, anotacao })),
      contatos: contacts, telefones: contacts.flatMap((contact) => (contact.telefones || []).map((phone) => ({ ...phone, contato_id: contact.id }))),
    }, null, 2), "application/json;charset=utf-8");
  }

  function exportContacts() {
    const rows = [["nome", "telefones", "email", "empresa", "endereco", "aniversario", "observacoes"]];
    for (const contact of contacts) rows.push([contact.nome, (contact.telefones || []).map((p) => `${p.rotulo}:${p.numero}`).join(" | "), contact.email, contact.empresa, contact.endereco, contact.aniversario || "", contact.observacoes]);
    download("contatos.csv", `\uFEFF${rows.map((row) => row.map(escapeCsv).join(",")).join("\r\n")}`, "text/csv;charset=utf-8");
  }

  async function importContacts(file: File) {
    try {
      const text = (await file.text()).replace(/^\uFEFF/, "");
      const rows = parseCsv(text);
      if (rows.length < 2) throw new Error("O CSV precisa conter cabeçalho e pelo menos um contato.");
      const headers = rows[0].map((value) => value.trim().toLowerCase());
      const nameIndex = headers.indexOf("nome");
      if (nameIndex < 0) throw new Error("A coluna obrigatória 'nome' não foi encontrada.");
      const records = rows.slice(1).map((row) => {
        const get = (column: string) => row[headers.indexOf(column)] || "";
        return {
          nome: row[nameIndex]?.trim(), email: get("email"), empresa: get("empresa"),
          endereco: get("endereco"), aniversario: get("aniversario") || null,
          observacoes: get("observacoes"), favorito: false, user_id: session!.user.id,
          telefones: get("telefones").split(" | ").filter(Boolean).map((entry) => {
            const separator = entry.indexOf(":");
            const rotulo = separator >= 0 ? entry.slice(0, separator).trim().toLowerCase() : "celular";
            const numero = separator >= 0 ? entry.slice(separator + 1).trim() : entry.trim();
            return { numero, rotulo: (["celular", "casa", "trabalho"].includes(rotulo) ? rotulo : "celular") as Phone["rotulo"] };
          }).filter((phone) => phone.numero),
        };
      }).filter((record) => record.nome);
      if (!records.length) throw new Error("Nenhum contato válido foi encontrado.");
      for (const record of records) {
        const { telefones, ...contact } = record;
        const contactId = crypto.randomUUID();
        await runMutation("contatos", "insert", { ...contact, id: contactId });
        if (telefones.length) {
          const phoneRecords = telefones.map((phone) => ({ ...phone, id: crypto.randomUUID(), contato_id: contactId, user_id: session!.user.id }));
          await runMutation("telefones", "insert", phoneRecords as unknown as Record<string, unknown>);
        }
        setContacts((all) => [...all, { ...contact, id: contactId, telefones: telefones.map((phone) => ({ ...phone, id: crypto.randomUUID() })) } as Contact]);
      }
      notify(`${records.length} contato(s) importado(s).${navigator.onLine ? "" : " Serão sincronizados quando a internet voltar."}`);
    } catch (error) { notify(messageOf(error), "error"); }
  }

  function changeTheme() {
    const next = theme === "light" ? "dark" : "light";
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
  const filteredAppointments = useMemo(() => appointments.filter((item) =>
    normalizeSearch(`${item.titulo} ${item.descricao} ${item.local} ${item.categoria} ${item.cliente} ${item.prioridade} ${item.tipo} ${formatBrazilianDate(item.data)}`).includes(searchTerm)), [appointments, searchTerm]);
  const filteredContacts = useMemo(() => contacts.filter((contact) =>
    normalizeSearch(`${contact.nome} ${contact.email} ${contact.empresa} ${contact.endereco} ${contact.observacoes} ${contact.aniversario ? formatBrazilianDate(contact.aniversario) : ""} ${(contact.telefones || []).map((phone) => `${phone.rotulo} ${phone.numero}`).join(" ")}`).includes(searchTerm)), [contacts, searchTerm]);
  const displayedContacts = useMemo(() => filteredContacts.filter((contact) => !contactLetter || contact.nome.trim().toLocaleUpperCase("pt-BR").startsWith(contactLetter)), [filteredContacts, contactLetter]);
  const filteredNotes = useMemo(() => Object.entries(observations).filter(([date, note]) => note.trim() &&
    normalizeSearch(`${formatBrazilianDate(date)} ${note}`).includes(searchTerm)), [observations, searchTerm]);
  const selectedEvents = filteredAppointments.filter((item) => occurrenceOn(item, selectedDate)).sort(appointmentSort);
  const today = todayInSaoPaulo();
  const taskItems = filteredAppointments.filter((item) => item.tipo === "tarefa" && Number(item.data.slice(0, 4)) === shownYear);
  const archivedYears = [...new Set([
    yearLimit,
    currentYear,
    currentYear - 1,
    ...appointments.map((item) => Number(item.data.slice(0, 4))),
    ...Object.keys(observations).map((date) => Number(date.slice(0, 4))),
  ])].filter((year) => year <= yearLimit && year >= 1900).sort((a, b) => b - a);
  const openTasks = taskItems.filter((item) => !item.concluido)
    .sort((a, b) => {
      return PRIORITY_ORDER[a.prioridade] - PRIORITY_ORDER[b.prioridade] || a.data.localeCompare(b.data) || appointmentSort(a, b);
    });
  const visibleTasks = taskItems.filter((item) => taskFilter === "all" || (taskFilter === "completed" ? item.concluido : !item.concluido))
    .sort((a, b) => Number(a.concluido) - Number(b.concluido) || PRIORITY_ORDER[a.prioridade] - PRIORITY_ORDER[b.prioridade] || a.data.localeCompare(b.data) || appointmentSort(a, b));
  const overdueTasks = openTasks.filter((item) => item.data < today && item.recorrencia === "none");
  const selectedContacts = contacts.filter((contact) => birthdayOn(contact, selectedDate));
  const holidays = brazilianHolidays(parseDate(selectedDate).getFullYear());
  const selectedHoliday = holidays.get(selectedDate);
  const alertsOn = pushEnabled || localAlerts;

  if (!authReady) return <main className="flex min-h-screen items-center justify-center p-4"><div className="text-center"><div className="mx-auto mb-3 h-8 w-8 animate-spin rounded-full border-4 border-violet-200 border-t-violet-600" role="status" aria-label="Carregando" /><p className="muted">Conectando à sua agenda...</p></div></main>;
  if (!session) return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={authenticate} className="card w-full max-w-md p-7 shadow-lg">
        <div className="mb-6 text-center"><div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center"><img src="/icon.png" alt="CODIFEX AGENDAS" className="h-16 w-16 rounded-2xl object-contain shadow-md" /></div><h1 className="text-2xl font-bold">CODIFEX AGENDAS</h1><p className="muted mt-2">Compromissos, tarefas e prazos do escritório em um só lugar.</p></div>
        <label className="mb-3 block text-sm font-medium">E-mail<input className="field mt-1" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="block text-sm font-medium">Senha<input className="field mt-1" type="password" minLength={6} required autoComplete={authMode === "login" ? "current-password" : "new-password"} value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {authError && <p className="mt-3 text-sm text-red-600" role="alert">{authError}</p>}
        {authError && <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => { setAuthReady(false); setAuthRetry((attempt) => attempt + 1); }}>Tentar conectar novamente</button>}
        <button disabled={authBusy} className="btn btn-primary mt-5 w-full">{authBusy ? "Aguarde..." : authMode === "login" ? "Entrar" : "Criar conta"}</button>
        <button type="button" className="btn btn-ghost mt-2 w-full" onClick={() => { setAuthMode(authMode === "login" ? "signup" : "login"); setAuthError(""); }}>{authMode === "login" ? "Ainda não tem conta? Criar conta" : "Já tem conta? Entrar"}</button>
        <p className="muted mt-4 text-center text-xs">O primeiro acesso precisa de internet. Depois, use a agenda instalada offline neste dispositivo.</p>
      </form>
    </main>
  );

  return (
    <main className="min-h-screen">
      <header className="surface sticky top-0 z-30 border-b line">
        <div className="app-header mx-auto max-w-[1400px] px-4 py-3 sm:px-6">
          <button type="button" className="flex items-center gap-2 text-lg font-bold" onClick={() => { setView("day"); setSearch(""); showDate(today); }}><img src="/icon.png" alt="CODIFEX AGENDAS" className="h-9 w-9 rounded-xl object-contain shadow-sm" /><span className="hidden sm:inline font-bold">CODIFEX AGENDAS</span></button>
          <div className="app-header-search relative">
            <input ref={searchRef} className="field py-2 pl-9" placeholder="Buscar tarefas, clientes, compromissos... (Ctrl+F)" value={search} onChange={(e) => setSearch(e.target.value)} />
            <span className="muted absolute left-3 top-2.5 text-lg pointer-events-none select-none">⌕</span>
          </div>
          <div className="app-header-actions">
            <button type="button" className="btn btn-primary py-2" onClick={() => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: view === "year" || view === "month" || view === "day" || view === "contacts" ? selectedDate : today, ...(view === "tasks" ? { tipo: "tarefa" as const, alerta_minutos: "none" } : {}) })}><span>＋</span><span className="hidden sm:inline">{view === "tasks" ? "Nova tarefa" : "Novo compromisso"}</span></button>
            <button type="button" className="btn btn-ghost px-2 py-2" aria-label={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"} title={theme === "light" ? "Ativar tema escuro" : "Ativar tema claro"} onClick={changeTheme}>{theme === "light" ? "☾" : "☀"}</button>
            <button type="button" disabled={pushBusy} className="btn btn-ghost px-2 py-2" aria-label={alertsOn ? "Desativar notificações" : "Ativar notificações"} title={alertsOn ? "Notificações ativas neste dispositivo" : "Ativar notificações neste dispositivo"} onClick={alertsOn ? disablePush : enablePush}>{pushBusy ? "…" : alertsOn ? "🔔" : "🔕"}</button>
            <button type="button" className="btn btn-ghost px-2 py-2" aria-label="Baixar backup dos dados em JSON" title="Baixar backup dos dados em JSON" onClick={() => {
              try {
                exportBackup();
                notify("Backup JSON baixado.");
              } catch (error) {
                notify(`Não foi possível baixar o backup: ${messageOf(error)}`, "error");
              }
            }}>⇩</button>
            <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${isOnline ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`} title={pendingSync ? `${pendingSync} alteração(ões) aguardando sincronização` : "Dados locais disponíveis"}>{isOnline ? "● Online" : "● Offline"}{pendingSync > 0 ? ` · ${pendingSync} pendente(s)` : ""}</span>
            <button type="button" className="btn btn-ghost px-2 py-2" title="Sair" onClick={() => getSupabase().auth.signOut().then(({ error }) => { if (error) notify(error.message, "error"); })}>↪</button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1400px] px-4 py-5 sm:px-6 sm:py-6">
        {notice && <div role="status" className={`fixed right-4 top-20 z-[60] max-w-sm rounded-xl px-4 py-3 text-sm text-white shadow-xl ${notice.kind === "error" ? "bg-red-600" : "bg-emerald-600"}`}>{notice.text}</div>}
        {!isOnline && <div className="mb-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-100">Modo offline: agenda, tarefas e edições ficam salvas neste dispositivo e sincronizam com o Supabase quando a conexão voltar.{pendingSync > 0 ? ` ${pendingSync} alteração(ões) aguardando envio.` : ""}</div>}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div><h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{view === "contacts" ? "Contatos da agenda" : view === "tasks" ? "Tarefas" : view === "year" ? `Agenda ${shownYear}` : view === "month" ? `${MONTHS[shownMonth]} ${shownYear}` : "Agenda do dia"}</h1><p className="muted mt-1 text-sm">{view === "day" ? formatDate(selectedDate) : `Olá, ${session.user.email}`}</p></div>
          <div className="flex flex-wrap gap-2">
            <button className={`btn ${view !== "tasks" ? "btn-primary" : "btn-ghost"}`} onClick={() => { setView("day"); showDate(today); }}>Agenda</button>
            <button className={`btn ${view === "tasks" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("tasks")}>Tarefas</button>
            {installPrompt && <button className="btn btn-ghost" onClick={() => {
              const prompt = installPrompt as Event & { prompt?: () => Promise<void> };
              prompt.prompt?.(); setInstallPrompt(null);
            }}>⇩ Instalar app</button>}
          </div>
        </div>
        {view !== "tasks" && !search.trim() && <div className="mb-5 flex flex-wrap items-center gap-2 border-b line pb-3">
          <button className={`btn px-3 py-2 text-sm ${view === "day" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("day")}>Dia</button>
          <button className={`btn px-3 py-2 text-sm ${view === "month" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("month")}>Calendário mensal</button>
          <button className={`btn px-3 py-2 text-sm ${view === "year" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("year")}>Visão anual</button>
          <button className={`btn px-3 py-2 text-sm ${view === "contacts" ? "btn-primary" : "btn-ghost"}`} onClick={() => setView("contacts")}>Contatos</button>
        </div>}

        {search.trim() ? (
          <section className="card p-4 sm:p-6">
            <h2 className="mb-4 text-lg font-bold">Resultados para “{search}”</h2>
            <div className="grid gap-6 lg:grid-cols-3">
              <div><h3 className="mb-2 font-semibold">Compromissos e tarefas ({filteredAppointments.length})</h3>{filteredAppointments.slice(0, 50).map((item) => <button key={item.id} className="mb-2 block w-full rounded-lg border line p-3 text-left" onClick={() => { setSelectedDate(item.data); setShownYear(parseDate(item.data).getFullYear()); setShownMonth(parseDate(item.data).getMonth()); setView("day"); setSearch(""); }}><strong>{item.titulo}</strong><span className="muted ml-2 text-sm">{formatDate(item.data)}{item.hora_inicio ? ` • ${item.hora_inicio.slice(0, 5)}` : ""}</span></button>)}{!filteredAppointments.length && <p className="muted text-sm">Nenhum compromisso ou tarefa correspondente.</p>}</div>
              <div><h3 className="mb-2 font-semibold">Contatos ({filteredContacts.length})</h3>{filteredContacts.slice(0, 50).map((contact) => <button key={contact.id} className="mb-2 block w-full rounded-lg border line p-3 text-left" onClick={() => { setContactLetter(""); setView("contacts"); setSearch(""); }}><strong>{contact.nome}</strong><span className="muted ml-2 text-sm">{contact.email}</span></button>)}{!filteredContacts.length && <p className="muted text-sm">Nenhum contato correspondente.</p>}</div>
              <div><h3 className="mb-2 font-semibold">Observações ({filteredNotes.length})</h3>{filteredNotes.slice(0, 50).map(([date, note]) => <button key={date} className="mb-2 block w-full rounded-lg border line p-3 text-left" onClick={() => { setSelectedDate(date); setShownYear(parseDate(date).getFullYear()); setShownMonth(parseDate(date).getMonth()); setView("day"); setSearch(""); }}><strong>{formatDate(date)}</strong><p className="muted mt-1 line-clamp-2 text-sm">{note}</p></button>)}{!filteredNotes.length && <p className="muted text-sm">Nenhuma observação correspondente.</p>}</div>
            </div>
          </section>
        ) : view === "contacts" ? (
          <section className="card p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-2"><div><h2 className="text-lg font-bold">Agenda telefônica</h2><p className="muted text-sm">{contacts.length} contato(s)</p></div>
              <div className="flex gap-2"><label className="btn btn-ghost">Importar CSV<input className="hidden" type="file" accept=".csv,text/csv" onChange={(e) => { const file = e.target.files?.[0]; if (file) importContacts(file); e.currentTarget.value = ""; }} /></label><button className="btn btn-ghost" onClick={exportContacts}>Exportar CSV</button><button className="btn btn-primary" onClick={() => setContactForm(null)}>＋ Novo contato</button></div>
            </div>
            <div className="mb-4 flex flex-wrap gap-1">{["Todos", ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => <button key={letter} onClick={() => setContactLetter(letter === "Todos" ? "" : letter)} className={`btn min-w-8 px-2 py-1 text-xs ${contactLetter === letter || (letter === "Todos" && !contactLetter) ? "btn-primary" : "btn-ghost"}`}>{letter}</button>)}</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {[...displayedContacts].sort((a, b) => a.nome.localeCompare(b.nome, "pt-BR")).map((contact) => <article key={contact.id} className="rounded-xl border line p-4">
                <div className="flex justify-between gap-2"><div><h3 className="font-bold">{contact.nome}</h3>{contact.empresa && <p className="muted text-sm">{contact.empresa}</p>}</div><button aria-label="Alternar favorito" className="btn btn-ghost h-9 px-2" onClick={() => toggleFavorite(contact)}>{contact.favorito ? "★" : "☆"}</button></div>
                {contact.email && <p className="mt-3 text-sm"><a className="text-violet-600" href={`mailto:${contact.email}`}>{contact.email}</a></p>}
                {(contact.telefones || []).map((phone) => <p key={phone.id || phone.numero} className="muted mt-1 text-sm">{phone.rotulo}: <a className="text-violet-600" href={`tel:${phone.numero}`}>{phone.numero}</a></p>)}
                {contact.endereco && <p className="muted mt-2 text-sm">{contact.endereco}</p>}
                {contact.aniversario && <p className="muted mt-2 text-sm">🎂 {formatDate(contact.aniversario)}</p>}
                <div className="mt-4 flex justify-end gap-2"><button className="btn btn-ghost px-3 py-1 text-sm" onClick={() => setContactForm(contact)}>Editar</button><button className="btn btn-ghost px-3 py-1 text-sm text-red-600" onClick={() => deleteContact(contact)}>Excluir</button></div>
              </article>)}
              {!displayedContacts.length && <p className="muted py-8 text-center md:col-span-2 xl:col-span-3">Nenhum contato encontrado.</p>}
            </div>
          </section>
        ) : view === "tasks" ? (
          <section className="card p-4 sm:p-6">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Tarefas · {shownYear}</h2><p className="muted mt-1 text-sm">{taskItems.length} cadastrada(s) · {openTasks.length} em aberto · {overdueTasks.length} atrasada(s)</p></div><div className="flex flex-wrap gap-2"><label className="muted flex items-center gap-2 text-sm">Ano<select className="field max-w-32 py-2" value={shownYear} onChange={(event) => {
              const year = Math.min(Number(event.target.value), yearLimit);
              setShownYear(year); setShownMonth(0); showDate(`${year}-01-01`);
            }}>{archivedYears.map((year) => <option key={year} value={year}>{year}</option>)}</select></label><button className="btn btn-primary" onClick={() => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: shownYear === currentYear ? today : `${shownYear}-01-01`, tipo: "tarefa", alerta_minutos: "none" })}>＋ Nova tarefa</button></div></div>
            <div className="mb-4 flex gap-2">{([{ id: "open", label: `A fazer (${openTasks.length})` }, { id: "completed", label: `Concluídas (${taskItems.filter((item) => item.concluido).length})` }, { id: "all", label: `Todas (${taskItems.length})` }] as const).map((filter) => <button key={filter.id} className={`btn px-3 py-2 text-sm ${taskFilter === filter.id ? "btn-primary" : "btn-ghost"}`} onClick={() => setTaskFilter(filter.id)}>{filter.label}</button>)}</div>
            <div className="space-y-2">{visibleTasks.map((item) => <WorkItem key={item.id} item={item} showDate onComplete={toggleComplete} onDelete={deleteAppointment} onEdit={(event) => setAppointmentForm({ ...event, hora_inicio: event.hora_inicio || "", hora_fim: event.hora_fim || "", alerta_minutos: event.alerta_minutos === null ? "none" : String(event.alerta_minutos) })} />)}
              {!visibleTasks.length && <div className="rounded-xl border border-dashed line p-8 text-center"><p className="font-semibold">{taskItems.length === 0 ? `Nenhuma tarefa cadastrada em ${shownYear}.` : taskFilter === "completed" ? "Nenhuma tarefa concluída ainda." : taskFilter === "open" ? "Nenhuma tarefa em aberto." : "Nenhuma tarefa para exibir."}</p><p className="muted mt-1 text-sm">{taskItems.length === 0 ? "Clique em “Nova tarefa” para adicionar sua primeira tarefa." : "As tarefas que correspondem a este filtro aparecerão aqui."}</p></div>}
            </div>
          </section>
        ) : view === "day" ? (
          <section className="day-workspace">
            <div className="card day-toolbar">
              <button className="btn btn-ghost" onClick={() => { const date = parseDate(selectedDate); date.setDate(date.getDate() - 1); showDate(dateKey(date)); }}>← Dia anterior</button>
              <div className="day-toolbar-date"><p className="muted text-sm">{new Intl.DateTimeFormat("pt-BR", { weekday: "long" }).format(parseDate(selectedDate))}</p><h2 className="text-xl font-bold">{formatDate(selectedDate)}</h2></div>
              <div className="flex gap-2">
                <button className="btn btn-ghost" onClick={() => showDate(today)}>Hoje</button>
                <button disabled={selectedDate === `${yearLimit}-12-31` || parseDate(selectedDate).getFullYear() > yearLimit} className="btn btn-ghost disabled:cursor-not-allowed disabled:opacity-40" onClick={() => {
                  const date = parseDate(selectedDate); date.setDate(date.getDate() + 1);
                    if (date.getFullYear() <= yearLimit) showDate(dateKey(date));
                }}>Próximo dia →</button>
              </div>
            </div>
            <div className="day-columns">
              <section className="card min-w-0 p-4 sm:p-6">
                <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
                  <div><p className="muted text-xs font-semibold uppercase tracking-wider">Sua rotina</p><h2 className="mt-1 text-xl font-bold">Compromissos do dia</h2><p className="muted mt-1 text-sm">{selectedEvents.length} item(ns) na agenda</p></div>
                  <button className="btn btn-primary" onClick={() => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: selectedDate })}>＋ Novo compromisso</button>
                </div>
                {selectedHoliday && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">🇧🇷 {selectedHoliday}</div>}
                {selectedContacts.map((contact) => <div key={contact.id} className="mb-3 rounded-lg bg-pink-50 p-3 text-sm text-pink-800 dark:bg-pink-950 dark:text-pink-100">🎂 Aniversário de {contact.nome}</div>)}
                <div className="space-y-3">
                  {selectedEvents.map((item) => <WorkItem key={item.id} item={item} showDate={item.tipo === "tarefa"} onComplete={toggleComplete} onDelete={deleteAppointment} onEdit={(event) => setAppointmentForm({ ...event, hora_inicio: event.hora_inicio || "", hora_fim: event.hora_fim || "", alerta_minutos: event.alerta_minutos === null ? "none" : String(event.alerta_minutos) })} />)}
                  {!selectedEvents.length && <div className="rounded-xl border border-dashed line p-8 text-center"><p className="font-semibold">Seu dia está livre</p><p className="muted mt-1 text-sm">Adicione um compromisso ou tarefa para organizar sua rotina.</p></div>}
                </div>
              </section>
              <aside className="card day-notes p-4 sm:p-6">
                <div className="mb-4 flex items-start justify-between gap-3"><div><p className="muted text-xs font-semibold uppercase tracking-wider">Anotações</p><h2 className="mt-1 text-xl font-bold">Observações do dia</h2></div><span className="muted pt-1 text-xs">{savingNote ? "Salvando..." : "Salvo"}</span></div>
                <p className="muted mb-3 text-sm">Estas notas ficam vinculadas somente a {formatDate(selectedDate)}.</p>
                <textarea className="field day-note-input text-sm" placeholder="Pautas, lembretes ou informações importantes..." value={observations[selectedDate] || ""} onChange={(e) => setObservations((all) => ({ ...all, [selectedDate]: e.target.value }))} />
                <p className="muted mt-3 text-xs">Salvamento automático após alguns instantes.</p>
              </aside>
            </div>
          </section>
        ) : (
          <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section>
              {view === "year" ? <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><button className="btn btn-ghost" onClick={() => { const year = shownYear - 1; setShownYear(year); setShownMonth(0); showDate(`${year}-01-01`); }}>← Ano anterior</button><strong className="text-xl">{shownYear}</strong><button disabled={shownYear >= yearLimit} className="btn btn-ghost disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { const year = Math.min(shownYear + 1, yearLimit); setShownYear(year); setShownMonth(0); showDate(`${year}-01-01`); }}>Ano seguinte →</button>
                  {shownYear === yearLimit && yearLimit < 9999 && <button className="btn btn-primary" onClick={generateNextYear}>＋ Gerar ano {yearLimit + 1}</button>}
                </div>
                <label className="mb-4 flex items-center gap-2 text-sm">Consultar ano arquivado<select className="field max-w-48 py-2" value={shownYear} onChange={(event) => {
                  const year = Math.min(Number(event.target.value), yearLimit);
                  setShownYear(year); setShownMonth(0); showDate(`${year}-01-01`);
                }}>{archivedYears.map((year) => <option key={year} value={year}>{year}{year === currentYear ? " (atual)" : ""}</option>)}</select></label>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {MONTHS.map((month, index) => <div key={month} className="card p-2 text-left transition hover:shadow-md sm:p-3">
                    <button className="mb-1 block w-full text-center text-sm font-semibold" onClick={() => { showDate(`${shownYear}-${String(index + 1).padStart(2, "0")}-01`); setView("month"); }}>{month}</button>
                    <CalendarMonth year={shownYear} month={index} maxYear={yearLimit} appointments={filteredAppointments} contacts={contacts} observations={observations} selected={selectedDate} onSelect={(date) => { showDate(date); setView("month"); }} compact />
                  </div>)}
                </div>
                <div className="muted mt-4 flex flex-wrap gap-4 text-xs"><span>● Feriado</span><span className="text-violet-500">● Compromisso</span><span className="text-pink-500">● Aniversário</span><span className="text-amber-500">● Observação</span></div>
              </> : <>
                <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><button className="btn btn-ghost" onClick={() => { const d = new Date(shownYear, shownMonth - 1, 1, 12); if (d.getFullYear() <= yearLimit) showDate(dateKey(d)); }}>← Anterior</button><button className="btn btn-ghost text-lg font-bold" onClick={() => { showDate(today); setView("month"); }}>Ir para hoje</button><button disabled={shownYear === yearLimit && shownMonth === 11} className="btn btn-ghost disabled:cursor-not-allowed disabled:opacity-40" onClick={() => { const d = new Date(shownYear, shownMonth + 1, 1, 12); if (d.getFullYear() <= yearLimit) showDate(dateKey(d)); }}>Próximo →</button>
                </div>
                <CalendarMonth year={shownYear} month={shownMonth} maxYear={yearLimit} appointments={filteredAppointments} contacts={contacts} observations={observations} selected={selectedDate} onSelect={showDate} />
                <div className="muted mt-4 flex flex-wrap gap-4 text-xs"><span>● Feriado</span><span className="text-violet-500">● Compromisso</span><span className="text-pink-500">● Aniversário</span><span className="text-amber-500">● Observação</span></div>
              </>}
            </section>
            <aside className="card p-4 sm:p-5 xl:sticky xl:top-24">
              <div className="mb-4 flex items-start justify-between"><div><p className="muted text-sm">{WEEKDAYS[(parseDate(selectedDate).getDay() + 6) % 7]}</p><h2 className="text-xl font-bold">{formatDate(selectedDate)}</h2></div><button className="btn btn-primary px-3" onClick={() => setAppointmentForm({ ...EMPTY_APPOINTMENT, data: selectedDate })}>＋</button></div>
              {selectedHoliday && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950 dark:text-red-200">🇧🇷 {selectedHoliday}</div>}
              {selectedContacts.map((contact) => <div key={contact.id} className="mb-3 rounded-lg bg-pink-50 p-3 text-sm text-pink-800 dark:bg-pink-950 dark:text-pink-100">🎂 Aniversário de {contact.nome}</div>)}
              <div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Agenda do dia</h3><span className="muted text-xs">{selectedEvents.length} item(ns)</span></div>
              <div className="space-y-2">
                {selectedEvents.map((item) => <article key={item.id} className={`rounded-lg border line p-3 ${item.concluido ? "opacity-60" : ""}`} style={{ borderLeft: `4px solid ${item.cor}` }}>
                  <div className="flex gap-2"><input type="checkbox" aria-label="Marcar como concluído" checked={item.concluido} onChange={() => toggleComplete(item)} className="mt-1 accent-violet-600" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className={`font-semibold ${item.concluido ? "line-through" : ""}`}>{item.titulo}</span>{item.tipo === "tarefa" && <PriorityPill priority={item.prioridade || "normal"} />}</div><p className="muted mt-1 text-xs">{item.tipo === "tarefa" ? "Prazo" : item.hora_inicio ? item.hora_inicio.slice(0, 5) : "Sem horário"}{item.tipo !== "tarefa" && item.hora_fim ? ` – ${item.hora_fim.slice(0, 5)}` : ""}{item.recorrencia !== "none" ? ` · ${({ daily: "diário", weekly: "semanal", monthly: "mensal", yearly: "anual" } as Record<string, string>)[item.recorrencia]}` : ""}</p>{item.cliente && <p className="muted mt-1 text-xs">Cliente/projeto: {item.cliente}</p>}{item.local && <p className="muted mt-1 text-xs">⌖ {item.local}</p>}{item.descricao && <p className="muted mt-2 whitespace-pre-wrap text-sm">{item.descricao}</p>}<span className="mt-2 inline-block rounded-full px-2 py-1 text-[10px] text-white" style={{ backgroundColor: item.cor }}>{item.categoria}</span></div></div>
                  <div className="mt-2 flex justify-end gap-1"><button className="btn btn-ghost px-2 py-1 text-xs" onClick={() => setAppointmentForm({ ...item, hora_inicio: item.hora_inicio || "", hora_fim: item.hora_fim || "", alerta_minutos: item.alerta_minutos === null ? "none" : String(item.alerta_minutos) })}>Editar</button><button className="btn btn-ghost px-2 py-1 text-xs text-red-600" onClick={() => deleteAppointment(item)}>Excluir</button></div>
                </article>)}
                {!selectedEvents.length && <p className="muted py-3 text-center text-sm">Sem itens agendados neste dia.</p>}
              </div>
              {view === "year" && <div className="mt-5 border-t line pt-4"><div className="mb-2 flex items-center justify-between"><h3 className="font-semibold">Observações do dia</h3><span className="muted text-xs">{savingNote ? "Salvando..." : "Salvo"}</span></div><textarea className="field min-h-28 resize-y text-sm" placeholder="Anote algo importante para este dia..." value={observations[selectedDate] || ""} onChange={(e) => setObservations((all) => ({ ...all, [selectedDate]: e.target.value }))} /></div>}
            </aside>
          </div>
        )}
      </div>

      {appointmentForm && <AppointmentForm initial={appointmentForm} busy={busy} onClose={() => setAppointmentForm(null)} onSave={saveAppointment} />}
      {contactForm !== undefined && <ContactForm initial={contactForm} busy={busy} onClose={() => setContactForm(undefined)} onSave={saveContact} />}
    </main>
  );
}
