import { useState, type FormEvent, type ReactNode } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "./api";
import {
  useSaasResource, SaasFeedback, SaasHeading, SaasStatus, SaasDialog,
  SaasPagination, saasMoney, saasDate, type Plan, type Subscription, type PaymentRequest,
} from "./Saas";

const root = "/super-admin/saas";
const limit = (value: number | null) => value === null ? "Cheklanmagan" : String(value);
const mutation = (path: string, payload: unknown, method = "POST") => api(path, { method, body: JSON.stringify(payload) });
function ErrorNotice({ error }: { error: string }) {
  return error ? <div className="notice" role="alert">{error}</div> : null;
}
function Table({ name, headers, children }: { name: string; headers: string[]; children: ReactNode }) {
  return <div className="table-scroll saas-table" tabIndex={0} role="region" aria-label={name}>
    <table aria-label={name}><thead><tr>{headers.map((header) => <th scope="col" key={header}>{header}</th>)}</tr></thead><tbody>{children}</tbody></table>
  </div>;
}

export function SaasPlans() {
  const state = useSaasResource<{ plans: Plan[] }>(`${root}/plans`);
  const [editing, setEditing] = useState<Plan | "new" | null>(null);
  const [success, setSuccess] = useState("");
  return <div className="saas-page">
    <SaasHeading title="Tariflar">Platformaning oylik tariflari va faol yozuvlar limitlari.</SaasHeading>
    <div className="saas-actions"><button className="button primary" onClick={() => setEditing("new")}>Tarif yaratish</button></div>
    {success && <p className="success-note" role="status">{success}</p>}
    <section className="panel saas-panel">
      <p className="saas-muted">Yangi narx va limitlar keyingi obunaga qo‘llanadi. To‘langan davr shartlari saqlanadi.</p>
      <SaasFeedback {...state} />
      {state.data && !state.loading && !state.error && (state.data.plans.length ? <Table name="SaaS tariflar" headers={["Tarif", "Oylik narx", "O‘quvchilar", "Guruhlar", "Holat", "Amal"]}>
        {state.data.plans.map((plan) => <tr key={plan.id}><td><strong>{plan.name}</strong><br /><small>{plan.code}</small></td><td>{saasMoney(plan.monthlyPriceUZS)}</td><td>{limit(plan.studentLimit)}</td><td>{limit(plan.groupLimit)}</td><td>{plan.isActive ? "Faol" : "Faolsiz"}</td><td><button className="button light" onClick={() => setEditing(plan)} aria-label={`${plan.name} tarifini tahrirlash`}>Tahrirlash</button></td></tr>)}
      </Table> : <p>Tariflar topilmadi. Birinchi tarifni yarating.</p>)}
    </section>
    {editing && <PlanEditor plan={editing === "new" ? null : editing} onClose={() => setEditing(null)} onSaved={() => { setEditing(null); setSuccess("Tarif saqlandi."); state.reload(); }} />}
  </div>;
}
function PlanEditor({ plan, onClose, onSaved }: { plan: Plan | null; onClose: () => void; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const data = new FormData(event.currentTarget);
    const optionalLimit = (key: string) => data.get(key) === "" ? null : Number(data.get(key));
    setBusy(true); setError("");
    try {
      await mutation(`${root}/plans${plan ? `/${plan.id}` : ""}`, {
        name: String(data.get("name")).trim(), code: String(data.get("code")).trim(),
        monthlyPriceUZS: Number(data.get("monthlyPriceUZS")),
        studentLimit: optionalLimit("studentLimit"), groupLimit: optionalLimit("groupLimit"),
        features: String(data.get("features")).split("\n").map((line) => line.trim()).filter(Boolean),
        isActive: data.get("isActive") === "on",
      }, plan ? "PATCH" : "POST");
      onSaved();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <SaasDialog title={plan ? "Tarifni tahrirlash" : "Tarif yaratish"} onClose={onClose} busy={busy}>
    <form className="saas-form" onSubmit={submit}>
      <fieldset disabled={busy}><div className="saas-form-grid">
        <label>Tarif nomi<input className="plain-input" name="name" required maxLength={80} defaultValue={plan?.name ?? ""} /></label>
        <label>Tarif kodi<input className="plain-input" name="code" required pattern="[a-z0-9_-]+" maxLength={40} defaultValue={plan?.code ?? ""} /></label>
        <label>Oylik narx (UZS)<input className="plain-input" name="monthlyPriceUZS" type="number" required min={0} max={1000000000} step={1} defaultValue={plan?.monthlyPriceUZS ?? ""} /></label>
        <label>Faol o‘quvchilar limiti<input className="plain-input" name="studentLimit" type="number" min={1} step={1} defaultValue={plan?.studentLimit ?? ""} aria-describedby="plan-limit-hint" /></label>
        <label>Faol guruhlar limiti<input className="plain-input" name="groupLimit" type="number" min={1} step={1} defaultValue={plan?.groupLimit ?? ""} aria-describedby="plan-limit-hint" /></label>
      </div>
      <p id="plan-limit-hint" className="saas-muted">Limitni bo‘sh qoldirsangiz, cheklanmagan bo‘ladi.</p>
      <label>Imkoniyatlar (har qatorda bittadan)<textarea className="plain-input" name="features" rows={4} defaultValue={plan?.features.join("\n") ?? ""} maxLength={4000} /></label>
      <label className="saas-check"><input name="isActive" type="checkbox" defaultChecked={plan?.isActive ?? true} />Tarif faol</label>
      </fieldset>
      <ErrorNotice error={error} />
      <div className="saas-actions"><button type="button" className="button light" onClick={onClose} disabled={busy}>Bekor qilish</button><button className="button primary" disabled={busy}>{busy ? "Saqlanmoqda…" : "Saqlash"}</button></div>
    </form>
  </SaasDialog>;
}

const actions: Record<string, string> = { assign: "Tarif biriktirish", trial: "14 kunlik trial berish", extend: "Obunani uzaytirish", change_plan: "Keyingi davr tarifini almashtirish", suspend: "Obunani to‘xtatish", reactivate: "Obunani qayta faollashtirish", cancel: "Obunani bekor qilish" };
interface SubscriptionList { subscriptions: Subscription[]; total: number; page: number; pageSize: number }
interface AuditEntry { id: string; action: string; actorId: string; tenantId: string; reason: string; createdAt: string; before: unknown; after: unknown }
export function SaasSubscriptions() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const tenantId = params.get("tenantId") ?? "";
  const status = params.get("status") ?? "";
  const query = new URLSearchParams({ page: String(page) });
  if (tenantId) query.set("tenantId", tenantId);
  if (status) query.set("status", status);
  const state = useSaasResource<SubscriptionList>(`${root}/subscriptions?${query}`);
  const [manage, setManage] = useState<{ id: string; name: string } | null>(null);
  const [history, setHistory] = useState<string | null>(null);
  const [success, setSuccess] = useState("");
  return <div className="saas-page">
    <SaasHeading title="Obunalar">Markaz obunasi va ma’muriy bloklanish alohida boshqariladi.</SaasHeading>
    <div className="saas-actions"><button className="button primary" onClick={() => setManage({ id: tenantId, name: "" })}>Markaz obunasini boshqarish</button></div>
    {success && <p className="success-note" role="status">{success}</p>}
    <section className="panel saas-panel">
      <form className="saas-filters" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); setParams(Object.fromEntries([...data.entries()].map(([k,v]) => [k,String(v)]).filter(([,v]) => v))); }}>
        <label>Markaz ID<input className="plain-input" name="tenantId" defaultValue={tenantId} maxLength={24} /></label>
        <label>Obuna holati<select className="plain-input" name="status" defaultValue={status}><option value="">Barchasi</option><option value="trialing">Sinov muddati</option><option value="active">Faol</option><option value="past_due">To‘lov kutilmoqda</option><option value="expired">Muddati tugagan</option><option value="suspended">To‘xtatilgan</option><option value="cancelled">Bekor qilingan</option></select></label>
        <button className="button primary">Filtrlash</button>
      </form>
      <SaasFeedback {...state} />
      {state.data && !state.loading && !state.error && <>
        {state.data.subscriptions.length ? <Table name="Markaz obunalari" headers={["Markaz", "Tarif", "Oylik narx", "Holat", "Tugash sanasi", "Amallar"]}>
          {state.data.subscriptions.map((s) => <tr key={s.id}><td>{s.tenantName || s.tenantId}</td><td>{s.planName}</td><td>{saasMoney(s.agreedPriceUZS)}</td><td><SaasStatus status={s.status} /></td><td>{saasDate(s.periodEnd)}</td><td><div className="saas-actions"><button className="button light" onClick={() => setManage({ id: s.tenantId, name: s.tenantName || s.tenantId })}>Boshqarish</button><button className="button light" onClick={() => setHistory(s.tenantId)}>Tarix</button></div></td></tr>)}
        </Table> : <p>Obunalar topilmadi. Oldingi markazlarga obuna qo‘lda biriktiriladi.</p>}
        <SaasPagination {...state.data} page={page} onPage={(n) => setParams({ ...Object.fromEntries(query), page: String(n) })} />
      </>}
    </section>
    {manage && <SubscriptionEditor tenant={manage} onClose={() => setManage(null)} onSaved={() => { setManage(null); setSuccess("Obuna yangilandi."); state.reload(); }} />}
    {history && <SubscriptionHistory tenantId={history} onClose={() => setHistory(null)} />}
  </div>;
}
function SubscriptionEditor({ tenant, onClose, onSaved }: { tenant: { id: string; name: string }; onClose: () => void; onSaved: () => void }) {
  const plans = useSaasResource<{ plans: Plan[] }>(`${root}/plans`);
  const [action, setAction] = useState("assign");
  const [commandKey, setCommandKey] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const paid = action === "extend";
  const choosePlan = ["assign", "trial", "change_plan"].includes(action);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); if (busy) return;
    const data = new FormData(e.currentTarget), id = String(data.get("tenantId")).trim();
    setBusy(true); setError("");
    try {
      await mutation(`${root}/subscriptions/${id}`, {
        action, reason: String(data.get("reason")).trim(), idempotencyKey: commandKey,
        ...(choosePlan ? { planId: String(data.get("planId")) } : {}),
        ...(["assign", "extend"].includes(action) ? { billingPeriod: Number(data.get("billingPeriod")) } : {}),
        ...(data.get("confirmedPayment") === "on" ? { confirmedPayment: true } : {}),
      });
      onSaved();
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <SaasDialog title="Markaz obunasini boshqarish" onClose={onClose} busy={busy}>
    {tenant.name && <p><strong>{tenant.name}</strong></p>}
    <form className="saas-form" onSubmit={submit} onChange={() => setCommandKey(crypto.randomUUID())}>
      <fieldset disabled={busy}>
        <label>Markaz ID<input className="plain-input" name="tenantId" required pattern="[a-fA-F0-9]{24}" maxLength={24} defaultValue={tenant.id} readOnly={!!tenant.name} /></label>
        <label>Amal<select className="plain-input" value={action} onChange={(e) => setAction(e.target.value)}>{Object.entries(actions).map(([key,label]) => <option key={key} value={key}>{label}</option>)}</select></label>
        {choosePlan && <><SaasFeedback {...plans} /><label>Tarif<select className="plain-input" name="planId" required defaultValue=""><option value="" disabled>Tarifni tanlang</option>{plans.data?.plans.filter((p) => p.isActive).map((p) => <option key={p.id} value={p.id}>{p.name} · {saasMoney(p.monthlyPriceUZS)}</option>)}</select></label></>}
        {["assign", "extend"].includes(action) && <label>Davr (oy)<input className="plain-input" type="number" name="billingPeriod" min={1} max={12} step={1} required defaultValue={1} /></label>}
        {action === "assign" && <p className="saas-muted">To‘lov tasdig‘isiz biriktirilgan obuna to‘lovni kutadi. Avvalgi markazga obuna biriktirish uning eski erkin foydalanish holatini tugatadi.</p>}
        {action === "change_plan" && <p className="saas-muted">Yangi tarif keyingi tasdiqlangan to‘lov davriga rejalashtiriladi.</p>}
        {(paid || action === "assign") && <label className="saas-check"><input type="checkbox" name="confirmedPayment" required={paid} />Mablag‘ tushganini tashqi bank ma’lumotidan tekshirdim.</label>}
        {action === "trial" && <p className="saas-muted">Trial faqat bir marta beriladi va server vaqti bo‘yicha 14 kun davom etadi.</p>}
        <label>Sabab<textarea className="plain-input" name="reason" required minLength={3} maxLength={500} rows={3} /></label>
      </fieldset>
      <ErrorNotice error={error} /><div className="saas-actions"><button type="button" className="button light" disabled={busy} onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={busy || (choosePlan && (plans.loading || !!plans.error))}>{busy ? "Saqlanmoqda…" : "Amalni tasdiqlash"}</button></div>
    </form>
  </SaasDialog>;
}
function SubscriptionHistory({ tenantId, onClose }: { tenantId: string; onClose: () => void }) {
  const state = useSaasResource<{ entries: AuditEntry[] }>(`${root}/subscriptions/${tenantId}/history`);
  return <SaasDialog title="Obuna tarixi" onClose={onClose}><SaasFeedback {...state} />{state.data && !state.loading && !state.error && (state.data.entries.length ? <Table name="Obuna o‘zgarishlari" headers={["Sana", "Amal", "Sabab", "Bajargan foydalanuvchi"]}>{state.data.entries.map((entry) => <tr key={entry.id}><td>{saasDate(entry.createdAt)}</td><td>{actions[entry.action] || entry.action}</td><td>{entry.reason}</td><td>{entry.actorId}</td></tr>)}</Table> : <p>Tarix yozuvlari topilmadi.</p>)}</SaasDialog>;
}

interface PaymentList { requests: PaymentRequest[]; total: number; page: number; pageSize: number }
export function SaasPayments() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const query = new URLSearchParams(params); query.set("page", String(page));
  const state = useSaasResource<PaymentList>(`${root}/payment-requests?${query}`);
  const [review, setReview] = useState<PaymentRequest | null>(null);
  const [success, setSuccess] = useState("");
  return <div className="saas-page">
    <SaasHeading title="To‘lov so‘rovlari">SaaS to‘lovlarini bank ma’lumotlari bilan qo‘lda tekshiring.</SaasHeading>
    {success && <p className="success-note" role="status">{success}</p>}
    <section className="panel saas-panel">
      <form className="saas-filters" onSubmit={(e) => { e.preventDefault(); const data = new FormData(e.currentTarget); setParams(Object.fromEntries([...data.entries()].map(([k,v]) => [k,String(v)]).filter(([,v]) => v))); }}>
        <label>Markaz ID<input className="plain-input" name="tenantId" maxLength={24} defaultValue={params.get("tenantId") ?? ""} /></label>
        <label>So‘rov holati<select className="plain-input" name="status" defaultValue={params.get("status") ?? ""}><option value="">Barchasi</option><option value="pending">Kutilayotgan</option><option value="approved">Tasdiqlangan</option><option value="rejected">Rad etilgan</option></select></label>
        <label>Boshlanish sanasi<input className="plain-input" type="date" name="from" defaultValue={params.get("from") ?? ""} /></label>
        <label>Tugash sanasi<input className="plain-input" type="date" name="to" defaultValue={params.get("to") ?? ""} /></label>
        <button className="button primary">Filtrlash</button>
        <button type="button" className="button light" onClick={() => { setParams({}); }}>Filtrni tozalash</button>
      </form>
      <SaasFeedback {...state} />
      {state.data && !state.loading && !state.error && <>
        {state.data.requests.length ? <Table name="SaaS to‘lov so‘rovlari" headers={["Markaz", "Tarif / davr", "Summa", "Yuborilgan sana", "Holat", "Amal"]}>{state.data.requests.map((request) => <tr key={request.id}><td>{request.tenantName || request.tenantId}</td><td>{request.planName} · {request.billingPeriod} oy</td><td>{saasMoney(request.amountUZS)}</td><td>{saasDate(request.submittedAt)}</td><td><SaasStatus status={request.status} /></td><td><button className="button light" onClick={() => setReview(request)}>Tafsilotlar</button></td></tr>)}</Table> : <p>Bu filtrlarga mos to‘lov so‘rovlari topilmadi.</p>}
        <SaasPagination {...state.data} page={page} onPage={(n) => setParams({ ...Object.fromEntries(query), page: String(n) })} />
      </>}
    </section>
    <PaymentInstructions />
    {review && <PaymentReview request={review} onClose={() => setReview(null)} onSaved={(approved) => { setReview(null); setSuccess(approved ? "To‘lov tasdiqlandi va obuna yangilandi." : "To‘lov so‘rovi rad etildi."); state.reload(); }} />}
  </div>;
}
function PaymentReview({ request, onClose, onSaved }: { request: PaymentRequest; onClose: () => void; onSaved: (approved: boolean) => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [note, setNote] = useState(""), [confirmed, setConfirmed] = useState(false), [decision, setDecision] = useState("approve");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setError("");
    if (decision === "approve" && !confirmed) { setError("Avval mablag‘ tushganini tashqi bank ma’lumotidan tekshiring."); return; }
    setBusy(true);
    try {
      await mutation(`${root}/payment-requests/${request.id}/${decision}`, { reviewNote: note.trim(), ...(decision === "approve" ? { confirmedReceived: true } : {}) });
      onSaved(decision === "approve");
    } catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <SaasDialog title="To‘lov tafsilotlari" onClose={onClose} busy={busy}>
    <dl className="saas-details">
      <div><dt>Markaz</dt><dd>{request.tenantName || request.tenantId}</dd></div>
      <div><dt>Tarif</dt><dd>{request.planName}</dd></div>
      <div><dt>So‘rov summasi</dt><dd>{saasMoney(request.amountUZS)}</dd></div>
      <div><dt>Davr</dt><dd>{request.billingPeriod} oy</dd></div>
      <div><dt>Holat</dt><dd><SaasStatus status={request.status} /></dd></div>
      <div><dt>To‘lov sanasi</dt><dd>{saasDate(request.paidAt)}</dd></div>
      <div><dt>To‘lov usuli</dt><dd>{request.paymentMethod}</dd></div>
      <div><dt>Tranzaksiya izohi</dt><dd>{request.transactionNote || "—"}</dd></div>
      <div><dt>Yuborilgan vaqt</dt><dd>{saasDate(request.submittedAt)}</dd></div>
      <div><dt>Tekshirilgan vaqt</dt><dd>{saasDate(request.reviewedAt)}</dd></div>
      {request.reviewNote && <div><dt>Tekshiruv izohi</dt><dd>{request.reviewNote}</dd></div>}
    </dl>
    {request.status === "pending" && <form className="saas-form" onSubmit={submit}>
      <p className="saas-muted">Markaz yuborgan so‘rov to‘lov kelib tushganini isbotlamaydi. Tasdiqlash obunani uzaytiradi.</p>
      <fieldset disabled={busy}>
        <label>Qaror<select className="plain-input" value={decision} onChange={(e) => setDecision(e.target.value)}><option value="approve">Tasdiqlash</option><option value="reject">Rad etish</option></select></label>
        <label>Tekshiruv izohi<textarea className="plain-input" required minLength={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} rows={3} /></label>
        {decision === "approve" && <label className="saas-check"><input type="checkbox" required checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />Mablag‘ bankka kelib tushganini tashqi ma’lumotlardan tekshirdim.</label>}
      </fieldset>
      <ErrorNotice error={error} /><div className="saas-actions"><button type="button" className="button light" disabled={busy} onClick={onClose}>Bekor qilish</button><button className="button primary" disabled={busy || (decision === "approve" && !confirmed)}>{busy ? "Saqlanmoqda…" : decision === "approve" ? "To‘lovni tasdiqlash" : "So‘rovni rad etish"}</button></div>
    </form>}
  </SaasDialog>;
}
interface Instructions { instructions: string; approved: boolean; updatedAt: string | null }
function PaymentInstructions() {
  const state = useSaasResource<Instructions>(`${root}/settings`);
  const [success, setSuccess] = useState("");
  return <section className="panel saas-panel"><h2>To‘lov yo‘riqnomasi</h2><p className="saas-muted">Faqat tasdiqlangan yo‘riqnoma markaz egalariga ko‘rsatiladi. Bank rekvizitlari va to‘lov tartibini aniq yozing.</p><SaasFeedback {...state} />{success && <p className="success-note" role="status">{success}</p>}{state.data && !state.loading && !state.error && <InstructionsForm key={state.data.updatedAt || "new"} settings={state.data} onSaved={() => { setSuccess("To‘lov yo‘riqnomasi saqlandi."); state.reload(); }} />}</section>;
}
function InstructionsForm({ settings, onSaved }: { settings: Instructions; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const data = new FormData(event.currentTarget);
    setBusy(true); setError("");
    try { await mutation(`${root}/settings`, { instructions: String(data.get("instructions")).trim(), approved: data.get("approved") === "on" }, "PATCH"); onSaved(); }
    catch (error) { setError((error as Error).message); } finally { setBusy(false); }
  }
  return <form className="saas-form" onSubmit={submit}><fieldset disabled={busy}><label>To‘lov bo‘yicha ko‘rsatmalar<textarea className="plain-input" name="instructions" rows={5} maxLength={4000} defaultValue={settings.instructions} /></label><label className="saas-check"><input type="checkbox" name="approved" defaultChecked={settings.approved} />Yo‘riqnomani tekshirdim va ko‘rsatishni tasdiqlayman.</label></fieldset><ErrorNotice error={error} /><div className="saas-actions"><button className="button primary" disabled={busy}>{busy ? "Saqlanmoqda…" : "Yo‘riqnomani saqlash"}</button></div></form>;
}
interface Analytics { activePaid: number; trialing: number; expired: number; pendingPayments: number; approvedAmountUZS: number; mrrUZS: number; byPlan: { planId: string; planName: string; count: number }[]; generatedAt: string }
export function SaasAnalytics() {
  const state = useSaasResource<Analytics>(`${root}/analytics`);
  const data = state.data;
  return <div className="saas-page"><SaasHeading title="SaaS analitika">Platforma obunalari va qo‘lda tasdiqlangan to‘lovlar ko‘rsatkichlari.</SaasHeading><SaasFeedback {...state} />{data && !state.loading && !state.error && <>
    <div className="saas-kpis">{[
      ["Faol pullik obunalar", data.activePaid], ["Trial markazlar", data.trialing], ["Muddati tugagan obunalar", data.expired], ["Kutilayotgan to‘lovlar", data.pendingPayments], ["Tasdiqlangan to‘lovlar summasi", saasMoney(data.approvedAmountUZS)], ["Oylik takrorlanuvchi qiymat (MRR)", saasMoney(data.mrrUZS)],
    ].map(([label,value]) => <article className="stat-card saas-kpi" key={String(label)}><h2>{label}</h2><strong>{value}</strong></article>)}</div>
    <section className="panel saas-panel"><h2>MRR qanday hisoblanadi?</h2><p>MRR — faol pullik obunalarning oylik qiymati. Bu bankka kelib tushgan haqiqiy mablag‘ emas. Trial, bekor qilingan, to‘xtatilgan va muddati tugagan obunalar MRRga kiritilmaydi. Bir martalik tushumlar va qaytarilgan mablag‘lar bilan aralashtirilmaydi.</p><p className="saas-muted">Hisoblangan vaqt: {saasDate(data.generatedAt)} · Asia/Tashkent</p></section>
    <section className="panel saas-panel"><h2>Tariflar bo‘yicha markazlar</h2>{data.byPlan.length ? <Table name="Tariflar taqsimoti" headers={["Tarif", "Markazlar soni"]}>{data.byPlan.map((plan) => <tr key={plan.planId}><td>{plan.planName}</td><td>{plan.count}</td></tr>)}</Table> : <p>Obuna ma’lumotlari hali mavjud emas.</p>}</section>
  </>}</div>;
}
