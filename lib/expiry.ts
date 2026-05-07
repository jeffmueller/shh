export const EXPIRY_OPTIONS = [
  { value: "first_view", label: "First view", seconds: null },
  { value: "1h", label: "1 hour", seconds: 3600 },
  { value: "6h", label: "6 hours", seconds: 21600 },
  { value: "12h", label: "12 hours", seconds: 43200 },
  { value: "1d", label: "1 day", seconds: 86400 },
  { value: "1w", label: "1 week", seconds: 604800 },
] as const;

export type ExpiryValue = (typeof EXPIRY_OPTIONS)[number]["value"];

export function isValidExpiry(v: unknown): v is ExpiryValue {
  return typeof v === "string" && EXPIRY_OPTIONS.some((o) => o.value === v);
}

export interface ExpiryResolution {
  burnAfterRead: boolean;
  expiresAt: number | null;
}

export function resolveExpiry(value: ExpiryValue, now: number = Math.floor(Date.now() / 1000)): ExpiryResolution {
  const opt = EXPIRY_OPTIONS.find((o) => o.value === value)!;
  if (opt.seconds === null) return { burnAfterRead: true, expiresAt: null };
  return { burnAfterRead: false, expiresAt: now + opt.seconds };
}
