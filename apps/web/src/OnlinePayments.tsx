import { useEffect, useRef, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import { SaasDialog, SaasFeedback, SaasHeading, SaasPagination, saasMoney, saasDate, useSaasResource, type Plan, type Subscription } from "./Saas";

export interface OnlineOrder { needsReview?: boolean; id: string; tenantId: string; planName: string; provider: string; environment: string; amountUZS: number; billingPeriod: number; status: string; createdAt: string; expiresAt: string; paidAt: string | null; refundedAt: string | null; refundResolvedAt: string | null }
interface Checkout { order: OnlineOrder; checkoutUrl: string | null }
interface OrderPage { orders: OnlineOrder[]; page: number; total: number; pageSize: number }
const statuses: Record<string, string> = { pending: "To‘lov kutilmoqda", paid: "To‘langan", cancelled: "Bekor qilingan", refunded: "Pul qaytarilgan", expired: "Muddati tugagan" };
export function OnlineCheckout({ plan, providers, tenantId, onClose, onManual }: { plan: Plan; providers: string[]; tenantId?: string; onClose: () => void; onManual?: () => void }) {
  const [months, setMonths] = useState(1), [provider, setProvider] = useState(providers[0] ?? "");
  const [result, setResult] = useState<Checkout | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const pending = useRef<object | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault(); if (busy) return;
    pending.current ??= { planId: plan.id, billingPeriod: months, provider, idempotencyKey: crypto.randomUUID(), ...(tenantId ? { tenantId } : {}) };
    setBusy(true); setError("");
    try {
      setResult(await api<Checkout>(tenantId ? "/super-admin/saas/payment-orders/test" : "/saas/payment-orders", { method: "POST", body: JSON.stringify(pending.current) }));
      window.dispatchEvent(new Event("online-payments-updated"));
    }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <SaasDialog className="payment-dialog" title="Tarif uchun to‘lash" busy={busy} onClose={onClose}>
    <p><strong>{plan.name}</strong> · {tenantId ? "Test to‘lovi" : "Obuna to‘lovi"}</p>
    {!result ? <form className="saas-form" onSubmit={submit}>
      <fieldset disabled={busy || Boolean(pending.current)}>
        <label>To‘lov davri (oy)<input className="plain-input" type="number" min={1} max={12} step={1} required value={months} onChange={e => setMonths(Number(e.target.value))} /></label>
        <label>To‘lov tizimi<select className="plain-input" required value={provider} onChange={e => setProvider(e.target.value)}>{providers.map(p => <option key={p} value={p}>{p === "payme" ? "Payme" : "Click"}</option>)}</select></label>
      </fieldset>
      <p>Yakuniy summa keyingi qadamda server tomonidan hisoblanadi.</p>
      {error && <p className="notice" role="alert">{error} Qayta urinish ayni buyurtma kalitidan foydalanadi.</p>}
      <button className="button primary" disabled={busy}>{busy ? "Hisoblanmoqda…" : pending.current ? "Qayta urinish" : "Summani hisoblash"}</button>
    </form> : <section aria-label="To‘lov tasdig‘i"><p>To‘lov davri: {result.order.billingPeriod} oy</p><p>Yakuniy summa: <strong>{saasMoney(result.order.amountUZS)}</strong></p>
      <p>Holat: {statuses[result.order.status]}</p>{result.checkoutUrl ? <a className="button primary" href={result.checkoutUrl}>{result.order.provider === "payme" ? "Payme orqali to‘lash" : "Click orqali to‘lash"}</a> : <p>To‘lov havolasi yopilgan. Holatni to‘lovlar tarixidan tekshiring.</p>}
      <p>Obuna provayder tasdiqlagach yangilanadi.</p></section>}
    {onManual && !pending.current && <button className="button light" type="button" onClick={onManual}>Bank orqali to‘lov</button>}
  </SaasDialog>;
}
export function OnlineHistory({ admin = false, onPaid }: { admin?: boolean; onPaid?: () => void }) {
  const [page, setPage] = useState(1), [environment, setEnvironment] = useState(""), [status, setStatus] = useState("");
  const [search] = useSearchParams();
  const [detail, setDetail] = useState<string | null>(() => { const id = search.get("paymentOrder"); return id && /^[a-f0-9]{24}$/i.test(id) ? id : null; });
  const path = admin ? "/super-admin/saas/online-payments" : "/saas/payment-orders";
  const params = new URLSearchParams({ page: String(page), ...(environment ? { environment } : {}), ...(status ? { status } : {}) });
  const state = useSaasResource<OrderPage>(`${path}?${params}`);
  useEffect(() => {
    const refresh = () => state.reload();
    window.addEventListener("online-payments-updated", refresh);
    return () => window.removeEventListener("online-payments-updated", refresh);
  }, []);
  return <section className="panel saas-panel"><h2>Onlayn to‘lovlar tarixi</h2>
    {admin && <div className="saas-actions"><label>Muhit<select className="plain-input" value={environment} onChange={e => { setEnvironment(e.target.value); setPage(1); }}><option value="">Barchasi</option><option value="production">Haqiqiy</option><option value="test">Test</option></select></label><label>Holat<select className="plain-input" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="">Barchasi</option>{Object.entries(statuses).filter(([value]) => value !== "expired").map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>}
    <SaasFeedback {...state} /><button className="button light" onClick={state.reload}>Tarixni yangilash</button>
    {!state.loading && !state.error && (state.data?.orders?.length ? <div className="table-scroll saas-table" role="region" aria-label="Onlayn to‘lovlar" tabIndex={0}><table><caption className="saas-sr-only">Onlayn to‘lovlar tarixi</caption><thead><tr>{["Sana", "Tarif", "Provayder", "Summa", "Holat", "Amal"].map(h => <th scope="col" key={h}>{h}</th>)}</tr></thead><tbody>{state.data.orders.map(o => <tr key={o.id}><td>{saasDate(o.createdAt)}</td><td>{o.planName} · {o.billingPeriod} oy{admin && <small className="payment-tenant">{o.tenantId}</small>}</td><td>{o.provider}{o.environment === "test" && " · Test"}</td><td>{saasMoney(o.amountUZS)}</td><td>{statuses[o.status]}{o.needsReview && <p>Obuna uchun admin tekshiruvi kerak</p>}{admin && o.status === "refunded" && !o.refundResolvedAt && <p>Obuna tuzatishi kutilmoqda</p>}</td><td><button className="button light" onClick={() => setDetail(o.id)}>Tafsilotlar</button></td></tr>)}</tbody></table></div> : <p>Hali onlayn to‘lovlar mavjud emas.</p>)}
    {state.data?.orders && <SaasPagination {...state.data} page={page} onPage={setPage} />}
    {detail && <PaymentDetail id={detail} admin={admin} onClose={() => { setDetail(null); state.reload(); onPaid?.(); }} onPaid={onPaid} />}
  </section>;
}
interface Detail extends Checkout { tenantName?: string; subscription?: Subscription | null; subscriptionRevision?: number; before?: Subscription | null; after?: Subscription | null }
function PaymentDetail({ id, admin, onClose, onPaid }: { id: string; admin: boolean; onClose: () => void; onPaid?: () => void }) {
  const path = `${admin ? "/super-admin/saas/online-payments" : "/saas/payment-orders"}/${id}`;
  const state = useSaasResource<Detail>(path), [version, setVersion] = useState(0);
  const latest = useRef(onPaid); latest.current = onPaid;
  const notified = useRef(false);
  const order = state.data?.order;
  useEffect(() => {
    if (order?.status === "paid" && !notified.current) { notified.current = true; latest.current?.(); window.dispatchEvent(new Event("saas-updated")); }
    if (order?.status !== "pending") return;
    // Bounded polling; manual refresh remains available after one minute.
    let count = 0;
    const interval = window.setInterval(() => { if (++count >= 12) window.clearInterval(interval); state.reload(); }, 5000);
    return () => window.clearInterval(interval);
  }, [order?.status, version]);
  return <SaasDialog className="payment-dialog" title="Onlayn to‘lov tafsilotlari" onClose={onClose}><SaasFeedback {...state} />{order && <>
    <p>{state.data?.tenantName} · {order.planName} · {saasMoney(order.amountUZS)}</p><p role="status">{statuses[order.status]}</p>
    {order.needsReview && <p className="notice" role="status">To‘lov qabul qilindi, ammo obuna shartlari o‘zgargan. Super administrator qaytarishni tekshirishi kerak.</p>}
    <p>To‘lov ID: {order.id}</p><p>{order.provider} · {order.environment === "test" ? "Test" : "Haqiqiy to‘lov"}</p>
    {state.data?.checkoutUrl && <a className="button primary" href={state.data.checkoutUrl}>To‘lovni davom ettirish</a>}
    <button className="button light" onClick={() => { state.reload(); setVersion(v => v + 1); }}>Holatni tekshirish</button>
    {order.status === "pending" && <p>Tasdiq kutilmoqda. Sahifaga qaytish to‘lov tasdig‘i emas.</p>}
    {admin && order.environment === "production" && !order.refundResolvedAt && (order.status === "refunded" || order.provider === "click" && order.status === "paid") && state.data?.subscription && <RefundForm detail={state.data} onSaved={state.reload} />}
    {order.refundResolvedAt && <p>Obuna tuzatishi qayd etilgan: {saasDate(order.refundResolvedAt)}</p>}
  </>}</SaasDialog>;
}
function RefundForm({ detail, onSaved }: { detail: Detail; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    const form = e.currentTarget, data = new FormData(form); setBusy(true); setError("");
    try {
      await api(`/super-admin/saas/online-payments/${detail.order.id}/refund`, { method: "POST", body: JSON.stringify({
        confirmedRefund: data.get("confirmed") === "on", reference: data.get("reference"), reason: data.get("reason"),
        periodEnd: new Date(`${data.get("periodEnd")}+05:00`).toISOString(), subscriptionRevision: detail.subscriptionRevision,
        password: data.get("password"), ...(data.get("code") ? { code: data.get("code") } : {}),
      }) }); onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); for (const name of ["password", "code"]) (form.elements.namedItem(name) as HTMLInputElement).value = ""; }
  }
  return <form className="saas-form" onSubmit={submit}><h3>Qaytarishni muvofiqlashtirish</h3><p>Bu amal pul qaytarmaydi. Provayder kabinetidagi to‘liq qaytarishni tekshirib, obuna muddatini tuzating.</p>
    <p>Joriy tugash sanasi: {saasDate(detail.subscription?.periodEnd)}. To‘lovdan oldingi sana: {saasDate(detail.before?.periodEnd)}.</p>
    <fieldset disabled={busy}><label>Qaytarish raqami<input className="plain-input" name="reference" minLength={3} maxLength={200} required /></label><label>Sabab<textarea className="plain-input" name="reason" minLength={3} maxLength={500} required /></label>
      <label>Yangi tugash sanasi (Toshkent)<input className="plain-input" name="periodEnd" type="datetime-local" step="0.001" defaultValue={new Date(Math.max(Date.parse(detail.order.needsReview ? detail.subscription!.periodEnd : detail.before?.periodEnd ?? detail.subscription!.periodStart), Date.parse(detail.subscription!.periodStart)) + 5 * 3600000).toISOString().slice(0, 23)} required /></label>
      <label className="saas-check"><input name="confirmed" type="checkbox" required />Pul to‘liq qaytarilganini provayder kabinetida tekshirdim</label>
      <label>Joriy parolingiz<input className="plain-input" name="password" type="password" autoComplete="current-password" required /></label><label>MFA kodi (yoqilgan bo‘lsa)<input className="plain-input" name="code" autoComplete="one-time-code" /></label>
    </fieldset>{error && <p className="notice" role="alert">{error}</p>}<button className="button primary" disabled={busy}>{busy ? "Saqlanmoqda…" : "Obuna tuzatishini tasdiqlash"}</button></form>;
}
export function OnlinePaymentsAdmin() { return <div className="saas-page"><SaasHeading title="Onlayn to‘lovlar">Payme va Click to‘lovlari, testlar va qaytarishlar.</SaasHeading><OnlineHistory admin /></div>; }
