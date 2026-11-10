import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
import { uzs as money } from "./Billing";
type Attempt = { _id: string; source: string; status: string; startedAt: string; finishedAt?: string;
  created?: number; preserved?: number; exceptions?: number; errorCode?: string };
type Preview = { month: string; nextTeacher: string | null; items: { teacherId: string; teacherName: string;
  status: string; message?: string; code?: string; finalSalary?: number; basis?: {
    grossSalary: number; lines: { groupName: string | null; salaryType: string; basisAmount: number; salary: number }[] } }[] };
const salaryTypes: Record<string, string> = { fixed: "Belgilangan oylik", collected: "Tushumdan foiz", billed: "Hisoblangan ta’lim haqidan foiz" };
const date = (s: string) => new Date(s).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" });
type Status = {
  attempts?: { runs: Attempt[]; total: number };
  notifications?: { _id: string; count: number }[];
  run: { status: string; completedAt?: string; message?: string } | null;
  items: {
    _id: string;
    teacherName: string;
    status: string;
    payrollId?: string;
    code?: string;
    message?: string;
  }[];
  total: number;
};
type Batch = { month: string; status: string; nextTeacher: string | null };
const labels: Record<string, string> = {
  running: "Yakun tasdiqlanmagan — holatni tekshiring",
  failed: "Urinish bajarilmadi — xavfsiz qayta urinish mumkin",
  processing: "Jarayonda",
  exceptions: "Tekshirish kerak",
  completed: "Qoralamalar tayyor",
};
export function PayrollAutomation({
  month,
  onComplete,
}: {
  month: string;
  onComplete: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [data, setData] = useState<Status | null>(null);
  const [page, setPage] = useState(1),
    [version, refresh] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    setPage(1);
    setHistoryPage(1);
    setPreview(null);
    setError("");
    setMessage("");
  }, [month]);
  useEffect(() => {
    let active = true;
    setData(null);
    api<Status>(`/payroll/automation/status?month=${month}&page=${page}&historyPage=${historyPage}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [month, page, historyPage, version]);
  async function loadPreview(afterTeacher?: string) {
    setBusy(true);
    setError("");
    try {
      setPreview(await api<Preview>("/payroll/automation/preview", { method: "POST",
        body: JSON.stringify({ month, ...(afterTeacher ? { afterTeacher } : {}) }) }));
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }
  async function generate() {
    setBusy(true);
    setError("");
    setMessage("");
    setPreview(null);
    try {
      let afterTeacher: string | undefined;
      let result: Batch;
      const seen = new Set<string>();
      do {
        result = await api<Batch>("/payroll/automation/run", {
          method: "POST",
          body: JSON.stringify({
            month,
            confirmed: true,
            ...(afterTeacher ? { afterTeacher } : {}),
          }),
        });
        // Acknowledgement/pending responses are never treated as completion.
        if (
          result.month !== month ||
          !["processing", "exceptions", "completed"].includes(result.status) ||
          !(
            result.nextTeacher === null ||
            /^[a-f\d]{24}$/i.test(result.nextTeacher)
          )
        )
          throw new Error(
            "Yakun natijasi tasdiqlanmadi. Holatni yangilab tekshiring.",
          );
        afterTeacher = result.nextTeacher ?? undefined;
        if (afterTeacher && seen.has(afterTeacher))
          throw new Error("Jarayon davom etmadi. Qayta urining.");
        if (afterTeacher) seen.add(afterTeacher);
      } while (afterTeacher);
      setMessage(
        result.status === "completed"
          ? "Qoralamalar tayyor. Maoshlarni ko‘rib chiqing."
          : "Ayrim maoshlar tayyor emas. Istisnolarni tekshiring va qayta urining.",
      );
      onComplete();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      refresh((v) => v + 1);
    }
  }
  return (
    <section
      className="panel payroll-automation"
      aria-labelledby="payroll-automation-title"
      aria-busy={busy}
    >
      <h2 id="payroll-automation-title">Oylik qoralamalarni ko‘rib chiqish</h2>
      <p>
        Tanlangan oy: {month} · Faqat tugagan oy uchun. Mavjud maoshlar va
        tuzatishlar saqlanadi. Tasdiqlash va to‘lov alohida bajariladi.
      </p>
      <div className="payroll-controls">
        <button className="button light" disabled={busy} onClick={() => void loadPreview()}>
          Yozuvsiz tekshirish
        </button>
        <button className="button primary" disabled={busy} onClick={generate}>
          {busy ? "Qoralamalar yaratilmoqda…" : "Oylik qoralamalarni yaratish"}
        </button>
        <button
          className="button light"
          disabled={busy}
          onClick={() => {
            setError("");
            refresh((v) => v + 1);
          }}
        >
          Holatni yangilash
        </button>
      </div>
      {preview && <div className="payroll-preview">
        <h3>Yozuvsiz tekshiruv · {preview.month}</h3>
        <p>Bu taxminiy natija. Qoralama, audit yoki xabar yaratilmaydi. Yaratishda ma’lumotlar qayta tekshiriladi.</p>
        {preview.items.map(i => <div key={i.teacherId}>
          <h4>{i.teacherName} · {i.status === "preserved" ? "Mavjud maosh saqlanadi" : i.status === "exception" ? "Tekshirish kerak" : "Yaratilishi mumkin"}</h4>
          {i.message && <p>{i.message} · {i.code}</p>}
          {i.basis && <>
            <p>Hisoblangan: {money(i.basis.grossSalary)}{i.finalSalary !== undefined && ` · Mavjud yakuniy summa: ${money(i.finalSalary)}`}</p>
            <ul>{i.basis.lines.map((l, n) => <li key={n}>{l.groupName ?? "Umumiy qoida"} · {salaryTypes[l.salaryType] ?? l.salaryType} · asos: {money(l.basisAmount)} · maosh: {money(l.salary)}</li>)}</ul>
          </>}
        </div>)}
        {preview.nextTeacher && <button className="button light" disabled={busy} onClick={() => void loadPreview(preview.nextTeacher!)}>Keyingi o‘qituvchilar</button>}
      </div>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {message && <p role="status">{message}</p>}
      {!data && !error && <p role="status">Holat yuklanmoqda…</p>}
      {data && (
        <>
          <p role="status">
            {data.run
              ? labels[data.run.status]
              : "Bu oy uchun avtomatik hisob-kitob hali boshlanmagan."}
          </p>
          {data.run?.message && (
            <p className="notice" role="alert">
              {data.run.message}
            </p>
          )}
          <p>Xabar holati: {data.notifications?.length
            ? data.notifications.map(n => `${({ pending: "Navbatda", sending: "Yuborilmoqda", sent: "Yuborildi", failed: "Xato", cancelled: "Bekor qilingan" } as Record<string, string>)[n._id] ?? n._id}: ${n.count}`).join(" · ")
            : "Xabar navbatga qo‘yilmagan"}. Navbatga qo‘yish yetkazib berish tasdig‘i emas.</p>
          {data.attempts && <>
            <h3>Ishga tushish tarixi · Asia/Tashkent</h3>
            {!data.attempts.runs.length && <p>Hali urinishlar yo‘q.</p>}
            <ul className="payroll-attempts">{data.attempts.runs.map(r => <li key={r._id}>
              {date(r.startedAt)} · {r.source === "manual" ? "Qo‘lda" : "Scheduler"} · {labels[r.status] ?? r.status}
              {r.finishedAt && ` · Tugadi: ${date(r.finishedAt)}`}
              {r.created !== undefined && ` · Yaratildi: ${r.created}, saqlandi: ${r.preserved}, istisno: ${r.exceptions}`}
              {r.errorCode && ` · ${r.errorCode}`}
            </li>)}</ul>
            <div className="payroll-controls">
              <button className="button light" disabled={busy || historyPage === 1} onClick={() => setHistoryPage(p => p - 1)}>Oldingi urinishlar</button>
              <span>{historyPage}-sahifa · {data.attempts.total} ta urinish</span>
              <button className="button light" disabled={busy || historyPage * 20 >= data.attempts.total} onClick={() => setHistoryPage(p => p + 1)}>Keyingi urinishlar</button>
            </div>
          </>}
          {data.items.length > 0 && (
            <div
              className="table-scroll"
              tabIndex={0}
              aria-label="Qoralamalar holati"
            >
              <table>
                <caption>O‘qituvchilar bo‘yicha natijalar · {month}</caption>
                <thead>
                  <tr>
                    {["O‘qituvchi", "Natija", "Tafsilot"].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((i) => (
                    <tr key={i._id}>
                      <td>{i.teacherName}</td>
                      <td>
                        {i.status === "ready"
                          ? "Ko‘rib chiqish uchun tayyor"
                          : i.status === "excluded"
                            ? "Hisob-kitobdan chiqarilgan"
                            : "Tekshirish kerak"}
                      </td>
                      <td>
                        {i.payrollId ? (
                          <Link to={`/payroll/${i.payrollId}`}>
                            Maoshni ko‘rish
                          </Link>
                        ) : (
                          <>
                            <p>{i.message}</p>
                            <small>{i.code}</small> ·{" "}
                            <Link to="/payroll/settings">
                              Maosh sozlamalari
                            </Link>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.total > 20 && (
            <div className="payroll-controls">
              <button
                className="button light"
                disabled={busy || page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Oldingi natijalar
              </button>
              <span>
                {page}-sahifa · {data.total} ta natija
              </span>
              <button
                className="button light"
                disabled={busy || page * 20 >= data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Keyingi natijalar
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}
