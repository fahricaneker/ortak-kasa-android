import { useState, type FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";

type Mode = "login" | "register";

export function AuthScreen({
  busy,
  onLogin,
  onRegister,
  onReset,
}: {
  busy: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
  onRegister: (email: string, password: string, name: string) => Promise<void>;
  onReset: (email: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const values = Object.fromEntries(new FormData(event.currentTarget).entries());
    if (mode === "register") {
      void onRegister(String(values.email), String(values.password), String(values.name));
    } else {
      void onLogin(String(values.email), String(values.password));
    }
  };

  return (
    <main className="auth-page">
      <div className="auth-orb auth-orb-one" />
      <div className="auth-orb auth-orb-two" />
      <section className="auth-shell">
        <div className="brand-block">
          <div className="brand-mark">OK</div>
          <div>
            <h1>Ortak Kasa</h1>
            <p>İşiniz, kasanız ve ortaklığınız tek yerde.</p>
          </div>
        </div>

        <div className="auth-card">
          <div className="segmented auth-tabs">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>Giriş yap</button>
            <button type="button" className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>Hesap aç</button>
          </div>

          <div className="auth-title">
            <h2>{mode === "login" ? "Tekrar hoş geldiniz" : "Hesabınızı oluşturun"}</h2>
            <p>{mode === "login" ? "Kayıtlarınıza ulaşmak için giriş yapın." : "İlk kişi ortaklığı kurar, diğeri kodla katılır."}</p>
          </div>

          <form className="form-stack" onSubmit={submit}>
            {mode === "register" && (
              <label className="field" htmlFor="auth-name">
                <span>Adınız</span>
                <input id="auth-name" name="name" required maxLength={50} autoComplete="name" placeholder="Adınız" />
              </label>
            )}
            <label className="field" htmlFor="auth-email">
              <span>E-posta</span>
              <div className="input-with-icon">
                <Mail size={18} />
                <input
                  id="auth-email"
                  name="email"
                  type="email"
                  required
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  autoComplete="email"
                  inputMode="email"
                  placeholder="ornek@mail.com"
                />
              </div>
            </label>
            <label className="field" htmlFor="auth-password">
              <span>Şifre</span>
              <div className="input-with-icon">
                <LockKeyhole size={18} />
                <input
                  id="auth-password"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={6}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  placeholder="En az 6 karakter"
                />
                <button type="button" className="password-toggle" onClick={() => setShowPassword((value) => !value)} aria-label="Şifreyi göster veya gizle">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </label>

            {mode === "login" && (
              <button className="link-button align-right" type="button" disabled={busy} onClick={() => void onReset(email)}>
                Şifremi unuttum
              </button>
            )}

            <button className="button button-primary button-large" type="submit" disabled={busy}>
              {busy ? "Lütfen bekleyin…" : mode === "login" ? "Giriş yap" : "Hesap aç"}
            </button>
          </form>

          <p className="cloud-note">Kayıtlarınız Firebase / Google Cloud üzerinde korunur ve iki telefonda eşzamanlanır.</p>
        </div>
      </section>
    </main>
  );
}
