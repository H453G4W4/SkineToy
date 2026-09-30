/** Integer minor-unit money helpers. All arithmetic in this project uses integer minor units. */

const MAX_MAJOR_DIGITS = 9;

export function currencyExponent(currency: string): number {
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  } catch {
    return 2;
  }
}

export function isCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/** Parses a user-entered decimal string ("170", "170.5", "170.50") into minor units. Returns null if invalid. */
export function parseAmount(input: string, currency: string): number | null {
  const exp = currencyExponent(currency);
  const trimmed = input.trim().replace(/,/g, "");
  const re = exp > 0 ? new RegExp(`^(\\d{1,${MAX_MAJOR_DIGITS}})(?:\\.(\\d{1,${exp}}))?$`) : new RegExp(`^(\\d{1,${MAX_MAJOR_DIGITS}})$`);
  const m = re.exec(trimmed);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number((m[2] ?? "").padEnd(exp, "0") || "0");
  const value = major * 10 ** exp + minor;
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export function formatMinor(minor: number, currency: string): string {
  const exp = currencyExponent(currency);
  if (exp === 0) return String(minor);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  const major = Math.floor(abs / 10 ** exp);
  const frac = String(abs % 10 ** exp).padStart(exp, "0");
  return `${sign}${major}.${frac}`;
}

/** "150.00" -> "150", "12.50" -> "12.50" — for compact face value labels. */
export function formatFaceValue(minor: number, currency: string): string {
  const full = formatMinor(minor, currency);
  return full.replace(/\.0+$/, "");
}
