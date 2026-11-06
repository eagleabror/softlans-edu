import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Eye, EyeOff, Layers, LockKeyhole, ShieldCheck } from "lucide-react";
import { api, HttpError } from "./api";

type Mode = "change" | "forgot" | "reset";
export function PasswordField({ name, label, error, disabled }: { name: string; label: string; error?: string; disabled: boolean }) {
  const [visible, setVisible] = useState(false);
  return <div className="password-field"><label htmlFor={name}>{label}</label>
    <div className="input-wrap"><LockKeyhole size={17} aria-hidden="true" />
      <input id={name} name={name} type={visible ? "text" : "password"} required disabled={disabled}
        autoComplete={(name === "currentPassword" || name === "password") ? "current-password" : "new-password"}
        aria-invalid={!!error} aria-describedby={error ? `${name}-error` : name === "newPassword" ? "password-policy" : undefined} />
      <button type="button" className="icon-button" aria-label={`${label}: ${visible ? "yashirish" : "ko‘rsatish"}`}
        aria-pressed={visible} disabled={disabled} onClick={() => setVisible(v => !v)}>
        {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
      </button></div>
    {error && <p id={`${name}-error`} className="password-field-error">{error}</p>}
  </div>;
}
function PublicFrame({ children }: { children: ReactNode }) {
  return <main className="password-public"><aside className="password-story">
    <Link to="/login" className="brand brand-light"><Layers size={28} aria-hidden="true" /> SoftLans edu <small>2.0</small></Link>
    <div><ShieldCheck size={56} strokeWidth={1.2} aria-hidden="true" /><p className="eyebrow">HISOB XAVFSIZLIGI</p>
      <h2>Ishonchli kirish.<br /><span>Xotirjam boshqaruv.</span></h2>
      <p>Markazingiz va jamoangiz uchun xavfsiz ish maydoni.</p></div>
    <p>SoftLans Edu · Ta’lim uchun yaratilgan</p>
  </aside><section className="password-public-content"><div className="password-card">{children}</div></section></main>;
}
export function PasswordSecurity({ mode, onSignedOut }: { mode: Mode; onSignedOut?: (updated?: boolean) => void }) {
  const navigate = useNavigate();
  const form = useRef<HTMLFormElement>(null);
  // Read once, then remove the secret from browser history. Never persist it.
  const [token] = useState(() => mode === "reset" ? new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "" : "");
  const [available, setAvailable] = useState<boolean | null>(mode === "change" ? true : null);
  const [busy, setBusy] = useState(false);
  const [success, setSuccess] = useState("");
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  useEffect(() => {
    if (mode === "reset" && window.location.hash) window.history.replaceState(null, "", window.location.pathname);
    if (mode === "change") return;
    let active = true;
    api<{ enabled: boolean }>("/auth/password-recovery").then(r => { if (active) setAvailable(r.enabled); })
      .catch(() => { if (active) setAvailable(false); });
    return () => { active = false; };
  }, [mode]);
  const title = mode === "change" ? "Parolni o‘zgartirish" : mode === "forgot" ? "Parolni unutdingizmi?" : "Yangi parol o‘rnating";
  const badToken = mode === "reset" && !/^[a-f0-9]{64}$/.test(token);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !available || badToken) return;
    setError(""); setFields({});
    const data = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    const invalid: Record<string, string> = {};
    if (mode === "forgot") {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email?.trim() ?? "") || data.email!.trim().length > 254)
        invalid.email = "To‘g‘ri email manzilini kiriting.";
    } else {
      if (mode === "change" && !data.currentPassword) invalid.currentPassword = "Joriy parolni kiriting.";
      if ((data.newPassword ?? "").length < 12) invalid.newPassword = "Parol kamida 12 ta belgidan iborat bo‘lsin.";
      else if (new TextEncoder().encode(data.newPassword).length > 72) invalid.newPassword = "Parol 72 UTF-8 baytdan oshmasin.";
      if (data.newPassword !== data.confirmNewPassword) invalid.confirmNewPassword = "Parollar mos kelmadi.";
      if (mode === "change" && data.currentPassword && data.currentPassword === data.newPassword)
        invalid.newPassword = "Yangi parol joriy paroldan farq qilishi kerak.";
    }
    if (Object.keys(invalid).length) {
      setFields(invalid); setError("Kiritilgan ma’lumotlarni tekshiring.");
      form.current?.querySelector<HTMLInputElement>(`[name="${Object.keys(invalid)[0]}"]`)?.focus(); return;
    }
    setBusy(true);
    try {
      if (mode === "forgot") {
        const result = await api<{ message: string }>("/auth/forgot-password", { method: "POST", body: JSON.stringify({ email: data.email!.trim() }) });
        setSuccess(result.message); form.current?.reset();
      } else {
        await api(`/auth/${mode === "change" ? "change-password" : "reset-password"}`, { method: "POST", body: JSON.stringify({
          ...(mode === "change" ? { currentPassword: data.currentPassword } : { token }), newPassword: data.newPassword,
        }) });
        form.current?.reset();
        navigate("/login", { replace: true, state: { passwordUpdated: true } });
        onSignedOut?.(true);
      }
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof HttpError && e.status === 401 && mode === "change") {
        navigate("/login", { replace: true }); onSignedOut?.();
      }
    } finally { setBusy(false); }
  }
  const content = <>
    <Link className="password-back" to={mode === "change" ? "/account" : "/login"}><ArrowLeft size={17} aria-hidden="true" />{mode === "change" ? "Hisobimga qaytish" : "Kirish sahifasiga qaytish"}</Link>
    <div className="auth-symbol"><LockKeyhole size={26} aria-hidden="true" /></div>
    {mode === "change" ? <h2>{title}</h2> : <h1>{title}</h1>}
    <p className="muted">{mode === "forgot" ? "Email manzilingizni kiriting. Hisobingiz mos bo‘lsa, tiklash yo‘riqnomasini olasiz." : "Parol yangilangach, barcha qurilmalardagi sessiyalar tugaydi. Qayta kirishingiz kerak bo‘ladi."}</p>
    {available === null && <p role="status">Yuklanmoqda…</p>}
    {available === false && <div className="notice" role="alert">Parolni email orqali tiklash hozircha mavjud emas. Markaz mas’uliga murojaat qiling.</div>}
    {badToken && <div className="notice" role="alert">Tiklash havolasi yaroqsiz. <Link to="/forgot-password">Yangi havola so‘rang.</Link></div>}
    {success ? <div className="success-note" role="status"><ShieldCheck size={22} aria-hidden="true" /><p>{success}</p></div> :
      <form ref={form} onSubmit={submit} noValidate className="auth-form password-form" aria-busy={busy}>
        {mode === "forgot" ? <div className="password-field"><label htmlFor="recovery-email">Email manzili</label>
          <div className="input-wrap"><input id="recovery-email" name="email" type="email" autoComplete="email" required maxLength={254}
            placeholder="siz@markaz.uz" disabled={busy || !available} aria-invalid={!!fields.email} aria-describedby={fields.email ? "email-error" : undefined} /></div>
          {fields.email && <p id="email-error" className="password-field-error">{fields.email}</p>}</div> : <>
          {mode === "change" && <PasswordField name="currentPassword" label="Joriy parol" error={fields.currentPassword} disabled={busy} />}
          <PasswordField name="newPassword" label="Yangi parol" error={fields.newPassword} disabled={busy || !available || badToken} />
          <p id="password-policy" className="muted password-policy">Kamida 12 ta belgi, ko‘pi bilan 72 UTF-8 bayt. Oldingi parolingizdan farqli parol tanlang.</p>
          <PasswordField name="confirmNewPassword" label="Yangi parolni tasdiqlang" error={fields.confirmNewPassword} disabled={busy || !available || badToken} />
        </>}
        {error && <div className="notice" role="alert">{error}</div>}
        <button className="button primary" disabled={busy || !available || badToken} type="submit">{busy ? "Yuborilmoqda…" : mode === "forgot" ? "Tiklash havolasini so‘rash" : "Parolni yangilash"}</button>
      </form>}
    {mode === "reset" && !badToken && <Link to="/forgot-password">Yangi tiklash havolasini so‘rash</Link>}
  </>;
  return mode === "change" ? <section className="panel password-settings">{content}</section> : <PublicFrame>{content}</PublicFrame>;
}
