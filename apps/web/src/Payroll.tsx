import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "./api";
import { uzs } from "./Billing";
type Line = {
  ruleId: string;
  groupId: string | null;
  salaryType: string;
  percentage: number | null;
  basisAmount: number;
  salary: number;
  legacyAttribution: boolean;
};
type Basis = { lines: Line[]; grossSalary: number };
type Statement = {
  id: string;
  teacherId: string;
  teacherName?: string;
  payrollMonth: string;
  calculationBasis: Basis;
  grossSalary: number;
  finalSalary: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
  revision: number;
  reversedAt?: string | null;
  adjustments: { amount: number; reason: string }[];
};
type Payout = {
  id: string;
  amount: number;
  method: string;
  paidAt: string;
  reference: string;
  reversal: { reason: string } | null;
};
type Rule = {
  _id: string;
  teacherId: string;
  groupId: string | null;
  salaryType: string;
  percentage: number | null;
  fixedAmount: number | null;
  effectiveFrom: string;
  effectiveUntil: string | null;
};
const types: Record<string, string> = {
  collected: "Tushumdan foiz",
  billed: "Hisoblangan ta’lim haqidan foiz",
  fixed: "Belgilangan oylik",
};
const statuses: Record<string, string> = {
  draft: "Qoralama",
  approved: "Tasdiqlangan",
  partially_paid: "Qisman to‘langan",
  paid: "To‘langan",
};
const now = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
  }).format(new Date());
const send = <T,>(path: string, data: object, method = "POST") =>
  api<T>(path, { method, body: JSON.stringify(data) });
function Breakdown({ basis }: { basis: Basis }) {
  return (
    <div className="table-scroll" tabIndex={0} aria-label="Maosh hisob-kitobi">
      <table>
        <caption>Hisob-kitob tafsilotlari</caption>
        <thead>
          <tr>
            {["Guruh", "Qoida", "Asos", "Foiz", "Maosh"].map((h) => (
              <th scope="col" key={h}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {basis.lines.map((l, i) => (
            <tr key={i}>
              <td>
                {l.groupId ?? "Umumiy oylik"}
                {l.legacyAttribution && (
                  <small> · Eski hisob: joriy o‘qituvchi</small>
                )}
              </td>
              <td>{types[l.salaryType]}</td>
              <td>{uzs(l.basisAmount)}</td>
              <td>{l.percentage ?? "—"}</td>
              <td>{uzs(l.salary)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
export function PayrollPage({
  owner,
  settings = false,
}: {
  owner: boolean;
  settings?: boolean;
}) {
  const [month, setMonth] = useState(now),
    [teacherId, setTeacher] = useState(""),
    [teacherPage, setTeacherPage] = useState(1);
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]),
    [teacherTotal, setTeacherTotal] = useState(0);
  const [groupPage, setGroupPage] = useState(1),
    [groupTotal, setGroupTotal] = useState(0),
    [groups, setGroups] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<Statement[] | null>(null),
    [rules, setRules] = useState<Rule[] | null>(null),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0);
  const [summary, setSummary] = useState<{
    approvedSalary: number;
    paidSalary: number;
    outstandingSalary: number;
    byGroup?: { groupId: string; grossSalary: number }[];
    unattributedSalary?: number;
  } | null>(null);
  const [preview, setPreview] = useState<Basis | null>(null),
    [version, refresh] = useState(0),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const [editing, setEditing] = useState<Rule | null>(null),
    [salaryType, setType] = useState("collected");
  useEffect(() => {
    if (!owner) return;
    let active = true;
    Promise.all([
      api<{ teachers: typeof teachers; total: number }>(
        `/groups/teachers?page=${teacherPage}`,
      ),
      api<{ groups: typeof groups; total: number }>(
        `/groups?pageSize=100&page=${groupPage}`,
      ),
    ])
      .then(([t, g]) => {
        if (active) {
          setTeachers(t.teachers);
          setTeacherTotal(t.total);
          setGroups(g.groups);
          setGroupTotal(g.total);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [owner, teacherPage, groupPage]);
  useEffect(() => {
    let active = true;
    setError("");
    setRows(null);
    setRules(null);
    setSummary(null);
    const q = new URLSearchParams({
      month,
      page: String(page),
      ...(teacherId ? { teacherId } : {}),
    });
    const task = settings
      ? api<{ rules: Rule[]; total: number }>(
          `/payroll/rules?page=${page}${teacherId ? "&teacherId=" + teacherId : ""}`,
        ).then((d) => {
          if (active) {
            setRules(d.rules);
            setTotal(d.total);
          }
        })
      : api<{ payrolls: Statement[]; total: number }>(`/payroll?${q}`).then(
          (d) => {
            if (active) {
              setRows(d.payrolls);
              setTotal(d.total);
            }
          },
        );
    Promise.all([
      task,
      ...(owner && !settings
        ? [
            api<typeof summary>(
              `/payroll/summary?month=${month}${teacherId ? "&teacherId=" + teacherId : ""}`,
            ).then((d) => {
              if (active) setSummary(d);
            }),
          ]
        : []),
    ]).catch((e) => {
      if (active) setError(e.message);
    });
    return () => {
      active = false;
    };
  }, [month, teacherId, page, version, settings, owner]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      refresh((v) => v + 1);
      setSuccess("Amal bajarildi.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function saveRule(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    await act(async () => {
      await send(
        editing ? `/payroll/rules/${editing._id}` : "/payroll/rules",
        {
          teacherId: f.get("teacherId"),
          groupId: f.get("groupId") || null,
          salaryType,
          percentage:
            salaryType === "fixed" ? null : Number(f.get("percentage")),
          fixedAmount:
            salaryType === "fixed" ? Number(f.get("fixedAmount")) : null,
          effectiveFrom: f.get("effectiveFrom"),
          effectiveUntil: f.get("effectiveUntil") || null,
          reason: f.get("reason"),
        },
        editing ? "PUT" : "POST",
      );
      setEditing(null);
    });
  }
  return (
    <div className="payroll-page">
      <div className="page-heading">
        <div>
          <h1>{settings ? "Maosh sozlamalari" : "O‘qituvchilar maoshi"}</h1>
          <p>
            Asia/Tashkent · Butun UZS · Tasdiqlangan xarajat va haqiqiy to‘lov
            alohida.
          </p>
        </div>
        {owner && (
          <Link
            className="button light"
            to={settings ? "/payroll" : "/payroll/settings"}
          >
            {settings ? "Oylik hisob-kitob" : "Maosh sozlamalari"}
          </Link>
        )}
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button
            className="button light"
            onClick={() => refresh((v) => v + 1)}
          >
            Qayta urinish
          </button>
        </div>
      )}
      {success && <p role="status">{success}</p>}
      <section className="panel payroll-controls">
        <label>
          Oy
          <input
            type="month"
            value={month}
            onChange={(e) => {
              setMonth(e.target.value);
              setPage(1);
              setPreview(null);
            }}
          />
        </label>
        {owner && (
          <>
            <label>
              O‘qituvchi
              <select
                value={teacherId}
                onChange={(e) => {
                  setTeacher(e.target.value);
                  setPage(1);
                  setPreview(null);
                }}
              >
                <option value="">Barchasi</option>
                {teachers.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button light"
              disabled={teacherPage === 1}
              onClick={() => setTeacherPage((p) => p - 1)}
            >
              Oldingi o‘qituvchilar
            </button>
            <button
              className="button light"
              disabled={teacherPage * 20 >= teacherTotal}
              onClick={() => setTeacherPage((p) => p + 1)}
            >
              Keyingi o‘qituvchilar
            </button>
          </>
        )}
      </section>
      {summary && (
        <div className="stats-grid financial-stats">
          {[
            ["Tasdiqlangan maosh xarajati", summary.approvedSalary],
            ["Haqiqiy to‘langan (qaytarishsiz)", summary.paidSalary],
            ["Maosh majburiyati", summary.outstandingSalary],
          ].map(([l, n]) => (
            <section className="stat-card" key={l}>
              <p>{l}</p>
              <strong>{uzs(Number(n))}</strong>
            </section>
          ))}
        </div>
      )}
      {summary?.byGroup && (
        <section className="panel">
          <h2>Guruhlar bo‘yicha maosh · {month}</h2>
          <p>
            Guruh summalari — hisoblangan maosh. Umumiy oylik va tuzatishlar
            alohida ko‘rsatiladi.
          </p>
          <div
            className="table-scroll"
            tabIndex={0}
            aria-label="Guruhlar bo‘yicha maosh"
          >
            <table>
              <thead>
                <tr>
                  <th scope="col">Guruh</th>
                  <th scope="col">Hisoblangan maosh</th>
                </tr>
              </thead>
              <tbody>
                {summary.byGroup.map((g) => (
                  <tr key={g.groupId}>
                    <td>
                      {groups.find((row) => row.id === g.groupId)?.name ??
                        g.groupId}
                    </td>
                    <td>{uzs(g.grossSalary)}</td>
                  </tr>
                ))}
                <tr>
                  <td>Guruhga taqsimlanmagan (tuzatishlar bilan)</td>
                  <td>{uzs(summary.unattributedSalary ?? 0)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
      {!settings && owner && (
        <section className="panel">
          <h2>Oylik hisob-kitob</h2>
          <p>
            Qoida oy boshidagi sanaga ko‘ra tanlanadi. Belgilangan oylik
            mutanosib kamaytirilmaydi. Kechikkan tushum qabul qilingan oyga
            kiradi.
          </p>
          <div className="payroll-controls">
            <button
              className="button light"
              disabled={busy || !teacherId}
              onClick={() =>
                act(async () =>
                  setPreview(
                    await send<Basis>("/payroll/preview", { teacherId, month }),
                  ),
                )
              }
            >
              Hisoblashni ko‘rish
            </button>
            <button
              className="button primary"
              disabled={busy || !teacherId}
              onClick={() =>
                act(() =>
                  send("/payroll/drafts", {
                    teacherId,
                    month,
                    confirmed: true,
                  }),
                )
              }
            >
              Qoralama yaratish
            </button>
          </div>
          {preview && (
            <>
              <Breakdown basis={preview} />
              <p>Jami: {uzs(preview.grossSalary)}</p>
            </>
          )}
        </section>
      )}
      {settings && owner && (
        <form
          className="panel payroll-form"
          onSubmit={saveRule}
          key={editing?._id ?? "new"}
        >
          <h2>{editing ? "Qoidani tahrirlash" : "Yangi maosh qoidasi"}</h2>
          <label>
            O‘qituvchi
            <select
              name="teacherId"
              required
              defaultValue={editing?.teacherId ?? teacherId}
            >
              <option value="">Tanlang</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Guruh (ixtiyoriy)
            <select name="groupId" defaultValue={editing?.groupId ?? ""}>
              <option value="">Umumiy qoida</option>
              {groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <div className="payroll-controls">
            <button
              type="button"
              className="button light"
              disabled={groupPage === 1}
              onClick={() => setGroupPage((p) => p - 1)}
            >
              Oldingi guruhlar
            </button>
            <button
              type="button"
              className="button light"
              disabled={groupPage * 100 >= groupTotal}
              onClick={() => setGroupPage((p) => p + 1)}
            >
              Keyingi guruhlar
            </button>
          </div>
          <label>
            Maosh turi
            <select
              value={salaryType}
              onChange={(e) => setType(e.target.value)}
            >
              {Object.entries(types).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          {salaryType === "fixed" ? (
            <label>
              Belgilangan summa (UZS)
              <input
                name="fixedAmount"
                type="number"
                min="0"
                max="1000000000000"
                step="1"
                required
                defaultValue={editing?.fixedAmount ?? ""}
              />
            </label>
          ) : (
            <label>
              Foiz
              <input
                name="percentage"
                type="number"
                min="0"
                max="100"
                step="0.01"
                required
                defaultValue={editing?.percentage ?? ""}
              />
            </label>
          )}
          <label>
            Amal boshlanishi (oyning 1-kuni)
            <input
              name="effectiveFrom"
              type="date"
              required
              defaultValue={editing?.effectiveFrom ?? month + "-01"}
            />
          </label>
          <label>
            Amal tugashi
            <input
              name="effectiveUntil"
              type="date"
              defaultValue={editing?.effectiveUntil ?? ""}
            />
          </label>
          <label>
            Sabab
            <textarea name="reason" required minLength={3} maxLength={1000} />
          </label>
          <button className="button primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
          {editing && (
            <button
              type="button"
              className="button light"
              onClick={() => setEditing(null)}
            >
              Bekor qilish
            </button>
          )}
        </form>
      )}
      {(settings ? rules : rows) === null && !error && (
        <p role="status">Yuklanmoqda…</p>
      )}
      {settings && rules && (
        <section className="panel">
          <h2>Maosh qoidalari</h2>
          {!rules.length && <p>Ma’lumotlar topilmadi.</p>}
          {rules.map((r) => (
            <article key={r._id}>
              <p>
                {teachers.find((t) => t.id === r.teacherId)?.name ??
                  r.teacherId}{" "}
                · {types[r.salaryType]} ·{" "}
                {r.salaryType === "fixed"
                  ? uzs(r.fixedAmount!)
                  : r.percentage + "%"}{" "}
                · {r.effectiveFrom} — {r.effectiveUntil ?? "Muddatsiz"} ·{" "}
                {r.groupId ?? "Umumiy"}
              </p>
              <button
                className="button light"
                onClick={() => {
                  setEditing(r);
                  setType(r.salaryType);
                }}
              >
                Tahrirlash
              </button>
              <ArchiveRule rule={r} busy={busy} act={act} />
            </article>
          ))}
        </section>
      )}
      {!settings && rows && (
        <section className="panel">
          <h2>Oylik maoshlar</h2>
          {!rows.length ? (
            <p>Ma’lumotlar topilmadi.</p>
          ) : (
            <div
              className="table-scroll"
              tabIndex={0}
              aria-label="Oylik maoshlar"
            >
              <table>
                <thead>
                  <tr>
                    {[
                      "O‘qituvchi",
                      "Oy",
                      "Maosh",
                      "To‘langan",
                      "Qoldiq",
                      "Holat",
                      "Amal",
                    ].map((h) => (
                      <th scope="col" key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => (
                    <tr key={p.id}>
                      <td>{p.teacherName}</td>
                      <td>{p.payrollMonth}</td>
                      <td>{uzs(p.finalSalary)}</td>
                      <td>{uzs(p.paidAmount)}</td>
                      <td>{uzs(p.outstandingAmount)}</td>
                      <td>
                        <span className="status-badge">
                          {p.reversedAt ? "Bekor qilingan" : statuses[p.status]}
                        </span>
                      </td>
                      <td>
                        <Link to={`/payroll/${p.id}`}>Tafsilotlar</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      <div className="payroll-controls">
        <button
          className="button light"
          disabled={page === 1}
          onClick={() => setPage((p) => p - 1)}
        >
          Oldingi
        </button>
        <span>
          {page} · Jami {total}
        </span>
        <button
          className="button light"
          disabled={page * 20 >= total}
          onClick={() => setPage((p) => p + 1)}
        >
          Keyingi
        </button>
      </div>
    </div>
  );
}
function ArchiveRule({
  rule,
  busy,
  act,
}: {
  rule: Rule;
  busy: boolean;
  act: (fn: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <form
      className="payroll-controls"
      onSubmit={(e) => {
        e.preventDefault();
        const reason = new FormData(e.currentTarget).get("reason");
        void act(() =>
          send(`/payroll/rules/${rule._id}`, { reason }, "DELETE"),
        );
      }}
    >
      <label>
        Arxivlash sababi
        <input name="reason" minLength={3} required />
      </label>
      <button className="button light" disabled={busy}>
        Qoidani arxivlash
      </button>
    </form>
  );
}
export function PayrollDetail({ owner }: { owner: boolean }) {
  const { id } = useParams(),
    [p, setP] = useState<Statement | null>(null),
    [payouts, setPayouts] = useState<Payout[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [version, refresh] = useState(0),
    [success, setSuccess] = useState("");
  const [confirming, setConfirming] = useState(false),
    dialog = useRef<HTMLDialogElement>(null);
  const retry = useRef<{ signature: string; key: string } | null>(null);
  useEffect(() => {
    let active = true;
    setP(null);
    setError("");
    Promise.all([
      api<{ payroll: Statement }>(`/payroll/${id}`),
      api<{ payouts: Payout[] }>(`/payroll/${id}/payouts`),
    ])
      .then(([d, h]) => {
        if (active) {
          setP(d.payroll);
          setPayouts(h.payouts);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, version]);
  useEffect(() => {
    if (confirming) dialog.current?.showModal();
    else dialog.current?.close();
  }, [confirming]);
  async function act(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await fn();
      setSuccess("Amal bajarildi.");
      refresh((v) => v + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="payroll-page">
      <div className="page-heading">
        <h1>Maosh tafsilotlari</h1>
        <Link className="button light" to="/payroll">
          O‘qituvchilar maoshi
        </Link>
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}{" "}
          <button
            className="button light"
            onClick={() => refresh((v) => v + 1)}
          >
            Qayta urinish
          </button>
        </p>
      )}
      {success && <p role="status">{success}</p>}
      {!p && !error && <p role="status">Yuklanmoqda…</p>}
      {p && (
        <>
          <section className="panel">
            <h2>
              {p.payrollMonth} ·{" "}
              {p.reversedAt ? "Bekor qilingan" : statuses[p.status]}
            </h2>
            <Breakdown basis={p.calculationBasis} />
            <p>
              Hisoblangan: {uzs(p.grossSalary)} · Yakuniy: {uzs(p.finalSalary)}{" "}
              · To‘langan: {uzs(p.paidAmount)} · Majburiyat:{" "}
              {uzs(p.outstandingAmount)}
            </p>
            {p.adjustments.map((a, i) => (
              <p key={i}>
                {uzs(a.amount)} · {a.reason}
              </p>
            ))}
          </section>
          {owner && p.status === "draft" && (
            <section className="panel">
              <h2>Tuzatish va tasdiqlash</h2>
              <form
                className="payroll-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  void act(() =>
                    send(`/payroll/${id}/adjustments`, {
                      revision: p.revision,
                      amount: Number(f.get("amount")),
                      reason: f.get("reason"),
                    }),
                  );
                }}
              >
                <label>
                  Tuzatish (UZS, manfiy bo‘lishi mumkin)
                  <input name="amount" type="number" step="1" required />
                </label>
                <label>
                  Tuzatish sababi
                  <textarea
                    name="reason"
                    minLength={3}
                    maxLength={1000}
                    required
                  />
                </label>
                <button className="button light" disabled={busy}>
                  Tuzatishni saqlash
                </button>
              </form>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => setConfirming(true)}
              >
                Maoshni tasdiqlash
              </button>
              <form
                className="payroll-controls"
                onSubmit={(e) => {
                  e.preventDefault();
                  const reason = new FormData(e.currentTarget).get("reason");
                  void act(() =>
                    send(`/payroll/${id}/recalculate`, {
                      reason,
                      revision: p.revision,
                      confirmed: true,
                    }),
                  );
                }}
              >
                <label>
                  Qayta hisoblash sababi
                  <input name="reason" minLength={3} required />
                </label>
                <button className="button light" disabled={busy}>
                  Qayta hisoblash
                </button>
              </form>
            </section>
          )}
          <dialog
            ref={dialog}
            className="member-dialog"
            aria-labelledby="payroll-approval"
            onCancel={(e) => {
              if (busy) e.preventDefault();
              else setConfirming(false);
            }}
          >
            <h2 id="payroll-approval">Maoshni tasdiqlaysizmi?</h2>
            <p>
              {p.teacherName} · {p.payrollMonth} · {uzs(p.finalSalary)}. Tasdiqlangan hisob-kitob
              saqlanadi va o‘zgarmaydi.
            </p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                act(async () => {
                  await send(`/payroll/${id}/approve`, {
                    revision: p.revision,
                    confirmed: true,
                  });
                  setConfirming(false);
                })
              }
            >
              Tasdiqlash
            </button>
            <button
              className="button light"
              disabled={busy}
              onClick={() => setConfirming(false)}
            >
              Bekor qilish
            </button>
          </dialog>
          {owner && p.status !== "draft" && !p.reversedAt && (
            <section className="panel">
              <h2>To‘lovni qayd etish</h2>
              <p>
                Bu amal bank o‘tkazmasini bajarmaydi. Faqat amalga oshirilgan
                to‘lovni kiriting.
              </p>
              <form
                className="payroll-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  const data = {
                    amount: Number(f.get("amount")),
                    paidAt: new Date(
                      String(f.get("paidAt")) + "+05:00",
                    ).toISOString(),
                    method: f.get("method"),
                    reference: f.get("reference"),
                    confirmed: true,
                  };
                  const signature = JSON.stringify(data);
                  if (retry.current?.signature !== signature)
                    retry.current = { signature, key: crypto.randomUUID() };
                  const idempotencyKey = retry.current.key;
                  void act(async () => {
                    await send(`/payroll/${id}/payouts`, {
                      ...data,
                      idempotencyKey,
                    });
                    retry.current = null;
                  });
                }}
              >
                <label>
                  Summa (UZS)
                  <input
                    name="amount"
                    type="number"
                    min="1"
                    max={p.outstandingAmount}
                    step="1"
                    required
                  />
                </label>
                <label>
                  To‘lov vaqti (Toshkent)
                  <input name="paidAt" type="datetime-local" required />
                </label>
                <label>
                  Usul
                  <select name="method">
                    <option value="cash">Naqd</option>
                    <option value="bank_transfer">Bank o‘tkazmasi</option>
                  </select>
                </label>
                <label>
                  Hujjat raqami
                  <input name="reference" maxLength={200} />
                </label>
                <label>
                  <input type="checkbox" required /> To‘lov amalga oshirilganini
                  tasdiqlayman
                </label>
                <button
                  className="button primary"
                  disabled={busy || !p.outstandingAmount}
                >
                  {busy ? "Saqlanmoqda…" : "To‘lovni qayd etish"}
                </button>
              </form>
              {!p.paidAmount && (
                <form
                  className="payroll-controls"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    void act(() =>
                      send(`/payroll/${id}/reverse`, {
                        reason: f.get("reason"),
                        confirmed: true,
                      }),
                    );
                  }}
                >
                  <label>
                    Maoshni bekor qilish sababi
                    <input name="reason" required minLength={3} />
                  </label>
                  <label>
                    <input type="checkbox" required /> Bekor qilishni
                    tasdiqlayman
                  </label>
                  <button className="button light" disabled={busy}>
                    Maoshni bekor qilish
                  </button>
                </form>
              )}
            </section>
          )}
          <section className="panel">
            <h2>Maosh to‘lovlari tarixi</h2>
            {!payouts.length && <p>Ma’lumotlar topilmadi.</p>}
            {payouts.map((pay) => (
              <article key={pay.id}>
                <p>
                  {uzs(pay.amount)} ·{" "}
                  {new Intl.DateTimeFormat("uz-UZ", {
                    timeZone: "Asia/Tashkent",
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(pay.paidAt))}{" "}
                  · {pay.method === "cash" ? "Naqd" : "Bank o‘tkazmasi"} ·{" "}
                  {pay.reference}
                </p>
                {pay.reversal ? (
                  <p>Qaytarilgan: {pay.reversal.reason}</p>
                ) : (
                  owner && (
                    <form
                      className="payroll-controls"
                      onSubmit={(e) => {
                        e.preventDefault();
                        const f = new FormData(e.currentTarget);
                        void act(() =>
                          send(`/payroll/${id}/payouts/${pay.id}/reverse`, {
                            reason: f.get("reason"),
                            confirmed: true,
                          }),
                        );
                      }}
                    >
                      <label>
                        Qaytarish sababi
                        <input name="reason" required minLength={3} />
                      </label>
                      <label>
                        <input type="checkbox" required /> Qaytarishni
                        tasdiqlayman
                      </label>
                      <button className="button light" disabled={busy}>
                        To‘lovni qaytarish
                      </button>
                    </form>
                  )
                )}
              </article>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
