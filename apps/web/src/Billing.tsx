import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import type {
  BillingSummary,
  ChargesView,
  ChargeView,
  PaymentsView,
  PaymentView,
  GroupsView,
} from "@softlans/contracts";
import { api } from "./api";
export const uzs = (n: number) => `${n.toLocaleString("uz-UZ")} UZS`;
const monthNow = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
const date = (s: string) =>
  new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(s));
const statusNames = {
  unpaid: "To‘lanmagan",
  partial: "Qisman",
  paid: "To‘langan",
  cancelled: "Bekor qilingan",
};
const methods = {
  cash: "Naqd",
  bank_transfer: "Bank o‘tkazmasi",
  click_manual: "Click (qo‘lda)",
};
export function FinancialStats({ data }: { data: BillingSummary }) {
  return (
    <>
      <p className="muted">
        {data.month} · Asia/Tashkent · Tushum — shu oyda qabul qilingan,
        qaytarilmagan to‘lovlar.
      </p>
      <div className="stats-grid financial-stats">
        {[
          ["Hisoblangan", uzs(data.billedAmount)],
          ["Qabul qilingan tushum", uzs(data.receivedAmount)],
          ["Tanlangan oy qarzi", uzs(data.outstandingAmount)],
          ["To‘lovlar soni", data.paymentCount],
        ].map(([label, value]) => (
          <section className="stat-card" key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
    </>
  );
}
export function Billing({
  owner,
  history = false,
}: {
  owner: boolean;
  history?: boolean;
}) {
  const { id: studentId } = useParams();
  const [month, setMonth] = useState(monthNow),
    [search, setSearch] = useState(""),
    [groupId, setGroup] = useState(""),
    [status, setStatus] = useState("");
  const [groups, setGroups] = useState<GroupsView | null>(null),
    [groupPage, setGroupPage] = useState(1),
    [data, setData] = useState<ChargesView | null>(null),
    [payments, setPayments] = useState<PaymentsView | null>(null),
    [summary, setSummary] = useState<BillingSummary | null>(null);
  const [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false);
  const [pay, setPay] = useState<ChargeView | null>(null),
    [adjust, setAdjust] = useState<ChargeView | null>(null),
    [reverse, setReverse] = useState<PaymentView | null>(null),
    [generate, setGenerate] = useState(false);
  useEffect(() => {
    let active = true;
    api<GroupsView>(`/groups?pageSize=100&page=${groupPage}`)
      .then((d) => {
        if (active) setGroups(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [groupPage]);
  useEffect(() => {
    let active = true;
    setError("");
    setData(null);
    setPayments(null);
    setSummary(null);
    const q = new URLSearchParams({
      month,
      page: String(page),
      search,
      ...(studentId ? { studentId } : {}),
      ...(groupId ? { groupId } : {}),
      ...(!history && status ? { status } : {}),
    });
    const load = history
      ? api<PaymentsView>(
          `/billing/${studentId ? `students/${studentId}/history` : "payments"}?${q}`,
        ).then((d) => {
          if (active) setPayments(d);
        })
      : api<ChargesView>(`/billing/charges?${q}`).then((d) => {
          if (active) setData(d);
        });
    Promise.all([
      load,
      api<BillingSummary>(`/billing/summary?month=${month}`).then((d) => {
        if (active) setSummary(d);
      }),
    ]).catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [month, page, search, groupId, status, version, history, studentId]);
  function done() {
    setPay(null);
    setAdjust(null);
    setReverse(null);
    setGenerate(false);
    setVersion((v) => v + 1);
    setSuccess("Amal muvaffaqiyatli bajarildi.");
  }
  async function submitGeneration(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api("/billing/charges/generate", {
        method: "POST",
        body: JSON.stringify({
          month,
          dueDay: Number(form.get("dueDay")),
          confirmed: true,
        }),
      });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const total = (history ? payments : data)?.total ?? 0;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="form-eyebrow">MOLIYA</span>
          <h1>{studentId ? "O‘quvchining moliyaviy profili" : "To‘lovlar"}</h1>
          <p className="muted">
            Hisoblar va qo‘lda qayd etilgan to‘lovlar. Barcha summalar UZS.
          </p>
        </div>
        <button className="button primary" onClick={() => setGenerate(true)}>
          Oylik hisob yaratish
        </button>
      </div>
      <nav className="billing-tabs" aria-label="Moliya">
        <Link
          className="button"
          to={studentId ? `/students/${studentId}/finance` : "/billing"}
        >
          Oylik hisoblar
        </Link>
        <Link
          className="button"
          to={
            studentId
              ? `/students/${studentId}/finance/history`
              : "/billing/history"
          }
        >
          To‘lov tarixi
        </Link>
      </nav>
      {summary && !studentId && <FinancialStats data={summary} />}
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setVersion((v) => v + 1)}
          >
            Qayta urinish
          </button>
        </div>
      )}
      {success && (
        <div className="success-note" role="status">
          {success}
        </div>
      )}
      <section className="panel">
        <form className="billing-filters" onSubmit={(e) => e.preventDefault()}>
          <label>
            O‘quvchini qidirish
            <input
              className="plain-input"
              value={search}
              maxLength={100}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            {history ? "Tushum oyi" : "Hisob oyi"}
            <input
              className="plain-input"
              type="month"
              min="2000-01"
              max="2199-12"
              value={month}
              onChange={(e) => {
                if (e.target.value) setMonth(e.target.value);
                setPage(1);
              }}
            />
          </label>
          <label>
            Guruh
            <select
              className="plain-input"
              value={groupId}
              onChange={(e) => {
                setGroup(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Barcha guruhlar</option>
              {groups?.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          {groups && groups.total > 100 && (
            <button
              type="button"
              className="button"
              onClick={() =>
                setGroupPage((p) => (p * 100 >= groups.total ? 1 : p + 1))
              }
            >
              Boshqa guruhlar ({groupPage})
            </button>
          )}
          {!history && (
            <label>
              Holat
              <select
                className="plain-input"
                value={status}
                onChange={(e) => {
                  setStatus(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">Barchasi</option>
                {Object.entries(statusNames).map(([v, n]) => (
                  <option key={v} value={v}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
          )}
        </form>
        {!data && !payments && !error && (
          <p className="loading-panel" role="status">
            Yuklanmoqda…
          </p>
        )}
        {data && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>O‘quvchi / guruh</th>
                  <th>Oy / muddat</th>
                  <th>Hisob</th>
                  <th>To‘langan / qoldiq</th>
                  <th>Holat</th>
                  <th>Amallar</th>
                </tr>
              </thead>
              <tbody>
                {data.charges.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link to={`/students/${c.studentId}/finance`}>
                        {c.studentName}
                      </Link>
                      <p>{c.groupName}</p>
                    </td>
                    <td>
                      {c.billingMonth}
                      <p className="small">{date(c.dueDate)}</p>
                    </td>
                    <td>
                      {uzs(c.finalAmount)}
                      {c.discountAmount > 0 && (
                        <p className="small">
                          Chegirma: {uzs(c.discountAmount)}
                        </p>
                      )}
                    </td>
                    <td>
                      {uzs(c.paidAmount)}
                      <p>{uzs(c.remainingAmount)}</p>
                    </td>
                    <td>{statusNames[c.status]}</td>
                    <td>
                      {c.remainingAmount > 0 && (
                        <button
                          className="button primary"
                          onClick={() => setPay(c)}
                        >
                          To‘lov qo‘shish
                        </button>
                      )}
                      {owner && (
                        <button
                          className="text-button"
                          onClick={() => setAdjust(c)}
                        >
                          Hisobni tuzatish
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {payments && (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Sana / o‘quvchi</th>
                  <th>Summa</th>
                  <th>Usul</th>
                  <th>Izoh / havola</th>
                  <th>Holat</th>
                </tr>
              </thead>
              <tbody>
                {payments.payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {date(p.paidAt)}
                      <p>
                        <Link to={`/students/${p.studentId}/finance`}>
                          {p.studentName ?? "Moliyaviy profil"}
                        </Link>
                      </p>
                    </td>
                    <td>{uzs(p.amount)}</td>
                    <td>{methods[p.method]}</td>
                    <td>
                      {p.note}
                      <p>{p.reference}</p>
                    </td>
                    <td>
                      {p.reversal ? (
                        <>
                          Qaytarilgan<p>{p.reversal.reason}</p>
                          <p className="small">{date(p.reversal.createdAt)}</p>
                        </>
                      ) : (
                        <>
                          Qabul qilingan
                          {owner && (
                            <button
                              className="text-button"
                              onClick={() => setReverse(p)}
                            >
                              To‘lovni qaytarish
                            </button>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {(data || payments) && !total && (
          <p className="empty-state">Ma’lumotlar topilmadi.</p>
        )}
        <div className="pagination">
          <span>
            {total} ta · {page}-sahifa
          </span>
          <div>
            <button
              className="button"
              disabled={page === 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Oldingi
            </button>
            <button
              className="button"
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Keyingi
            </button>
          </div>
        </div>
      </section>
      {pay && (
        <PaymentDialog
          charge={pay}
          onClose={() => setPay(null)}
          onDone={done}
        />
      )}
      {generate && (
        <Modal
          title="Oylik hisob yaratish"
          busy={busy}
          close={() => setGenerate(false)}
        >
          <form className="auth-form" onSubmit={submitGeneration}>
            <p>
              {month} uchun barcha mos faol a’zoliklardan to‘liq oylik hisoblar
              yaratiladi. Takroriy hisoblar yaratilmaydi.
            </p>
            <label>
              To‘lov muddati (oy kuni)
              <input
                className="plain-input"
                type="number"
                name="dueDay"
                min={1}
                max={28}
                defaultValue={10}
                required
              />
            </label>
            <label>
              <input type="checkbox" required /> Ommaviy hisob yaratishni
              tasdiqlayman
            </label>
            {error && (
              <div className="notice" role="alert">
                {error}
              </div>
            )}
            <button className="button primary" disabled={busy}>
              Tasdiqlash va yaratish
            </button>
          </form>
        </Modal>
      )}
      {adjust && (
        <Correction charge={adjust} close={() => setAdjust(null)} done={done} />
      )}
      {reverse && (
        <Correction
          payment={reverse}
          close={() => setReverse(null)}
          done={done}
        />
      )}
    </>
  );
}
function Modal({
  title,
  close,
  busy,
  children,
}: {
  title: string;
  close: () => void;
  busy: boolean;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="member-dialog"
      ref={ref}
      aria-label={title}
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else close();
      }}
    >
      <div className="section-heading">
        <h2>{title}</h2>
        <button className="button" disabled={busy} onClick={close}>
          Yopish
        </button>
      </div>
      {children}
    </dialog>
  );
}
function PaymentDialog({
  charge,
  onClose,
  onDone,
}: {
  charge: ChargeView;
  onClose: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  // Retain the exact payload/key after transport failures; retries cannot create a second payment.
  const pending = useRef<string | null>(null);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!pending.current) {
      const f = new FormData(e.currentTarget);
      const amount = Number(f.get("amount"));
      if (!Number.isSafeInteger(amount) || amount < 1) {
        setError("Musbat butun summa kiriting.");
        return;
      }
      pending.current = JSON.stringify({
        chargeId: charge.id,
        amount,
        method: f.get("method"),
        paidAt: new Date(`${f.get("paidAt")}:00+05:00`).toISOString(),
        reference: f.get("reference"),
        note: f.get("note"),
        idempotencyKey: crypto.randomUUID(),
        confirmed: true,
      });
    }
    setBusy(true);
    setError("");
    try {
      await api("/billing/payments", { method: "POST", body: pending.current });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const local = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 16);
  return (
    <Modal title="To‘lov qo‘shish" busy={busy} close={onClose}>
      <p>
        {charge.studentName} · {charge.groupName} · {charge.billingMonth}
      </p>
      <p>Qoldiq: {uzs(charge.remainingAmount)}</p>
      <form className="auth-form" onSubmit={submit}>
        <fieldset disabled={busy || !!pending.current}>
          <label>
            Summa (UZS)
            <input
              className="plain-input"
              name="amount"
              type="number"
              min={1}
              max={charge.remainingAmount}
              step={1}
              defaultValue={charge.remainingAmount}
              required
            />
          </label>
          <label>
            To‘lov usuli
            <select className="plain-input" name="method">
              {Object.entries(methods).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label>
            To‘langan vaqt (Toshkent)
            <input
              className="plain-input"
              name="paidAt"
              type="datetime-local"
              defaultValue={local}
              required
            />
          </label>
          <label>
            Havola
            <input className="plain-input" name="reference" maxLength={200} />
          </label>
          <label>
            Izoh
            <textarea className="plain-input" name="note" maxLength={1000} />
          </label>
          <label>
            <input type="checkbox" required /> To‘lov summasi va usulini
            tasdiqlayman
          </label>
        </fieldset>
        {error && (
          <div className="notice" role="alert">
            {error} Qayta urinish aynan shu to‘lovni tekshiradi.
          </div>
        )}
        <button className="button primary" disabled={busy}>
          {busy
            ? "Saqlanmoqda…"
            : pending.current
              ? "Qayta urinish"
              : "To‘lovni tasdiqlash"}
        </button>
      </form>
    </Modal>
  );
}
function Correction({
  charge,
  payment,
  close,
  done,
}: {
  charge?: ChargeView;
  payment?: PaymentView;
  close: () => void;
  done: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    try {
      await api(
        charge
          ? `/billing/charges/${charge.id}`
          : `/billing/payments/${payment!.id}/reverse`,
        {
          method: charge ? "PATCH" : "POST",
          body: JSON.stringify(
            charge
              ? {
                  originalAmount: Number(f.get("originalAmount")),
                  discountAmount: Number(f.get("discountAmount")),
                  cancelled: f.get("cancelled") === "on",
                  reason: f.get("reason"),
                }
              : { reason: f.get("reason"), confirmed: true },
          ),
        },
      );
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={charge ? "Hisobni tuzatish" : "To‘lovni qaytarish"}
      busy={busy}
      close={close}
    >
      <form className="auth-form" onSubmit={submit}>
        {charge && (
          <>
            <label>
              Asl summa
              <input
                className="plain-input"
                name="originalAmount"
                type="number"
                min={0}
                step={1}
                max={1e12}
                defaultValue={charge.originalAmount}
                required
              />
            </label>
            <label>
              Chegirma
              <input
                className="plain-input"
                name="discountAmount"
                type="number"
                min={0}
                step={1}
                max={1e12}
                defaultValue={charge.discountAmount}
                required
              />
            </label>
            <label>
              <input
                name="cancelled"
                type="checkbox"
                defaultChecked={charge.status === "cancelled"}
              />{" "}
              Hisobni bekor qilish
            </label>
          </>
        )}
        <label>
          Sabab
          <textarea
            className="plain-input"
            name="reason"
            minLength={3}
            maxLength={1000}
            required
          />
        </label>
        <label>
          <input type="checkbox" required /> Tuzatishni tasdiqlayman
        </label>
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
        <button className="button primary" disabled={busy}>
          Tasdiqlash
        </button>
      </form>
    </Modal>
  );
}
