import { useEffect, useMemo, useState, type ComponentType, type SVGProps } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  Building2,
  Calculator,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  FileDown,
  HandCoins,
  History,
  House,
  LogOut,
  MessageCircle,
  Plus,
  ReceiptText,
  Settings,
  TimerReset,
  Trash2,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";

import type { CashEntry, CompanyData, CompanySettingsInput, Job, NewAdvance, NewCashEntry, NewJob, Period, UserProfile } from "../types";
import {
  effectiveJobDate,
  isInRange,
  localDateKey,
  money,
  parseMoney,
  periodLabels,
  periodRange,
  shiftAnchor,
  shortDate,
} from "../lib/utils";
import {
  AdvanceDialog,
  JobDialog,
  PaymentDialog,
  TransactionDialog,
  type EntryDialog,
} from "./EntryDialogs";
import { Field, Modal } from "./Modal";

type Tab = "overview" | "jobs" | "cash" | "advances" | "vehicles";
type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>;

function normalizedCustomer(value: string) {
  return value.trim().toLocaleLowerCase("tr-TR");
}

function jobPaid(job: Job) {
  if (job.status === "paid") return job.amountCents;
  return Math.max(0, Math.min(job.amountCents, Number(job.paidCents ?? 0)));
}

function jobRemaining(job: Job) {
  return Math.max(0, job.amountCents - jobPaid(job));
}

function overdueDays(job: Job, today: string) {
  if (job.status === "paid" || job.plannedDate >= today) return 0;
  const [sy, sm, sd] = job.plannedDate.split("-").map(Number);
  const [ey, em, ed] = today.split("-").map(Number);
  return Math.max(0, Math.floor((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86_400_000));
}

function customerCredit(data: CompanyData, customerName: string) {
  const key = normalizedCustomer(customerName);
  return data.customerAccounts.find((item) => normalizedCustomer(item.customerName) === key)?.creditCents ?? 0;
}

async function compressLogo(file: File) {
  if (!file.type.startsWith("image/")) throw new Error("Logo için bir görsel dosyası seçin.");
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Logo görseli açılamadı."));
      image.src = url;
    });
    const max = 480;
    const ratio = Math.min(1, max / Math.max(image.naturalWidth, image.naturalHeight));
    const width = Math.max(1, Math.round(image.naturalWidth * ratio));
    const height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Logo işlenemedi.");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    let dataUrl = canvas.toDataURL("image/jpeg", 0.82);
    if (dataUrl.length > 280_000) dataUrl = canvas.toDataURL("image/jpeg", 0.64);
    if (dataUrl.length > 300_000) throw new Error("Logo hâlâ çok büyük. Daha küçük bir görsel seçin.");
    return dataUrl;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function Dashboard({
  profile,
  data,
  busy,
  onAddCash,
  onAddAdvance,
  onAddJob,
  onAddPayment,
  onCollectCustomer,
  onDeleteJob,
  onDeleteCash,
  onSaveCompany,
  onLogout,
  notify,
}: {
  profile: UserProfile;
  data: CompanyData;
  busy: boolean;
  onAddCash: (entry: NewCashEntry) => Promise<void>;
  onAddAdvance: (entry: NewAdvance) => Promise<void>;
  onAddJob: (entry: NewJob) => Promise<void>;
  onAddPayment: (jobId: string, amountCents: number, paidDate: string, note: string) => Promise<void>;
  onCollectCustomer: (customerName: string, amountCents: number, paidDate: string, note: string) => Promise<void>;
  onDeleteJob: (jobId: string) => Promise<void>;
  onDeleteCash: (entryId: string) => Promise<void>;
  onSaveCompany: (values: CompanySettingsInput) => Promise<void>;
  onLogout: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [anchor, setAnchor] = useState(localDateKey());
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<EntryDialog>(null);
  const [paymentJob, setPaymentJob] = useState<Job | null>(null);
  const [customerOpen, setCustomerOpen] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [jobFrom, setJobFrom] = useState("");
  const [jobTo, setJobTo] = useState("");

  const today = localDateKey();
  const range = periodRange(period, anchor);

  const customers = useMemo(() => {
    const map = new Map<string, string>();
    data.jobs.forEach((job) => {
      const key = normalizedCustomer(job.customerName);
      if (key && !map.has(key)) map.set(key, job.customerName.trim());
    });
    return Array.from(map.values()).sort((a, b) => a.localeCompare(b, "tr"));
  }, [data.jobs]);

  const computed = useMemo(() => {
    const cashEntries = data.cashEntries.filter((item) => isInRange(item.entryDate, range.start, range.end));
    const advances = data.advances.filter((item) => isInRange(item.entryDate, range.start, range.end));
    const jobs = data.jobs.filter((item) => isInRange(effectiveJobDate(item, today), range.start, range.end));
    const openJobs = jobs
      .filter((item) => item.status !== "paid")
      .sort((a, b) => effectiveJobDate(a, today).localeCompare(effectiveJobDate(b, today)));
    const income = cashEntries.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amountCents, 0);
    const expense = cashEntries.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amountCents, 0);
    const advanceTotal = advances.reduce((sum, item) => sum + item.amountCents, 0);
    const receivables = openJobs.reduce((sum, item) => sum + jobRemaining(item), 0);
    const overdueJobs = openJobs.filter((item) => overdueDays(item, today) > 0);
    const overdueReceivables = overdueJobs.reduce((sum, item) => sum + jobRemaining(item), 0);
    const vehicleFees = jobs.reduce((sum, item) => sum + item.serviceFeeCents, 0);
    return { cashEntries, advances, jobs, openJobs, overdueJobs, income, expense, advanceTotal, receivables, overdueReceivables, vehicleFees, balance: income - expense - advanceTotal };
  }, [data, range.start, range.end, today]);

  const settlement = useMemo(() => {
    const periodJobs = data.jobs.filter((job) => isInRange(job.plannedDate, range.start, range.end));
    const vehicleTotal = periodJobs.reduce((sum, job) => sum + job.serviceFeeCents, 0);
    const partnershipPool = computed.income - computed.expense - vehicleTotal;
    const partnerCount = Math.max(1, data.partners.length);
    const baseShare = Math.trunc(partnershipPool / partnerCount);
    const remainder = partnershipPool - baseShare * partnerCount;
    const rows = data.partners.map((partner, index) => {
      const vehicleFee = periodJobs.filter((job) => job.vehiclePartnerId === partner.id).reduce((sum, job) => sum + job.serviceFeeCents, 0);
      const advance = computed.advances.filter((item) => item.partnerId === partner.id).reduce((sum, item) => sum + item.amountCents, 0);
      const share = baseShare + (index === 0 ? remainder : 0);
      return { partner, vehicleFee, advance, share, settlement: share + vehicleFee - advance };
    });
    return { vehicleTotal, partnershipPool, rows };
  }, [data.jobs, data.partners, computed.income, computed.expense, computed.advances, range.start, range.end]);

  const customRangeActive = Boolean(jobFrom && jobTo);
  const jobsForView = useMemo(() => {
    const source = customRangeActive
      ? data.jobs.filter((job) => job.plannedDate >= jobFrom && job.plannedDate <= jobTo)
      : computed.jobs;
    return [...source].sort((a, b) => b.plannedDate.localeCompare(a.plannedDate));
  }, [customRangeActive, data.jobs, computed.jobs, jobFrom, jobTo]);

  const jobTotals = useMemo(() => {
    const billed = jobsForView.reduce((sum, job) => sum + job.amountCents, 0);
    const paid = jobsForView.reduce((sum, job) => sum + jobPaid(job), 0);
    return { billed, paid, remaining: Math.max(0, billed - paid) };
  }, [jobsForView]);

  const recentMovements = useMemo(() => [
    ...computed.cashEntries.map((item) => ({
      id: item.id,
      date: item.entryDate,
      title: item.counterparty || item.category,
      detail: item.category,
      amount: item.kind === "income" ? item.amountCents : -item.amountCents,
      type: item.kind as "income" | "expense",
    })),
    ...computed.advances.map((item) => ({
      id: item.id,
      date: item.entryDate,
      title: `${item.partnerName} avans`,
      detail: item.note || "Avans",
      amount: -item.amountCents,
      type: "advance" as const,
    })),
  ].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 6), [computed]);

  const perform = async (action: () => Promise<void>, successMessage: string, close?: () => void) => {
    try {
      await action();
      close?.();
      notify(successMessage, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Kayıt tamamlanamadı.", "error");
    }
  };

  const confirmDeleteJob = (job: Job) => {
    const linkedPayments = data.cashEntries.filter((item) => item.jobId === job.id).length;
    const extra = linkedPayments ? ` Bu işe bağlı ${linkedPayments} ödeme kaydı da silinecek.` : "";
    if (!window.confirm(`${job.customerName} - ${job.title} işini silmek istiyor musunuz?${extra}`)) return;
    void perform(() => onDeleteJob(job.id), "İş kaydı silindi.");
  };

  const confirmDeleteCash = (entry: CashEntry) => {
    const linked = entry.jobId ? " Bu ödeme bir işe bağlıysa işin kalan borcu otomatik güncellenecek." : "";
    if (!window.confirm(`${money(entry.amountCents)} tutarındaki ${entry.kind === "income" ? "gelir" : "gider"} kaydını silmek istiyor musunuz?${linked}`)) return;
    void perform(() => onDeleteCash(entry.id), "Kasa kaydı silindi.");
  };

  const renderPdfAndShare = async ({
    html,
    filename,
    title,
    text,
    orientation = "portrait",
    width = 900,
  }: {
    html: string;
    filename: string;
    title: string;
    text: string;
    orientation?: "portrait" | "landscape";
    width?: number;
  }) => {
    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-12000px";
    host.style.top = "0";
    host.style.width = `${width}px`;
    host.style.background = "#ffffff";
    host.innerHTML = html;
    Array.from(host.querySelectorAll("td")).forEach((cell) => {
      const el = cell as HTMLElement;
      el.style.padding = "10px 9px";
      el.style.borderBottom = "1px solid #e2e8f0";
      if (el.classList.contains("num")) el.style.textAlign = "right";
    });

    document.body.appendChild(host);
    try {
      const canvas = await html2canvas(host.firstElementChild as HTMLElement, {
        scale: 2,
        backgroundColor: "#ffffff",
        useCORS: true,
        logging: false,
      });
      const pdf = new jsPDF({ orientation, unit: "mm", format: "a4" });
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 8;
      const imageWidth = pageWidth - margin * 2;
      const imageHeight = (canvas.height * imageWidth) / canvas.width;
      const image = canvas.toDataURL("image/png", 1);
      const usableHeight = pageHeight - margin * 2;
      let offset = 0;
      let firstPage = true;

      while (offset < imageHeight) {
        if (!firstPage) pdf.addPage();
        pdf.addImage(image, "PNG", margin, margin - offset, imageWidth, imageHeight, undefined, "FAST");
        offset += usableHeight;
        firstPage = false;
      }

      if (Capacitor.isNativePlatform()) {
        const dataUri = pdf.output("datauristring");
        const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
        await Filesystem.writeFile({ path: filename, data: base64, directory: Directory.Cache });
        const result = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
        await Share.share({
          title,
          text,
          files: [result.uri],
          dialogTitle: "WhatsApp, e-posta veya başka bir uygulama ile paylaş",
        });
      } else {
        pdf.save(filename);
      }
    } finally {
      host.remove();
    }
  };

  const companyLogo = data.company.logoDataUrl || new URL("icon-512.png", window.location.href).href;
  const companyInfoLines = [
    data.company.phone ? `Tel: ${escapeHtml(data.company.phone)}` : "",
    data.company.email ? `E-posta: ${escapeHtml(data.company.email)}` : "",
    data.company.address ? escapeHtml(data.company.address) : "",
    data.company.taxOffice || data.company.taxNumber
      ? `${escapeHtml(data.company.taxOffice || "")} ${data.company.taxNumber ? `· VKN/TCKN: ${escapeHtml(data.company.taxNumber)}` : ""}`
      : "",
  ].filter(Boolean);

  const exportPdf = async () => {
    if (!jobsForView.length) {
      notify("PDF oluşturmak için seçili aralıkta en az bir iş olmalı.", "info");
      return;
    }

    const reportStart = customRangeActive ? jobFrom : range.start;
    const reportEnd = customRangeActive ? jobTo : range.end;
    const rows = jobsForView.map((job) => {
      const paid = jobPaid(job);
      const remaining = jobRemaining(job);
      const overdue = overdueDays(job, today);
      return `
        <tr>
          <td>${escapeHtml(shortDate(job.plannedDate))}</td>
          <td>${escapeHtml(job.customerName)}</td>
          <td>${escapeHtml(job.title)}</td>
          <td class="num">${escapeHtml(money(job.amountCents))}</td>
          <td class="num">${escapeHtml(money(paid))}</td>
          <td class="num">${escapeHtml(money(remaining))}</td>
          <td>${job.status === "paid" ? "Tamamlandı" : overdue > 0 ? `${overdue} gün gecikmiş` : job.status === "partial" ? "Kısmi ödendi" : "Bekliyor"}</td>
        </tr>`;
    }).join("");

    const html = `
      <section style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff;padding:44px 48px;width:1120px;box-sizing:border-box;">
        <header style="display:flex;align-items:flex-start;justify-content:space-between;border-bottom:3px solid #0f766e;padding-bottom:22px;margin-bottom:24px;gap:24px;">
          <div style="display:flex;align-items:flex-start;gap:18px;max-width:690px;">
            <img src="${companyLogo}" alt="logo" style="width:76px;height:76px;border-radius:18px;object-fit:contain;border:1px solid #e2e8f0;background:#fff;" />
            <div>
              <div style="font-size:30px;font-weight:800;letter-spacing:-0.5px;">${escapeHtml(data.company.name)}</div>
              <div style="font-size:15px;color:#64748b;margin-top:5px;">Ortak Kasa · İş ve Tahsilat Raporu</div>
              ${companyInfoLines.length ? `<div style="font-size:11px;color:#64748b;line-height:1.5;margin-top:8px;">${companyInfoLines.join("<br>")}</div>` : ""}
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:13px;color:#64748b;">Rapor aralığı</div>
            <div style="font-size:17px;font-weight:700;">${escapeHtml(shortDate(reportStart))} – ${escapeHtml(shortDate(reportEnd))}</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;">Oluşturma: ${escapeHtml(new Date().toLocaleString("tr-TR"))}</div>
          </div>
        </header>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:26px;">
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;"><span style="display:block;color:#64748b;font-size:13px;">İş sayısı</span><strong style="font-size:24px;">${jobsForView.length}</strong></div>
          <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:14px;padding:16px;"><span style="display:block;color:#64748b;font-size:13px;">Toplam iş</span><strong style="font-size:22px;">${escapeHtml(money(jobTotals.billed))}</strong></div>
          <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:14px;padding:16px;"><span style="display:block;color:#047857;font-size:13px;">Tahsil edilen</span><strong style="font-size:22px;color:#065f46;">${escapeHtml(money(jobTotals.paid))}</strong></div>
          <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:14px;padding:16px;"><span style="display:block;color:#c2410c;font-size:13px;">Kalan alacak</span><strong style="font-size:22px;color:#9a3412;">${escapeHtml(money(jobTotals.remaining))}</strong></div>
        </div>

        <table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="background:#0f172a;color:#fff;">
            <th style="text-align:left;padding:11px 9px;">Tarih</th><th style="text-align:left;padding:11px 9px;">Müşteri</th><th style="text-align:left;padding:11px 9px;">İş</th>
            <th style="text-align:right;padding:11px 9px;">Toplam</th><th style="text-align:right;padding:11px 9px;">Alınan</th><th style="text-align:right;padding:11px 9px;">Kalan</th><th style="text-align:left;padding:11px 9px;">Durum</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <footer style="margin-top:26px;border-top:1px solid #e2e8f0;padding-top:14px;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;">
          <span>${escapeHtml(data.company.name)} · Ortak Kasa</span><span>Bu rapor uygulamadaki kayıtlar esas alınarak oluşturulmuştur.</span>
        </footer>
      </section>`;

    try {
      await renderPdfAndShare({
        html,
        width: 1120,
        orientation: "landscape",
        filename: `Ortak-Kasa_Is-Raporu_${reportStart}_${reportEnd}.pdf`,
        title: `${data.company.name} iş raporu`,
        text: `${shortDate(reportStart)} - ${shortDate(reportEnd)} iş ve tahsilat raporu`,
      });
      notify("Kurumsal PDF raporu oluşturuldu.", "success");
    } catch (error) {
      notify(error instanceof Error ? `PDF oluşturulamadı: ${error.message}` : "PDF oluşturulamadı.", "error");
    }
  };

  const exportCustomerStatement = async (customerName: string) => {
    const key = normalizedCustomer(customerName);
    const customerJobs = data.jobs
      .filter((job) => normalizedCustomer(job.customerName) === key)
      .sort((a, b) => a.plannedDate.localeCompare(b.plannedDate));
    const jobIds = new Set(customerJobs.map((job) => job.id));
    const payments = data.cashEntries
      .filter((entry) => entry.kind === "income" && normalizedCustomer(entry.counterparty) === key && (entry.jobId ? jobIds.has(entry.jobId) : entry.category === "Müşteri avansı"))
      .sort((a, b) => a.entryDate.localeCompare(b.entryDate));
    const billed = customerJobs.reduce((sum, job) => sum + job.amountCents, 0);
    const allocated = customerJobs.reduce((sum, job) => sum + jobPaid(job), 0);
    const remaining = Math.max(0, billed - allocated);
    const credit = customerCredit(data, customerName);
    const jobRows = customerJobs.map((job) => `
      <tr><td>${escapeHtml(shortDate(job.plannedDate))}</td><td>${escapeHtml(job.title)}</td><td class="num">${escapeHtml(money(job.amountCents))}</td><td class="num">${escapeHtml(money(jobPaid(job)))}</td><td class="num">${escapeHtml(money(jobRemaining(job)))}</td></tr>`).join("");
    const paymentRows = payments.map((entry) => `
      <tr><td>${escapeHtml(shortDate(entry.entryDate))}</td><td>${escapeHtml(entry.category)}</td><td>${escapeHtml(entry.note || "Tahsilat")}</td><td class="num">${escapeHtml(money(entry.amountCents))}</td></tr>`).join("");

    const html = `
      <section style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff;padding:40px 42px;width:900px;box-sizing:border-box;">
        <header style="display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #0f766e;padding-bottom:20px;margin-bottom:22px;">
          <div style="display:flex;gap:16px;align-items:flex-start;">
            <img src="${companyLogo}" style="width:72px;height:72px;border-radius:16px;object-fit:contain;border:1px solid #e2e8f0;" />
            <div><div style="font-size:27px;font-weight:800;">${escapeHtml(data.company.name)}</div><div style="color:#64748b;margin-top:4px;">Müşteri Hesap Ekstresi</div>${companyInfoLines.length ? `<div style="font-size:11px;color:#64748b;line-height:1.5;margin-top:7px;">${companyInfoLines.join("<br>")}</div>` : ""}</div>
          </div>
          <div style="text-align:right;"><strong style="font-size:18px;">${escapeHtml(customerName)}</strong><div style="font-size:11px;color:#94a3b8;margin-top:5px;">${escapeHtml(new Date().toLocaleString("tr-TR"))}</div></div>
        </header>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px;">
          <div style="padding:14px;border:1px solid #e2e8f0;border-radius:12px;"><span style="display:block;font-size:12px;color:#64748b;">Toplam iş</span><strong>${escapeHtml(money(billed))}</strong></div>
          <div style="padding:14px;border:1px solid #a7f3d0;background:#ecfdf5;border-radius:12px;"><span style="display:block;font-size:12px;color:#047857;">İşlere işlenen</span><strong>${escapeHtml(money(allocated))}</strong></div>
          <div style="padding:14px;border:1px solid #fed7aa;background:#fff7ed;border-radius:12px;"><span style="display:block;font-size:12px;color:#c2410c;">Kalan borç</span><strong>${escapeHtml(money(remaining))}</strong></div>
          <div style="padding:14px;border:1px solid #bfdbfe;background:#eff6ff;border-radius:12px;"><span style="display:block;font-size:12px;color:#1d4ed8;">Müşteri avansı</span><strong>${escapeHtml(money(credit))}</strong></div>
        </div>
        <h3 style="margin:0 0 10px;">Yapılan işler</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:24px;"><thead><tr style="background:#0f172a;color:#fff;"><th style="text-align:left;padding:9px;">Tarih</th><th style="text-align:left;padding:9px;">İş</th><th style="text-align:right;padding:9px;">Tutar</th><th style="text-align:right;padding:9px;">Alınan</th><th style="text-align:right;padding:9px;">Kalan</th></tr></thead><tbody>${jobRows || '<tr><td colspan="5">Kayıt yok</td></tr>'}</tbody></table>
        <h3 style="margin:0 0 10px;">Tahsilat geçmişi</h3>
        <table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr style="background:#0f766e;color:#fff;"><th style="text-align:left;padding:9px;">Tarih</th><th style="text-align:left;padding:9px;">Tür</th><th style="text-align:left;padding:9px;">Açıklama</th><th style="text-align:right;padding:9px;">Tutar</th></tr></thead><tbody>${paymentRows || '<tr><td colspan="4">Tahsilat kaydı yok</td></tr>'}</tbody></table>
        <footer style="margin-top:24px;border-top:1px solid #e2e8f0;padding-top:12px;font-size:11px;color:#94a3b8;">${escapeHtml(data.company.name)} · Bu ekstre Ortak Kasa kayıtlarından otomatik oluşturulmuştur.</footer>
      </section>`;

    const safe = customerName.replace(/[^a-zA-Z0-9ğüşöçıİĞÜŞÖÇ]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 45) || "Musteri";
    try {
      await renderPdfAndShare({
        html,
        filename: `Hesap-Ekstresi_${safe}_${localDateKey()}.pdf`,
        title: `${data.company.name} · ${customerName} hesap ekstresi`,
        text: `${customerName} için kalan borç ${money(remaining)}, müşteri avansı ${money(credit)}.`,
      });
      notify("Müşteri hesap ekstresi paylaşmaya hazır.", "success");
    } catch (error) {
      notify(error instanceof Error ? `Ekstre oluşturulamadı: ${error.message}` : "Ekstre oluşturulamadı.", "error");
    }
  };

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-block compact">
            {data.company.logoDataUrl
              ? <img className="brand-company-logo" src={data.company.logoDataUrl} alt={`${data.company.name} logosu`} />
              : <div className="brand-mark small">OK</div>}
            <div className="header-brand-copy"><h1>{data.company.name}</h1><p>Ortak Kasa · Buluta bağlı</p></div>
          </div>
          <button className="header-settings" type="button" onClick={() => setSettingsOpen(true)} aria-label="Ayarlar">
            <Settings size={22} />
          </button>
        </div>
      </header>

      <main className="dashboard-shell">
        <section className="period-row">
          <div className="segmented period-tabs">
            {(Object.keys(periodLabels) as Period[]).map((item) => (
              <button key={item} type="button" className={period === item ? "active" : ""} onClick={() => setPeriod(item)}>{periodLabels[item]}</button>
            ))}
          </div>
          <div className="date-stepper">
            <button type="button" onClick={() => setAnchor((value) => shiftAnchor(value, period, -1))} aria-label="Önceki dönem"><ChevronLeft size={20} /></button>
            <button className="date-label" type="button" onClick={() => setAnchor(today)} title="Bugüne dön">{range.label}</button>
            <button type="button" onClick={() => setAnchor((value) => shiftAnchor(value, period, 1))} aria-label="Sonraki dönem"><ChevronRight size={20} /></button>
          </div>
        </section>

        <section className="balance-card">
          <div className="balance-grid-lines" />
          <div className="balance-main">
            <span>Dönem kasa durumu</span>
            <strong className={computed.balance < 0 ? "negative" : ""}>{money(computed.balance)}</strong>
            <small>Gelir − gider − avans</small>
          </div>
          <div className="stats-grid">
            <MiniStat label="Gelir" value={computed.income} tone="mint" />
            <MiniStat label="Gider" value={computed.expense} tone="rose" />
            <MiniStat label="Avans" value={computed.advanceTotal} tone="gold" />
            <MiniStat label="Bekleyen" value={computed.receivables} tone="blue" />
          </div>
        </section>

        <DesktopTabs tab={tab} onChange={setTab} />

        {tab === "overview" && (
          <section className="tab-content">
            <div>
              <p className="eyebrow">Hızlı kayıt</p>
              <div className="quick-actions">
                <QuickAction label="İş ekle" icon={BriefcaseBusiness} tone="dark" onClick={() => setDialog("job")} />
                <QuickAction label="Gelir" icon={ArrowDown} tone="mint" onClick={() => setDialog("income")} />
                <QuickAction label="Gider" icon={ArrowUp} tone="rose" onClick={() => setDialog("expense")} />
                <QuickAction label="Avans" icon={HandCoins} tone="gold" onClick={() => setDialog("advance")} />
              </div>
            </div>

            {computed.overdueJobs.length > 0 && (
              <button className="overdue-card" type="button" onClick={() => setTab("jobs")}>
                <span className="row-icon rose"><TimerReset size={21} /></span>
                <span><strong>{computed.overdueJobs.length} vadesi geçmiş iş</strong><small>Toplam gecikmiş alacak {money(computed.overdueReceivables)}</small></span>
                <b>İşleri gör</b>
              </button>
            )}

            <div className="two-column">
              <Panel title="Bekleyen işler" subtitle="Kalan borç sıfırlanana kadar takip edilir" badge={computed.openJobs.length}>
                {computed.openJobs.length ? computed.openJobs.slice(0, 6).map((job) => (
                  <CompactJob
                    key={job.id}
                    job={job}
                    today={today}
                    onPaid={() => setPaymentJob(job)}
                    onCustomer={() => setCustomerOpen(job.customerName)}
                  />
                )) : <Empty icon={Check} text="Bu dönemde bekleyen iş yok." />}
              </Panel>
              <Panel title="Son hareketler" subtitle="Seçili dönemin kasa akışı">
                {recentMovements.length ? recentMovements.map((item) => <MovementRow key={`${item.type}-${item.id}`} item={item} />) : <Empty icon={ReceiptText} text="Bu dönemde hareket yok." />}
              </Panel>
            </div>

            <section className="settlement-card">
              <header className="settlement-head">
                <span className="row-icon gold"><Calculator size={21} /></span>
                <div><strong>Ortak hesaplaşması</strong><small>{range.label} için gelir, gider, araç payı ve avanslara göre</small></div>
              </header>
              <div className="settlement-summary">
                <SummaryBox label="Kasa geliri − gider" value={computed.income - computed.expense} />
                <SummaryBox label="Araç / servis payı" value={settlement.vehicleTotal} tone="warning" />
                <SummaryBox label="Eşit bölünecek havuz" value={settlement.partnershipPool} tone={settlement.partnershipPool >= 0 ? "positive" : "warning"} />
              </div>
              <div className="settlement-rows">
                {settlement.rows.map(({ partner, vehicleFee, advance, share, settlement: amount }) => (
                  <div className="settlement-row" key={partner.id}>
                    <span><strong>{partner.name}</strong><small>Eşit pay {money(share)} + araç {money(vehicleFee)} − avans {money(advance)}</small></span>
                    <b className={amount < 0 ? "negative" : "positive"}>{money(amount)}</b>
                  </div>
                ))}
              </div>
              <p className="settlement-note">Formül: dönem kasa geliri − gider − araç/servis payları eşit bölünür; araç payı ilgili ortağa eklenir, aldığı avans kendi payından düşülür. Aylık hesap için üstten “Ay” seçin.</p>
            </section>

            {computed.vehicleFees > 0 && (
              <button className="vehicle-summary" type="button" onClick={() => setTab("vehicles")}>
                <span className="row-icon mint"><Car size={21} /></span>
                <span><strong>Araç servis toplamı</strong><small>Seçili dönemde yazılan araç payı</small></span>
                <b>{money(computed.vehicleFees)}</b>
              </button>
            )}
          </section>
        )}

        {tab === "jobs" && (
          <section className="tab-content">
            <SectionHeading title="İş takibi" description={`${jobsForView.length} kayıt`} button="İş ekle" onClick={() => setDialog("job")} />

            <section className="job-filter-card">
              <div className="job-filter-head">
                <div><strong>Tarih aralığına göre iş raporu</strong><span>İki tarih seçildiğinde bu bölüm yalnızca o aralıktaki işleri toplar.</span></div>
                <button className="button button-primary compact-button" type="button" onClick={() => void exportPdf()}><FileDown size={18} /> PDF</button>
              </div>
              <div className="job-filter-grid">
                <label><span>Başlangıç</span><input type="date" value={jobFrom} onChange={(event) => setJobFrom(event.target.value)} /></label>
                <label><span>Bitiş</span><input type="date" value={jobTo} onChange={(event) => setJobTo(event.target.value)} /></label>
                <button className="button button-ghost" type="button" onClick={() => { setJobFrom(""); setJobTo(""); }}>Filtreyi temizle</button>
              </div>
              <div className="job-summary-grid">
                <SummaryBox label="İş toplamı" value={jobTotals.billed} />
                <SummaryBox label="Alınan" value={jobTotals.paid} tone="positive" />
                <SummaryBox label="Kalan alacak" value={jobTotals.remaining} tone="warning" />
              </div>
            </section>

            {customers.length > 0 && (
              <section>
                <p className="eyebrow">Kayıtlı müşteriler</p>
                <div className="customer-chip-list">
                  {customers.map((customer) => (
                    <button key={customer} className="customer-chip" type="button" onClick={() => setCustomerOpen(customer)}>
                      <UserRound size={17} /> {customer}
                    </button>
                  ))}
                </div>
              </section>
            )}

            {jobsForView.length ? (
              <div className="job-grid">
                {jobsForView.map((job) => (
                  <JobCard
                    key={job.id}
                    job={job}
                    today={today}
                    onPaid={() => setPaymentJob(job)}
                    onCustomer={() => setCustomerOpen(job.customerName)}
                    onDelete={() => confirmDeleteJob(job)}
                  />
                ))}
              </div>
            ) : <LargeEmpty icon={BriefcaseBusiness} title="Bu aralıkta iş yok" text="Tarih filtresini değiştirin veya yeni iş ekleyin." button="İş ekle" onClick={() => setDialog("job")} />}
          </section>
        )}

        {tab === "cash" && (
          <section className="tab-content">
            <SectionHeading title="Gelir ve gider" description={`${computed.cashEntries.length} hareket`} />
            <div className="dual-actions">
              <button className="button button-income" type="button" onClick={() => setDialog("income")}><ArrowDown size={19} /> Gelir ekle</button>
              <button className="button button-expense" type="button" onClick={() => setDialog("expense")}><ArrowUp size={19} /> Gider ekle</button>
            </div>
            <Panel>
              {computed.cashEntries.length
                ? computed.cashEntries.map((item) => <CashRow key={item.id} entry={item} onDelete={() => confirmDeleteCash(item)} />)
                : <Empty icon={ReceiptText} text="Bu dönemde gelir veya gider yok." />}
            </Panel>
          </section>
        )}

        {tab === "advances" && (
          <section className="tab-content">
            <SectionHeading title="Ortak avansları" description={`${computed.advances.length} parça ödeme`} button="Avans ekle" onClick={() => setDialog("advance")} />
            <div className="partner-grid">
              {data.partners.map((partner) => {
                const total = computed.advances.filter((item) => item.partnerId === partner.id).reduce((sum, item) => sum + item.amountCents, 0);
                return <PartnerTotal key={partner.id} name={partner.name} value={total} icon={UserRound} label="Dönem avansı" />;
              })}
            </div>
            <Panel>
              {computed.advances.length
                ? computed.advances.map((item) => <MovementRow key={item.id} item={{ id: item.id, date: item.entryDate, title: item.partnerName, detail: item.note || "Avans", amount: -item.amountCents, type: "advance" }} />)
                : <Empty icon={HandCoins} text="Bu dönemde avans kaydı yok." />}
            </Panel>
          </section>
        )}

        {tab === "vehicles" && (
          <section className="tab-content">
            <SectionHeading title="Araç ve servis" description="Kimin aracıyla çalışıldığını takip edin" button="İş ekle" onClick={() => setDialog("job")} />
            <div className="partner-grid">
              {data.partners.map((partner) => {
                const total = computed.jobs.filter((job) => job.vehiclePartnerId === partner.id).reduce((sum, job) => sum + job.serviceFeeCents, 0);
                return <PartnerTotal key={partner.id} name={`${partner.name} aracı`} value={total} icon={Car} label="Dönem servis payı" />;
              })}
            </div>
            <Panel title="Araç kullanılan işler" subtitle={`${computed.jobs.filter((job) => job.vehiclePartnerId).length} kayıt`}>
              {computed.jobs.some((job) => job.vehiclePartnerId)
                ? computed.jobs.filter((job) => job.vehiclePartnerId).map((job) => <VehicleRow key={job.id} job={job} />)
                : <Empty icon={Car} text="Bu dönemde araç kaydı yok." />}
            </Panel>
          </section>
        )}
      </main>

      <MobileNav tab={tab} onChange={setTab} />

      <TransactionDialog kind="income" open={dialog === "income"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddCash(entry), "Gelir kaydedildi.", () => setDialog(null))} />
      <TransactionDialog kind="expense" open={dialog === "expense"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddCash(entry), "Gider kaydedildi.", () => setDialog(null))} />
      <AdvanceDialog partners={data.partners} open={dialog === "advance"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddAdvance(entry), "Avans kaydedildi.", () => setDialog(null))} />
      <JobDialog customers={customers} partners={data.partners} open={dialog === "job"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddJob(entry), "İş kaydedildi. Müşteri artık kayıtlı müşteri olarak görünecek.", () => setDialog(null))} />
      <PaymentDialog job={paymentJob} busy={busy} onClose={() => setPaymentJob(null)} onInvalid={(message) => notify(message, "error")} onSave={(jobId, amountCents, paidDate, note) => perform(() => onAddPayment(jobId, amountCents, paidDate, note), "Ödeme kasaya işlendi ve kalan borç güncellendi.", () => setPaymentJob(null))} />
      <CustomerHistoryModal
        customerName={customerOpen}
        data={data}
        today={today}
        busy={busy}
        onClose={() => setCustomerOpen(null)}
        onPay={(job) => { setCustomerOpen(null); setPaymentJob(job); }}
        onInvalid={(message) => notify(message, "error")}
        onShareStatement={(customerName) => void exportCustomerStatement(customerName)}
        onCollect={(customerName, amountCents, paidDate, note) =>
          perform(
            () => onCollectCustomer(customerName, amountCents, paidDate, note),
            "Tahsilat işlendi. Açık borçları aşan kısım müşteri avansı olarak saklandı.",
          )
        }
      />
      <SettingsModal open={settingsOpen} busy={busy} onClose={() => setSettingsOpen(false)} profile={profile} data={data} onSaveCompany={onSaveCompany} onLogout={onLogout} notify={notify} />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "mint" | "rose" | "gold" | "blue" }) {
  return <div className={`mini-stat ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>;
}

function SummaryBox({ label, value, tone = "" }: { label: string; value: number; tone?: "positive" | "warning" | "" }) {
  return <div className={`job-summary-box ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>;
}

function QuickAction({ label, icon: IconComponent, tone, onClick }: { label: string; icon: Icon; tone: string; onClick: () => void }) {
  return <button className={`quick-action ${tone}`} type="button" onClick={onClick}><IconComponent size={21} /><span>{label}</span></button>;
}

function Panel({ title, subtitle, badge, children }: { title?: string; subtitle?: string; badge?: number; children: React.ReactNode }) {
  return <section className="panel">{title && <header className="panel-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{badge !== undefined && <span className="count-badge">{badge}</span>}</header>}<div className="panel-body">{children}</div></section>;
}

function CompactJob({ job, today, onPaid, onCustomer }: { job: Job; today: string; onPaid: () => void; onCustomer: () => void }) {
  const days = overdueDays(job, today);
  const remaining = jobRemaining(job);
  return (
    <div className={`list-row ${days > 0 ? "overdue-row" : ""}`}>
      <span className={`row-icon ${days > 0 ? "rose" : "gold"}`}><BriefcaseBusiness size={20} /></span>
      <button className="row-copy row-copy-button" type="button" onClick={onCustomer}>
        <strong>{job.customerName}</strong>
        <small>{job.title}{days > 0 ? ` · ${days} gün gecikti` : job.status === "partial" ? " · Kısmi ödendi" : ""}</small>
      </button>
      <span className="row-end"><b className={days > 0 ? "negative" : ""}>{money(remaining)}</b><button type="button" onClick={onPaid}>Ödeme al</button></span>
    </div>
  );
}

type Movement = { id: string; date: string; title: string; detail: string; amount: number; type: "income" | "expense" | "advance" };

function MovementRow({ item }: { item: Movement }) {
  const positive = item.amount >= 0;
  const IconComponent = item.type === "advance" ? HandCoins : positive ? ArrowDown : ArrowUp;
  const tone = positive ? "mint" : item.type === "advance" ? "gold" : "rose";
  return <div className="list-row"><span className={`row-icon ${tone}`}><IconComponent size={20} /></span><span className="row-copy"><strong>{item.title}</strong><small>{item.detail} · {shortDate(item.date)}</small></span><b className={`movement-amount ${positive ? "positive" : "negative"}`}>{positive ? "+" : "−"}{money(Math.abs(item.amount))}</b></div>;
}

function CashRow({ entry, onDelete }: { entry: CashEntry; onDelete: () => void }) {
  const positive = entry.kind === "income";
  return (
    <div className="list-row">
      <span className={`row-icon ${positive ? "mint" : "rose"}`}>{positive ? <ArrowDown size={20} /> : <ArrowUp size={20} />}</span>
      <span className="row-copy">
        <strong>{entry.counterparty || entry.category}</strong>
        <small>{entry.category} · {shortDate(entry.entryDate)}{entry.jobId ? " · İşe bağlı ödeme" : ""}</small>
      </span>
      <span className="cash-row-end">
        <b className={`movement-amount ${positive ? "positive" : "negative"}`}>{positive ? "+" : "−"}{money(entry.amountCents)}</b>
        <button className="icon-button danger-icon" type="button" onClick={onDelete} aria-label="Kaydı sil"><Trash2 size={17} /></button>
      </span>
    </div>
  );
}

function JobCard({ job, today, onPaid, onCustomer, onDelete }: { job: Job; today: string; onPaid: () => void; onCustomer: () => void; onDelete: () => void }) {
  const open = job.status !== "paid";
  const days = overdueDays(job, today);
  const paid = jobPaid(job);
  const remaining = jobRemaining(job);
  const statusText = job.status === "paid" ? "Tamamlandı" : days > 0 ? `${days} gün gecikti` : job.status === "partial" ? "Kısmi ödendi" : "Ödeme bekliyor";

  return (
    <article className="job-card clickable-card" onClick={onCustomer}>
      <div className="job-top">
        <div>
          <div className="job-title-line"><h3>{job.customerName}</h3><span className={`status-badge ${job.status === "paid" ? "paid" : days > 0 ? "overdue" : "waiting"}`}>{statusText}</span></div>
          <p>{job.title}</p>
        </div>
        <strong>{money(job.amountCents)}</strong>
      </div>

      <div className="job-payment-grid">
        <span><small>Alınan</small><b>{money(paid)}</b></span>
        <span><small>Kalan</small><b>{money(remaining)}</b></span>
      </div>

      <div className="job-meta">
        <span><CalendarDays size={16} />{open ? shortDate(effectiveJobDate(job, today)) : `${shortDate(job.paidDate ?? job.plannedDate)} ödendi`}</span>
        {job.vehiclePartnerName && <span><Car size={16} />{job.vehiclePartnerName} · {money(job.serviceFeeCents)}</span>}
      </div>

      {job.note && <p className="job-note">{job.note}</p>}

      <div className="job-card-actions">
        {open && <button className="button button-income" type="button" onClick={(event) => { event.stopPropagation(); onPaid(); }}><Check size={18} /> Ödeme al</button>}
        <button className="button button-danger-outline" type="button" onClick={(event) => { event.stopPropagation(); onDelete(); }}><Trash2 size={17} /> Sil</button>
      </div>
    </article>
  );
}

function CustomerHistoryModal({
  customerName,
  data,
  today,
  busy,
  onClose,
  onPay,
  onCollect,
  onShareStatement,
  onInvalid,
}: {
  customerName: string | null;
  data: CompanyData;
  today: string;
  busy: boolean;
  onClose: () => void;
  onPay: (job: Job) => void;
  onCollect: (customerName: string, amountCents: number, paidDate: string, note: string) => Promise<void>;
  onShareStatement: (customerName: string) => void;
  onInvalid: (message: string) => void;
}) {
  const key = customerName ? normalizedCustomer(customerName) : "";
  const customerJobs = data.jobs
    .filter((job) => normalizedCustomer(job.customerName) === key)
    .sort((a, b) => b.plannedDate.localeCompare(a.plannedDate));
  const billed = customerJobs.reduce((sum, job) => sum + job.amountCents, 0);
  const paid = customerJobs.reduce((sum, job) => sum + jobPaid(job), 0);
  const remaining = Math.max(0, billed - paid);
  const credit = customerName ? customerCredit(data, customerName) : 0;
  const jobIds = new Set(customerJobs.map((job) => job.id));
  const payments = data.cashEntries
    .filter((entry) => entry.kind === "income" && normalizedCustomer(entry.counterparty) === key && (entry.jobId ? jobIds.has(entry.jobId) : entry.category === "Müşteri avansı"))
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate));

  const collect = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!customerName) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    const amountCents = parseMoney(String(values.amount));
    if (amountCents === null) {
      onInvalid("Geçerli bir tahsilat tutarı yazın.");
      return;
    }
    void onCollect(customerName, amountCents, String(values.paidDate), String(values.note ?? ""));
    form.reset();
  };

  return (
    <Modal open={Boolean(customerName)} onClose={onClose} title={customerName ?? "Müşteri"} description="Geçmiş işler, tahsilatlar, vade ve müşteri bakiyesi">
      <div className="customer-history">
        <div className="customer-summary-grid four">
          <SummaryBox label="Toplam iş" value={billed} />
          <SummaryBox label="İşlere işlenen" value={paid} tone="positive" />
          <SummaryBox label="Kalan borç" value={remaining} tone="warning" />
          <SummaryBox label="Müşteri avansı" value={credit} tone="positive" />
        </div>

        {customerName && (
          <div className="customer-statement-actions">
            <button className="button button-primary full" type="button" onClick={() => onShareStatement(customerName)}>
              <MessageCircle size={18} /> WhatsApp / PDF hesap ekstresi
            </button>
          </div>
        )}

        {customerName && (
          <form className="customer-collect-card" onSubmit={collect}>
            <div className="customer-collect-head">
              <span className="row-icon mint"><HandCoins size={20} /></span>
              <span>
                <strong>Toplam bakiyeden tahsilat al</strong>
                <small>Ödeme en eski açık borçtan başlar. Borcu aşan tutar müşteri avansı olur ve sonraki işe otomatik düşer.</small>
              </span>
            </div>
            <div className="customer-collect-grid">
              <Field label="Tahsil edilen (₺)" htmlFor="customer-collect-amount"><input id="customer-collect-amount" name="amount" required inputMode="decimal" placeholder="0,00" /></Field>
              <Field label="Ödeme tarihi" htmlFor="customer-collect-date"><input id="customer-collect-date" name="paidDate" type="date" required defaultValue={localDateKey()} /></Field>
            </div>
            <Field label="Not (isteğe bağlı)" htmlFor="customer-collect-note"><textarea id="customer-collect-note" name="note" rows={2} maxLength={180} placeholder="Örn. EFT / nakit tahsilat" /></Field>
            <div className="customer-collect-info"><span>Dağıtım sırası</span><strong>En eski borç → yeni borç → fazla tutar avans</strong></div>
            <button className="button button-income full" type="submit" disabled={busy}><HandCoins size={18} /> {busy ? "Tahsilat işleniyor…" : "Toplam tahsilatı kaydet"}</button>
          </form>
        )}

        {remaining === 0 && customerJobs.length > 0 && (
          <div className="success-box"><strong>Açık borç yok</strong><span>{credit > 0 ? `Müşterinin ${money(credit)} avansı sonraki işe otomatik uygulanacak.` : "Tüm işler tahsil edilmiş görünüyor."}</span></div>
        )}

        <section>
          <h3 className="settings-title"><BriefcaseBusiness size={18} /> Geçmiş işler</h3>
          <div className="customer-history-list">
            {customerJobs.map((job) => {
              const days = overdueDays(job, today);
              return (
                <div className="customer-history-row" key={job.id}>
                  <span>
                    <strong>{job.title}</strong>
                    <small>{shortDate(job.plannedDate)} · Toplam {money(job.amountCents)} · Alınan {money(jobPaid(job))}{job.creditAppliedCents > 0 ? ` · Avanstan ${money(job.creditAppliedCents)}` : ""}{days > 0 ? ` · ${days} gün gecikti` : ""}</small>
                  </span>
                  <span className="customer-history-end">
                    <b className={days > 0 ? "negative" : ""}>{job.status === "paid" ? "Kapandı" : `${money(jobRemaining(job))} kaldı`}</b>
                    {job.status !== "paid" && <button type="button" onClick={() => onPay(job)}>Bu işe ödeme al</button>}
                  </span>
                </div>
              );
            })}
            {!customerJobs.length && <Empty icon={BriefcaseBusiness} text="Bu müşteriye ait iş bulunamadı." />}
          </div>
        </section>

        <section>
          <h3 className="settings-title"><ReceiptText size={18} /> Ödeme geçmişi</h3>
          <div className="customer-history-list">
            {payments.map((entry) => (
              <div className="customer-history-row" key={entry.id}>
                <span><strong>{money(entry.amountCents)}</strong><small>{shortDate(entry.entryDate)} · {entry.note || entry.category}</small></span>
                <b className="positive">{entry.category}</b>
              </div>
            ))}
            {!payments.length && <Empty icon={ReceiptText} text="Henüz ödeme kaydı yok." />}
          </div>
        </section>
      </div>
    </Modal>
  );
}

function VehicleRow({ job }: { job: Job }) {
  return <div className="list-row"><span className="row-icon mint"><Car size={20} /></span><span className="row-copy"><strong>{job.vehiclePartnerName} aracı</strong><small>{job.customerName} · {job.title} · {shortDate(job.status === "paid" ? job.paidDate ?? job.plannedDate : job.plannedDate)}</small></span><b>{money(job.serviceFeeCents)}</b></div>;
}

function PartnerTotal({ name, value, icon: IconComponent, label }: { name: string; value: number; icon: Icon; label: string }) {
  return <article className="partner-total"><span className="row-icon gold"><IconComponent size={21} /></span><div><strong>{name}</strong><small>{label}</small><b>{money(value)}</b></div></article>;
}

function SectionHeading({ title, description, button, onClick }: { title: string; description: string; button?: string; onClick?: () => void }) {
  return <div className="section-heading"><div><h2>{title}</h2><p>{description}</p></div>{button && <button className="button button-primary compact-button" type="button" onClick={onClick}><Plus size={18} />{button}</button>}</div>;
}

function Empty({ icon: IconComponent, text }: { icon: Icon; text: string }) {
  return <div className="empty"><IconComponent size={33} /><p>{text}</p></div>;
}

function LargeEmpty({ icon: IconComponent, title, text, button, onClick }: { icon: Icon; title: string; text: string; button: string; onClick: () => void }) {
  return <div className="large-empty"><span><IconComponent size={27} /></span><h3>{title}</h3><p>{text}</p><button className="button button-primary" type="button" onClick={onClick}><Plus size={18} />{button}</button></div>;
}

const navItems: { id: Tab; label: string; icon: Icon }[] = [
  { id: "overview", label: "Özet", icon: House },
  { id: "jobs", label: "İşler", icon: BriefcaseBusiness },
  { id: "cash", label: "Kasa", icon: WalletCards },
  { id: "advances", label: "Avans", icon: HandCoins },
  { id: "vehicles", label: "Araç", icon: Car },
];

function DesktopTabs({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return <nav className="desktop-tabs" aria-label="Uygulama bölümleri">{navItems.map(({ id, label, icon: IconComponent }) => <button key={id} className={tab === id ? "active" : ""} type="button" onClick={() => onChange(id)}><IconComponent size={18} />{label}</button>)}</nav>;
}

function MobileNav({ tab, onChange }: { tab: Tab; onChange: (tab: Tab) => void }) {
  return <nav className="mobile-nav" aria-label="Uygulama bölümleri">{navItems.map(({ id, label, icon: IconComponent }) => <button key={id} className={tab === id ? "active" : ""} type="button" onClick={() => onChange(id)}><IconComponent size={20} /><span>{label}</span></button>)}</nav>;
}

function SettingsModal({
  open,
  busy,
  onClose,
  profile,
  data,
  onSaveCompany,
  onLogout,
  notify,
}: {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  profile: UserProfile;
  data: CompanyData;
  onSaveCompany: (values: CompanySettingsInput) => Promise<void>;
  onLogout: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const owner = data.company.ownerUid === profile.uid;
  const [logoBusy, setLogoBusy] = useState(false);
  const [values, setValues] = useState<CompanySettingsInput>({
    name: data.company.name,
    phone: data.company.phone ?? "",
    email: data.company.email ?? "",
    address: data.company.address ?? "",
    taxOffice: data.company.taxOffice ?? "",
    taxNumber: data.company.taxNumber ?? "",
    logoDataUrl: data.company.logoDataUrl ?? "",
  });

  useEffect(() => {
    if (!open) return;
    setValues({
      name: data.company.name,
      phone: data.company.phone ?? "",
      email: data.company.email ?? "",
      address: data.company.address ?? "",
      taxOffice: data.company.taxOffice ?? "",
      taxNumber: data.company.taxNumber ?? "",
      logoDataUrl: data.company.logoDataUrl ?? "",
    });
  }, [open, data.company.name, data.company.phone, data.company.email, data.company.address, data.company.taxOffice, data.company.taxNumber, data.company.logoDataUrl]);

  const setField = (field: keyof CompanySettingsInput, value: string) => setValues((current) => ({ ...current, [field]: value }));

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(data.company.inviteCode);
      notify("Ortaklık kodu kopyalandı.", "success");
    } catch {
      notify(`Ortaklık kodu: ${data.company.inviteCode}`, "info");
    }
  };

  const chooseLogo = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLogoBusy(true);
    try {
      setField("logoDataUrl", await compressLogo(file));
      notify("Logo hazırlandı. Kaydet butonuna basınca firma bilgilerine eklenecek.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Logo işlenemedi.", "error");
    } finally {
      setLogoBusy(false);
      event.target.value = "";
    }
  };

  const save = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      await onSaveCompany(values);
      notify("Firma bilgileri kaydedildi. Yeni PDF ve ekstrelerde bu logo/bilgiler kullanılacak.", "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Firma bilgileri kaydedilemedi.", "error");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Ayarlar ve firma bilgileri" description="Firma kimliği, ortaklık, logo ve işlem geçmişi">
      <div className="settings-stack">
        <section className="company-settings-card">
          <h3 className="settings-title"><Building2 size={18} /> Firma bilgileri ve PDF logosu</h3>
          {owner ? (
            <form className="form-stack" onSubmit={save}>
              <div className="company-logo-row">
                <div className="company-logo-preview">
                  {values.logoDataUrl ? <img src={values.logoDataUrl} alt="Firma logosu" /> : <span>LOGO</span>}
                </div>
                <div className="company-logo-actions">
                  <label className="button button-ghost file-button">
                    {logoBusy ? "Logo hazırlanıyor…" : "Logo seç"}
                    <input type="file" accept="image/*" onChange={(event) => void chooseLogo(event)} disabled={logoBusy || busy} />
                  </label>
                  {values.logoDataUrl && <button className="button button-danger-outline" type="button" onClick={() => setField("logoDataUrl", "")} disabled={busy}>Logoyu kaldır</button>}
                  <small>Logo telefonda küçültülerek saklanır; iş raporu ve müşteri hesap ekstresinde kullanılır.</small>
                </div>
              </div>

              <div className="form-grid">
                <Field label="Firma adı" htmlFor="company-name"><input id="company-name" value={values.name} onChange={(event) => setField("name", event.target.value)} maxLength={80} required /></Field>
                <Field label="Telefon" htmlFor="company-phone"><input id="company-phone" value={values.phone} onChange={(event) => setField("phone", event.target.value)} maxLength={40} inputMode="tel" placeholder="05xx xxx xx xx" /></Field>
              </div>
              <Field label="E-posta" htmlFor="company-email"><input id="company-email" value={values.email} onChange={(event) => setField("email", event.target.value)} maxLength={120} inputMode="email" placeholder="firma@ornek.com" /></Field>
              <Field label="Adres" htmlFor="company-address"><textarea id="company-address" value={values.address} onChange={(event) => setField("address", event.target.value)} maxLength={240} rows={3} placeholder="Firma adresi" /></Field>
              <div className="form-grid">
                <Field label="Vergi dairesi" htmlFor="company-tax-office"><input id="company-tax-office" value={values.taxOffice} onChange={(event) => setField("taxOffice", event.target.value)} maxLength={80} /></Field>
                <Field label="VKN / TCKN" htmlFor="company-tax-number"><input id="company-tax-number" value={values.taxNumber} onChange={(event) => setField("taxNumber", event.target.value)} maxLength={40} inputMode="numeric" /></Field>
              </div>
              <button className="button button-primary full" type="submit" disabled={busy || logoBusy}>{busy ? "Kaydediliyor…" : "Firma bilgilerini kaydet"}</button>
            </form>
          ) : (
            <div className="info-box">Firma bilgileri ve logo yalnızca işletme sahibi tarafından değiştirilebilir. Kayıtlı bilgiler PDF'lerde otomatik kullanılır.</div>
          )}
        </section>

        <section className="invite-card">
          <span>Ortaklık kodu</span>
          <div><code>{data.company.inviteCode}</code><button className="icon-button" type="button" onClick={() => void copyCode()} aria-label="Kodu kopyala"><Copy size={19} /></button></div>
          <p>Ortağınız kendi hesabını açtıktan sonra “Kodla katıl” bölümüne bu kodu yazar.</p>
        </section>

        <section>
          <h3 className="settings-title"><Users size={18} /> Bağlı ortaklar</h3>
          <div className="member-list">{data.partners.map((partner) => <div className="member-row" key={partner.id}><span className="member-avatar">{partner.name.slice(0, 1).toUpperCase()}</span><span><strong>{partner.name}</strong><small>{partner.userId ? "Telefonu bağlı" : "Davet bekliyor"}</small></span><b className={partner.userId ? "active" : "waiting"}>{partner.userId ? "Aktif" : "Bekliyor"}</b></div>)}</div>
        </section>

        <section>
          <h3 className="settings-title"><History size={18} /> İşlem geçmişi</h3>
          <div className="audit-list">
            {data.auditLogs.length ? data.auditLogs.slice(0, 30).map((item) => (
              <div className="audit-row" key={item.id}>
                <span><strong>{item.actorName}</strong><small>{new Date(item.eventDate).toLocaleString("tr-TR")}</small></span>
                <p>{item.summary}</p>
              </div>
            )) : <Empty icon={History} text="Henüz işlem geçmişi oluşmadı." />}
          </div>
        </section>

        <section className="cloud-card"><Cloud size={21} /><div><strong>Google Cloud senkronizasyonu</strong><p>İnternet varken iki telefondaki kayıtlar otomatik olarak aynı kalır.</p></div></section>
        <section className="account-row"><span className="row-icon neutral"><UserRound size={20} /></span><span><strong>{profile.displayName}</strong><small>{profile.email}</small></span></section>
        <button className="button button-logout full" type="button" onClick={() => void onLogout()}><LogOut size={18} /> Hesaptan çık</button>
      </div>
    </Modal>
  );
}
