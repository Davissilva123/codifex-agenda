"use client";

import { useState } from "react";
import type { AgendaCategory } from "@/lib/types";

export const CATEGORY_COLORS = [
  "#2563eb", "#0f766e", "#16a34a", "#ca8a04", "#ea580c",
  "#dc2626", "#db2777", "#9333ea", "#4f46e5", "#64748b",
];

interface CategoryManagerModalProps {
  categories: AgendaCategory[];
  usageCount: Record<string, number>;
  busy: boolean;
  onSave: (name: string, color: string, id?: string) => Promise<void>;
  onDelete: (id: string, moveToId?: string) => Promise<void>;
  onClose: () => void;
}

export function CategoryManagerModal({
  categories,
  usageCount,
  busy,
  onSave,
  onDelete,
  onClose,
}: CategoryManagerModalProps) {
  const [name, setName] = useState("");
  const [color, setColor] = useState(CATEGORY_COLORS[0]);
  const [editingId, setEditingId] = useState<string>();
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteId, setDeleteId] = useState<string>();
  const [moveToId, setMoveToId] = useState("");
  const [error, setError] = useState("");

  function edit(category: AgendaCategory) {
    setEditModalOpen(true);
    setEditingId(category.id);
    setName(category.nome);
    setColor(category.cor);
    setDeleteId(undefined);
  }

  function resetForm() {
    setEditModalOpen(false);
    setEditingId(undefined);
    setName("");
    setColor(CATEGORY_COLORS[0]);
    setError("");
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    try {
      await onSave(name, color, editingId);
      resetForm();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível salvar a categoria.");
    }
  }

  async function confirmDelete() {
    if (!deleteId) return;
    try {
      await onDelete(deleteId, moveToId || undefined);
      setDeleteId(undefined);
      setMoveToId("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Não foi possível excluir a categoria.");
    }
  }

  function startCreate() {
    setEditModalOpen(true);
    setEditingId(undefined);
    setName("");
    setColor(CATEGORY_COLORS[0]);
    setDeleteId(undefined);
    setError("");
  }

  const categoryBeingDeleted = categories.find((category) => category.id === deleteId);
  const requiresReplacement = Boolean(deleteId && usageCount[deleteId]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-3" role="dialog" aria-modal="true" aria-labelledby="categories-title">
      <section className="surface max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="categories-title" className="text-xl font-bold">Gerenciar categorias</h2>
          <div className="flex items-center gap-2">
            <button type="button" className="btn btn-primary" onClick={startCreate}>＋ Nova</button>
            <button type="button" className="btn btn-ghost" onClick={onClose} aria-label="Fechar">×</button>
          </div>
        </div>

        {editModalOpen && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-3" role="dialog" aria-modal="true" aria-labelledby="category-edit-title">
            <form id="category-edit-form" onSubmit={submit} className="surface w-full max-w-md rounded-2xl p-5 shadow-2xl sm:p-6">
              <div className="mb-4 flex items-center justify-between gap-3">
                <h3 id="category-edit-title" className="text-lg font-bold">{editingId ? "Renomear categoria" : "Nova categoria"}</h3>
                <button type="submit" className="btn btn-primary" disabled={busy}>
                  {busy ? "Salvando..." : editingId ? "Salvar" : "Adicionar"}
                </button>
              </div>
              <label className="block text-sm font-medium">
                Nome
                <input autoFocus className="field mt-1" value={name} onChange={(event) => setName(event.target.value)} maxLength={60} required />
              </label>
              <fieldset className="mt-3">
                <legend className="text-sm font-medium">Cor</legend>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {CATEGORY_COLORS.map((value) => (
                    <button
                      key={value}
                      type="button"
                      aria-label={`Selecionar cor ${value}`}
                      aria-pressed={color === value}
                      onClick={() => setColor(value)}
                      className={`h-7 w-7 rounded-full ${color === value ? "ring-2 ring-offset-2 ring-blue-600" : ""}`}
                      style={{ backgroundColor: value }}
                    />
                  ))}
                  <label className="muted flex items-center gap-2 text-xs">
                    Personalizada
                    <input type="color" aria-label="Escolher cor personalizada" value={color} onChange={(event) => setColor(event.target.value)} className="h-8 w-9 cursor-pointer rounded border line bg-transparent p-0.5" />
                  </label>
                </div>
              </fieldset>
              {error && <p role="alert" className="mt-3 text-sm text-red-600">{error}</p>}
              <div className="mt-5 flex justify-end border-t line pt-3">
                <button type="button" className="btn btn-ghost" onClick={resetForm}>Cancelar</button>
              </div>
            </form>
          </div>
        )}

        <div className="mb-5 space-y-2">
          {categories.map((category) => (
            <div key={category.id} className="flex items-center gap-2 rounded-xl border line p-2.5">
              <span className="h-3.5 w-3.5 rounded-full" style={{ backgroundColor: category.cor }} />
              <span className="min-w-0 flex-1 truncate text-sm font-medium">{category.nome}</span>
              <span className="muted text-xs">{usageCount[category.id] || 0}</span>
              <button type="button" className="btn btn-ghost px-2 py-1 text-xs" onClick={() => edit(category)}>Renomear</button>
              <button
                type="button"
                className="btn btn-ghost px-2 py-1 text-xs text-red-600"
                onClick={() => {
                  setDeleteId(category.id);
                  setEditModalOpen(false);
                  setEditingId(undefined);
                  setMoveToId(categories.find((item) => item.id !== category.id)?.id || "");
                  setError("");
                }}
              >
                Excluir
              </button>
            </div>
          ))}
          {!categories.length && <p className="muted text-sm">Ainda não há categorias cadastradas.</p>}
        </div>

        {deleteId && (
          <div className="mb-4 rounded-xl border border-red-300 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
            <p className="text-sm font-semibold">Excluir “{categoryBeingDeleted?.nome}”?</p>
            {requiresReplacement ? (
              <label className="mt-2 block text-sm">
                Mover {usageCount[deleteId!]} compromisso(s) para
                <select className="field mt-1" value={moveToId} onChange={(event) => setMoveToId(event.target.value)} required>
                  {categories.filter((category) => category.id !== deleteId).map((category) => (
                    <option key={category.id} value={category.id}>{category.nome}</option>
                  ))}
                </select>
              </label>
            ) : <p className="muted mt-1 text-xs">Os compromissos existentes não serão alterados.</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost" onClick={() => setDeleteId(undefined)}>Cancelar</button>
              <button type="button" disabled={busy || (requiresReplacement && !moveToId)} className="btn btn-primary" onClick={confirmDelete}>Confirmar exclusão</button>
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
