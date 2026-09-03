import { type FormEvent } from "react";

import type { Job, Partner } from "../types";
import { localDateKey, money, parseMoney } from "../lib/utils";
import { Field, FormActions, Modal } from "./Modal";

export type EntryDialog = "job" | "income" | "expense" | "advance" | null;

function valuesFrom(event: FormEvent<HTMLFormElement>) {
  event.preventDefault();
  return Object.fromEntries(new FormData(event.currentTarget).entries());
}

export function TransactionDialog({
  kind,
  open,
  busy,
  onClose,
  onSave,
  onInvalid,
}: {
  kind: "income" | "expense";
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onInvalid: (message: string) => void;
  onSave: (entry: {
    kind: "income" | "expense";
    amountCents: number;
    category: string;
    counterparty: string;
    note: string;
    entryDate: string;
  }) => Promise<void>;
}) {
  const income = kind === "income";
  const categories = income
    ? ["Tahsilat", "Malzeme satışı", "Diğer gelir"]
    : ["Yakıt", "Malzeme", "Bakım", "Yemek", "Diğer gider"];

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const values = valuesFrom(event);
    const amountCents = parseMoney(String(values.amount));
    if (amountCents === null) {
      onInvalid("Geçerli bir tutar yazın.");
      return;
    }
    void onSave({
      kind,
      amountCents,
      category: String(values.category),
      counterparty: String(values.counterparty),
      note: String(values.note),
      entryDate: String(values.entryDate),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title={income ? "Gelir ekle" : "Gider ekle"} description={income ? "Kasaya giren ödemeyi kaydedin." : "Kasadan yapılan ödemeyi kaydedin."}>
      <form className="form-stack" onSubmit={submit}>
        <Field label="Tutar (₺)" htmlFor={`${kind}-amount`}><input id={`${kind}-amount`} name="amount" required inputMode="decimal" placeholder="0,00" autoFocus /></Field>
        <Field label="Kategori" htmlFor={`${kind}-category`}>
          <select id={`${kind}-category`} name="category" defaultValue={categories[0]}>{categories.map((category) => <option key={category}>{category}</option>)}</select>
        </Field>
        <Field label={income ? "Ödeme yapan / müşteri" : "Ödeme yapılan yer"} htmlFor={`${kind}-counterparty`}>
          <input id={`${kind}-counterparty`} name="counterparty" maxLength={80} placeholder={income ? "Müşteri adı" : "Firma veya kişi"} />
        </Field>
        <Field label="Tarih" htmlFor={`${kind}-date`}><input id={`${kind}-date`} name="entryDate" type="date" required defaultValue={localDateKey()} /></Field>
        <Field label="Not (isteğe bağlı)" htmlFor={`${kind}-note`}><textarea id={`${kind}-note`} name="note" maxLength={240} rows={3} placeholder="Kısa açıklama" /></Field>
        <FormActions busy={busy} onCancel={onClose} />
      </form>
    </Modal>
  );
}

export function AdvanceDialog({
  partners,
  open,
  busy,
  onClose,
  onSave,
  onInvalid,
}: {
  partners: Partner[];
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onInvalid: (message: string) => void;
  onSave: (entry: { partnerId: string; amountCents: number; entryDate: string; note: string }) => Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const values = valuesFrom(event);
    const amountCents = parseMoney(String(values.amount));
    if (amountCents === null) {
      onInvalid("Geçerli bir tutar yazın.");
      return;
    }
    void onSave({
      partnerId: String(values.partnerId),
      amountCents,
      entryDate: String(values.entryDate),
      note: String(values.note),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Avans ekle" description="Parça parça alınan her tutarı ayrı kaydedin.">
      <form className="form-stack" onSubmit={submit}>
        <Field label="Avansı alan" htmlFor="advance-partner">
          <select id="advance-partner" name="partnerId" required defaultValue={partners[0]?.id}>{partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name}</option>)}</select>
        </Field>
        <Field label="Tutar (₺)" htmlFor="advance-amount"><input id="advance-amount" name="amount" required inputMode="decimal" placeholder="0,00" autoFocus /></Field>
        <Field label="Tarih" htmlFor="advance-date"><input id="advance-date" name="entryDate" type="date" required defaultValue={localDateKey()} /></Field>
        <Field label="Not (isteğe bağlı)" htmlFor="advance-note"><textarea id="advance-note" name="note" maxLength={240} rows={3} placeholder="Örn. yakıt için" /></Field>
        <FormActions busy={busy} onCancel={onClose} submitLabel="Avansı kaydet" />
      </form>
    </Modal>
  );
}

export function JobDialog({
  partners,
  open,
  busy,
  onClose,
  onSave,
  onInvalid,
}: {
  partners: Partner[];
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onInvalid: (message: string) => void;
  onSave: (entry: {
    customerName: string;
    title: string;
    amountCents: number;
    plannedDate: string;
    vehiclePartnerId: string | null;
    serviceFeeCents: number;
    note: string;
  }) => Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const values = valuesFrom(event);
    const amountCents = parseMoney(String(values.amount));
    const serviceFeeCents = parseMoney(String(values.serviceFee), true);
    if (amountCents === null) {
      onInvalid("Alınacak tutarı kontrol edin.");
      return;
    }
    if (serviceFeeCents === null) {
      onInvalid("Servis / araç payını kontrol edin.");
      return;
    }
    void onSave({
      customerName: String(values.customerName),
      title: String(values.title),
      amountCents,
      plannedDate: String(values.plannedDate),
      vehiclePartnerId: String(values.vehiclePartnerId) === "none" ? null : String(values.vehiclePartnerId),
      serviceFeeCents,
      note: String(values.note),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Yeni iş ekle" description="Ödeme gelene kadar iş otomatik olarak bugüne devreder.">
      <form className="form-stack" onSubmit={submit}>
        <div className="form-grid">
          <Field label="Müşteri" htmlFor="job-customer"><input id="job-customer" name="customerName" required maxLength={80} placeholder="Müşteri adı" autoFocus /></Field>
          <Field label="Alınacak tutar (₺)" htmlFor="job-amount"><input id="job-amount" name="amount" required inputMode="decimal" placeholder="0,00" /></Field>
        </div>
        <Field label="Yapılacak iş" htmlFor="job-title"><input id="job-title" name="title" required maxLength={100} placeholder="Örn. personel servisi" /></Field>
        <Field label="İş tarihi" htmlFor="job-date"><input id="job-date" name="plannedDate" type="date" required defaultValue={localDateKey()} /></Field>
        <div className="form-grid">
          <Field label="Kullanılan araç" htmlFor="job-vehicle">
            <select id="job-vehicle" name="vehiclePartnerId" defaultValue="none">
              <option value="none">Araç yazma</option>
              {partners.map((partner) => <option key={partner.id} value={partner.id}>{partner.name} aracı</option>)}
            </select>
          </Field>
          <Field label="Servis / araç payı (₺)" htmlFor="job-service"><input id="job-service" name="serviceFee" inputMode="decimal" defaultValue="0" /></Field>
        </div>
        <Field label="Not (isteğe bağlı)" htmlFor="job-note"><textarea id="job-note" name="note" maxLength={240} rows={3} placeholder="Adres, saat veya kısa açıklama" /></Field>
        <FormActions busy={busy} onCancel={onClose} submitLabel="İşi kaydet" />
      </form>
    </Modal>
  );
}

export function PaymentDialog({
  job,
  busy,
  onClose,
  onSave,
}: {
  job: Job | null;
  busy: boolean;
  onClose: () => void;
  onSave: (jobId: string, paidDate: string) => Promise<void>;
}) {
  const submit = (event: FormEvent<HTMLFormElement>) => {
    const values = valuesFrom(event);
    if (job) void onSave(job.id, String(values.paidDate));
  };
  return (
    <Modal open={Boolean(job)} onClose={onClose} title="Ödeme alındı" description={job ? `${job.customerName} · ${money(job.amountCents)}` : undefined}>
      {job && (
        <form className="form-stack" onSubmit={submit}>
          <div className="success-box"><strong>Tek işlemle iki kayıt</strong><span>İş seçilen tarihte tamamlanır ve tutar aynı güne gelir olarak eklenir.</span></div>
          <Field label="Müşterinin ödeme yaptığı gün" htmlFor="paid-date"><input id="paid-date" name="paidDate" type="date" required defaultValue={localDateKey()} autoFocus /></Field>
          <FormActions busy={busy} onCancel={onClose} submitLabel="Ödendi ve bitir" />
        </form>
      )}
    </Modal>
  );
}
