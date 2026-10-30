import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { CheckCheck, CalendarDays } from "lucide-react";
import type {
  AttendanceRoster,
  AttendanceSession,
  AttendanceSessions,
  AttendanceStatus,
  AttendanceSummary,
  GroupsView,
} from "@softlans/contracts";
import { api } from "./api";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const labels: Record<AttendanceStatus, string> = {
  present: "Keldi",
  absent: "Kelmadi",
  late: "Kechikdi",
  excused: "Sababli kelmadi",
};
const sessionLabels = {
  scheduled: "Kutilmoqda",
  completed: "Belgilangan",
  cancelled: "Bekor qilingan",
};
export function AttendanceStats({ data }: { data: AttendanceSummary }) {
  return (
    <div className="stats-grid attendance-stats">
      {[
        ["Jami darslar", data.totalSessions],
        ["Davomati to‘liq", data.completedSessions],
        ["Davomat kutilmoqda", data.awaitingSessions],
        [
          "Qatnashish",
          data.attendancePercentage === null
            ? "—"
            : `${data.attendancePercentage}%`,
        ],
      ].map(([title, value]) => (
        <section className="stat-card" key={title}>
          <div className="stat-top">
            <span>{title}</span>
            <CheckCheck size={20} aria-hidden="true" />
          </div>
          <strong>{value}</strong>
          <p>Asia/Tashkent · davomat</p>
        </section>
      ))}
    </div>
  );
}
function Heading({ title }: { title: string }) {
  return (
    <div className="page-heading">
      <div>
        <span className="form-eyebrow">TA’LIM BOSHQARUVI · ASIA/TASHKENT</span>
        <h1>{title}</h1>
        <p className="muted">Har bir dars, har bir o‘quvchi — e’tiborda.</p>
      </div>
    </div>
  );
}
export function Attendance({ history = false }: { history?: boolean }) {
  const { groupId, studentId } = useParams();
  const [start, setStart] = useState(today),
    [end, setEnd] = useState(today),
    [group, setGroup] = useState(groupId ?? "");
  const [groups, setGroups] = useState<GroupsView | null>(null);
  const [data, setData] = useState<AttendanceSessions | null>(null),
    [summary, setSummary] = useState<AttendanceSummary | null>(null);
  const [page, setPage] = useState(1),
    [retry, setRetry] = useState(0),
    [error, setError] = useState("");
  useEffect(() => {
    setGroup(groupId ?? "");
    setPage(1);
  }, [groupId]);
  useEffect(() => {
    let active = true;
    api<GroupsView>("/groups?pageSize=100")
      .then((d) => {
        if (active) setGroups(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setData(null);
    setSummary(null);
    setError("");
    const q = new URLSearchParams({
      start: history ? start : today(),
      end: history ? end : today(),
      page: String(page),
      ...(group ? { groupId: group } : {}),
      ...(studentId ? { studentId } : {}),
    });
    async function load() {
      try {
        await api("/attendance/generate", {
          method: "POST",
          body: JSON.stringify({
            start: q.get("start"),
            end: q.get("end"),
            ...(group ? { groupId: group } : {}),
          }),
        });
        const [d, s] = await Promise.all([
          api<AttendanceSessions>(`/attendance/sessions?${q}`),
          api<AttendanceSummary>(`/attendance/summary?${q}`),
        ]);
        if (active) {
          setData(d);
          setSummary(s);
        }
      } catch (e) {
        if (active) setError((e as Error).message);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [history, start, end, group, studentId, page, retry]);
  return (
    <div className="attendance-module">
      <Heading
        title={
          studentId
            ? "O‘quvchi davomati"
            : groupId
              ? "Guruh davomati"
              : history
                ? "Davomat tarixi"
                : "Davomat"
        }
      />
      <nav className="attendance-toolbar" aria-label="Davomat bo‘limlari">
        <Link className="button light" to="/attendance/today">
          Bugungi darslar
        </Link>
        <Link className="button light" to="/attendance/history">
          Davomat tarixi
        </Link>
      </nav>
      <section className="panel attendance-filters">
        <h2>{history ? "Davr va guruh" : "Bugungi darslar"}</h2>
        <div className="attendance-toolbar">
          {history && (
            <>
              <label>
                Boshlanish
                <input
                  className="plain-input"
                  type="date"
                  value={start}
                  max={end}
                  onChange={(e) => {
                    setStart(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
              <label>
                Tugash
                <input
                  className="plain-input"
                  type="date"
                  value={end}
                  min={start}
                  max={today()}
                  onChange={(e) => {
                    setEnd(e.target.value);
                    setPage(1);
                  }}
                />
              </label>
            </>
          )}
          <label>
            Guruh
            <select
              className="plain-input"
              value={group}
              onChange={(e) => {
                setGroup(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Barcha ruxsat etilgan guruhlar</option>
              {groups?.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button className="button light" onClick={() => setRetry(retry + 1)}>
            Qayta urinish
          </button>
        </div>
      )}
      {!data && !error && <p role="status">Yuklanmoqda…</p>}
      {summary && (
        <>
          <AttendanceStats data={summary} />
          <p className="muted">
            Keldi: {summary.present} · Kelmadi: {summary.absent} · Kechikdi:{" "}
            {summary.late} · Sababli: {summary.excused} · Belgilanmagan:{" "}
            {summary.unmarked}
          </p>
          <p className="muted small">
            Qatnashish = (keldi + kechikdi) / belgilangan × 100. Qamrov:{" "}
            {summary.coveragePercentage ?? "—"}%. Belgilanmaganlar kelmadi deb
            hisoblanmaydi.
          </p>
        </>
      )}
      {data && (
        <section className="panel attendance-results">
          {!data.total ? (
            <div className="empty-state">
              <CalendarDays size={28} aria-hidden="true" />
              <p>Tanlangan davrda darslar topilmadi.</p>
            </div>
          ) : history ? (
            <div className="table-scroll">
              <table>
                <caption>Davomat tarixi</caption>
                <thead>
                  <tr>
                    {["Sana", "Guruh", "Vaqt", "Holat", "Amallar"].map((t) => (
                      <th scope="col" key={t}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.sessions.map((s) => (
                    <tr key={s.id}>
                      <td>{s.lessonDate}</td>
                      <td>
                        <Link to={`/attendance/groups/${s.groupId}`}>
                          {s.groupName}
                        </Link>
                      </td>
                      <td>
                        {s.startTime}–{s.endTime}
                      </td>
                      <td>{sessionLabels[s.status]}</td>
                      <td>
                        <Link
                          className="button light"
                          to={`/attendance/sessions/${s.id}`}
                        >
                          Ko‘rish
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="attendance-cards">
              {data.sessions.map((s) => (
                <article className="attendance-lesson" key={s.id}>
                  <span className="small-tag">{sessionLabels[s.status]}</span>
                  <h2>{s.groupName}</h2>
                  <p>
                    {s.lessonDate} · {s.startTime}–{s.endTime}
                  </p>
                  <p className="muted">{s.rosterCount} ta o‘quvchi</p>
                  <Link
                    className="button primary"
                    to={`/attendance/sessions/${s.id}`}
                  >
                    Davomat belgilash
                  </Link>
                </article>
              ))}
            </div>
          )}
          <div className="pagination">
            <span>
              {data.total} ta dars · {page}-sahifa
            </span>
            <div>
              <button
                className="button light"
                disabled={page === 1}
                onClick={() => setPage(page - 1)}
              >
                Oldingi
              </button>
              <button
                className="button light"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Keyingi
              </button>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
export function AttendanceMark({ manage = false }: { manage?: boolean }) {
  const { id } = useParams();
  const [data, setData] = useState<AttendanceRoster | null>(null),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [retry, setRetry] = useState(0);
  const [dirty, setDirty] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState<"bulk" | "save" | "cancel" | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setDirty(new Set());
    api<AttendanceRoster>(`/attendance/sessions/${id}/roster`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, retry]);
  useEffect(() => {
    if (confirm) dialog.current?.showModal();
  }, [confirm]);
  const readonly = busy || data?.session.status === "cancelled";
  function change(
    studentId: string,
    patch: Partial<AttendanceRoster["students"][number]>,
  ) {
    setData(
      (d) =>
        d && {
          ...d,
          students: d.students.map((s) =>
            s.studentId === studentId ? { ...s, ...patch } : s,
          ),
        },
    );
    setDirty((d) => new Set([...d, studentId]));
    setSuccess("");
  }
  function close() {
    dialog.current?.close();
    setConfirm(null);
  }
  async function act() {
    if (!data || busy) return;
    if (confirm === "bulk") {
      for (const s of data.students)
        if (!s.status) change(s.studentId, { status: "present" });
      close();
      return;
    }
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      if (confirm === "cancel")
        await api(`/attendance/sessions/${id}`, {
          method: "PATCH",
          body: JSON.stringify({
            revision: data.session.revision,
            status:
              data.session.status === "cancelled" ? "scheduled" : "cancelled",
          }),
        });
      else {
        const records = data.students
          .filter((s) => dirty.has(s.studentId) && s.status)
          .map((s) => ({
            studentId: s.studentId,
            status: s.status,
            note: s.note,
          }));
        let revision = data.session.revision;
        // Each bounded batch is atomic. Retain unsaved edits if a later batch conflicts.
        for (let offset = 0; offset < records.length; offset += 100) {
          const batch = records.slice(offset, offset + 100);
          const result = await api<{ session: AttendanceSession }>(
            `/attendance/sessions/${id}/attendance`,
            {
              method: "PATCH",
              body: JSON.stringify({ revision, records: batch }),
            },
          );
          revision = result.session.revision;
          setData((d) => d && { ...d, session: result.session });
          setDirty(
            (d) =>
              new Set(
                [...d].filter((id) => !batch.some((r) => r.studentId === id)),
              ),
          );
        }
      }
      const fresh = await api<AttendanceRoster>(
        `/attendance/sessions/${id}/roster`,
      );
      setData(fresh);
      setDirty(new Set());
      setSuccess("Davomat saqlandi.");
      close();
    } catch (e) {
      setError((e as Error).message);
      close();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="attendance-module">
      <Heading title="Davomat belgilash" />
      <Link className="button light" to="/attendance">
        Bugungi darslarga qaytish
      </Link>
      {error && (
        <div role="alert" className="notice">
          {error}{" "}
          <button
            className="button light"
            disabled={busy}
            onClick={() => {
              if (
                !dirty.size ||
                window.confirm("Saqlanmagan o‘zgarishlar bekor qilinsinmi?")
              )
                setRetry(retry + 1);
            }}
          >
            Yangilash
          </button>
        </div>
      )}
      {success && (
        <p role="status" className="success-note">
          {success}
        </p>
      )}
      {!data && !error && <p role="status">Yuklanmoqda…</p>}
      {data && (
        <>
          <section className="panel attendance-filters">
            <h2>{data.session.groupName}</h2>
            <p>
              {data.session.lessonDate} · {data.session.startTime}–
              {data.session.endTime} · {sessionLabels[data.session.status]}
            </p>
            <div className="attendance-toolbar">
              <button
                className="button light"
                disabled={readonly || !data.students.some((s) => !s.status)}
                onClick={() => setConfirm("bulk")}
              >
                Belgilanmaganlarni «Keldi» belgilash
              </button>
              <Link
                className="button light"
                to={`/attendance/groups/${data.session.groupId}`}
              >
                Guruh davomati
              </Link>
              {manage && (
                <button
                  className="button light"
                  disabled={busy}
                  onClick={() => setConfirm("cancel")}
                >
                  {data.session.status === "cancelled"
                    ? "Darsni tiklash"
                    : "Darsni bekor qilish"}
                </button>
              )}
            </div>
          </section>
          <p className="muted">
            Belgilanmagan: {data.students.filter((s) => !s.status).length}.
            Saqlashdan oldin belgilarni tekshiring.
          </p>
          <section
            className="panel attendance-roster"
            aria-label="O‘quvchilar ro‘yxati"
          >
            {!data.students.length && (
              <p className="empty-state">
                Bu dars sanasida ro‘yxatga olingan o‘quvchilar yo‘q.
              </p>
            )}
            {data.students.map((s) => (
              <article className="attendance-student" key={s.studentId}>
                <div>
                  <Link to={`/attendance/students/${s.studentId}`}>
                    <strong>{s.name}</strong>
                  </Link>
                  <p className="muted small">
                    {s.status ? labels[s.status] : "Belgilanmagan"}
                    {s.markedAt &&
                      ` · ${new Date(s.markedAt).toLocaleString("uz-UZ", { timeZone: "Asia/Tashkent" })}`}
                  </p>
                </div>
                <div
                  className="attendance-statuses"
                  role="group"
                  aria-label={`${s.name} davomati`}
                >
                  {Object.entries(labels).map(([status, label]) => (
                    <button
                      key={status}
                      className={`button ${s.status === status ? "primary" : "light"}`}
                      aria-pressed={s.status === status}
                      disabled={readonly}
                      onClick={() =>
                        change(s.studentId, {
                          status: status as AttendanceStatus,
                        })
                      }
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <label className="attendance-note">
                  Izoh · {s.name}
                  <input
                    className="plain-input"
                    maxLength={500}
                    value={s.note}
                    disabled={readonly}
                    onChange={(e) =>
                      change(s.studentId, { note: e.target.value })
                    }
                  />
                </label>
              </article>
            ))}
          </section>
          <div className="attendance-save">
            <span role="status">
              {dirty.size
                ? "Saqlanmagan o‘zgarishlar bor"
                : "Barcha o‘zgarishlar saqlangan"}
            </span>
            <button
              className="button primary"
              disabled={
                readonly ||
                !data.students.some((s) => dirty.has(s.studentId) && s.status)
              }
              onClick={() => setConfirm("save")}
            >
              {busy ? "Saqlanmoqda…" : "Davomatni saqlash"}
            </button>
          </div>
        </>
      )}
      {confirm && (
        <dialog
          ref={dialog}
          className="member-dialog"
          aria-labelledby="attendance-confirm"
          onCancel={(e) => {
            if (busy) e.preventDefault();
            else close();
          }}
        >
          <h2 id="attendance-confirm">
            {confirm === "bulk"
              ? "Belgilanmaganlar «Keldi» deb belgilansinmi?"
              : confirm === "cancel"
                ? "Dars holati o‘zgartirilsinmi?"
                : "Davomat saqlansinmi?"}
          </h2>
          <p>
            {confirm === "bulk"
              ? "Avval belgilangan holatlar saqlanadi. So‘ng ro‘yxatni tekshirib saqlang."
              : "Tanlangan dars va belgilarni tekshiring."}
          </p>
          <div className="attendance-toolbar">
            <button className="button light" disabled={busy} onClick={close}>
              Bekor qilish
            </button>
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void act()}
            >
              {busy ? "Saqlanmoqda…" : "Tasdiqlash"}
            </button>
          </div>
        </dialog>
      )}
    </div>
  );
}
