import { useCallback, useEffect, useRef, useState } from "react";
import { onAuthStateChanged, type User } from "firebase/auth";
import { AlertTriangle, CheckCircle2, CloudCog, Info, LoaderCircle } from "lucide-react";

import { AuthScreen } from "./components/AuthScreen";
import { Dashboard } from "./components/Dashboard";
import { SetupScreen } from "./components/SetupScreen";
import {
  addAdvance,
  addCashEntry,
  addJob,
  addJobPayment,
  addCustomerPayment,
  createCompany,
  deleteCashEntry,
  deleteJob,
  joinCompany,
  login,
  logout,
  register,
  resetPassword,
  saveCompanySettings,
  subscribeCompany,
  subscribeProfile,
} from "./lib/data";
import { auth, firebaseConfigured } from "./lib/firebase";
import { errorMessage } from "./lib/utils";
import type { CompanyData, CompanySettingsInput, NewAdvance, NewCashEntry, NewJob, UserProfile } from "./types";

type Notice = { id: number; message: string; tone: "success" | "error" | "info" };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [companyData, setCompanyData] = useState<CompanyData | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeTimer = useRef<number | null>(null);

  const notify = useCallback((message: string, tone: Notice["tone"] = "info") => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
    setNotice({ id: Date.now(), message, tone });
    noticeTimer.current = window.setTimeout(() => setNotice(null), 4200);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) window.clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (!auth) {
      setAuthLoading(false);
      return;
    }
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setProfile(nextUser ? undefined : null);
      setCompanyData(null);
      setAuthLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    return subscribeProfile(
      user.uid,
      setProfile,
      (error) => {
        setProfile(null);
        notify(errorMessage(error), "error");
      },
    );
  }, [user, notify]);

  useEffect(() => {
    if (!profile) {
      setCompanyData(null);
      return;
    }
    return subscribeCompany(
      profile.companyId,
      setCompanyData,
      (error) => notify(errorMessage(error), "error"),
    );
  }, [profile, notify]);

  const withBusy = async <T,>(action: () => Promise<T>) => {
    setBusy(true);
    try {
      return await action();
    } finally {
      setBusy(false);
    }
  };

  const handleLogin = async (email: string, password: string) => {
    try {
      await withBusy(() => login(email, password));
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const handleRegister = async (email: string, password: string, name: string) => {
    try {
      await withBusy(() => register(email, password, name));
      notify("Hesabınız oluşturuldu.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const handleReset = async (email: string) => {
    if (!email.trim()) {
      notify("Önce e-posta adresinizi yazın.", "info");
      return;
    }
    try {
      await withBusy(() => resetPassword(email));
      notify("Şifre yenileme bağlantısı e-postanıza gönderildi.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const handleCreateCompany = async (values: { companyName: string; ownerName: string; partnerName: string }) => {
    if (!user) return;
    try {
      await withBusy(() => createCompany(user, values));
      notify("Ortaklık oluşturuldu.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const handleJoinCompany = async (code: string) => {
    if (!user) return;
    try {
      await withBusy(() => joinCompany(user, code));
      notify("Ortaklığa katıldınız.", "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const handleLogout = async () => {
    try {
      await withBusy(logout);
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  };

  const requireProfile = () => {
    if (!profile) throw new Error("Ortaklık bilgisi yüklenemedi.");
    return profile;
  };

  const handleAddCash = (entry: NewCashEntry) => withBusy(() => addCashEntry(requireProfile(), entry));
  const handleAddAdvance = (entry: NewAdvance) => withBusy(() => addAdvance(requireProfile(), entry));
  const handleAddJob = (entry: NewJob) => withBusy(() => addJob(requireProfile(), entry));
  const handleAddPayment = (jobId: string, amountCents: number, paidDate: string, note: string) =>
    withBusy(() => addJobPayment(requireProfile(), jobId, amountCents, paidDate, note));
  const handleCollectCustomer = (customerName: string, amountCents: number, paidDate: string, note: string) =>
    withBusy(() => addCustomerPayment(requireProfile(), customerName, amountCents, paidDate, note));
  const handleDeleteJob = (jobId: string) => withBusy(() => deleteJob(requireProfile(), jobId));
  const handleDeleteCash = (entryId: string) => withBusy(() => deleteCashEntry(requireProfile(), entryId));
  const handleSaveCompany = (values: CompanySettingsInput) => withBusy(() => saveCompanySettings(requireProfile(), values));

  let content;
  if (!firebaseConfigured) {
    content = <ConfigurationScreen />;
  } else if (authLoading || (user && profile === undefined) || (profile && !companyData)) {
    content = <LoadingScreen />;
  } else if (!user) {
    content = <AuthScreen busy={busy} onLogin={handleLogin} onRegister={handleRegister} onReset={handleReset} />;
  } else if (!profile) {
    content = <SetupScreen user={user} busy={busy} onCreate={handleCreateCompany} onJoin={handleJoinCompany} onLogout={handleLogout} />;
  } else if (companyData) {
    content = (
      <Dashboard
        profile={profile}
        data={companyData}
        busy={busy}
        onAddCash={handleAddCash}
        onAddAdvance={handleAddAdvance}
        onAddJob={handleAddJob}
        onAddPayment={handleAddPayment}
        onCollectCustomer={handleCollectCustomer}
        onDeleteJob={handleDeleteJob}
        onDeleteCash={handleDeleteCash}
        onSaveCompany={handleSaveCompany}
        onLogout={handleLogout}
        notify={notify}
      />
    );
  }

  return <>{content}{notice && <NoticeToast notice={notice} onClose={() => setNotice(null)} />}</>;
}

function LoadingScreen() {
  return <main className="loading-page"><div className="brand-mark">OK</div><LoaderCircle className="spin" size={27} /><p>Kayıtlar hazırlanıyor…</p></main>;
}

function ConfigurationScreen() {
  return (
    <main className="configuration-page">
      <section>
        <span><CloudCog size={30} /></span>
        <h1>Google Cloud bağlantısı bekleniyor</h1>
        <p>Uygulama hazır. Firebase proje bilgileri eklendiğinde giriş ve ortak kayıtları açılacak.</p>
        <div className="info-box">Bu ekran yalnızca ilk kurulum tamamlanmadan önce görünür.</div>
      </section>
    </main>
  );
}

function NoticeToast({ notice, onClose }: { notice: Notice; onClose: () => void }) {
  const Icon = notice.tone === "success" ? CheckCircle2 : notice.tone === "error" ? AlertTriangle : Info;
  return <button key={notice.id} className={`notice-toast ${notice.tone}`} type="button" onClick={onClose}><Icon size={20} /><span>{notice.message}</span></button>;
}
