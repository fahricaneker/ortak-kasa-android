import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import html2canvas from "html2canvas";
import { jsPDF } from "jspdf";
import { Capacitor } from "@capacitor/core";
import { Directory, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import {
  ArrowDown,
  ArrowUp,
  BriefcaseBusiness,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  Cloud,
  Copy,
  FileDown,
  HandCoins,
  House,
  LogOut,
  Plus,
  ReceiptText,
  Settings,
  Trash2,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";

import type { CashEntry, CompanyData, Job, NewAdvance, NewCashEntry, NewJob, Period, UserProfile } from "../types";
import {
  effectiveJobDate,
  isInRange,
  localDateKey,
  money,
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
import { Modal } from "./Modal";

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
  onDeleteJob,
  onDeleteCash,
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
  onDeleteJob: (jobId: string) => Promise<void>;
  onDeleteCash: (entryId: string) => Promise<void>;
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
    const vehicleFees = jobs.reduce((sum, item) => sum + item.serviceFeeCents, 0);
    return { cashEntries, advances, jobs, openJobs, income, expense, advanceTotal, receivables, vehicleFees, balance: income - expense - advanceTotal };
  }, [data, range.start, range.end, today]);

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
      return `
        <tr>
          <td>${escapeHtml(shortDate(job.plannedDate))}</td>
          <td>${escapeHtml(job.customerName)}</td>
          <td>${escapeHtml(job.title)}</td>
          <td class="num">${escapeHtml(money(job.amountCents))}</td>
          <td class="num">${escapeHtml(money(paid))}</td>
          <td class="num">${escapeHtml(money(remaining))}</td>
          <td>${job.status === "paid" ? "Tamamlandı" : job.status === "partial" ? "Kısmi ödendi" : "Bekliyor"}</td>
        </tr>`;
    }).join("");

    const host = document.createElement("div");
    host.style.position = "fixed";
    host.style.left = "-12000px";
    host.style.top = "0";
    host.style.width = "1120px";
    host.style.background = "#ffffff";
    host.innerHTML = `
      <section style="font-family:Arial,Helvetica,sans-serif;color:#0f172a;background:#fff;padding:44px 48px;width:1120px;box-sizing:border-box;">
        <header style="display:flex;align-items:center;justify-content:space-between;border-bottom:3px solid #0f766e;padding-bottom:22px;margin-bottom:24px;">
          <div style="display:flex;align-items:center;gap:18px;">
            <img src="${new URL("icon-512.png", window.location.href).href}" alt="logo" style="width:70px;height:70px;border-radius:18px;object-fit:cover;" />
            <div>
              <div style="font-size:30px;font-weight:800;letter-spacing:-0.5px;">${escapeHtml(data.company.name)}</div>
              <div style="font-size:15px;color:#64748b;margin-top:5px;">Ortak Kasa · İş ve Tahsilat Raporu</div>
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
          <thead>
            <tr style="background:#0f172a;color:#fff;">
              <th style="text-align:left;padding:11px 9px;">Tarih</th>
              <th style="text-align:left;padding:11px 9px;">Müşteri</th>
              <th style="text-align:left;padding:11px 9px;">İş</th>
              <th style="text-align:right;padding:11px 9px;">Toplam</th>
              <th style="text-align:right;padding:11px 9px;">Alınan</th>
              <th style="text-align:right;padding:11px 9px;">Kalan</th>
              <th style="text-align:left;padding:11px 9px;">Durum</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <footer style="margin-top:26px;border-top:1px solid #e2e8f0;padding-top:14px;display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;">
          <span>${escapeHtml(data.company.name)} · Ortak Kasa</span>
          <span>Bu rapor uygulamadaki kayıtlar esas alınarak oluşturulmuştur.</span>
        </footer>
      </section>
    `;

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
      const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
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

      const filename = `Ortak-Kasa_Is-Raporu_${reportStart}_${reportEnd}.pdf`;

      if (Capacitor.isNativePlatform()) {
        const dataUri = pdf.output("datauristring");
        const base64 = dataUri.includes(",") ? dataUri.split(",")[1] : dataUri;
        await Filesystem.writeFile({
          path: filename,
          data: base64,
          directory: Directory.Cache,
        });
        const result = await Filesystem.getUri({ path: filename, directory: Directory.Cache });
        await Share.share({
          title: `${data.company.name} iş raporu`,
          text: `${shortDate(reportStart)} - ${shortDate(reportEnd)} iş ve tahsilat raporu`,
          files: [result.uri],
          dialogTitle: "PDF raporunu paylaş veya kaydet",
        });
      } else {
        pdf.save(filename);
      }

      notify("Kurumsal PDF raporu oluşturuldu.", "success");
    } catch (error) {
      notify(error instanceof Error ? `PDF oluşturulamadı: ${error.message}` : "PDF oluşturulamadı.", "error");
    } finally {
      host.remove();
    }
  };

  return (
    <div className="app-page">
      <header className="app-header">
        <div className="header-inner">
          <div className="brand-block compact">
            <div className="brand-mark small">OK</div>
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
        jobs={data.jobs}
        cashEntries={data.cashEntries}
        onClose={() => setCustomerOpen(null)}
        onPay={(job) => { setCustomerOpen(null); setPaymentJob(job); }}
      />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} profile={profile} data={data} onLogout={onLogout} notify={notify} />
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
  const carried = job.plannedDate < today;
  const remaining = jobRemaining(job);
  return (
    <div className="list-row">
      <span className="row-icon gold"><BriefcaseBusiness size={20} /></span>
      <button className="row-copy row-copy-button" type="button" onClick={onCustomer}>
        <strong>{job.customerName}</strong>
        <small>{job.title}{carried ? " · Bugüne devretti" : ""}</small>
      </button>
      <span className="row-end"><b>{money(remaining)}</b><button type="button" onClick={onPaid}>Ödeme al</button></span>
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
  const carried = open && job.plannedDate < today;
  const paid = jobPaid(job);
  const remaining = jobRemaining(job);
  const statusText = job.status === "paid" ? "Tamamlandı" : job.status === "partial" ? "Kısmi ödendi" : carried ? "Bugüne devretti" : "Ödeme bekliyor";

  return (
    <article className="job-card clickable-card" onClick={onCustomer}>
      <div className="job-top">
        <div>
          <div className="job-title-line"><h3>{job.customerName}</h3><span className={`status-badge ${job.status === "paid" ? "paid" : "waiting"}`}>{statusText}</span></div>
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
  jobs,
  cashEntries,
  onClose,
  onPay,
}: {
  customerName: string | null;
  jobs: Job[];
  cashEntries: CashEntry[];
  onClose: () => void;
  onPay: (job: Job) => void;
}) {
  const key = customerName ? normalizedCustomer(customerName) : "";
  const customerJobs = jobs
    .filter((job) => normalizedCustomer(job.customerName) === key)
    .sort((a, b) => b.plannedDate.localeCompare(a.plannedDate));

  const billed = customerJobs.reduce((sum, job) => sum + job.amountCents, 0);
  const paid = customerJobs.reduce((sum, job) => sum + jobPaid(job), 0);
  const remaining = Math.max(0, billed - paid);
  const jobIds = new Set(customerJobs.map((job) => job.id));
  const payments = cashEntries
    .filter((entry) => entry.kind === "income" && entry.jobId && jobIds.has(entry.jobId))
    .sort((a, b) => b.entryDate.localeCompare(a.entryDate));

  return (
    <Modal open={Boolean(customerName)} onClose={onClose} title={customerName ?? "Müşteri"} description="Geçmiş işler, tahsilatlar ve kalan bakiye">
      <div className="customer-history">
        <div className="customer-summary-grid">
          <SummaryBox label="Toplam iş" value={billed} />
          <SummaryBox label="Alınan" value={paid} tone="positive" />
          <SummaryBox label="Kalan borç" value={remaining} tone="warning" />
        </div>

        <section>
          <h3 className="settings-title"><BriefcaseBusiness size={18} /> Geçmiş işler</h3>
          <div className="customer-history-list">
            {customerJobs.map((job) => (
              <div className="customer-history-row" key={job.id}>
                <span>
                  <strong>{job.title}</strong>
                  <small>{shortDate(job.plannedDate)} · Toplam {money(job.amountCents)} · Alınan {money(jobPaid(job))}</small>
                </span>
                <span className="customer-history-end">
                  <b>{job.status === "paid" ? "Kapandı" : `${money(jobRemaining(job))} kaldı`}</b>
                  {job.status !== "paid" && <button type="button" onClick={() => onPay(job)}>Ödeme al</button>}
                </span>
              </div>
            ))}
            {!customerJobs.length && <Empty icon={BriefcaseBusiness} text="Bu müşteriye ait iş bulunamadı." />}
          </div>
        </section>

        <section>
          <h3 className="settings-title"><ReceiptText size={18} /> Ödeme geçmişi</h3>
          <div className="customer-history-list">
            {payments.map((entry) => (
              <div className="customer-history-row" key={entry.id}>
                <span><strong>{money(entry.amountCents)}</strong><small>{shortDate(entry.entryDate)} · {entry.note || "İş ödemesi"}</small></span>
                <b className="positive">Tahsil edildi</b>
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

function SettingsModal({ open, onClose, profile, data, onLogout, notify }: { open: boolean; onClose: () => void; profile: UserProfile; data: CompanyData; onLogout: () => Promise<void>; notify: (message: string, tone?: "success" | "error" | "info") => void }) {
  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(data.company.inviteCode);
      notify("Ortaklık kodu kopyalandı.", "success");
    } catch {
      notify(`Ortaklık kodu: ${data.company.inviteCode}`, "info");
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Ayarlar ve ortaklık" description="İkinci telefonu aynı kasaya bağlayın.">
      <div className="settings-stack">
        <section className="invite-card">
          <span>Ortaklık kodu</span>
          <div><code>{data.company.inviteCode}</code><button className="icon-button" type="button" onClick={() => void copyCode()} aria-label="Kodu kopyala"><Copy size={19} /></button></div>
          <p>Ortağınız kendi hesabını açtıktan sonra “Kodla katıl” bölümüne bu kodu yazar.</p>
        </section>
        <section>
          <h3 className="settings-title"><Users size={18} /> Bağlı ortaklar</h3>
          <div className="member-list">{data.partners.map((partner) => <div className="member-row" key={partner.id}><span className="member-avatar">{partner.name.slice(0, 1).toUpperCase()}</span><span><strong>{partner.name}</strong><small>{partner.userId ? "Telefonu bağlı" : "Davet bekliyor"}</small></span><b className={partner.userId ? "active" : "waiting"}>{partner.userId ? "Aktif" : "Bekliyor"}</b></div>)}</div>
        </section>
        <section className="cloud-card"><Cloud size={21} /><div><strong>Google Cloud senkronizasyonu</strong><p>İnternet varken iki telefondaki kayıtlar otomatik olarak aynı kalır.</p></div></section>
        <section className="account-row"><span className="row-icon neutral"><UserRound size={20} /></span><span><strong>{profile.displayName}</strong><small>{profile.email}</small></span></section>
        <button className="button button-logout full" type="button" onClick={() => void onLogout()}><LogOut size={18} /> Hesaptan çık</button>
      </div>
    </Modal>
  );
}
