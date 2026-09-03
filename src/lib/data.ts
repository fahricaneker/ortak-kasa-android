import {
  browserLocalPersistence,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  setPersistence,
  signInWithEmailAndPassword,
  signOut,
  updateProfile,
  type User,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  onSnapshot,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  where,
  writeBatch,
  type DocumentData,
  type QueryDocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore";

import type {
  Advance,
  AuditLog,
  CashEntry,
  Company,
  CompanyData,
  CompanySettingsInput,
  CustomerAccount,
  Job,
  NewAdvance,
  NewCashEntry,
  NewJob,
  Partner,
  UserProfile,
} from "../types";
import { requireFirebase } from "./firebase";

const inviteAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function inviteCode() {
  const bytes = new Uint8Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => inviteAlphabet[byte % inviteAlphabet.length]).join("");
}

function clean(value: string, max: number) {
  return value.trim().slice(0, max);
}

function withId<T>(snapshot: QueryDocumentSnapshot<DocumentData>) {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

function normalizedCustomer(value: string) {
  return clean(value, 80).toLocaleLowerCase("tr-TR");
}

function customerAccountId(value: string) {
  return encodeURIComponent(normalizedCustomer(value)).slice(0, 1400) || "musteri";
}

function normalizeJob(raw: Omit<Job, "vehiclePartnerName">): Omit<Job, "vehiclePartnerName"> {
  const legacy = raw as Omit<Job, "vehiclePartnerName"> & {
    originalAmountCents?: number;
    paidAmountCents?: number;
    creditAppliedCents?: number;
  };
  const storedAmount = Number(raw.amountCents ?? 0);
  const originalAmount = Number.isInteger(legacy.originalAmountCents) && Number(legacy.originalAmountCents) > 0
    ? Number(legacy.originalAmountCents)
    : storedAmount;
  const legacyPaid = Number.isInteger(legacy.paidAmountCents) && Number(legacy.paidAmountCents) > 0
    ? Number(legacy.paidAmountCents)
    : raw.status === "paid"
      ? originalAmount
      : 0;
  const paidCents = Math.max(
    0,
    Math.min(originalAmount, Number.isInteger(raw.paidCents) ? Number(raw.paidCents) : legacyPaid),
  );
  const creditAppliedCents = Math.max(
    0,
    Math.min(paidCents, Number.isInteger(legacy.creditAppliedCents) ? Number(legacy.creditAppliedCents) : 0),
  );
  const status: Job["status"] =
    paidCents >= originalAmount && originalAmount > 0
      ? "paid"
      : paidCents > 0
        ? "partial"
        : raw.status === "paid"
          ? "paid"
          : "open";

  return {
    ...raw,
    amountCents: originalAmount,
    paidCents: status === "paid" ? originalAmount : paidCents,
    creditAppliedCents,
    status,
    paidDate: status === "paid" ? raw.paidDate ?? raw.plannedDate : null,
  };
}

function writeAudit(
  profile: UserProfile,
  action: AuditLog["action"],
  entityType: AuditLog["entityType"],
  summary: string,
) {
  const { db } = requireFirebase();
  void addDoc(collection(db, "companies", profile.companyId, "auditLogs"), {
    action,
    entityType,
    summary: clean(summary, 240),
    actorUid: profile.uid,
    actorName: clean(profile.displayName || profile.email || "Kullanıcı", 80),
    eventDate: new Date().toISOString(),
    createdBy: profile.uid,
    createdAt: serverTimestamp(),
  }).catch((error) => console.warn("İşlem geçmişi kaydedilemedi", error));
}

export async function register(email: string, password: string, displayName: string) {
  const { auth } = requireFirebase();
  await setPersistence(auth, browserLocalPersistence);
  const result = await createUserWithEmailAndPassword(auth, email.trim(), password);
  await updateProfile(result.user, { displayName: clean(displayName, 50) });
  return result.user;
}

export async function login(email: string, password: string) {
  const { auth } = requireFirebase();
  await setPersistence(auth, browserLocalPersistence);
  return (await signInWithEmailAndPassword(auth, email.trim(), password)).user;
}

export async function resetPassword(email: string) {
  const { auth } = requireFirebase();
  await sendPasswordResetEmail(auth, email.trim());
}

export async function logout() {
  const { auth } = requireFirebase();
  await signOut(auth);
}

export function subscribeProfile(
  uid: string,
  onValue: (profile: UserProfile | null) => void,
  onError: (error: Error) => void,
) {
  const { db } = requireFirebase();
  return onSnapshot(
    doc(db, "users", uid),
    (snapshot) => onValue(snapshot.exists() ? ({ uid, ...snapshot.data() } as UserProfile) : null),
    onError,
  );
}

export async function createCompany(
  user: User,
  values: { companyName: string; ownerName: string; partnerName: string },
) {
  const { db } = requireFirebase();
  const companyName = clean(values.companyName, 80);
  const ownerName = clean(values.ownerName, 50);
  const partnerName = clean(values.partnerName, 50);
  if (!companyName || !ownerName || !partnerName) {
    throw new Error("İşletme, sizin adınız ve ortak adı zorunludur.");
  }

  const companyRef = doc(collection(db, "companies"));
  const ownerRef = doc(collection(companyRef, "partners"));
  const partnerRef = doc(collection(companyRef, "partners"));
  const userRef = doc(db, "users", user.uid);

  await runTransaction(db, async (transaction) => {
    const existingUser = await transaction.get(userRef);
    if (existingUser.exists()) throw new Error("Zaten bir ortaklığa bağlısınız.");

    let code = "";
    let codeRef = doc(db, "inviteCodes", "placeholder");
    for (let attempt = 0; attempt < 8; attempt += 1) {
      code = inviteCode();
      codeRef = doc(db, "inviteCodes", code);
      const existingCode = await transaction.get(codeRef);
      if (!existingCode.exists()) break;
      code = "";
    }
    if (!code) throw new Error("Ortaklık kodu üretilemedi. Tekrar deneyin.");

    const now = serverTimestamp();
    transaction.set(companyRef, {
      name: companyName,
      inviteCode: code,
      ownerUid: user.uid,
      phone: "",
      email: "",
      address: "",
      taxOffice: "",
      taxNumber: "",
      logoDataUrl: "",
      createdAt: now,
    });
    transaction.set(ownerRef, {
      name: ownerName,
      role: "owner",
      userId: user.uid,
      email: user.email ?? "",
      joinedAt: now,
      createdAt: now,
    });
    transaction.set(partnerRef, {
      name: partnerName,
      role: "partner",
      userId: null,
      email: null,
      joinedAt: null,
      createdAt: now,
    });
    transaction.set(codeRef, {
      companyId: companyRef.id,
      partnerId: partnerRef.id,
      active: true,
      createdBy: user.uid,
      createdAt: now,
    });
    transaction.set(userRef, {
      email: user.email ?? "",
      displayName: ownerName,
      companyId: companyRef.id,
      partnerId: ownerRef.id,
      inviteCode: code,
      createdAt: now,
    });
  });
}

export async function joinCompany(user: User, rawCode: string) {
  const { db } = requireFirebase();
  const code = rawCode.replace(/\s/g, "").toUpperCase().slice(0, 6);
  if (code.length !== 6) throw new Error("6 haneli ortaklık kodunu yazın.");

  const inviteRef = doc(db, "inviteCodes", code);
  const userRef = doc(db, "users", user.uid);

  await runTransaction(db, async (transaction) => {
    const [inviteSnapshot, existingUser] = await Promise.all([
      transaction.get(inviteRef),
      transaction.get(userRef),
    ]);
    if (existingUser.exists()) throw new Error("Zaten bir ortaklığa bağlısınız.");
    if (!inviteSnapshot.exists() || inviteSnapshot.data().active !== true) {
      throw new Error("Kod bulunamadı veya daha önce kullanılmış.");
    }

    const invite = inviteSnapshot.data() as { companyId: string; partnerId: string };
    const partnerRef = doc(db, "companies", invite.companyId, "partners", invite.partnerId);
    const partnerSnapshot = await transaction.get(partnerRef);
    if (!partnerSnapshot.exists() || partnerSnapshot.data().userId) {
      throw new Error("Bu ortaklıkta boş yer kalmamış.");
    }

    const partnerName = String(partnerSnapshot.data().name ?? user.displayName ?? "Ortak").slice(0, 50);
    const now = serverTimestamp();
    transaction.update(partnerRef, {
      userId: user.uid,
      email: user.email ?? "",
      joinedAt: now,
    });
    transaction.update(inviteRef, {
      active: false,
      claimedBy: user.uid,
      claimedAt: now,
    });
    transaction.set(userRef, {
      email: user.email ?? "",
      displayName: partnerName,
      companyId: invite.companyId,
      partnerId: invite.partnerId,
      inviteCode: code,
      createdAt: now,
    });
  });
}

export function subscribeCompany(
  companyId: string,
  onValue: (data: CompanyData) => void,
  onError: (error: Error) => void,
) {
  const { db } = requireFirebase();
  let company: Company | null = null;
  let partners: Partner[] = [];
  let cashEntries: CashEntry[] = [];
  let advanceRecords: Omit<Advance, "partnerName">[] = [];
  let jobRecords: Omit<Job, "vehiclePartnerName">[] = [];
  let customerAccounts: CustomerAccount[] = [];
  let auditLogs: AuditLog[] = [];

  const emit = () => {
    if (!company) return;
    const partnerNames = new Map(partners.map((partner) => [partner.id, partner.name]));
    const advances = advanceRecords.map((item) => ({
      ...item,
      partnerName: partnerNames.get(item.partnerId) ?? "Ortak",
    }));
    const jobs = jobRecords.map((item) => ({
      ...normalizeJob(item),
      vehiclePartnerName: item.vehiclePartnerId
        ? partnerNames.get(item.vehiclePartnerId) ?? "Ortak"
        : null,
    }));
    onValue({ company, partners, cashEntries, advances, jobs, customerAccounts, auditLogs });
  };
  const unsubs: Unsubscribe[] = [];

  unsubs.push(onSnapshot(doc(db, "companies", companyId), (snapshot) => {
    if (!snapshot.exists()) return onError(new Error("İşletme kaydı bulunamadı."));
    company = { id: snapshot.id, ...snapshot.data() } as Company;
    emit();
  }, onError));

  unsubs.push(onSnapshot(collection(db, "companies", companyId, "partners"), (snapshot) => {
    partners = snapshot.docs
      .map((item) => withId<Partner>(item))
      .sort((a, b) => (a.role === "owner" ? -1 : b.role === "owner" ? 1 : a.name.localeCompare(b.name, "tr")));
    emit();
  }, onError));

  unsubs.push(onSnapshot(collection(db, "companies", companyId, "cashEntries"), (snapshot) => {
    cashEntries = snapshot.docs
      .map((item) => withId<CashEntry>(item))
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    emit();
  }, onError));

  unsubs.push(onSnapshot(collection(db, "companies", companyId, "advances"), (snapshot) => {
    advanceRecords = snapshot.docs
      .map((item) => withId<Omit<Advance, "partnerName">>(item))
      .sort((a, b) => b.entryDate.localeCompare(a.entryDate));
    emit();
  }, onError));

  unsubs.push(onSnapshot(collection(db, "companies", companyId, "jobs"), (snapshot) => {
    jobRecords = snapshot.docs
      .map((item) => withId<Omit<Job, "vehiclePartnerName">>(item))
      .map(normalizeJob)
      .sort((a, b) => (a.status === b.status ? b.plannedDate.localeCompare(a.plannedDate) : a.status === "paid" ? 1 : -1));
    emit();
  }, onError));

  unsubs.push(onSnapshot(collection(db, "companies", companyId, "customerAccounts"), (snapshot) => {
    customerAccounts = snapshot.docs
      .map((item) => withId<CustomerAccount>(item))
      .map((item) => ({ ...item, creditCents: Math.max(0, Number(item.creditCents ?? 0)) }))
      .sort((a, b) => a.customerName.localeCompare(b.customerName, "tr"));
    emit();
  }, onError));

  unsubs.push(onSnapshot(collection(db, "companies", companyId, "auditLogs"), (snapshot) => {
    auditLogs = snapshot.docs
      .map((item) => withId<AuditLog>(item))
      .sort((a, b) => String(b.eventDate ?? "").localeCompare(String(a.eventDate ?? "")))
      .slice(0, 100);
    emit();
  }, onError));

  return () => unsubs.forEach((unsubscribe) => unsubscribe());
}

export async function addCashEntry(profile: UserProfile, entry: NewCashEntry) {
  const { db } = requireFirebase();
  await addDoc(collection(db, "companies", profile.companyId, "cashEntries"), {
    ...entry,
    counterparty: clean(entry.counterparty, 80),
    note: clean(entry.note, 240),
    category: clean(entry.category, 50),
    jobId: null,
    customerAccountId: null,
    customerPaymentGroupId: null,
    createdBy: profile.uid,
    createdAt: serverTimestamp(),
  });
  writeAudit(profile, "create", "cash", `${entry.kind === "income" ? "Gelir" : "Gider"} eklendi: ${clean(entry.counterparty || entry.category, 80)} · ${(entry.amountCents / 100).toFixed(2)} TL`);
}

export async function addAdvance(profile: UserProfile, entry: NewAdvance) {
  const { db } = requireFirebase();
  await addDoc(collection(db, "companies", profile.companyId, "advances"), {
    ...entry,
    note: clean(entry.note, 240),
    createdBy: profile.uid,
    createdAt: serverTimestamp(),
  });
  writeAudit(profile, "create", "advance", `Avans eklendi · ${(entry.amountCents / 100).toFixed(2)} TL`);
}

export async function addJob(profile: UserProfile, entry: NewJob) {
  const { db } = requireFirebase();
  const customerName = clean(entry.customerName, 80);
  const title = clean(entry.title, 100);
  const accountId = customerAccountId(customerName);
  const accountRef = doc(db, "companies", profile.companyId, "customerAccounts", accountId);
  const jobRef = doc(collection(db, "companies", profile.companyId, "jobs"));

  let appliedCredit = 0;
  await runTransaction(db, async (transaction) => {
    const accountSnapshot = await transaction.get(accountRef);
    const availableCredit = accountSnapshot.exists()
      ? Math.max(0, Number(accountSnapshot.data().creditCents ?? 0))
      : 0;
    appliedCredit = Math.min(availableCredit, entry.amountCents);
    const fullyPaid = appliedCredit >= entry.amountCents;
    const now = serverTimestamp();

    transaction.set(jobRef, {
      ...entry,
      customerName,
      title,
      note: clean(entry.note, 240),
      paidCents: appliedCredit,
      creditAppliedCents: appliedCredit,
      status: fullyPaid ? "paid" : appliedCredit > 0 ? "partial" : "open",
      paidDate: fullyPaid ? entry.plannedDate : null,
      createdBy: profile.uid,
      createdAt: now,
      updatedAt: now,
    });

    if (appliedCredit > 0) {
      transaction.set(accountRef, {
        customerName,
        creditCents: Math.max(0, availableCredit - appliedCredit),
        updatedBy: profile.uid,
        updatedAt: now,
      }, { merge: true });
    }
  });

  writeAudit(
    profile,
    "create",
    "job",
    `${customerName} için iş eklendi: ${title} · ${(entry.amountCents / 100).toFixed(2)} TL${appliedCredit > 0 ? ` · ${(appliedCredit / 100).toFixed(2)} TL müşteri avansından düşüldü` : ""}`,
  );
}

export async function addJobPayment(
  profile: UserProfile,
  jobId: string,
  amountCents: number,
  paidDate: string,
  note: string,
) {
  const { db } = requireFirebase();
  const jobRef = doc(db, "companies", profile.companyId, "jobs", jobId);
  const paymentRef = doc(collection(db, "companies", profile.companyId, "cashEntries"));
  let auditSummary = "İş ödemesi kaydedildi.";

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists()) throw new Error("İş kaydı bulunamadı.");

    const raw = normalizeJob({ id: snapshot.id, ...snapshot.data() } as Omit<Job, "vehiclePartnerName">);
    const currentPaid = raw.paidCents;
    if (raw.status === "paid" || currentPaid >= raw.amountCents) throw new Error("Bu iş zaten tamamen ödenmiş.");
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Geçerli bir ödeme tutarı yazın.");

    const remaining = raw.amountCents - currentPaid;
    if (amountCents > remaining) {
      throw new Error(`Bu işte fazla ödeme yerine müşteri kartındaki “Toplam bakiyeden tahsilat al” alanını kullanın. Kalan: ${(remaining / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`);
    }

    const nextPaid = currentPaid + amountCents;
    const fullyPaid = nextPaid >= raw.amountCents;
    const now = serverTimestamp();

    transaction.set(paymentRef, {
      kind: "income",
      amountCents,
      category: "İş ödemesi",
      counterparty: clean(raw.customerName, 80),
      note: clean(note, 240) || `${clean(raw.title, 100)} işi ödemesi`,
      entryDate: paidDate,
      jobId,
      customerAccountId: null,
      customerPaymentGroupId: null,
      createdBy: profile.uid,
      createdAt: now,
    });

    transaction.update(jobRef, {
      amountCents: raw.amountCents,
      paidCents: nextPaid,
      creditAppliedCents: raw.creditAppliedCents,
      status: fullyPaid ? "paid" : "partial",
      paidDate: fullyPaid ? paidDate : null,
      updatedAt: now,
    });
    auditSummary = `${raw.customerName} · ${raw.title} için ${(amountCents / 100).toFixed(2)} TL ödeme alındı.`;
  });

  writeAudit(profile, "payment", "job", auditSummary);
}

export async function addCustomerPayment(
  profile: UserProfile,
  customerName: string,
  amountCents: number,
  paidDate: string,
  note: string,
) {
  const { db } = requireFirebase();
  const cleanCustomer = clean(customerName, 80);
  if (!cleanCustomer) throw new Error("Müşteri adı bulunamadı.");
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Geçerli bir tahsilat tutarı yazın.");

  const jobsRef = collection(db, "companies", profile.companyId, "jobs");
  const jobsSnapshot = await getDocs(jobsRef);
  const customerKey = normalizedCustomer(cleanCustomer);
  const accountId = customerAccountId(cleanCustomer);
  const accountRef = doc(db, "companies", profile.companyId, "customerAccounts", accountId);

  const candidates = jobsSnapshot.docs
    .filter((item) => normalizedCustomer(String(item.data().customerName ?? "")) === customerKey)
    .sort((a, b) => {
      const byDate = String(a.data().plannedDate ?? "").localeCompare(String(b.data().plannedDate ?? ""));
      return byDate || a.id.localeCompare(b.id);
    });

  if (candidates.length > 200) throw new Error("Bu müşteride çok fazla iş var. Tahsilatı daha küçük gruplar halinde kaydedin.");

  const groupId = `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  let allocatedTotal = 0;
  let excessCredit = 0;

  await runTransaction(db, async (transaction) => {
    const accountSnapshot = await transaction.get(accountRef);
    const snapshots = [];
    for (const candidate of candidates) snapshots.push(await transaction.get(candidate.ref));

    const prepared = snapshots
      .filter((snapshot) => snapshot.exists())
      .map((snapshot) => {
        const raw = normalizeJob({ id: snapshot.id, ...snapshot.data() } as Omit<Job, "vehiclePartnerName">);
        return {
          ref: snapshot.ref,
          raw,
          remaining: Math.max(0, raw.amountCents - raw.paidCents),
        };
      })
      .filter((item) => item.remaining > 0)
      .sort((a, b) => {
        const byDate = String(a.raw.plannedDate ?? "").localeCompare(String(b.raw.plannedDate ?? ""));
        return byDate || a.ref.id.localeCompare(b.ref.id);
      });

    const totalRemaining = prepared.reduce((sum, item) => sum + item.remaining, 0);
    let undistributed = Math.min(amountCents, totalRemaining);
    allocatedTotal = undistributed;
    excessCredit = amountCents - undistributed;
    const now = serverTimestamp();

    for (const item of prepared) {
      if (undistributed <= 0) break;
      const allocated = Math.min(undistributed, item.remaining);
      const nextPaid = item.raw.paidCents + allocated;
      const fullyPaid = nextPaid >= item.raw.amountCents;
      const paymentRef = doc(collection(db, "companies", profile.companyId, "cashEntries"));
      const baseNote = clean(note, 160);
      const title = clean(String(item.raw.title ?? "İş"), 100);

      transaction.set(paymentRef, {
        kind: "income",
        amountCents: allocated,
        category: "Toplu tahsilat",
        counterparty: cleanCustomer,
        note: baseNote ? `Toplu tahsilat · ${title} · ${baseNote}` : `Toplu tahsilat · ${title}`,
        entryDate: paidDate,
        jobId: item.ref.id,
        customerAccountId: accountId,
        customerPaymentGroupId: groupId,
        createdBy: profile.uid,
        createdAt: now,
      });

      transaction.update(item.ref, {
        amountCents: item.raw.amountCents,
        paidCents: nextPaid,
        creditAppliedCents: item.raw.creditAppliedCents,
        status: fullyPaid ? "paid" : "partial",
        paidDate: fullyPaid ? paidDate : null,
        updatedAt: now,
      });

      undistributed -= allocated;
    }

    if (excessCredit > 0) {
      const existingCredit = accountSnapshot.exists() ? Math.max(0, Number(accountSnapshot.data().creditCents ?? 0)) : 0;
      const creditEntryRef = doc(collection(db, "companies", profile.companyId, "cashEntries"));
      transaction.set(creditEntryRef, {
        kind: "income",
        amountCents: excessCredit,
        category: "Müşteri avansı",
        counterparty: cleanCustomer,
        note: clean(note, 180) || "Açık borcu aşan müşteri tahsilatı",
        entryDate: paidDate,
        jobId: null,
        customerAccountId: accountId,
        customerPaymentGroupId: groupId,
        createdBy: profile.uid,
        createdAt: now,
      });
      transaction.set(accountRef, {
        customerName: cleanCustomer,
        creditCents: existingCredit + excessCredit,
        updatedBy: profile.uid,
        updatedAt: now,
      }, { merge: true });
    }
  });

  const details = [
    allocatedTotal > 0 ? `${(allocatedTotal / 100).toFixed(2)} TL açık işlere dağıtıldı` : "",
    excessCredit > 0 ? `${(excessCredit / 100).toFixed(2)} TL müşteri avansı olarak kaldı` : "",
  ].filter(Boolean).join(" · ");
  writeAudit(profile, "payment", "customer", `${cleanCustomer} için ${(amountCents / 100).toFixed(2)} TL toplam tahsilat alındı${details ? ` · ${details}` : ""}.`);
}

export async function deleteCashEntry(profile: UserProfile, entryId: string) {
  const { db } = requireFirebase();
  const entryRef = doc(db, "companies", profile.companyId, "cashEntries", entryId);
  let auditSummary = "Kasa kaydı silindi.";

  await runTransaction(db, async (transaction) => {
    const entrySnapshot = await transaction.get(entryRef);
    if (!entrySnapshot.exists()) return;
    const entry = { id: entrySnapshot.id, ...entrySnapshot.data() } as CashEntry;

    const jobRef = entry.jobId && entry.kind === "income"
      ? doc(db, "companies", profile.companyId, "jobs", entry.jobId)
      : null;
    const accountRef = entry.category === "Müşteri avansı" && entry.customerAccountId
      ? doc(db, "companies", profile.companyId, "customerAccounts", entry.customerAccountId)
      : null;

    const jobSnapshot = jobRef ? await transaction.get(jobRef) : null;
    const accountSnapshot = accountRef ? await transaction.get(accountRef) : null;

    if (jobRef && jobSnapshot?.exists()) {
      const raw = normalizeJob({ id: jobSnapshot.id, ...jobSnapshot.data() } as Omit<Job, "vehiclePartnerName">);
      const nextPaid = Math.max(raw.creditAppliedCents, raw.paidCents - Number(entry.amountCents ?? 0));
      transaction.update(jobRef, {
        amountCents: raw.amountCents,
        paidCents: nextPaid,
        creditAppliedCents: raw.creditAppliedCents,
        status: nextPaid <= 0 ? "open" : nextPaid >= raw.amountCents ? "paid" : "partial",
        paidDate: nextPaid >= raw.amountCents ? raw.paidDate ?? entry.entryDate : null,
        updatedAt: serverTimestamp(),
      });
    }

    if (accountRef) {
      const currentCredit = accountSnapshot?.exists() ? Math.max(0, Number(accountSnapshot.data().creditCents ?? 0)) : 0;
      if (currentCredit < entry.amountCents) {
        throw new Error("Bu müşteri avansının bir kısmı sonraki işlerde kullanılmış. Önce avansın kullanıldığı iş kaydını düzeltin veya silin.");
      }
      transaction.set(accountRef, {
        customerName: clean(entry.counterparty, 80),
        creditCents: currentCredit - entry.amountCents,
        updatedBy: profile.uid,
        updatedAt: serverTimestamp(),
      }, { merge: true });
    }

    transaction.delete(entryRef);
    auditSummary = `${entry.kind === "income" ? "Gelir" : "Gider"} silindi: ${entry.counterparty || entry.category} · ${(entry.amountCents / 100).toFixed(2)} TL`;
  });

  writeAudit(profile, "delete", "cash", auditSummary);
}

export async function deleteJob(profile: UserProfile, jobId: string) {
  const { db } = requireFirebase();
  const jobRef = doc(db, "companies", profile.companyId, "jobs", jobId);
  const jobSnapshot = await getDoc(jobRef);
  const job = jobSnapshot.exists()
    ? normalizeJob({ id: jobSnapshot.id, ...jobSnapshot.data() } as Omit<Job, "vehiclePartnerName">)
    : null;

  const cashRef = collection(db, "companies", profile.companyId, "cashEntries");
  const linked = await getDocs(query(cashRef, where("jobId", "==", jobId)));
  if (linked.size > 450) throw new Error("Bu işe bağlı çok fazla ödeme var. Kayıtları bölerek silin.");

  const batch = writeBatch(db);
  linked.docs.forEach((item) => batch.delete(item.ref));
  batch.delete(jobRef);

  if (job && job.creditAppliedCents > 0) {
    const accountRef = doc(db, "companies", profile.companyId, "customerAccounts", customerAccountId(job.customerName));
    batch.set(accountRef, {
      customerName: clean(job.customerName, 80),
      creditCents: increment(job.creditAppliedCents),
      updatedBy: profile.uid,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  await batch.commit();
  writeAudit(profile, "delete", "job", job ? `${job.customerName} · ${job.title} işi silindi.` : `İş kaydı silindi (${jobId}).`);
}

export async function saveCompanySettings(profile: UserProfile, values: CompanySettingsInput) {
  const { db } = requireFirebase();
  const name = clean(values.name, 80);
  if (!name) throw new Error("Firma adı zorunludur.");
  const logoDataUrl = values.logoDataUrl.trim();
  if (logoDataUrl && !logoDataUrl.startsWith("data:image/")) throw new Error("Logo dosyası geçerli bir görsel olmalı.");
  if (logoDataUrl.length > 300_000) throw new Error("Logo çok büyük. Daha küçük bir görsel seçin.");

  await setDoc(doc(db, "companies", profile.companyId), {
    name,
    phone: clean(values.phone, 40),
    email: clean(values.email, 120),
    address: clean(values.address, 240),
    taxOffice: clean(values.taxOffice, 80),
    taxNumber: clean(values.taxNumber, 40),
    logoDataUrl,
    updatedBy: profile.uid,
    updatedAt: serverTimestamp(),
  }, { merge: true });

  writeAudit(profile, "settings", "company", "Firma bilgileri ve PDF kurumsal ayarları güncellendi.");
}

export async function saveProfileName(profile: UserProfile, displayName: string) {
  const { db } = requireFirebase();
  await setDoc(doc(db, "users", profile.uid), { displayName: clean(displayName, 50) }, { merge: true });
}
