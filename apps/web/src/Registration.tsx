import { useEffect, useState, type FormEvent } from "react";
import { api } from "./api";
import type { SessionView } from "@softlans/contracts";
import type { Plan } from "./Saas";
import { saasMoney } from "./Saas";

export function Registration({ onSession }: { onSession: (session: SessionView) => void }) {
  const [step, setStep] = useState(0);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [centerName, setCenterName] = useState("");
  const [planId, setPlanId] = useState("");
  const [account, setAccount] = useState({ name: "", email: "", password: "" });
  useEffect(() => {
    let alive = true;
    setLoading(true); setError("");
    api<{ plans: Plan[] }>("/auth/registration-plans").then(result => {
      if (alive) { setPlans(result.plans); setPlanId(current => result.plans.some(p => p.id === current) ? current : ""); }
    }).catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [version]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || loading || !plans.length) return;
    if (step < 2) { setStep(step + 1); setError(""); return; }
    setBusy(true); setError("");
    try {
      const session = await api<SessionView>("/auth/register", { method: "POST", body: JSON.stringify({ centerName, planId, ...account }) });
      onSession(session);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  const selected = plans.find(p => p.id === planId);
  return <form className="auth-form registration-form" onSubmit={submit}>
    <ol aria-label="Ro‘yxatdan o‘tish bosqichlari">{["Markaz ma’lumotlari", "Tarif tanlash", "Rahbar akkaunti"].map((label, i) => <li key={label} aria-current={step === i ? "step" : undefined}>{label}{step === i ? " — joriy bosqich" : ""}</li>)}</ol>
    {loading && <p role="status">Tariflar yuklanmoqda…</p>}
    {error && <div className="notice" role="alert">{error}</div>}
    {!loading && !plans.length && <><p>Ro‘yxatdan o‘tish uchun faol tariflar mavjud emas yoki ro‘yxatdan o‘tish yopiq.</p><button type="button" className="button light" onClick={() => setVersion(v => v + 1)}>Qayta urinish</button></>}
    <fieldset disabled={busy || loading || !plans.length}>
      {step === 0 && <><label htmlFor="registration-center">O‘quv markazi nomi</label><input className="plain-input" id="registration-center" required minLength={2} maxLength={120} autoComplete="organization" value={centerName} onChange={e => setCenterName(e.target.value)} /></>}
      {step === 1 && <fieldset><legend>Tarifni tanlang</legend>{plans.map(plan => <label key={plan.id} className="panel registration-plan"><input type="radio" name="planId" required value={plan.id} checked={planId === plan.id} onChange={() => setPlanId(plan.id)} /> {plan.name} — {saasMoney(plan.monthlyPriceUZS)} / oy<br />Faol o‘quvchilar: {plan.studentLimit ?? "Cheklanmagan"}. Faol guruhlar: {plan.groupLimit ?? "Cheklanmagan"}.{plan.features.length > 0 && <span> {plan.features.join(" · ")}</span>}</label>)}</fieldset>}
      {step === 2 && <><p>{centerName} · {selected?.name} · {selected && saasMoney(selected.monthlyPriceUZS)} / oy</p>{([['name', 'Ism va familiya'], ['email', 'Email manzili'], ['password', 'Parol']] as const).map(([key, label]) => <div key={key}><label htmlFor={`registration-${key}`}>{label}</label><input className="plain-input" id={`registration-${key}`} type={key === 'name' ? 'text' : key} required minLength={key === 'password' ? 12 : key === 'name' ? 2 : undefined} maxLength={key === 'name' ? 100 : key === 'email' ? 254 : undefined} autoComplete={key === 'password' ? 'new-password' : key} value={account[key]} onChange={e => setAccount({ ...account, [key]: e.target.value })} /></div>)}<p>Tanlangan tarifda 14 kun bepul sinov. Trial tugagach, obuna haqiqiy to‘lov tasdiqlangandan so‘ng faollashadi.</p></>}
      <div className="saas-actions">{step > 0 && <button type="button" className="button light" onClick={() => { setStep(step - 1); setError(""); }}>Orqaga</button>}<button className="button primary auth-submit" disabled={busy || loading || !plans.length}>{busy ? "Hisob yaratilmoqda…" : step < 2 ? "Davom etish" : "14 kunlik bepul sinovni boshlash"}</button></div>
    </fieldset>
  </form>;
}
