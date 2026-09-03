import type { Job, Period } from "../types";

export const periodLabels: Record<Period, string> = {
  day: "Gün",
  week: "Hafta",
  month: "Ay",
  year: "Yıl",
};

export function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function dateFromKey(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

export function periodRange(period: Period, anchorKey: string) {
  const anchor = dateFromKey(anchorKey);
  let start = new Date(anchor);
  let end = new Date(anchor);

  if (period === "week") {
    const mondayOffset = (anchor.getDay() + 6) % 7;
    start.setDate(anchor.getDate() - mondayOffset);
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (period === "month") {
    start = new Date(anchor.getFullYear(), anchor.getMonth(), 1, 12);
    end = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0, 12);
  } else if (period === "year") {
    start = new Date(anchor.getFullYear(), 0, 1, 12);
    end = new Date(anchor.getFullYear(), 11, 31, 12);
  }

  const formatter = new Intl.DateTimeFormat("tr-TR", {
    day: period === "year" ? undefined : "numeric",
    month: period === "year" ? undefined : "long",
    year: period === "year" || period === "month" ? "numeric" : undefined,
    weekday: period === "day" ? "long" : undefined,
  });
  let label = formatter.format(anchor);
  if (period === "week") {
    const short = new Intl.DateTimeFormat("tr-TR", { day: "numeric", month: "short" });
    label = `${short.format(start)} – ${short.format(end)}`;
  }
  if (period === "year") label = String(anchor.getFullYear());

  return { start: localDateKey(start), end: localDateKey(end), label };
}

export function shiftAnchor(anchorKey: string, period: Period, amount: number) {
  const date = dateFromKey(anchorKey);
  if (period === "day") date.setDate(date.getDate() + amount);
  if (period === "week") date.setDate(date.getDate() + amount * 7);
  if (period === "month") date.setMonth(date.getMonth() + amount);
  if (period === "year") date.setFullYear(date.getFullYear() + amount);
  return localDateKey(date);
}

export function isInRange(date: string | null, start: string, end: string) {
  return Boolean(date && date >= start && date <= end);
}

export function effectiveJobDate(job: Job, today: string) {
  if (job.status === "paid") return job.paidDate ?? job.plannedDate;
  return job.plannedDate < today ? today : job.plannedDate;
}

export function money(cents: number) {
  return new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
    maximumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

export function shortDate(date: string) {
  return new Intl.DateTimeFormat("tr-TR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(dateFromKey(date));
}

export function parseMoney(value: string, allowZero = false) {
  let normalized = value.trim().replace(/[\s₺]/g, "");
  if (normalized.includes(",")) {
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  }
  const amount = Number(normalized);
  if (!Number.isFinite(amount)) return null;
  const cents = Math.round(amount * 100);
  if (allowZero ? cents < 0 : cents <= 0) return null;
  return cents;
}

export function errorMessage(error: unknown) {
  const code = typeof error === "object" && error && "code" in error
    ? String((error as { code: unknown }).code)
    : "";
  const messages: Record<string, string> = {
    "auth/email-already-in-use": "Bu e-posta ile daha önce hesap açılmış.",
    "auth/invalid-credential": "E-posta veya şifre yanlış.",
    "auth/invalid-email": "E-posta adresini kontrol edin.",
    "auth/missing-password": "Şifrenizi yazın.",
    "auth/weak-password": "Şifre en az 6 karakter olmalı.",
    "auth/too-many-requests": "Çok fazla deneme yapıldı. Biraz sonra tekrar deneyin.",
    "permission-denied": "Bu kayıt için yetkiniz yok.",
    "unavailable": "İnternet bağlantısını kontrol edip tekrar deneyin.",
  };
  if (messages[code]) return messages[code];
  if (error instanceof Error && error.message) return error.message;
  return "İşlem tamamlanamadı. Lütfen tekrar deneyin.";
}
