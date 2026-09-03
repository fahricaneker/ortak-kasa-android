import { useMemo, useState, type ComponentType, type SVGProps } from "react";
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  BriefcaseBusiness,
  CalendarDays,
  Car,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  Copy,
  HandCoins,
  House,
  LogOut,
  Plus,
  ReceiptText,
  Settings,
  UserRound,
  Users,
  WalletCards,
} from "lucide-react";

import type { CompanyData, Job, NewAdvance, NewCashEntry, NewJob, Period, UserProfile } from "../types";
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

export function Dashboard({
  profile,
  data,
  busy,
  onAddCash,
  onAddAdvance,
  onAddJob,
  onMarkPaid,
  onLogout,
  notify,
}: {
  profile: UserProfile;
  data: CompanyData;
  busy: boolean;
  onAddCash: (entry: NewCashEntry) => Promise<void>;
  onAddAdvance: (entry: NewAdvance) => Promise<void>;
  onAddJob: (entry: NewJob) => Promise<void>;
  onMarkPaid: (jobId: string, paidDate: string) => Promise<void>;
  onLogout: () => Promise<void>;
  notify: (message: string, tone?: "success" | "error" | "info") => void;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const [anchor, setAnchor] = useState(localDateKey());
  const [tab, setTab] = useState<Tab>("overview");
  const [dialog, setDialog] = useState<EntryDialog>(null);
  const [paidJob, setPaidJob] = useState<Job | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const today = localDateKey();
  const range = periodRange(period, anchor);
  const computed = useMemo(() => {
    const cashEntries = data.cashEntries.filter((item) => isInRange(item.entryDate, range.start, range.end));
    const advances = data.advances.filter((item) => isInRange(item.entryDate, range.start, range.end));
    const jobs = data.jobs.filter((item) => isInRange(effectiveJobDate(item, today), range.start, range.end));
    const openJobs = jobs
      .filter((item) => item.status === "open")
      .sort((a, b) => effectiveJobDate(a, today).localeCompare(effectiveJobDate(b, today)));
    const income = cashEntries.filter((item) => item.kind === "income").reduce((sum, item) => sum + item.amountCents, 0);
    const expense = cashEntries.filter((item) => item.kind === "expense").reduce((sum, item) => sum + item.amountCents, 0);
    const advanceTotal = advances.reduce((sum, item) => sum + item.amountCents, 0);
    const receivables = openJobs.reduce((sum, item) => sum + item.amountCents, 0);
    const vehicleFees = jobs.reduce((sum, item) => sum + item.serviceFeeCents, 0);
    return { cashEntries, advances, jobs, openJobs, income, expense, advanceTotal, receivables, vehicleFees, balance: income - expense - advanceTotal };
  }, [data, range.start, range.end, today]);

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

  const perform = async (action: () => Promise<void>, successMessage: string, close: () => void) => {
    try {
      await action();
      close();
      notify(successMessage, "success");
    } catch (error) {
      notify(error instanceof Error ? error.message : "Kayıt tamamlanamadı.", "error");
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
              <Panel title="Bekleyen işler" subtitle="Ödeme gelene kadar bugüne taşınır" badge={computed.openJobs.length}>
                {computed.openJobs.length ? computed.openJobs.slice(0, 6).map((job) => (
                  <CompactJob key={job.id} job={job} today={today} onPaid={() => setPaidJob(job)} />
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
            <SectionHeading title="İş takibi" description={`${computed.jobs.length} kayıt`} button="İş ekle" onClick={() => setDialog("job")} />
            {computed.jobs.length ? (
              <div className="job-grid">{computed.jobs.map((job) => <JobCard key={job.id} job={job} today={today} onPaid={() => setPaidJob(job)} />)}</div>
            ) : <LargeEmpty icon={BriefcaseBusiness} title="Bu dönemde iş yok" text="Yeni işi eklediğinizde müşteri, araç ve ödeme durumunu burada görürsünüz." button="İş ekle" onClick={() => setDialog("job")} />}
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
              {computed.cashEntries.length ? computed.cashEntries.map((item) => <MovementRow key={item.id} item={{ id: item.id, date: item.entryDate, title: item.counterparty || item.category, detail: item.category, amount: item.kind === "income" ? item.amountCents : -item.amountCents, type: item.kind }} />) : <Empty icon={ReceiptText} text="Bu dönemde gelir veya gider yok." />}
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
              {computed.advances.length ? computed.advances.map((item) => <MovementRow key={item.id} item={{ id: item.id, date: item.entryDate, title: item.partnerName, detail: item.note || "Avans", amount: -item.amountCents, type: "advance" }} />) : <Empty icon={HandCoins} text="Bu dönemde avans kaydı yok." />}
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
              {computed.jobs.some((job) => job.vehiclePartnerId) ? computed.jobs.filter((job) => job.vehiclePartnerId).map((job) => <VehicleRow key={job.id} job={job} />) : <Empty icon={Car} text="Bu dönemde araç kaydı yok." />}
            </Panel>
          </section>
        )}
      </main>

      <MobileNav tab={tab} onChange={setTab} />

      <TransactionDialog kind="income" open={dialog === "income"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddCash(entry), "Gelir kaydedildi.", () => setDialog(null))} />
      <TransactionDialog kind="expense" open={dialog === "expense"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddCash(entry), "Gider kaydedildi.", () => setDialog(null))} />
      <AdvanceDialog partners={data.partners} open={dialog === "advance"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddAdvance(entry), "Avans kaydedildi.", () => setDialog(null))} />
      <JobDialog partners={data.partners} open={dialog === "job"} busy={busy} onClose={() => setDialog(null)} onInvalid={(message) => notify(message, "error")} onSave={(entry) => perform(() => onAddJob(entry), "İş kaydedildi.", () => setDialog(null))} />
      <PaymentDialog job={paidJob} busy={busy} onClose={() => setPaidJob(null)} onSave={(jobId, paidDate) => perform(() => onMarkPaid(jobId, paidDate), "İş tamamlandı ve gelir yazıldı.", () => setPaidJob(null))} />
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} profile={profile} data={data} onLogout={onLogout} notify={notify} />
    </div>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: number; tone: "mint" | "rose" | "gold" | "blue" }) {
  return <div className={`mini-stat ${tone}`}><span>{label}</span><strong>{money(value)}</strong></div>;
}

function QuickAction({ label, icon: IconComponent, tone, onClick }: { label: string; icon: Icon; tone: string; onClick: () => void }) {
  return <button className={`quick-action ${tone}`} type="button" onClick={onClick}><IconComponent size={21} /><span>{label}</span></button>;
}

function Panel({ title, subtitle, badge, children }: { title?: string; subtitle?: string; badge?: number; children: React.ReactNode }) {
  return <section className="panel">{title && <header className="panel-head"><div><h3>{title}</h3>{subtitle && <p>{subtitle}</p>}</div>{badge !== undefined && <span className="count-badge">{badge}</span>}</header>}<div className="panel-body">{children}</div></section>;
}

function CompactJob({ job, today, onPaid }: { job: Job; today: string; onPaid: () => void }) {
  const carried = job.plannedDate < today;
  return <div className="list-row"><span className="row-icon gold"><BriefcaseBusiness size={20} /></span><span className="row-copy"><strong>{job.customerName}</strong><small>{job.title}{carried ? " · Bugüne devretti" : ""}</small></span><span className="row-end"><b>{money(job.amountCents)}</b><button type="button" onClick={onPaid}>Ödendi</button></span></div>;
}

type Movement = { id: string; date: string; title: string; detail: string; amount: number; type: "income" | "expense" | "advance" };
function MovementRow({ item }: { item: Movement }) {
  const positive = item.amount >= 0;
  const IconComponent = item.type === "advance" ? HandCoins : positive ? ArrowDown : ArrowUp;
  const tone = positive ? "mint" : item.type === "advance" ? "gold" : "rose";
  return <div className="list-row"><span className={`row-icon ${tone}`}><IconComponent size={20} /></span><span className="row-copy"><strong>{item.title}</strong><small>{item.detail} · {shortDate(item.date)}</small></span><b className={`movement-amount ${positive ? "positive" : "negative"}`}>{positive ? "+" : "−"}{money(Math.abs(item.amount))}</b></div>;
}

function JobCard({ job, today, onPaid }: { job: Job; today: string; onPaid: () => void }) {
  const open = job.status === "open";
  const carried = open && job.plannedDate < today;
  return <article className="job-card"><div className="job-top"><div><div className="job-title-line"><h3>{job.customerName}</h3><span className={`status-badge ${open ? "waiting" : "paid"}`}>{open ? carried ? "Bugüne devretti" : "Ödeme bekliyor" : "Tamamlandı"}</span></div><p>{job.title}</p></div><strong>{money(job.amountCents)}</strong></div><div className="job-meta"><span><CalendarDays size={16} />{open ? shortDate(effectiveJobDate(job, today)) : `${shortDate(job.paidDate ?? job.plannedDate)} ödendi`}</span>{job.vehiclePartnerName && <span><Car size={16} />{job.vehiclePartnerName} · {money(job.serviceFeeCents)}</span>}</div>{job.note && <p className="job-note">{job.note}</p>}{open && <button className="button button-income full" type="button" onClick={onPaid}><Check size={18} /> Ödeme alındı</button>}</article>;
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
  return <Modal open={open} onClose={onClose} title="Ayarlar ve ortaklık" description="İkinci telefonu aynı kasaya bağlayın."><div className="settings-stack"><section className="invite-card"><span>Ortaklık kodu</span><div><code>{data.company.inviteCode}</code><button className="icon-button" type="button" onClick={() => void copyCode()} aria-label="Kodu kopyala"><Copy size={19} /></button></div><p>Ortağınız kendi hesabını açtıktan sonra “Kodla katıl” bölümüne bu kodu yazar.</p></section><section><h3 className="settings-title"><Users size={18} /> Bağlı ortaklar</h3><div className="member-list">{data.partners.map((partner) => <div className="member-row" key={partner.id}><span className="member-avatar">{partner.name.slice(0, 1).toUpperCase()}</span><span><strong>{partner.name}</strong><small>{partner.userId ? "Telefonu bağlı" : "Davet bekliyor"}</small></span><b className={partner.userId ? "active" : "waiting"}>{partner.userId ? "Aktif" : "Bekliyor"}</b></div>)}</div></section><section className="cloud-card"><Cloud size={21} /><div><strong>Google Cloud senkronizasyonu</strong><p>İnternet varken iki telefondaki kayıtlar otomatik olarak aynı kalır.</p></div></section><section className="account-row"><span className="row-icon neutral"><UserRound size={20} /></span><span><strong>{profile.displayName}</strong><small>{profile.email}</small></span></section><button className="button button-logout full" type="button" onClick={() => void onLogout()}><LogOut size={18} /> Hesaptan çık</button></div></Modal>;
}
