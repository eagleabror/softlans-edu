import { useEffect, useRef, useState } from "react";
import type { TuitionAutomationView, TuitionMonthPreview } from "@softlans/contracts";
import { api } from "./api";

const money = (n: number) => `${n.toLocaleString("uz-UZ")} UZS`;
const date = (s: string) => new Intl.DateTimeFormat("uz-UZ", {
  timeZone: "Asia/Tashkent", dateStyle: "medium", timeStyle: "short",
}).format(new Date(s));
const status = {
  running: "Natija hali tasdiqlanmagan",
  completed: "Yakunlangan",
  failed: "Xato — hisoblar qaytarilgan",
};
const errors = {
  BILLING_OWNER_REQUIRED: "Faol biznes egasi topilmadi.",
  BILLING_RUN_FAILED: "Hisoblash bajarilmadi. Qayta urinishdan oldin tizimni tekshiring.",
};
export function BillingAutomation({ month, version }: { month: string; version: number }) {
  const [data, setData] = useState<TuitionAutomationView | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [refresh, setRefresh] = useState(0);
  const [preview, setPreview] = useState<TuitionMonthPreview | null>(null);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const previewRequest = useRef(0);
  useEffect(() => { setPage(1); setPreview(null); setPreviewError(""); }, [month, version]);
  useEffect(() => {
    let active = true;
    setData(null); setError("");
    api<TuitionAutomationView>(`/billing/automation?month=${month}&page=${page}`)
      .then(d => {
        if (!Array.isArray(d.runs) || typeof d.schedulerEnabled !== "boolean")
          throw new Error("Avtomatik hisoblash holati tasdiqlanmadi.");
        if (active) setData(d);
      })
      .catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [month, page, refresh, version]);
  useEffect(() => {
    previewRequest.current++;
    setPreview(null); setBusy(false);
    return () => { previewRequest.current++; };
  }, [refresh, month, version]);
  // A keyed parent remount prevents an old month's pending preview from being displayed.
  async function loadPreview() {
    const requestId = ++previewRequest.current;
    setBusy(true); setPreviewError(""); setPreview(null);
    try {
      const d = await api<TuitionMonthPreview>("/billing/charges/preview", {
        method: "POST", body: JSON.stringify({ month }),
      });
      if (d.month !== month || d.dryRun !== true || d.created !== 0 ||
        ![d.wouldCreate, d.skipped, d.amount].every(n => Number.isSafeInteger(n) && n >= 0))
        throw new Error("Hisoblash preview’i tasdiqlanmadi.");
      if (requestId === previewRequest.current) setPreview(d);
    } catch (e) { if (requestId === previewRequest.current) setPreviewError((e as Error).message); }
    finally { if (requestId === previewRequest.current) setBusy(false); }
  }
  return <section className="panel billing-automation" aria-labelledby="billing-automation-title">
    <div className="section-heading">
      <h2 id="billing-automation-title">Avtomatik oylik hisoblash</h2>
      <button className="button light" onClick={() => setRefresh(v => v + 1)}>Holatni yangilash</button>
    </div>
    {!data && !error && <p role="status">Holat yuklanmoqda…</p>}
    {error && <p className="notice" role="alert">{error} Qo‘lda hisob yaratishdan foydalanishingiz mumkin.</p>}
    {data && <>
      <p><strong>{data.schedulerEnabled ? "Server avtomatik hisoblashga ruxsat bergan" : "Avtomatik hisoblash o‘chirilgan"}</strong></p>
      <p className="muted">Bu server holati; tashqi scheduler ishlaganini faqat quyidagi natijalar ko‘rsatadi. Qo‘lda hisob yaratish mustaqil ishlaydi.</p>
      {!data.runs.length ? <p>Tanlangan oy uchun avtomatik urinishlar yo‘q.</p> : <>
        <div className="table-scroll" tabIndex={0} aria-label="Avtomatik hisoblash urinishlari">
          <table>
            <caption>{month} · Asia/Tashkent · Har qator bitta avtomatik hisoblash urinishidir.</caption>
            <thead><tr>{["Boshlangan", "Tugagan", "Holat", "Yaratildi", "O‘tkazildi", "Summa", "Xato"].map(t => <th scope="col" key={t}>{t}</th>)}</tr></thead>
            <tbody>{data.runs.map(r => <tr key={r.id}>
              <td>{date(r.startedAt)}</td><td>{r.finishedAt ? date(r.finishedAt) : "—"}</td>
              <td>{status[r.status]}</td><td>{r.created}</td><td>{r.skipped}</td><td>{money(r.amount)}</td>
              <td>{r.errorCode ? <>{errors[r.errorCode]} <code>{r.errorCode}</code></> : "—"}</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="muted">Tasdiqlanmagan urinish uzilgan bo‘lishi mumkin. Qayta urinish mavjud hisoblarni takror yaratmaydi.</p>
      </>}
      <div className="pagination"><span>{data.total} ta urinish · {page}-sahifa</span><div>
        <button className="button light" disabled={page === 1} onClick={() => setPage(p => p - 1)}>Oldingi urinishlar sahifasi</button>
        <button className="button light" disabled={page * data.pageSize >= data.total} onClick={() => setPage(p => p + 1)}>Keyingi urinishlar sahifasi</button>
      </div></div>
    </>}
    <p className="muted">{month} uchun guruh narxi, jadvali va to‘lov muddati asosida oldindan tekshirish. Hisoblar yaratilmaydi. Qo‘lda yaratishda tanlangan to‘lov kuni alohida qo‘llanadi.</p>
    <button className="button light" disabled={busy} onClick={loadPreview}>{busy ? "Tekshirilmoqda…" : "Oylik hisobni oldindan tekshirish"}</button>
    {previewError && <p className="notice" role="alert">{previewError}</p>}
    {preview && <p role="status">{preview.month}: Yaratilishi mumkin: {preview.wouldCreate} · O‘tkaziladi: {preview.skipped} · Summa: {money(preview.amount)}. Hisoblar yozilmadi. Bu joriy ma’lumotlar nusxasi; yaratish paytida qayta hisoblanadi.</p>}
  </section>;
}
