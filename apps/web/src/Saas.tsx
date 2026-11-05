import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { api, HttpError } from "./api";
import "./Saas.css";

export interface Plan {
  id: string; name: string; code: string; monthlyPriceUZS: number;
  studentLimit: number | null; groupLimit: number | null; features: string[]; isActive: boolean;
}
export interface Subscription {
  id: string; tenantId: string; tenantName?: string; planId: string; planName: string; planCode: string;
  status: string; periodStart: string; periodEnd: string; trialStart: string | null; trialEnd: string | null;
  agreedPriceUZS: number; studentLimit: number | null; groupLimit: number | null; features: string[];
  remainingDays: number; pendingPlanId: string | null;
}
export interface PaymentRequest {
  id: string; tenantId: string; tenantName: string; planId: string; planName: string;
  amountUZS: number; billingPeriod: number; status: string; submittedBy: string; submittedAt: string;
  paidAt: string; paymentMethod: string; transactionNote: string;
  reviewedBy: string | null; reviewedAt: string | null; reviewNote: string | null;
}
export const saasMoney = (value: number) => `${new Intl.NumberFormat("uz-UZ").format(value)} UZS`;
export const saasDate = (value: string | null | undefined) => value
  ? new Intl.DateTimeFormat("uz-UZ", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Tashkent" }).format(new Date(value)) : "—";
const statusNames: Record<string, string> = {
  trialing: "Bepul sinov", active: "Faol", past_due: "To‘lov kutilmoqda", expired: "Muddati tugagan",
  suspended: "To‘xtatilgan", cancelled: "Bekor qilingan", legacy: "Avvalgi markaz", pending: "Ko‘rib chiqilmoqda",
  approved: "Tasdiqlangan", rejected: "Rad etilgan",
};
export function SaasStatus({ status }: { status: string }) {
  return <span className={`saas-status saas-status-${status}`}>{statusNames[status] ?? status}</span>;
}
export function useSaasResource<T>(path: string) {
  const [result, setResult] = useState<{ path: string; value: T } | null>(null);
  const [loading, setLoading] = useState(true), [error, setError] = useState(""), [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setLoading(true); setError("");
    api<T>(path).then(value => { if (live) setResult({ path, value }); })
      .catch((e: Error) => { if (live) setError(e.message); })
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
  }, [path, version]);
  return { data: result?.path === path ? result.value : null, loading, error, reload: () => setVersion(v => v + 1) };
}
export function SaasFeedback({ loading, error, reload }: { loading: boolean; error: string; reload: () => void }) {
  if (error) return <div className="notice saas-actions" role="alert">{error}<button className="button light" onClick={reload}>Qayta urinish</button></div>;
  return loading ? <p role="status">Yuklanmoqda…</p> : null;
}
export function SaasHeading({ title, children }: { title: string; children?: ReactNode }) {
  return <div className="page-heading"><div><h1>{title}</h1><p>{children}</p></div></div>;
}
export function SaasPagination({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (n: number) => void }) {
  return <div className="saas-actions saas-pagination"><span>Jami {total} ta · {page}-sahifa</span><button className="button light" disabled={page <= 1} onClick={() => onPage(page - 1)}>Oldingi</button><button className="button light" disabled={page * pageSize >= total} onClick={() => onPage(page + 1)}>Keyingi</button></div>;
}
export function SaasDialog({ title, onClose, children, busy = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const headingId = `saas-dialog-${title.replaceAll(" ", "-")}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const dialog = ref.current; dialog?.showModal();
    return () => { dialog?.close(); previous?.focus(); };
  }, []);
  return <dialog ref={ref} className="member-dialog saas-dialog" aria-labelledby={headingId} onCancel={e => { e.preventDefault(); if (!busy) onClose(); }}>
    <div className="saas-actions"><h2 id={headingId}>{title}</h2><button className="button light" type="button" onClick={onClose} disabled={busy} aria-label="Oynani yopish">Yopish</button></div>{children}
  </dialog>;
}

export function SubscriptionBanner({ owner }: { owner: boolean }) {
  const location = useLocation();
  const [value, setValue] = useState<{ readOnly: boolean; status: string; periodEnd: string | null } | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => { void api<typeof value>("/saas/entitlement").then(result => { if (live) setValue(result); }).catch(() => {}); };
    load();
    window.addEventListener("saas-updated", load);
    window.addEventListener("focus", load);
    return () => { live = false; window.removeEventListener("saas-updated", load); window.removeEventListener("focus", load); };
  }, [location.pathname]);
  if (!value?.readOnly) return null;
  return <section className="notice saas-readonly" role="status" aria-label="Obuna cheklovi">
    <strong><SaasStatus status={value.status} /> · Faqat ko‘rish rejimi</strong>
    <p>Ma’lumotlaringiz saqlanadi. O‘zgartirish kiritish uchun obunani yangilang.</p>
    {owner ? <Link className="button primary" to="/settings/subscription">Obunani yangilash</Link> : <p>Obunani yangilash uchun markaz egasiga murojaat qiling.</p>}
  </section>;
}
interface TenantSummary {
  subscription: Subscription | null; usage: { students: number; groups: number }; legacy: boolean;
  instructions: { text: string; updatedAt: string } | null;
}
interface RequestsPage { requests: PaymentRequest[]; total: number; page: number; pageSize: number }
const limitText = (value: number | null) => value === null ? "Cheklanmagan" : String(value);

export function TenantSubscription() {
  const state = useSaasResource<TenantSummary>("/saas");
  const plans = useSaasResource<{ plans: Plan[] }>("/saas/plans");
  const [page, setPage] = useState(1);
  const payments = useSaasResource<RequestsPage>(`/saas/payment-requests?page=${page}`);
  const reminders = useSaasResource<{ reminders: { id: string; message: string; periodEnd: string }[] }>("/saas/reminders");
  const [chosen, setChosen] = useState<Plan | null>(null), [success, setSuccess] = useState("");
  const subscription = state.data?.subscription;
  function saved() {
    setChosen(null); setPage(1); payments.reload(); state.reload();
    setSuccess("To‘lov so‘rovi yuborildi. Super administrator tasdiqlagach obuna yangilanadi.");
    window.dispatchEvent(new Event("saas-updated"));
  }
  return <div className="saas-page">
    <SaasHeading title="Obuna va tariflar">Markazingizning SoftLans xizmatiga obunasi. Barcha sanalar Toshkent vaqtida.</SaasHeading>
    {success && <div className="success-note" role="status">{success}</div>}
    <SaasFeedback {...state} />
    {!state.loading && !state.error && state.data && <>
      <section className="panel saas-panel">
        <div className="saas-actions"><h2>Hozirgi obuna</h2><SaasStatus status={subscription?.status ?? "legacy"} /></div>
        {subscription ? <>
          <dl className="saas-details">
            <div><dt>Tarif</dt><dd>{subscription.planName}</dd></div>
            <div><dt>Kelishilgan oylik narx</dt><dd>{saasMoney(subscription.agreedPriceUZS)}</dd></div>
            <div><dt>Obuna tugashi</dt><dd>{saasDate(subscription.periodEnd)}</dd></div>
            <div><dt>Qolgan kunlar</dt><dd>{subscription.remainingDays} kun</dd></div>
            <div><dt>Faol o‘quvchilar</dt><dd>{state.data.usage.students} / {limitText(subscription.studentLimit)}</dd></div>
            <div><dt>Faol guruhlar</dt><dd>{state.data.usage.groups} / {limitText(subscription.groupLimit)}</dd></div>
            {subscription.trialStart && <div><dt>Sinov boshlanishi</dt><dd>{saasDate(subscription.trialStart)}</dd></div>}
            {subscription.trialEnd && <div><dt>Sinov tugashi</dt><dd>{saasDate(subscription.trialEnd)}</dd></div>}
          </dl>
          {subscription.pendingPlanId && <p className="saas-muted">Keyingi davr uchun tarif almashtirish belgilangan. Yangi tarif faqat to‘lov tasdiqlangach qo‘llanadi.</p>}
          {((subscription.studentLimit !== null && state.data.usage.students >= subscription.studentLimit) || (subscription.groupLimit !== null && state.data.usage.groups >= subscription.groupLimit)) && <p className="notice" role="status">Tarif limitiga yetilgan. Mavjud yozuvlar saqlanadi; yangi faol yozuv uchun yuqoriroq tarif tanlang yoki faol yozuvlar sonini kamaytiring.</p>}
        </> : <p>Bu markaz avval yaratilgan. Amaldagi ish tartibi saqlangan; tarifni Super administrator biriktiradi. Avtomatik sinov muddati berilmagan.</p>}
      </section>
      {reminders.error ? <SaasFeedback {...reminders} /> : reminders.data?.reminders.length ? <section className="panel saas-panel" aria-label="Obuna eslatmalari"><h2>Obuna eslatmalari</h2><ul>{reminders.data.reminders.map(item => <li key={item.id}>{item.message} <span className="saas-muted">({saasDate(item.periodEnd)})</span></li>)}</ul></section> : null}
      <section className="panel saas-panel"><h2>Tariflarni solishtirish</h2><SaasFeedback {...plans} />
        {!plans.loading && !plans.error && <div className="saas-plan-grid">{plans.data?.plans.map(plan => <article className="saas-plan" key={plan.id}>
          <h3>{plan.name}</h3><p className="saas-price">{saasMoney(plan.monthlyPriceUZS)}<span> / oy</span></p>
          <dl><dt>Faol o‘quvchilar</dt><dd>{limitText(plan.studentLimit)}</dd><dt>Faol guruhlar</dt><dd>{limitText(plan.groupLimit)}</dd></dl>
          {plan.features.length > 0 && <ul>{plan.features.map((feature, index) => <li key={index}>{feature}</li>)}</ul>}
          <button className="button primary" disabled={!state.data?.instructions} onClick={() => { setChosen(plan); setSuccess(""); }}>{plan.name} tarifini tanlash</button>
        </article>)}</div>}
        {!plans.loading && !plans.error && plans.data?.plans.length === 0 && <p>Hozircha faol tariflar mavjud emas.</p>}
        {!state.data.instructions && <p className="notice" role="status">Tasdiqlangan to‘lov yo‘riqnomasi hali kiritilmagan. To‘lov uchun Super administrator bilan bog‘laning.</p>}
      </section>
    </>}
    <section className="panel saas-panel"><h2>To‘lov so‘rovlari tarixi</h2><SaasFeedback {...payments} />
      {!payments.loading && !payments.error && payments.data && <>{payments.data.requests.length ? <div className="table-scroll saas-table" role="region" aria-label="SaaS to‘lovlar tarixi" tabIndex={0}><table><caption className="saas-sr-only">SaaS to‘lov so‘rovlari</caption><thead><tr><th scope="col">Sana</th><th scope="col">Tarif</th><th scope="col">Summa</th><th scope="col">Davr</th><th scope="col">Holat</th><th scope="col">Ko‘rib chiqish izohi</th></tr></thead><tbody>{payments.data.requests.map(request => <tr key={request.id}><td>{saasDate(request.submittedAt)}</td><td>{request.planName}</td><td>{saasMoney(request.amountUZS)}</td><td>{request.billingPeriod} oy</td><td><SaasStatus status={request.status} /></td><td>{request.reviewNote || "—"}</td></tr>)}</tbody></table></div> : <p>Hali to‘lov so‘rovlari yuborilmagan.</p>}<SaasPagination {...payments.data} page={page} onPage={setPage} /></>}
    </section>
    {chosen && state.data?.instructions && <PaymentDialog plan={chosen} instructions={state.data.instructions.text} onClose={() => setChosen(null)} onSaved={saved} />}
  </div>;
}
interface PaymentPayload { planId: string; billingPeriod: number; paidAt: string; paymentMethod: string; transactionNote: string; idempotencyKey: string }
function PaymentDialog({ plan, instructions, onClose, onSaved }: { plan: Plan; instructions: string; onClose: () => void; onSaved: () => void }) {
  const [months, setMonths] = useState(1), [paidAt, setPaidAt] = useState(""), [method, setMethod] = useState(""), [note, setNote] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [pending, setPending] = useState<PaymentPayload | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault(); if (busy) return;
    const payload = pending ?? { planId: plan.id, billingPeriod: months, paidAt: new Date(`${paidAt}:00+05:00`).toISOString(), paymentMethod: method.trim(), transactionNote: note.trim(), idempotencyKey: crypto.randomUUID() };
    setPending(payload); setBusy(true); setError("");
    try { await api("/saas/payment-requests", { method: "POST", body: JSON.stringify(payload) }); onSaved(); }
    catch (e) { setError((e as Error).message); if (e instanceof HttpError && e.status >= 400 && e.status < 500 && e.status !== 409 && e.status !== 429) setPending(null); }
    finally { setBusy(false); }
  }
  return <SaasDialog title="To‘lov so‘rovi yuborish" busy={busy} onClose={onClose}>
    <p><strong>{plan.name}</strong> · {saasMoney(plan.monthlyPriceUZS)} / oy</p>
    <div className="saas-instructions"><h3>Tasdiqlangan to‘lov yo‘riqnomasi</h3><p>{instructions}</p></div>
    <p>So‘rov yuborish to‘lovni tasdiqlamaydi. Super administrator mablag‘ kelib tushganini tekshirgach obuna yangilanadi.</p>
    <form className="saas-form" onSubmit={submit}>
      <fieldset disabled={busy || pending !== null}>
        <label>To‘lov davri (oy)<input className="plain-input" type="number" min={1} max={12} step={1} required value={months} onChange={e => setMonths(Number(e.target.value))} /></label>
        <label>To‘lov sanasi va vaqti (Toshkent)<input className="plain-input" type="datetime-local" required value={paidAt} onChange={e => setPaidAt(e.target.value)} /></label>
        <label>To‘lov usuli<input className="plain-input" required maxLength={100} value={method} onChange={e => setMethod(e.target.value)} placeholder="Masalan: bank o‘tkazmasi" /></label>
        <label>Tranzaksiya izohi<textarea className="plain-input" required maxLength={500} rows={3} value={note} onChange={e => setNote(e.target.value)} /></label>
      </fieldset>
      <p>Hisoblangan summa: <strong>{saasMoney(plan.monthlyPriceUZS * months)}</strong>. Yakuniy summa serverdagi tarif narxidan belgilanadi.</p>
      {error && <div className="notice" role="alert">{error}{pending && <p>Qayta yuborishda shu so‘rovning ma’lumotlari va identifikatori saqlanadi.</p>}</div>}
      <button className="button primary" disabled={busy}>{busy ? "Yuborilmoqda…" : pending ? "So‘rovni qayta yuborish" : "To‘lov qilganim haqida yuborish"}</button>
    </form>
  </SaasDialog>;
}
