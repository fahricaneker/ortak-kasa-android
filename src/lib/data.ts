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
  getDocs,
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
  CashEntry,
  Company,
  CompanyData,
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

function normalizeJob(raw: Omit<Job, "vehiclePartnerName">): Omit<Job, "vehiclePartnerName"> {
  const legacy = raw as Omit<Job, "vehiclePartnerName"> & {
    originalAmountCents?: number;
    paidAmountCents?: number;
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
    status,
    paidDate: status === "paid" ? raw.paidDate ?? raw.plannedDate : null,
  };
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
    onValue({ company, partners, cashEntries, advances, jobs });
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
    createdBy: profile.uid,
    createdAt: serverTimestamp(),
  });
}

export async function addAdvance(profile: UserProfile, entry: NewAdvance) {
  const { db } = requireFirebase();
  await addDoc(collection(db, "companies", profile.companyId, "advances"), {
    ...entry,
    note: clean(entry.note, 240),
    createdBy: profile.uid,
    createdAt: serverTimestamp(),
  });
}

export async function addJob(profile: UserProfile, entry: NewJob) {
  const { db } = requireFirebase();
  await addDoc(collection(db, "companies", profile.companyId, "jobs"), {
    ...entry,
    customerName: clean(entry.customerName, 80),
    title: clean(entry.title, 100),
    note: clean(entry.note, 240),
    paidCents: 0,
    status: "open",
    paidDate: null,
    createdBy: profile.uid,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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

  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(jobRef);
    if (!snapshot.exists()) throw new Error("İş kaydı bulunamadı.");

    const raw = snapshot.data() as Job & { originalAmountCents?: number; paidAmountCents?: number };
    const storedAmount = Number(raw.amountCents ?? 0);
    const jobAmount = Number.isInteger(raw.originalAmountCents) && Number(raw.originalAmountCents) > 0
      ? Number(raw.originalAmountCents)
      : storedAmount;
    const legacyPaid = Number.isInteger(raw.paidAmountCents) && Number(raw.paidAmountCents) > 0
      ? Number(raw.paidAmountCents)
      : raw.status === "paid"
        ? jobAmount
        : 0;
    const currentPaid = Math.max(
      0,
      Math.min(jobAmount, Number.isInteger(raw.paidCents) ? Number(raw.paidCents) : legacyPaid),
    );
    if (raw.status === "paid" || currentPaid >= jobAmount) throw new Error("Bu iş zaten tamamen ödenmiş.");
    if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Geçerli bir ödeme tutarı yazın.");

    const remaining = jobAmount - currentPaid;
    if (amountCents > remaining) {
      throw new Error(`Ödeme kalan tutarı geçemez. Kalan: ${(remaining / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`);
    }

    const nextPaid = currentPaid + amountCents;
    const fullyPaid = nextPaid >= jobAmount;
    const now = serverTimestamp();

    transaction.set(paymentRef, {
      kind: "income",
      amountCents,
      category: "İş ödemesi",
      counterparty: clean(raw.customerName, 80),
      note: clean(note, 240) || `${clean(raw.title, 100)} işi ödemesi`,
      entryDate: paidDate,
      jobId,
      createdBy: profile.uid,
      createdAt: now,
    });

    transaction.update(jobRef, {
      amountCents: jobAmount,
      paidCents: nextPaid,
      status: fullyPaid ? "paid" : "partial",
      paidDate: fullyPaid ? paidDate : null,
      updatedAt: now,
    });
  });
}

export async function deleteCashEntry(profile: UserProfile, entryId: string) {
  const { db } = requireFirebase();
  const entryRef = doc(db, "companies", profile.companyId, "cashEntries", entryId);

  await runTransaction(db, async (transaction) => {
    const entrySnapshot = await transaction.get(entryRef);
    if (!entrySnapshot.exists()) return;
    const entry = entrySnapshot.data() as CashEntry;

    if (entry.jobId && entry.kind === "income") {
      const jobRef = doc(db, "companies", profile.companyId, "jobs", entry.jobId);
      const jobSnapshot = await transaction.get(jobRef);
      if (jobSnapshot.exists()) {
        const raw = jobSnapshot.data() as Job & { originalAmountCents?: number; paidAmountCents?: number };
        const storedAmount = Number(raw.amountCents ?? 0);
        const amountCents = Number.isInteger(raw.originalAmountCents) && Number(raw.originalAmountCents) > 0
          ? Number(raw.originalAmountCents)
          : storedAmount;
        const legacyPaid = Number.isInteger(raw.paidAmountCents) && Number(raw.paidAmountCents) > 0
          ? Number(raw.paidAmountCents)
          : raw.status === "paid"
            ? amountCents
            : 0;
        const currentPaid = Math.max(
          0,
          Math.min(amountCents, Number.isInteger(raw.paidCents) ? Number(raw.paidCents) : legacyPaid),
        );
        const nextPaid = Math.max(0, currentPaid - Number(entry.amountCents ?? 0));
        transaction.update(jobRef, {
          amountCents,
          paidCents: nextPaid,
          status: nextPaid <= 0 ? "open" : nextPaid >= amountCents ? "paid" : "partial",
          paidDate: nextPaid >= amountCents ? raw.paidDate ?? entry.entryDate : null,
          updatedAt: serverTimestamp(),
        });
      }
    }

    transaction.delete(entryRef);
  });
}

export async function deleteJob(profile: UserProfile, jobId: string) {
  const { db } = requireFirebase();
  const cashRef = collection(db, "companies", profile.companyId, "cashEntries");
  const linked = await getDocs(query(cashRef, where("jobId", "==", jobId)));
  if (linked.size > 450) throw new Error("Bu işe bağlı çok fazla ödeme var. Destek için kayıtları bölerek silin.");

  const batch = writeBatch(db);
  linked.docs.forEach((item) => batch.delete(item.ref));
  batch.delete(doc(db, "companies", profile.companyId, "jobs", jobId));
  await batch.commit();
}

export async function saveProfileName(profile: UserProfile, displayName: string) {
  const { db } = requireFirebase();
  await setDoc(doc(db, "users", profile.uid), { displayName: clean(displayName, 50) }, { merge: true });
}
