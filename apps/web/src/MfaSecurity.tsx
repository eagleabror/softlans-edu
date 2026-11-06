import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { KeyRound, ShieldCheck, Smartphone } from "lucide-react";
import type { SessionView } from "@softlans/contracts";
import { api } from "./api";
import { PasswordField } from "./PasswordSecurity";
import { PageHeading } from "./ui";
import "./MfaSecurity.css";

const post = <T,>(path: string, body: unknown = {}) => api<T>(`/auth/${path}`, { method: "POST", body: JSON.stringify(body) });
export function FactorField({ disabled = false, recovery = true }: { disabled?: boolean; recovery?: boolean }) {
  return <div className="password-field"><label htmlFor="factor-code">{recovery ? "Tasdiqlash yoki tiklash kodi" : "Tasdiqlash kodi"}</label>
    <input className="plain-input" id="factor-code" name="code" required disabled={disabled} autoComplete="one-time-code"
      inputMode={recovery ? "text" : "numeric"} pattern={recovery ? "([0-9]{6}|[a-f0-9-]{32,39})" : "[0-9]{6}"} maxLength={39} aria-describedby="factor-help" />
    <p id="factor-help" className="muted">{recovery ? "Ilovadagi 6 raqamli kod yoki bir martalik tiklash kodini kiriting." : "Google Authenticator yoki Microsoft Authenticator ilovasidagi 6 raqamli kodni kiriting."}</p></div>;
}
export function MfaLoginChallenge({ onSession, onCancel }: { onSession: (s: SessionView) => void; onCancel: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    const code = String(new FormData(e.currentTarget).get("code") ?? "");
    setBusy(true); setError("");
    try { onSession(await post<SessionView>("mfa/verify", { code })); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <main className="password-public mfa-login"><aside className="password-story"><Link to="/login" className="brand brand-light">SoftLans edu 2.0</Link>
    <div><ShieldCheck size={56} aria-hidden="true" /><h2>Hisobingiz uchun<br />qo‘shimcha himoya.</h2><p>Parolingiz tasdiqlandi. Endi shaxsingizni tasdiqlang.</p></div><p>SoftLans Edu · Hisob xavfsizligi</p></aside>
    <section className="password-public-content"><div className="password-card"><div className="auth-symbol"><KeyRound aria-hidden="true" /></div>
      <h1>Ikki bosqichli tasdiqlash</h1><p className="muted">So‘rov 5 daqiqa amal qiladi. Kodni hech kimga bermang.</p>
      <form className="auth-form" onSubmit={submit} aria-busy={busy}><FactorField disabled={busy} />
        {error && <div className="notice" role="alert">{error}</div>}
        <button className="button primary" disabled={busy}>{busy ? "Tekshirilmoqda…" : "Kirishni tasdiqlash"}</button>
      </form><button className="button light" disabled={busy} onClick={async () => {
        setBusy(true); try { await post("mfa/cancel"); onCancel(); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
      }}>Kirishga qaytish</button>
    </div></section></main>;
}

type SecurityStatus = { enabled: boolean; available: boolean; recoveryCodesRemaining: number; superAdminEnforced: boolean };
type Device = { id: string; current: boolean; device: string; signedInAt: string; lastActivityAt: string };
type Operation = "enroll" | "confirm" | "cancel" | "recovery-codes" | "disable" | "revoke-others";
function deviceDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Tashkent" }).format(new Date(value));
}
export function SecuritySettings({ onSignedOut }: { onSignedOut: () => void }) {
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [legacy, setLegacy] = useState(false);
  const [operation, setOperation] = useState<Operation | null>(null);
  const [qr, setQr] = useState("");
  const [codes, setCodes] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revoke, setRevoke] = useState<Device | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const form = useRef<HTMLFormElement>(null);
  async function load() {
    const [security, sessions] = await Promise.all([api<SecurityStatus>("/auth/security"), api<{ legacy: boolean; sessions: Device[] }>("/auth/sessions")]);
    setStatus(security); setDevices(sessions.sessions); setLegacy(sessions.legacy);
  }
  useEffect(() => { load().catch(e => setError((e as Error).message)); }, []);
  useEffect(() => {
    if (!revoke) return;
    const element = dialog.current; element?.showModal();
    return () => element?.close();
  }, [revoke]);
  useEffect(() => { if (operation) form.current?.querySelector<HTMLInputElement>("input")?.focus(); }, [operation]);
  useEffect(() => {
    if (!qr) return;
    const timer = window.setTimeout(() => { setQr(""); setOperation(null); setNotice("QR-kod muddati tugadi. Sozlashni qayta boshlang."); }, 600_000);
    return () => window.clearTimeout(timer);
  }, [qr]);
  const titles: Record<Operation, string> = { enroll: "Ikki bosqichli himoyani yoqish", confirm: "Autentifikator kodini tasdiqlash", cancel: "Sozlashni bekor qilish", "recovery-codes": "Tiklash kodlarini yangilash", disable: "Ikki bosqichli himoyani o‘chirish", "revoke-others": "Boshqa sessiyalarni tugatish" };
  function choose(next: Operation) { setError(""); setNotice(""); setOperation(next); form.current?.reset(); }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (!operation || busy) return;
    const data = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await post<{ qrDataUrl?: string; recoveryCodes?: string[] } | undefined>(operation === "revoke-others" ? "sessions/revoke-others" : `security/${operation}`, data);
      form.current?.reset();
      if (operation === "disable") { onSignedOut(); return; }
      if (result?.qrDataUrl) { setQr(result.qrDataUrl); setOperation(null); }
      else {
        setQr(""); setOperation(null);
        if (result?.recoveryCodes) setCodes(result.recoveryCodes);
        setNotice(operation === "confirm" ? "Ikki bosqichli himoya yoqildi. Tiklash kodlarini saqlang." : "O‘zgarish saqlandi.");
        await load();
      }
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  return <div className="mfa-security"><PageHeading eyebrow="HISOB HIMOYASI" title="Xavfsizlik sozlamalari" description="Ikki bosqichli himoya va qurilmalardagi sessiyalarni boshqaring." />
    <Link to="/account" className="password-back">Hisobimga qaytish</Link>
    {error && <div className="notice" role="alert">{error}<button className="button light" disabled={busy} onClick={() => { setError(""); load().catch(e => setError(e.message)); }}>Qayta urinish</button></div>}
    {notice && <p className="success-note" role="status">{notice}</p>}
    {!status && !error && <p role="status">Yuklanmoqda…</p>}
    {status && <>
      <section className="panel mfa-panel"><div className="mfa-section-title"><ShieldCheck aria-hidden="true" /><h2>Ikki bosqichli himoya</h2><span className="role-tag">{status.enabled ? "Yoqilgan" : "Yoqilmagan"}</span></div>
        <p className="muted">Paroldan keyin autentifikator ilovasidagi bir martalik kod so‘raladi.</p>
        {!status.available && <p className="notice">Himoyani sozlash uchun mas’ul operatorga murojaat qiling.</p>}
        {status.superAdminEnforced && <p>Super administrator uchun ushbu himoya majburiy.</p>}
        {status.enabled && <p>Qolgan tiklash kodlari: <strong>{status.recoveryCodesRemaining}</strong></p>}
        {!qr && !codes.length && <div className="mfa-actions">
          {!status.enabled ? <button className="button primary" disabled={!status.available || busy || legacy} onClick={() => choose("enroll")}>Himoyani yoqish</button> : <>
            <button className="button light" disabled={busy} onClick={() => choose("recovery-codes")}>Tiklash kodlarini yangilash</button>
            {!status.superAdminEnforced && <button className="button light" disabled={busy} onClick={() => choose("disable")}>Himoyani o‘chirish</button>}
          </>}
        </div>}
      </section>
      {qr && <section className="panel mfa-panel"><h2>QR-kod orqali ulash</h2><p>Google Authenticator yoki Microsoft Authenticator ilovasida yangi hisob qo‘shib, QR-kodni skanerlang. QR-kodni ulashmang. U 10 daqiqa amal qiladi.</p>
        <img className="mfa-qr" data-security-secret src={qr} alt="Autentifikator ilovasida skanerlash uchun maxfiy QR-kod" width={240} height={240} />
        <div className="mfa-actions"><button className="button primary" disabled={busy} onClick={() => choose("confirm")}>Kodni kiritish</button><button className="button light" disabled={busy} onClick={() => choose("cancel")}>Sozlashni bekor qilish</button></div>
      </section>}
      {!!codes.length && <section className="panel mfa-panel"><h2>Tiklash kodlari</h2><p role="status">Bu kodlar faqat hozir ko‘rsatiladi. Har bir kod bir marta ishlaydi.</p>
        <p>Kodlarni ishonchli parol menejerida yoki qog‘ozga yozib, qulflanadigan joyda saqlang. Email, chat va umumiy bulutli jildga yubormang. Skrinshot olmang. Autentifikator saqlangan qurilmadan alohida saqlang.</p>
        <ul className="mfa-codes" data-security-secret>{codes.map(code => <li key={code}><code>{code}</code></li>)}</ul>
        <button className="button primary" onClick={() => { setCodes([]); setNotice("Tiklash kodlari yopildi. Ularni qayta ko‘rib bo‘lmaydi."); }}>Kodlarni saqladim</button>
      </section>}
      {operation && <section className="panel mfa-panel"><h2>{titles[operation]}</h2>
        <p className="muted">Xavfsizlik uchun joriy parolingizni qayta kiriting.{status.enabled && " Autentifikator yoki tiklash kodi ham talab qilinadi."}</p>
        {operation === "recovery-codes" && <p>Avvalgi barcha tiklash kodlari bekor qilinadi.</p>}
        {operation === "disable" && <p>Barcha sessiyalar tugaydi. Qayta kirishingiz kerak bo‘ladi.</p>}
        <form ref={form} className="auth-form" aria-busy={busy} onSubmit={submit}>
          <PasswordField name="password" label="Joriy parol" disabled={busy} />
          {(status.enabled || operation === "confirm") && <FactorField disabled={busy} recovery={status.enabled} />}
          <div className="mfa-actions"><button className="button primary" disabled={busy}>{busy ? "Tekshirilmoqda…" : "Tasdiqlash"}</button><button type="button" className="button light" disabled={busy} onClick={() => { form.current?.reset(); setOperation(null); }}>Yopish</button></div>
        </form>
      </section>}
      <section className="panel mfa-panel"><div className="mfa-section-title"><Smartphone aria-hidden="true" /><h2>Faol sessiyalar</h2></div>
        <p className="muted">Vaqtlar taxminiy, Toshkent vaqti bilan. Sessiya uchun IP manzil va qurilma izi saqlanmaydi.</p>
        {legacy && <p className="notice">Avvalgi sessiya ishlatilmoqda. Qurilmalarni boshqarish uchun hisobdan chiqib, qayta kiring.</p>}
        {!devices.length && !legacy && <p>Faol sessiyalar topilmadi.</p>}
        <ul className="mfa-devices">{devices.map(device => <li key={device.id}><div><strong>{device.device}</strong>{device.current && <span className="role-tag">Joriy qurilma</span>}
          <p>Kirish: {deviceDate(device.signedInAt)}<br />Oxirgi faollik: {deviceDate(device.lastActivityAt)}</p></div>
          <button className="button light" disabled={busy} onClick={() => setRevoke(device)}>Sessiyani tugatish</button></li>)}</ul>
        <button className="button light" disabled={busy || legacy} onClick={() => choose("revoke-others")}>Boshqa sessiyalarni tugatish</button>
      </section>
    </>}
    <dialog ref={dialog} className="member-dialog mfa-dialog" aria-labelledby="revoke-heading" onCancel={e => { if (busy) e.preventDefault(); else setRevoke(null); }}>
      <h2 id="revoke-heading">Sessiyani tugatish</h2><p>{revoke?.device} qurilmasidagi sessiya tugatilsinmi?{revoke?.current && " Bu joriy qurilma. Hisobingizdan chiqasiz."}</p>
      <div className="mfa-actions"><button className="button primary" disabled={busy} onClick={async () => {
        if (!revoke || busy) return; setBusy(true); setError("");
        try { const result = await post<{ currentRevoked: boolean }>("sessions/revoke", { id: revoke.id }); setRevoke(null);
          if (result.currentRevoked) onSignedOut(); else { setNotice("Sessiya tugatildi."); await load(); }
        } catch (e) { setRevoke(null); setError((e as Error).message); } finally { setBusy(false); }
      }}>{busy ? "Tugatilmoqda…" : "Ha, tugatish"}</button><button className="button light" disabled={busy} onClick={() => setRevoke(null)}>Bekor qilish</button></div>
    </dialog>
  </div>;
}
