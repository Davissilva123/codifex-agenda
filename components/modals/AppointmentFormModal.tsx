"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { AgendaAppointmentType, AgendaCategory, Appointment, AppointmentKind, Priority, Recurrence } from "@/lib/types";
import { detectAppointmentConflict } from "@/lib/conflict";
import { extractMeetingUrl } from "@/lib/meeting";

export const COLORS = ["#6858d8", "#e2537d", "#e68a32", "#238d78", "#3676c8", "#874eaa"];

export const ALERTS = [
  { value: "0", label: "Na hora" },
  { value: "5", label: "5 min" },
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hora" },
  { value: "1440", label: "1 dia antes" },
];

export interface AppointmentFormValues {
  titulo: string;
  data: string;
  hora_inicio: string;
  hora_fim: string;
  descricao: string;
  local: string;
  categoria: string;
  cor: string;
  alerta_minutos: string;
  alertas_minutos?: string[];
  recorrencia: Recurrence;
  tipo: AppointmentKind;
  tipo_personalizado?: string | null;
  prioridade: Priority;
  cliente: string;
  responsavel: string;
}

interface AppointmentFormModalProps {
  initial: AppointmentFormValues & { id?: string };
  allAppointments: Appointment[];
  categories: AgendaCategory[];
  appointmentTypes: AgendaAppointmentType[];
  onSave: (values: AppointmentFormValues, id?: string) => Promise<void>;
  onClose: () => void;
  busy: boolean;
  DateField: React.ComponentType<{ value: string; onChange: (v: string) => void; required?: boolean; className?: string }>;
  TimeField: React.ComponentType<{ value: string; onChange: (v: string) => void; className?: string }>;
}

export function AppointmentFormModal({
  initial,
  allAppointments,
  categories,
  appointmentTypes,
  onSave,
  onClose,
  busy,
  DateField,
  TimeField,
}: AppointmentFormModalProps) {
  const [values, setValues] = useState<AppointmentFormValues & { id?: string }>(initial);
  const [error, setError] = useState("");
  const [selectedAlerts, setSelectedAlerts] = useState<string[]>(
    initial.alertas_minutos || (initial.alerta_minutos === "none" ? [] : [initial.alerta_minutos])
  );
  const [alertToAdd, setAlertToAdd] = useState("");
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false);
  const categoryMenuRef = useRef<HTMLDivElement>(null);
  const isMedical = values.tipo === "compromisso" && !values.tipo_personalizado && ["Saúde", "Médico"].includes(values.categoria);
  const selectedCustomType = values.tipo_personalizado || "";
  const selectedCategory = categories.find((category) => category.nome === values.categoria);
  const appointmentTypeLabel = (tipoBase: "compromisso" | "medico" | "tarefa", fallback: string) =>
    appointmentTypes.find((type) => type.tipo_base === tipoBase)?.nome || fallback;

  useEffect(() => {
    if (!categoryMenuOpen) return;

    const closeOnOutsideClick = (event: PointerEvent) => {
      if (!categoryMenuRef.current?.contains(event.target as Node)) setCategoryMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCategoryMenuOpen(false);
    };

    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [categoryMenuOpen]);

  function set<K extends keyof AppointmentFormValues>(key: K, value: AppointmentFormValues[K]) {
    setValues((current) => ({ ...current, [key]: value }));
  }

  // Detecção de conflito de horário em tempo real
  const conflict = useMemo(() => {
    return detectAppointmentConflict(allAppointments, {
      id: initial.id,
      data: values.data,
      hora_inicio: values.hora_inicio || null,
      hora_fim: values.hora_fim || null,
      tipo: values.tipo,
      responsavel: values.responsavel,
    });
  }, [allAppointments, initial.id, values.data, values.hora_inicio, values.hora_fim, values.tipo, values.responsavel]);

  // Detecção de link de reunião
  const meetingUrl = useMemo(() => {
    return extractMeetingUrl(values.local) || extractMeetingUrl(values.descricao);
  }, [values.local, values.descricao]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!values.titulo.trim()) {
      setError("Informe o título do compromisso/tarefa.");
      return;
    }
    if (values.hora_inicio && values.hora_fim && values.hora_fim <= values.hora_inicio) {
      setError("A hora de término deve ser posterior à hora de início.");
      return;
    }
    if (values.hora_fim && !values.hora_inicio) {
      setError("Informe a hora de início para configurar o término.");
      return;
    }
    if (selectedAlerts.length && !values.hora_inicio) {
      setError("Informe a hora de início para configurar um alerta.");
      return;
    }

    try {
      await onSave({ ...values, alertas_minutos: selectedAlerts }, initial.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Ocorreu um erro ao salvar.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3"
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-title"
    >
      <form
        onSubmit={submit}
        className="surface max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-7"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 id="event-title" className="text-xl font-bold">
            {initial.id ? "Editar item" : values.tipo === "tarefa" ? "Nova tarefa" : "Novo compromisso"}
          </h2>
          <button type="button" onClick={onClose} className="btn btn-ghost" aria-label="Fechar">
            ✕
          </button>
        </div>

        {/* Alerta de Conflito de Horário */}
        {conflict && (
          <div className="mb-4 rounded-xl border border-amber-300 bg-amber-50 dark:border-amber-900/60 dark:bg-amber-950/40 p-3 text-xs sm:text-sm text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
            <span className="text-base leading-none">⚠️</span>
            <div>
              <strong className="font-semibold">Atenção:</strong>
              <p className="mt-0.5">{conflict.message}</p>
            </div>
          </div>
        )}

        <div className="mb-3">
          <label className="text-sm font-medium">
            O que você vai fazer?
            <select
              className="field mt-1"
              value={isMedical ? "medico" : selectedCustomType ? `custom:${selectedCustomType}` : values.tipo}
              onChange={(e) => {
                const selected = e.target.value;
                if (selected === "medico") {
                  setValues((current) => ({
                    ...current,
                    tipo: "compromisso",
                    tipo_personalizado: "",
                    hora_fim: "",
                    categoria: categories.find((category) => ["Médico", "Saúde"].includes(category.nome))?.nome || "Médico",
                    alerta_minutos: "1440",
                    recorrencia: "none",
                  }));
                  return;
                }

                if (selected.startsWith("custom:")) {
                  const customType = selected.slice("custom:".length);
                  setValues((current) => ({
                    ...current,
                    tipo: "compromisso",
                    tipo_personalizado: customType,
                    categoria: ["Saúde", "Médico"].includes(current.categoria) ? "Normal" : current.categoria,
                    alerta_minutos: current.alerta_minutos === "none" ? "15" : current.alerta_minutos,
                  }));
                  return;
                }

                const tipo = selected as AppointmentKind;
                setValues((current) => ({
                  ...current,
                  tipo,
                  tipo_personalizado: "",
                  categoria: ["Saúde", "Médico"].includes(current.categoria) ? "Normal" : current.categoria,
                  alerta_minutos:
                    tipo === "tarefa" && !current.hora_inicio
                      ? "none"
                      : tipo === "compromisso" && current.alerta_minutos === "none"
                      ? "15"
                      : current.alerta_minutos,
                }));
              }}
            >
              <option value="compromisso">{appointmentTypeLabel("compromisso", "Compromisso / reunião")}</option>
              <option value="medico">{appointmentTypeLabel("medico", "Médico")}</option>
              <option value="tarefa">{appointmentTypeLabel("tarefa", "Tarefa / prazo")}</option>
              {appointmentTypes.filter((type) => !type.tipo_base).map((appointmentType) => (
                <option key={appointmentType.id} value={`custom:${appointmentType.nome}`}>{appointmentType.nome}</option>
              ))}
              {selectedCustomType && !appointmentTypes.some((appointmentType) => !appointmentType.tipo_base && appointmentType.nome === selectedCustomType) && (
                <option value={`custom:${selectedCustomType}`}>{selectedCustomType}</option>
              )}
            </select>
          </label>

        </div>

        <label className="mb-3 block text-sm font-medium">
          {values.tipo === "tarefa" ? "Tarefa" : isMedical ? "Especialidade" : "Assunto"} *
          <input
            autoFocus
            className="field mt-1"
            value={values.titulo}
            maxLength={200}
            placeholder={
              values.tipo === "tarefa"
                ? "Ex.: Enviar proposta ao cliente"
                : isMedical
                ? "Ex.: Cardiologia"
                : "Ex.: Reunião de alinhamento"
            }
            onChange={(e) => set("titulo", e.target.value)}
            required
          />
        </label>

        <label className="mb-3 block text-sm font-medium">
          {isMedical ? "Paciente" : "Responsável"}
          <input
            className="field mt-1"
            value={values.responsavel}
            maxLength={200}
            placeholder="Opcional"
            onChange={(e) => set("responsavel", e.target.value)}
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-medium">
            {values.tipo === "tarefa" ? "Prazo" : "Data"}
            <DateField value={values.data} onChange={(value) => set("data", value)} required />
          </label>
          <label className="text-sm font-medium">
            Início
            <TimeField value={values.hora_inicio} onChange={(value) => set("hora_inicio", value)} />
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          {isMedical ? (
            <label className="text-sm font-medium">
              Área / categoria
              <input className="field mt-1" value={values.categoria} readOnly />
            </label>
          ) : (
            <label className="text-sm font-medium">
              Área / categoria
              <div className="appointment-category-select mt-1" ref={categoryMenuRef}>
                <button
                  type="button"
                  className="field appointment-category-trigger"
                  aria-label={`Área ou categoria: ${values.categoria}`}
                  aria-haspopup="listbox"
                  aria-expanded={categoryMenuOpen}
                  onClick={() => setCategoryMenuOpen((open) => !open)}
                >
                  <span className="appointment-category-value">
                    <span className="appointment-category-color" style={{ backgroundColor: selectedCategory?.cor || values.cor }} />
                    <span>{values.categoria}</span>
                  </span>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m7 10 5 5 5-5" />
                  </svg>
                </button>
                {categoryMenuOpen && (
                  <div className="appointment-category-options" role="listbox" aria-label="Escolher categoria">
                    {categories.map((category) => (
                      <button
                        key={category.id}
                        type="button"
                        role="option"
                        aria-selected={values.categoria === category.nome}
                        className="appointment-category-option"
                        onClick={() => {
                          setValues((current) => ({ ...current, categoria: category.nome, cor: category.cor }));
                          setCategoryMenuOpen(false);
                        }}
                      >
                        <span className="appointment-category-color" style={{ backgroundColor: category.cor }} />
                        <span>{category.nome}</span>
                        {values.categoria === category.nome && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="m5 12 4 4L19 6" />
                          </svg>
                        )}
                      </button>
                    ))}
                    {!categories.length && <span className="muted block px-3 py-2 text-sm">Nenhuma categoria disponível.</span>}
                  </div>
                )}
              </div>
            </label>
          )}

          <div className="text-sm font-medium">
          <label htmlFor="appointment-reminder-select">Avisar antes</label>
          <select
            id="appointment-reminder-select"
            className="field mt-1"
            value={alertToAdd}
            onChange={(e) => {
              const minutes = e.target.value;
              if (minutes && !selectedAlerts.includes(minutes)) setSelectedAlerts((current) => [...current, minutes]);
              setAlertToAdd("");
            }}
          >
            <option value="">Adicionar aviso...</option>
            {ALERTS.filter((alert) => !selectedAlerts.includes(alert.value)).map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
          {selectedAlerts.length > 0 && (
            <div className="appointment-reminders-list" aria-label="Avisos adicionados">
              <span className="appointment-reminders-label">Avisos adicionados</span>
              <div className="flex flex-wrap gap-2">
                {selectedAlerts.map((minutes) => (
                  <span key={minutes} className="agenda-reminder-chip">
                    {ALERTS.find((item) => item.value === minutes)?.label || `${minutes} min`}
                    <button
                      type="button"
                      aria-label={`Remover aviso ${minutes}`}
                      onClick={() => setSelectedAlerts((current) => current.filter((value) => value !== minutes))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            </div>
          )}
          </div>
        </div>

        {isMedical ? (
          <div className="mt-3 grid grid-cols-2 gap-3">
            <label className="text-sm font-medium">
              Médico/Clínica
              <input
                className="field mt-1"
                value={values.cliente}
                maxLength={200}
                placeholder="Opcional"
                onChange={(e) => set("cliente", e.target.value)}
              />
            </label>
            <label className="text-sm font-medium">
              Endereço
              <input
                className="field mt-1"
                value={values.local}
                maxLength={200}
                placeholder="Endereço da consulta"
                onChange={(e) => set("local", e.target.value)}
              />
            </label>
          </div>
        ) : (
          <>
            <label className="mt-3 block text-sm font-medium">
              Cliente
              <input
                className="field mt-1"
                value={values.cliente}
                maxLength={200}
                placeholder="Opcional"
                onChange={(e) => set("cliente", e.target.value)}
              />
            </label>

            <div className="mt-3">
              <label className="text-sm font-medium">
                Local ou Link da Reunião
                <input
                  className="field mt-1"
                  value={values.local}
                  maxLength={200}
                  placeholder="Ex.: Sala 02 ou https://meet.google.com/xyz"
                  onChange={(e) => set("local", e.target.value)}
                />
              </label>
              {meetingUrl && (
                <span className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-emerald-600 dark:text-emerald-400">
                  📹 Link de videoconferência detectado
                </span>
              )}
            </div>
          </>
        )}

        <details className="mt-4 rounded-xl border line p-3">
          <summary className="cursor-pointer select-none text-sm font-semibold">Mais opções</summary>
          <div className="mt-4 grid grid-cols-2 items-start gap-3">
            <label className="text-sm font-medium">
              Prioridade
              <select
                className="field mt-1"
                value={values.prioridade}
                onChange={(e) => set("prioridade", e.target.value as Priority)}
              >
                <option value="urgente">🔴 Urgente</option>
                <option value="alta">🟠 Alta</option>
                <option value="normal">🔵 Normal</option>
                <option value="baixa">⚪ Baixa</option>
              </select>
            </label>
            {!isMedical && (
              <>
                <label className="text-sm font-medium">
                  Término
                  <TimeField value={values.hora_fim} onChange={(value) => set("hora_fim", value)} />
                </label>
                <label className="text-sm font-medium">
                  Repetição
                  <select
                    className="field mt-1"
                    value={values.recorrencia}
                    onChange={(e) => set("recorrencia", e.target.value as Recurrence)}
                  >
                    <option value="none">Não repetir</option>
                    <option value="daily">Diária</option>
                    <option value="weekly">Semanal</option>
                    <option value="monthly">Mensal</option>
                    <option value="yearly">Anual</option>
                  </select>
                </label>
                <div className="min-w-0">
                  <span className="text-sm font-medium">Cor</span>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {COLORS.map((color) => (
                      <button
                        key={color}
                        type="button"
                        aria-label={`Cor ${color}`}
                        aria-pressed={values.cor === color}
                        onClick={() => set("cor", color)}
                        className={`h-7 w-7 rounded-full transition-transform ${
                          values.cor === color ? "scale-115 ring-2 ring-offset-2 ring-violet-600" : "opacity-85"
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </details>

        <label className="mt-3 block text-sm font-medium">
          {isMedical ? "Observação" : "Descrição"}
          <textarea
            className="field mt-1 min-h-20"
            maxLength={4000}
            placeholder="Pautas, links, detalhes adicionais..."
            value={values.descricao}
            onChange={(e) => set("descricao", e.target.value)}
          />
        </label>

        {error && <p className="mt-3 text-sm text-red-600" role="alert">{error}</p>}

        <div className="mt-5 flex justify-end gap-2">
          <button type="button" onClick={onClose} className="btn btn-ghost">
            Cancelar
          </button>
          <button disabled={busy} className="btn btn-primary">
            {busy ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}
