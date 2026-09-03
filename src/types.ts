export type Period = "day" | "week" | "month" | "year";

export type UserProfile = {
  uid: string;
  email: string;
  displayName: string;
  companyId: string;
  partnerId: string;
  inviteCode: string;
};

export type Company = {
  id: string;
  name: string;
  inviteCode: string;
  ownerUid: string;
};

export type Partner = {
  id: string;
  name: string;
  role: "owner" | "partner";
  userId: string | null;
  email: string | null;
};

export type CashEntry = {
  id: string;
  kind: "income" | "expense";
  amountCents: number;
  category: string;
  counterparty: string;
  note: string;
  entryDate: string;
  jobId: string | null;
};

export type Advance = {
  id: string;
  partnerId: string;
  partnerName: string;
  amountCents: number;
  entryDate: string;
  note: string;
};

export type Job = {
  id: string;
  customerName: string;
  title: string;
  amountCents: number;
  plannedDate: string;
  vehiclePartnerId: string | null;
  vehiclePartnerName: string | null;
  serviceFeeCents: number;
  note: string;
  status: "open" | "paid";
  paidDate: string | null;
};

export type CompanyData = {
  company: Company;
  partners: Partner[];
  cashEntries: CashEntry[];
  advances: Advance[];
  jobs: Job[];
};

export type NewCashEntry = Omit<CashEntry, "id" | "jobId">;
export type NewAdvance = Omit<Advance, "id" | "partnerName">;
export type NewJob = Omit<Job, "id" | "vehiclePartnerName" | "status" | "paidDate">;
