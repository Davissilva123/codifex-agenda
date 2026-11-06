"use client";

import { FormEvent, useState } from "react";
import type { Contact, Phone } from "@/lib/types";
import { formatBrazilianPhone, isValidBrazilianPhone, isValidEmail } from "@/lib/contacts";

export const EMPTY_CONTACT = {
  nome: "",
  email: "",
  empresa: "",
  endereco: "",
  aniversario: "",
  observacoes: "",
  favorito: false,
};

interface ContactFormModalProps {
  initial: Contact | null;
  onSave: (values: typeof EMPTY_CONTACT, phones: Phone[], id?: string) => Promise<void>;
  onClose: () => void;
  busy: boolean;
  DateField: React.ComponentType<{ value: string; onChange: (v: string) => void; required?: boolean; className?: string }>;
}

export function ContactFormModal({
  initial,
  onSave,
  onClose,
  busy,
  DateField,
}: ContactFormModalProps) {
  const [values, setValues] = useState(
    initial
      ? {
          nome: initial.nome,
          email: initial.email,
          empresa: initial.empresa,
          endereco: initial.endereco,
          aniversario: initial.aniversario || "",
          observacoes: initial.observacoes,
          favorito: initial.favorito,
        }
      : EMPTY_CONTACT
  );
  const [phones, setPhones] = useState<Phone[]>(
    initial?.telefones?.length
      ? initial.telefones.map((phone) => ({ ...phone, numero: formatBrazilianPhone(phone.numero) }))
      : [{ numero: "", rotulo: "celular" }]
  );
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    const validPhones = phones.filter((phone) => phone.numero.trim());
    if (!initial && !validPhones.length) {
      setError("Informe pelo menos um telefone para cadastrar o contato.");
      return;
    }
    if (values.email.trim() && !isValidEmail(values.email)) {
      setError("Informe um e-mail válido.");
      return;
    }
    const invalidPhone = validPhones.find((phone) => !isValidBrazilianPhone(phone.numero));
    if (invalidPhone) {
      setError(`O telefone "${invalidPhone.numero}" deve conter DDD e 8 ou 9 dígitos.`);
      return;
    }
    setError("");
    try {
      await onSave(values, validPhones, initial?.id);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Ocorreu um erro ao salvar o contato.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3" role="dialog" aria-modal="true">
      <form onSubmit={submit} className={`contact-form-modal surface max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-2xl p-5 shadow-2xl sm:p-7${initial ? " is-edit" : " is-new"}`}>
        <button type="button" onClick={onClose} className="btn btn-ghost contact-form-close contact-form-close-new" aria-label="Fechar">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>

        <div className="contact-form-section">
          <h3 className="contact-form-section-title">Informações principais</h3>
          <label className="contact-form-label block text-sm font-medium">
            Nome <span className="contact-form-required">*</span>
            <input
              className="field mt-1"
              autoFocus
              required
              maxLength={200}
              placeholder="Ex.: Maria da Silva"
              value={values.nome}
              onChange={(e) => setValues({ ...values, nome: e.target.value })}
            />
          </label>
        </div>

        <div className="contact-form-phone-section mt-4">
          <div className="contact-form-section-heading mb-2 flex items-center justify-between text-sm font-medium">
            <div>
              <h3>{initial ? "Telefones" : <>Telefone <span className="contact-form-required">*</span></>}</h3>
              <p className="muted mt-0.5 text-xs">
                {initial ? "Gerencie os números associados a este contato." : "Obrigatório para cadastrar o contato."}
              </p>
            </div>
            <button
              type="button"
              className="contact-form-add-phone btn btn-ghost px-2 py-1 text-sm text-violet-600"
              onClick={() => setPhones([...phones, { numero: "", rotulo: "celular" }])}
            >
              + <span>{initial ? "Adicionar" : "Adicionar outro"}</span>
            </button>
          </div>
          {phones.map((phone, index) => (
            <div key={index} className="contact-form-phone-row mb-2 flex gap-2">
              <input
                className="field contact-form-phone-input"
                placeholder="(33) 99999-9999"
                type="tel"
                inputMode="numeric"
                maxLength={16}
                required={!initial && index === 0}
                aria-required={!initial && index === 0}
                value={phone.numero}
                onChange={(e) =>
                  setPhones(phones.map((p, i) => (i === index ? { ...p, numero: formatBrazilianPhone(e.target.value) } : p)))
                }
              />
              <select
                className="field max-w-36"
                value={phone.rotulo}
                onChange={(e) =>
                  setPhones(phones.map((p, i) => (i === index ? { ...p, rotulo: e.target.value as Phone["rotulo"] } : p)))
                }
              >
                <option value="celular">Celular</option>
                <option value="casa">Casa</option>
                <option value="trabalho">Trabalho</option>
              </select>
              {phones.length > 1 && (
                (initial || index > 0) && (
                  <button
                    type="button"
                    aria-label="Remover telefone"
                    className="contact-form-remove-phone btn btn-ghost"
                    onClick={() => setPhones(phones.filter((_, i) => i !== index))}
                  >
                    ✕
                  </button>
                )
              )}
            </div>
          ))}
        </div>

        <div className="contact-form-section contact-form-extra-section mt-5">
          <h3 className="contact-form-section-title">
            Detalhes adicionais <span className="muted">· opcionais</span>
          </h3>
          <div className="contact-form-extra-grid grid gap-3 sm:grid-cols-2">
            <label className="contact-form-label text-sm font-medium">
              E-mail
              <input
                className="field mt-1"
                type="email"
                maxLength={254}
                placeholder="nome@exemplo.com"
                value={values.email}
                onChange={(e) => setValues({ ...values, email: e.target.value })}
              />
            </label>
            <label className="contact-form-label text-sm font-medium">
              Empresa
              <input
                className="field mt-1"
                placeholder="Nome da empresa"
                value={values.empresa}
                onChange={(e) => setValues({ ...values, empresa: e.target.value })}
              />
            </label>
            <label className="contact-form-label text-sm font-medium">
              Aniversário
              <DateField
                value={values.aniversario}
                onChange={(aniversario) => setValues((current) => ({ ...current, aniversario }))}
              />
            </label>
            <label className="contact-form-label text-sm font-medium">
              Endereço
              <input
                className="field mt-1"
                placeholder="Rua, cidade..."
                value={values.endereco}
                onChange={(e) => setValues({ ...values, endereco: e.target.value })}
              />
            </label>
          </div>

          <label className="contact-form-favorite mt-4 flex items-center gap-2 text-sm cursor-pointer select-none">
            <input
              type="checkbox"
              checked={values.favorito}
              onChange={(e) => setValues({ ...values, favorito: e.target.checked })}
              className="rounded border-line accent-violet-600"
            />
            Adicionar aos favoritos
          </label>

          <label className="contact-form-label mt-4 block text-sm font-medium">
            Observações
            <textarea
              className="field mt-1 min-h-20"
              placeholder="Informações úteis sobre este contato..."
              value={values.observacoes}
              onChange={(e) => setValues({ ...values, observacoes: e.target.value })}
            />
          </label>
        </div>

        {error && <p className="contact-form-error mt-3 text-sm text-red-600" role="alert">{error}</p>}

        <div className="contact-form-footer mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button disabled={busy} className="btn btn-primary">
            {busy ? "Salvando..." : initial ? "Salvar contato" : "Criar contato"}
          </button>
        </div>
      </form>
    </div>
  );
}
