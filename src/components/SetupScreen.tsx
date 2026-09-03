import { useState, type FormEvent } from "react";
import type { User } from "firebase/auth";
import { ArrowRight, Building2, KeyRound, LogOut, Users } from "lucide-react";

type SetupMode = "create" | "join";

export function SetupScreen({
  user,
  busy,
  onCreate,
  onJoin,
  onLogout,
}: {
  user: User;
  busy: boolean;
  onCreate: (values: { companyName: string; ownerName: string; partnerName: string }) => Promise<void>;
  onJoin: (code: string) => Promise<void>;
  onLogout: () => Promise<void>;
}) {
  const [mode, setMode] = useState<SetupMode>("create");
  const firstName = user.displayName?.split(" ")[0] ?? "";

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (mode === "create") {
      void onCreate({
        companyName: String(values.companyName),
        ownerName: String(values.ownerName),
        partnerName: String(values.partnerName),
      });
    } else {
      void onJoin(String(values.inviteCode));
    }
  };

  return (
    <main className="setup-page">
      <section className="setup-shell">
        <header className="setup-header">
          <div className="brand-block compact">
            <div className="brand-mark">OK</div>
            <div><h1>Ortak Kasa</h1><p>İlk kurulum</p></div>
          </div>
          <button className="button button-dark-ghost" type="button" onClick={() => void onLogout()}>
            <LogOut size={17} /> Çıkış
          </button>
        </header>

        <div className="setup-card">
          <div className="setup-intro">
            <div className="setup-icon"><Users size={27} /></div>
            <div>
              <h2>Ortaklığınızı bağlayın</h2>
              <p>Biriniz işletmeyi oluşturur, diğeriniz çıkan 6 haneli kodla katılır.</p>
            </div>
          </div>

          <div className="segmented setup-tabs">
            <button type="button" className={mode === "create" ? "active" : ""} onClick={() => setMode("create")}>
              <Building2 size={17} /> Yeni oluştur
            </button>
            <button type="button" className={mode === "join" ? "active" : ""} onClick={() => setMode("join")}>
              <KeyRound size={17} /> Kodla katıl
            </button>
          </div>

          <form className="form-stack setup-form" onSubmit={submit}>
            {mode === "create" ? (
              <>
                <label className="field" htmlFor="company-name"><span>İşletme adı</span><input id="company-name" name="companyName" required maxLength={80} placeholder="Örn. Yıldız Servis" autoFocus /></label>
                <div className="form-grid">
                  <label className="field" htmlFor="owner-name"><span>Sizin adınız</span><input id="owner-name" name="ownerName" required maxLength={50} defaultValue={firstName} placeholder="Adınız" /></label>
                  <label className="field" htmlFor="partner-name"><span>Ortağınızın adı</span><input id="partner-name" name="partnerName" required maxLength={50} placeholder="Ortağınız" /></label>
                </div>
                <button className="button button-primary button-large" type="submit" disabled={busy}>
                  {busy ? "Oluşturuluyor…" : <>Ortaklığı oluştur <ArrowRight size={19} /></>}
                </button>
              </>
            ) : (
              <>
                <label className="field" htmlFor="invite-code">
                  <span>6 haneli ortaklık kodu</span>
                  <input id="invite-code" name="inviteCode" className="code-input" required minLength={6} maxLength={6} autoCapitalize="characters" autoComplete="off" placeholder="ABC234" autoFocus />
                </label>
                <div className="info-box">Kodu, ortaklığı ilk oluşturan kişinin uygulamasındaki Ayarlar bölümünde bulabilirsiniz.</div>
                <button className="button button-primary button-large" type="submit" disabled={busy}>
                  {busy ? "Bağlanıyor…" : <>Ortaklığa katıl <ArrowRight size={19} /></>}
                </button>
              </>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
