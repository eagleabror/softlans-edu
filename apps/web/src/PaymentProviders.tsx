import { useState, type FormEvent } from "react";
import { api } from "./api";
import { SaasFeedback, SaasHeading, saasDate, useSaasResource } from "./Saas";
import { OnlineCheckout } from "./OnlinePayments";
import type { Plan } from "./Saas";

type Provider = "payme" | "click";
type Environment = "test" | "production";
interface Settings {
  provider: Provider; environment: Environment; merchantId: string; serviceId: string; login: string;
  secretConfigured: boolean; enabled: boolean; revision: number; used: boolean;
  lastCallbackAt: string | null; lastError: string; callbackUrl: string;
}
interface SettingsList { encryptionAvailable: boolean; providers: Settings[]; origin: string }
export function PaymentProviders() {
  const state = useSaasResource<SettingsList>("/super-admin/saas/payment-providers");
  const [environment, setEnvironment] = useState<Environment>("production");
  return <div className="saas-page">
    <SaasHeading title="To‘lov tizimlari">Markazlarning Softlans obunasi uchun Payme va Click rekvizitlari.</SaasHeading>
    <SaasFeedback {...state} />
    <label className="saas-form">Muhit<select className="plain-input" value={environment} onChange={e => setEnvironment(e.target.value as Environment)}><option value="production">Haqiqiy to‘lovlar</option><option value="test">Test</option></select></label>
    {state.data && <>
      {!state.data.encryptionAvailable && <p className="notice" role="alert">Serverda to‘lov kalitlarini shifrlash sozlanmagan. Sozlangach rekvizitlarni shu yerdan kiritishingiz mumkin.</p>}
      <div className="saas-plan-grid">{(["payme", "click"] as const).map(name => {
        const item = state.data!.providers.find(p => p.provider === name && p.environment === environment);
        return <ProviderForm key={`${name}:${environment}:${item?.revision ?? 0}`} name={name} environment={environment} item={item} origin={state.data!.origin} available={state.data!.encryptionAvailable} onSaved={state.reload} />;
      })}</div>
      {environment === "test" && <TestCheckout providers={state.data.providers.filter(p => p.environment === "test" && p.enabled).map(p => p.provider)} />}
    </>}
  </div>;
}
function ProviderForm({ name, environment, item, origin, available, onSaved }: { name: Provider; environment: Environment; item?: Settings; origin: string; available: boolean; onSaved: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [copied, setCopied] = useState(false);
  const callback = item?.callbackUrl ?? `${origin}/api/integrations/${name}/${environment}`;
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    const form = event.currentTarget, data = new FormData(form), secret = String(data.get("secret") ?? "");
    setBusy(true); setError("");
    try {
      await api(`/super-admin/saas/payment-providers/${name}/${environment}`, { method: "PATCH", body: JSON.stringify({
        merchantId: String(data.get("merchantId")).trim(), ...(name === "click" ? { serviceId: String(data.get("serviceId")).trim() } : { login: String(data.get("login")).trim() }),
        ...(secret ? { secret } : {}), enabled: data.get("enabled") === "on", revision: item?.revision ?? 0,
        password: String(data.get("password")), ...(data.get("code") ? { code: String(data.get("code")) } : {}),
      }) });
      onSaved();
    } catch (e) { setError((e as Error).message); }
    finally {
      for (const field of ["secret", "password", "code"]) { const input = form.elements.namedItem(field); if (input instanceof HTMLInputElement) input.value = ""; }
      setBusy(false);
    }
  }
  return <section className="panel saas-panel"><h2>{name === "payme" ? "Payme" : "Click"}</h2>
    <p role="status">{item ? item.enabled ? "Yoqilgan" : "O‘chirilgan" : "Sozlanmagan"}{item && " · Sozlamalar saqlangan"}</p>
    <p className="saas-muted">Saqlash ulanish tasdiqlanganini bildirmaydi. Rekvizitlarni provayder sinovi bilan tekshiring.</p>
    <form className="saas-form" onSubmit={submit}>
      <fieldset disabled={!available || busy}>
        <label>{name === "payme" ? "Kassa / Merchant ID" : "Merchant ID"}<input className="plain-input" name="merchantId" required maxLength={100} defaultValue={item?.merchantId ?? ""} readOnly={item?.used} /></label>
        {name === "click" ? <label>Service ID<input className="plain-input" name="serviceId" required inputMode="numeric" pattern="[0-9]{1,30}" defaultValue={item?.serviceId ?? ""} readOnly={item?.used} /></label>
          : <label>Callback login<input className="plain-input" name="login" required defaultValue={item?.login ?? "Paycom"} maxLength={100} /></label>}
        <label>{item ? "Yangi maxfiy kalit (almashtirish uchun)" : "Maxfiy kalit"}<input className="plain-input" name="secret" type="password" autoComplete="new-password" required={!item} minLength={8} maxLength={256} /></label>
        <p className="saas-muted">{item?.secretConfigured ? "Kalit kiritilgan. Bo‘sh qoldirilsa avvalgi kalit saqlanadi." : "Provayder bergan maxfiy kalitni kiriting."}</p>
        <label className="saas-check"><input name="enabled" type="checkbox" defaultChecked={item?.enabled ?? false} />{environment === "test" ? "Test to‘lovlarini yoqish" : "Haqiqiy to‘lovlarni yoqish"}</label>
        <label>Joriy parolingiz<input className="plain-input" name="password" type="password" autoComplete="current-password" required maxLength={72} /></label>
        <label>MFA kodi (yoqilgan bo‘lsa)<input className="plain-input" name="code" autoComplete="one-time-code" maxLength={64} /></label>
      </fieldset>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="button primary" disabled={!available || busy}>{busy ? "Saqlanmoqda…" : "Sozlamalarni saqlash"}</button>
    </form>
    <label className="saas-form">Callback manzili<input className="plain-input" readOnly value={callback} /></label>
    <button className="button light" type="button" onClick={() => { void navigator.clipboard.writeText(callback).then(() => setCopied(true)).catch(() => setError("Manzilni belgilab nusxalang.")); }}>{copied ? "Nusxalandi" : "Manzilni nusxalash"}</button>
    <p>Qaytish sahifasi: {environment === "test" ? "/super-admin/online-payments" : "/settings/subscription"}</p>
    <p>Oxirgi tekshirilgan callback: {saasDate(item?.lastCallbackAt)}</p>
    {item?.lastError && <p className="notice">Oxirgi provayder xato kodi: {item.lastError}</p>}
  </section>;
}
function TestCheckout({ providers }: { providers: Provider[] }) {
  const plans = useSaasResource<{ plans: Plan[] }>("/super-admin/saas/plans");
  const [tenantId, setTenantId] = useState(""), [planId, setPlanId] = useState(""), [open, setOpen] = useState(false);
  const plan = plans.data?.plans.find(p => p.id === planId);
  return <section className="panel saas-panel"><h2>Test to‘lov buyurtmasi</h2>
    <p>Test obunani o‘zgartirmaydi. Faqat provayder tasdiqlagan test rekvizitlaridan foydalaning.</p><SaasFeedback {...plans} />
    <form className="saas-form" onSubmit={e => { e.preventDefault(); setOpen(true); }}>
      <label>Test markazi ID<input className="plain-input" required pattern="[a-fA-F0-9]{24}" value={tenantId} onChange={e => setTenantId(e.target.value)} /></label>
      <label>Tarif<select className="plain-input" required value={planId} onChange={e => setPlanId(e.target.value)}><option value="">Tanlang</option>{plans.data?.plans.filter(p => p.isActive).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <button className="button light" disabled={!providers.length}>Test buyurtmasini ochish</button>
    </form>
    {open && plan && <OnlineCheckout plan={plan} providers={providers} tenantId={tenantId} onClose={() => setOpen(false)} />}
  </section>;
}
