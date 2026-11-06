"use client";

import { useState } from "react";
import type { AgendaAppointmentType, AppointmentBaseType } from "@/lib/types";

interface AppointmentTypeManagerModalProps {
  appointmentTypes: AgendaAppointmentType[];
  busy: boolean;
  onSave: (name: string, id?: string, tipoBase?: AppointmentBaseType) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}

export function AppointmentTypeManagerModal({
  appointmentTypes,
  busy,
  onSave,
  onDelete,
  onClose,
}: AppointmentTypeManagerModalProps) {
  const [name, setName] = useState("");
  const [editingId, setEditingId] = useState<string>();
  const [editingBaseType, setEditingBaseType] = useState<AppointmentBaseType>();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string>();
  const [error, setError] = useState("");

  function edit(type: AgendaAppointmentType) {
    setEditModalOpen(true);
    setEditingId(type.id);
    setEditingBaseType(type.tipo_base || undefined);
    setName(type.nome);
    setDeleteId(undefined);
    setError("");
  }

  function resetForm() {
    setEditModalOpen(false);
    setEditingId(undefined);
    setEditingBaseType(undefined);
    setName("");
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await onSave(name, editingId, editingBaseType);
      resetForm();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível salvar o tipo.");
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    try {
      await onDelete(deleteId);
      setDeleteId(undefined);
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível excluir o tipo.");
    }
  }

  function startCreate() {
    setEditModalOpen(true);
    setEditingId(undefined);
    setEditingBaseType(undefined);
    setName("");
    setDeleteId(undefined);
    setError("");
  }

  const deletingType = appointmentTypes.find((type) => type.id === deleteId);

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3" role="dialog" aria-modal="true" aria-labelledby="appointment-types-title">
      <section className="surface max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 id="appointment-types-title" className="text-xl font-bold">Gerenciar tipos</h2>
            <p className="muted mt-1 text-sm">Edite as opções padrão ou crie novas para o formulário.</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={startCreate}>＋ Novo</button>
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Fechar">×</button>
          </div>
        </div>

        {editModalOpen && (
          <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-labelledby="appointment-type-edit-title">
            <form id="appointment-type-edit-form" onSubmit={submit} className="surface w-full max-w-md rounded-2xl p-5 shadow-2xl sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 id="appointment-type-edit-title" className="text-lg font-bold">
                  {editingId ? "Renomear tipo" : "Novo tipo de compromisso"}
                </h3>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Salvando..." : editingId ? "Salvar" : "Adicionar"}
                </button>
              </div>
              <label className="block text-sm font-medium">
                Nome da opção
                <input
                  autoFocus
                  className="field mt-1"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={60}
                  required
                />
              </label>
              {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
              <div className="mt-5 flex justify-end border-t line pt-3">
                <button type="button" className="btn btn-ghost" onClick={resetForm}>Cancelar</button>
              </div>
            </form>
          </div>
        )}

        <div className="mb-5 space-y-2">
          {appointmentTypes.map((type) => (
            <div key={type.id} className="flex items-center gap-2 rounded-xl border line p-2.5">
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{type.nome}</span>
              {type.tipo_base && <span className="muted text-xs">Padrão</span>}
              <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => edit(type)}>Renomear</button>
              {!type.tipo_base && (
                <button
                  type="button"
                  className="btn btn-ghost px-2 py-1 text-xs text-red-600"
                  onClick={() => {
                    setDeleteId(type.id);
                    setEditModalOpen(false);
                    setEditingId(undefined);
                    setEditingBaseType(undefined);
                    setError("");
                  }}
                >
                  Excluir
                </button>
              )}
            </div>
          ))}
          {!appointmentTypes.length && <p className="muted text-sm">Nenhum tipo personalizado cadastrado.</p>}
        </div>

        {deleteId && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
            <p className="text-sm font-semibold">Excluir “{deletingType?.nome}”?</p>
            <p className="muted mt-1 text-xs">Os compromissos já salvos mantêm o nome desse tipo.</p>
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setDeleteId(undefined)}>Cancelar</button>
              <button type="button" disabled={busy} className="btn btn-primary" onClick={confirmDelete}>Confirmar exclusão</button>
            </div>
          </div>
        )}

        <div className="flex justify-end border-t line pt-4">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancelar</button>
        </div>
      </section>
    </div>
  );
}
