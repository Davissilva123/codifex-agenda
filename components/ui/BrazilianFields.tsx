"use client";

import { useEffect, useRef, useState } from "react";

function formatBrazilianDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}/${month}/${year}` : "";
}

function parseBrazilianDate(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const [, dayText, monthText, yearText] = match;
  const day = Number(dayText);
  const month = Number(monthText);
  const year = Number(yearText);
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

function isBrazilianTime(value: string): boolean {
  return /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

interface DateFieldProps {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  className?: string;
}

export function BrazilianDateField({
  value,
  onChange,
  required = false,
  className = "field mt-1",
}: DateFieldProps) {
  const [displayValue, setDisplayValue] = useState(() => formatBrazilianDate(value));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDisplayValue(formatBrazilianDate(value)), [value]);

  function update(val: string) {
    const formatted = maskBrazilianDate(val);
    setDisplayValue(formatted);
    const parsed = parseBrazilianDate(formatted);
    const valid = parsed !== null || (!required && formatted === "");
    inputRef.current?.setCustomValidity(valid ? "" : "Informe uma data válida no formato dd/mm/aaaa.");
    if (parsed) onChange(parsed);
    else if (!formatted && !required) onChange("");
  }

  return (
    <input
      ref={inputRef}
      className={className}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="dd/mm/aaaa"
      value={displayValue}
      onChange={(event) => update(event.target.value)}
      onBlur={() => {
        const valid = parseBrazilianDate(displayValue) !== null || (!required && displayValue === "");
        inputRef.current?.setCustomValidity(valid ? "" : "Informe uma data válida no formato dd/mm/aaaa.");
      }}
      required={required}
      maxLength={10}
      aria-label="Data no formato dia/mês/ano"
    />
  );
}

interface TimeFieldProps {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function BrazilianTimeField({ value, onChange, className = "field mt-1" }: TimeFieldProps) {
  const [displayValue, setDisplayValue] = useState(value.slice(0, 5));
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => setDisplayValue(value.slice(0, 5)), [value]);

  function update(val: string) {
    const formatted = maskBrazilianTime(val);
    setDisplayValue(formatted);
    const valid = !formatted || isBrazilianTime(formatted);
    inputRef.current?.setCustomValidity(valid ? "" : "Informe um horário válido no formato 24 horas, HH:mm.");
    onChange(valid ? formatted : "");
  }

  return (
    <input
      ref={inputRef}
      className={className}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="HH:mm"
      value={displayValue}
      onChange={(event) => update(event.target.value)}
      onBlur={() => {
        const valid = !displayValue || isBrazilianTime(displayValue);
        inputRef.current?.setCustomValidity(valid ? "" : "Informe um horário válido no formato 24 horas, HH:mm.");
      }}
      maxLength={5}
      aria-label="Horário no formato 24 horas"
    />
  );
}
