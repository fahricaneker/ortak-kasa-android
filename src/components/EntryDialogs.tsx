import { useEffect, useState, type FormEvent } from "react";

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
  customers,
  open,
  busy,
  onClose,
  onSave,
  onInvalid,
}: {
  partners: Partner[];
  customers: string[];
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
  const [customerChoice, setCustomerChoice] = useState("__new__");

  useEffect(() => {
    if (open) setCustomerChoice(customers[0] ?? "__new__");
  }, [open, customers]);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const values = valuesFrom(event);
    const amountCents = parseMoney(String(values.amount));
    const serviceFeeCents = parseMoney(String(values.serviceFee), true);
    const selected = String(values.customerChoice);
    const customerName = selected === "__new__" ? String(values.customerName ?? "").trim() : selected;

    if (!customerName) {
      onInvalid("Müşteri seçin veya yeni müşteri adını yazın.");
      return;
    }
    if (amountCents === null) {
      onInvalid("Alınacak tutarı kontrol edin.");
      return;
    }
    if (serviceFeeCents === null) {
      onInvalid("Servis / araç payını kontrol edin.");
      return;
    }

    void onSave({
      customerName,
      title: String(values.title),
      amountCents,
      plannedDate: String(values.plannedDate),
      vehiclePartnerId: String(values.vehiclePartnerId) === "none" ? null : String(values.vehiclePartnerId),
      serviceFeeCents,
      note: String(values.note),
    });
  };

  return (
    <Modal open={open} onClose={onClose} title="Yeni iş ekle" description="Kayıtlı müşteriyi seçin veya yeni müşteri ekleyin.">
      <form className="form-stack" onSubmit={submit}>
        <Field label="Kayıtlı müşteri" htmlFor="job-customer-choice">
          <select
            id="job-customer-choice"
            name="customerChoice"
            value={customerChoice}
            onChange={(event) => setCustomerChoice(event.target.value)}
          >
            {customers.map((customer) => <option key={customer} value={customer}>{customer}</option>)}
            <option value="__new__">+ Yeni müşteri</option>
          </select>
        </Field>

        {customerChoice === "__new__" && (
          <Field label="Yeni müşteri adı" htmlFor="job-customer">
            <input id="job-customer" name="customerName" required maxLength={80} placeholder="Müşteri adı" autoFocus />
          </Field>
        )}

        <div className="form-grid">
          <Field label="Alınacak tutar (₺)" htmlFor="job-amount"><input id="job-amount" name="amount" required inputMode="decimal" placeholder="0,00" /></Field>
          <Field label="İş tarihi" htmlFor="job-date"><input id="job-date" name="plannedDate" type="date" required defaultValue={localDateKey()} /></Field>
        </div>

        <Field label="Yapılacak iş" htmlFor="job-title"><input id="job-title" name="title" required maxLength={100} placeholder="Örn. personel servisi" /></Field>

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
  onInvalid,
}: {
  job: Job | null;
  busy: boolean;
  onClose: () => void;
  onInvalid: (message: string) => void;
  onSave: (jobId: string, amountCents: number, paidDate: string, note: string) => Promise<void>;
}) {
  const remaining = job ? Math.max(0, job.amountCents - job.paidCents) : 0;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    const values = valuesFrom(event);
    if (!job) return;

    const amountCents = parseMoney(String(values.amount));
    if (amountCents === null) {
      onInvalid("Geçerli bir ödeme tutarı yazın.");
      return;
    }
    if (amountCents > remaining) {
      onInvalid(`Ödeme kalan tutarı geçemez. Kalan ${money(remaining)}.`);
      return;
    }

    void onSave(job.id, amountCents, String(values.paidDate), String(values.note));
  };

  const defaultAmount = (remaining / 100).toFixed(2).replace(".", ",");

  return (
    <Modal
      open={Boolean(job)}
      onClose={onClose}
      title="Ödeme al"
      description={job ? `${job.customerName} · ${job.title}` : undefined}
    >
      {job && (
        <form className="form-stack" onSubmit={submit}>
          <div className="payment-overview">
            <div><span>İş toplamı</span><strong>{money(job.amountCents)}</strong></div>
            <div><span>Alınan</span><strong>{money(job.paidCents)}</strong></div>
            <div><span>Kalan</span><strong>{money(remaining)}</strong></div>
          </div>

          <Field label="Bu sefer alınan tutar (₺)" htmlFor="paid-amount">
            <input id="paid-amount" name="amount" required inputMode="decimal" defaultValue={defaultAmount} autoFocus />
          </Field>
          <Field label="Ödeme tarihi" htmlFor="paid-date">
            <input id="paid-date" name="paidDate" type="date" required defaultValue={localDateKey()} />
          </Field>
          <Field label="Ödeme notu (isteğe bağlı)" htmlFor="paid-note">
            <textarea id="paid-note" name="note" maxLength={240} rows={2} placeholder="Örn. havale, nakit, 1. taksit" />
          </Field>

          <div className="success-box">
            <strong>Kısmi ödeme desteklenir</strong>
            <span>Girilen tutar kasaya gelir olur. Kalan borç sıfır olduğunda iş otomatik tamamlanır.</span>
          </div>
          <FormActions busy={busy} onCancel={onClose} submitLabel={remaining === job.amountCents ? "Ödemeyi kaydet" : "Yeni ödemeyi kaydet"} />
        </form>
      )}
    </Modal>
  );
}
