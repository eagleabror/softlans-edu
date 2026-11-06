import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
type Status = {
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
  const [data, setData] = useState<Status | null>(null);
  const [page, setPage] = useState(1),
    [version, refresh] = useState(0);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  useEffect(() => {
    setPage(1);
    setMessage("");
  }, [month]);
  useEffect(() => {
    let active = true;
    setData(null);
    api<Status>(`/payroll/automation/status?month=${month}&page=${page}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [month, page, version]);
  async function generate() {
    setBusy(true);
    setError("");
    setMessage("");
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
      className="panel"
      aria-labelledby="payroll-automation-title"
      aria-busy={busy}
    >
      <h2 id="payroll-automation-title">Oylik qoralamalarni ko‘rib chiqish</h2>
      <p>
        Tanlangan oy: {month} · Faqat tugagan oy uchun. Mavjud maoshlar va
        tuzatishlar saqlanadi. Tasdiqlash va to‘lov alohida bajariladi.
      </p>
      <div className="payroll-controls">
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
