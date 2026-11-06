export function normalizePhoneNumber(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length >= 12 && digits.startsWith("55") ? digits.slice(2) : digits;
}

export function formatBrazilianPhone(value: string): string {
  const digits = normalizePhoneNumber(value).slice(0, 11);
  if (digits.length <= 2) return digits ? `(${digits}` : "";
  const areaCode = digits.slice(0, 2);
  const number = digits.slice(2);
  if (!number) return `(${areaCode})`;
  if (number.length <= 4) return `(${areaCode}) ${number}`;
  if (digits.length <= 10) return `(${areaCode}) ${number.slice(0, 4)}-${number.slice(4)}`;
  return `(${areaCode}) ${number.slice(0, 5)}-${number.slice(5)}`;
}

export function isValidBrazilianPhone(value: string): boolean {
  const digits = normalizePhoneNumber(value);
  return digits.length === 10 || digits.length === 11;
}

export function isValidEmail(value: string): boolean {
  return /^(?=.{1,254}$)(?=.{1,64}@)[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]{0,61}[A-Z0-9])?)+$/i.test(
    value.trim()
  );
}
