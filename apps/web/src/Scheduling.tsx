import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  ClassroomView,
  ClassroomsView,
  GroupView,
  GroupsView,
  ScheduleView,
  SchedulesView,
} from "@softlans/contracts";
import { api } from "./api";
const days = [
  "Dushanba",
  "Seshanba",
  "Chorshanba",
  "Payshanba",
  "Juma",
  "Shanba",
  "Yakshanba",
];
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function shift(date: string, n: number) {
  const d = new Date(date + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function ErrorNote({ error }: { error: string }) {
  return error ? (
    <div className="notice" role="alert">
      {error}
    </div>
  ) : null;
}
function Heading({ title }: { title: string }) {
  return (
    <div className="page-heading">
      <div>
        <span className="form-eyebrow">TA’LIM BOSHQARUVI · ASIA/TASHKENT</span>
        <h1>{title}</h1>
      </div>
    </div>
  );
}
function Pages({
  page,
  total,
  size,
  change,
}: {
  page: number;
  total: number;
  size: number;
  change: (p: number) => void;
}) {
  return (
    <div className="group-pagination">
      <button
        className="button"
        disabled={page <= 1}
        onClick={() => change(page - 1)}
      >
        Oldingi
      </button>
      <span>
        {page} / {Math.max(1, Math.ceil(total / size))}
      </span>
      <button
        className="button"
        disabled={page * size >= total}
        onClick={() => change(page + 1)}
      >
        Keyingi
      </button>
    </div>
  );
}
async function allPages<T>(path: string, key: string): Promise<T[]> {
  const rows: T[] = [];
  let page = 1;
  for (;;) {
    const data = await api<Record<string, unknown>>(
      `${path}${path.includes("?") ? "&" : "?"}page=${page}`,
    );
    rows.push(...(data[key] as T[]));
    if (page * Number(data.pageSize) >= Number(data.total)) return rows;
    page++;
  }
}
function useOptions(manage: boolean) {
  const [groups, setGroups] = useState<GroupView[]>([]),
    [rooms, setRooms] = useState<ClassroomView[]>([]),
    [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    Promise.all([
      allPages<GroupView>("/groups", "groups"),
      manage
        ? allPages<ClassroomView>("/classrooms", "classrooms")
        : Promise.resolve([]),
      manage
        ? allPages<{ id: string; name: string }>("/groups/teachers", "teachers")
        : Promise.resolve([]),
    ])
      .then(([g, r, t]) => {
        if (active) {
          setGroups(g);
          setRooms(r);
          setTeachers(t);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [manage]);
  return { groups, rooms, teachers, error };
}
export function ScheduleList({
  manage,
  weekly = false,
  groupId,
}: {
  manage: boolean;
  weekly?: boolean;
  groupId?: string;
}) {
  const [data, setData] = useState<SchedulesView | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [date, setDate] = useState(today),
    [group, setGroup] = useState(groupId ?? ""),
    [teacher, setTeacher] = useState(""),
    [room, setRoom] = useState(""),
    [day, setDay] = useState(""),
    [status, setStatus] = useState("active");
  const options = useOptions(manage);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const q = new URLSearchParams({
      page: String(page),
      ...(weekly ? { date } : {}),
      ...(group ? { groupId: group } : {}),
      ...(teacher ? { teacherId: teacher } : {}),
      ...(room ? { classroomId: room } : {}),
      ...(day ? { dayOfWeek: day } : {}),
      ...(status ? { status } : {}),
    });
    api<SchedulesView>(`/schedules${weekly ? "/weekly" : ""}?${q}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page, version, date, group, teacher, room, day, status, weekly]);
  const filter = (set: (v: string) => void, value: string) => {
    set(value);
    setPage(1);
  };
  return (
    <>
      {!groupId && (
        <>
          <Heading title={weekly ? "Haftalik kalendar" : "Dars jadvali"} />
          <div className="schedule-actions">
            <Link
              className="button"
              to={weekly ? "/schedules" : "/schedules/weekly"}
            >
              {weekly ? "Dars jadvali" : "Haftalik kalendar"}
            </Link>
            {manage && (
              <>
                <Link className="button primary" to="/schedules/new">
                  Dars qo‘shish
                </Link>
                <Link className="button" to="/classrooms">
                  Xonalar
                </Link>
              </>
            )}
          </div>
        </>
      )}
      {groupId && <h2>Dars jadvali</h2>}
      <ErrorNote error={error || options.error} />
      {error && (
        <button className="button" onClick={() => setVersion(version + 1)}>
          Qayta urinish
        </button>
      )}
      <section className="panel schedule-panel">
        <div className="schedule-filters">
          {!groupId && (
            <label>
              Guruh
              <select
                className="plain-input"
                value={group}
                onChange={(e) => filter(setGroup, e.target.value)}
              >
                <option value="">Barcha guruhlar</option>
                {options.groups.map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {manage && (
            <>
              <label>
                O‘qituvchi
                <select
                  className="plain-input"
                  value={teacher}
                  onChange={(e) => filter(setTeacher, e.target.value)}
                >
                  <option value="">Barcha o‘qituvchilar</option>
                  {options.teachers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Xona
                <select
                  className="plain-input"
                  value={room}
                  onChange={(e) => filter(setRoom, e.target.value)}
                >
                  <option value="">Barcha xonalar</option>
                  {options.rooms.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </label>
            </>
          )}
          <label>
            Kun
            <select
              className="plain-input"
              value={day}
              onChange={(e) => filter(setDay, e.target.value)}
            >
              <option value="">Barcha kunlar</option>
              {days.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Holat
            <select
              className="plain-input"
              value={status}
              onChange={(e) => filter(setStatus, e.target.value)}
            >
              <option value="active">Faol</option>
              <option value="inactive">Nofaol</option>
            </select>
          </label>
        </div>
        {weekly && (
          <div className="schedule-actions">
            <button
              className="button"
              onClick={() => filter(setDate, shift(date, -7))}
            >
              ← Hafta
            </button>
            <button
              className="button"
              onClick={() => filter(setDate, shift(date, -1))}
            >
              ← Kun
            </button>
            <label>
              Sana
              <input
                className="plain-input"
                type="date"
                value={date}
                onChange={(e) => {
                  if (e.target.value) filter(setDate, e.target.value);
                }}
              />
            </label>
            <button
              className="button"
              onClick={() => filter(setDate, shift(date, 1))}
            >
              Kun →
            </button>
            <button
              className="button"
              onClick={() => filter(setDate, shift(date, 7))}
            >
              Hafta →
            </button>
            <button className="button" onClick={() => filter(setDate, today())}>
              Bugun
            </button>
          </div>
        )}
        {data?.weekStart && (
          <p>
            {data.weekStart} — {data.weekEnd} · Asia/Tashkent
          </p>
        )}
        {!data && !error && (
          <p role="status" className="loading-panel">
            Darslar yuklanmoqda…
          </p>
        )}
        {data && !data.total && (
          <p className="empty-state">Darslar topilmadi.</p>
        )}
        <div className={weekly ? "schedule-week" : "schedule-list"}>
          {days.map((d, i) => {
            const lessons =
              data?.schedules.filter((s) => s.dayOfWeek === i + 1) ?? [];
            return (
              (weekly || lessons.length > 0) && (
                <section className="schedule-day" key={d}>
                  <h3>{d}</h3>
                  {lessons.map((s) => (
                    <article className="lesson-block" key={s.id}>
                      <strong>
                        {s.startTime} – {s.endTime}
                      </strong>
                      <Link to={`/groups/${s.groupId}`}>{s.groupName}</Link>
                      <span>
                        {s.teacherName} · {s.classroomName}
                      </span>
                      <small>
                        {s.effectiveFrom ?? "Boshlanish cheklanmagan"} —{" "}
                        {s.effectiveUntil ?? "Tugash cheklanmagan"}
                      </small>
                      {manage && (
                        <Link to={`/schedules/${s.id}/edit`}>Tahrirlash</Link>
                      )}
                    </article>
                  ))}
                </section>
              )
            );
          })}
        </div>
        {data && (
          <Pages
            page={page}
            total={data.total}
            size={data.pageSize}
            change={setPage}
          />
        )}
      </section>
    </>
  );
}
export function ScheduleForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    navigate = useNavigate(),
    options = useOptions(true);
  const [row, setRow] = useState<ScheduleView | null>(null),
    [group, setGroup] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!edit) return;
    let active = true;
    api<{ schedule: ScheduleView }>(`/schedules/${id}`)
      .then((d) => {
        if (active) {
          setRow(d.schedule);
          setGroup(d.schedule.groupId);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [edit, id]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.currentTarget));
    const g = options.groups.find((g) => g.id === group);
    if (!g) return;
    setBusy(true);
    setError("");
    try {
      await api(edit ? `/schedules/${id}` : "/schedules", {
        method: edit ? "PATCH" : "POST",
        body: JSON.stringify({
          ...f,
          groupId: group,
          teacherId:
            row?.status === "inactive" &&
            f.status === "inactive" &&
            row.groupId === group
              ? row.teacherId
              : g.teacherId,
          dayOfWeek: Number(f.dayOfWeek),
          effectiveFrom: f.effectiveFrom || null,
          effectiveUntil: f.effectiveUntil || null,
        }),
      });
      navigate("/schedules");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={edit ? "Darsni tahrirlash" : "Dars qo‘shish"} />
      <ErrorNote error={error || options.error} />
      <Link className="button" to="/schedules">
        Dars jadvali
      </Link>
      {edit && !row ? (
        !error && <p role="status">Yuklanmoqda…</p>
      ) : (
        <form className="panel auth-form schedule-form" onSubmit={submit}>
          <label>
            Guruh
            <select
              required
              className="plain-input"
              value={group}
              onChange={(e) => setGroup(e.target.value)}
            >
              <option value="">Guruh tanlang</option>
              {options.groups
                .filter((g) => g.status === "active" || g.id === group)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.name}
                  </option>
                ))}
            </select>
          </label>
          <p>
            O‘qituvchi:{" "}
            {options.teachers.find(
              (t) =>
                t.id === options.groups.find((g) => g.id === group)?.teacherId,
            )?.name ?? "Guruh o‘qituvchisi"}
          </p>
          <label>
            Xona
            <select
              name="classroomId"
              required
              className="plain-input"
              defaultValue={row?.classroomId ?? ""}
            >
              <option value="">Xona tanlang</option>
              {options.rooms
                .filter(
                  (r) => r.status === "active" || r.id === row?.classroomId,
                )
                .map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Hafta kuni
            <select
              className="plain-input"
              name="dayOfWeek"
              defaultValue={row?.dayOfWeek ?? 1}
            >
              {days.map((d, i) => (
                <option key={d} value={i + 1}>
                  {d}
                </option>
              ))}
            </select>
          </label>
          <label>
            Boshlanish vaqti
            <input
              className="plain-input"
              name="startTime"
              type="time"
              required
              defaultValue={row?.startTime}
            />
          </label>
          <label>
            Tugash vaqti
            <input
              className="plain-input"
              name="endTime"
              type="time"
              required
              defaultValue={row?.endTime}
            />
          </label>
          <label>
            Amal qilish boshlanishi
            <input
              className="plain-input"
              name="effectiveFrom"
              type="date"
              defaultValue={row?.effectiveFrom ?? ""}
            />
          </label>
          <label>
            Amal qilish tugashi
            <input
              className="plain-input"
              name="effectiveUntil"
              type="date"
              defaultValue={row?.effectiveUntil ?? ""}
            />
          </label>
          <label>
            Holat
            <select
              className="plain-input"
              name="status"
              defaultValue={row?.status ?? "active"}
            >
              <option value="active">Faol</option>
              <option value="inactive">Nofaol</option>
            </select>
          </label>
          <ErrorNote error={error} />
          <button className="button primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
          {edit && row?.status === "active" && (
            <button
              type="button"
              className="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await api(`/schedules/${id}/deactivate`, {
                    method: "POST",
                    body: "{}",
                  });
                  navigate("/schedules");
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Darsni o‘chirish
            </button>
          )}
        </form>
      )}
    </>
  );
}
export function Classrooms() {
  const [data, setData] = useState<ClassroomsView | null>(null),
    [page, setPage] = useState(1),
    [version, setVersion] = useState(0),
    [editing, setEditing] = useState<ClassroomView | "new" | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api<ClassroomsView>(`/classrooms?page=${page}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page, version]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    const f = Object.fromEntries(new FormData(e.currentTarget));
    setBusy(true);
    setError("");
    try {
      await api(
        editing === "new" ? "/classrooms" : `/classrooms/${editing.id}`,
        {
          method: editing === "new" ? "POST" : "PATCH",
          body: JSON.stringify({
            ...f,
            capacity: f.capacity ? Number(f.capacity) : null,
          }),
        },
      );
      setEditing(null);
      setVersion(version + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const room = editing && editing !== "new" ? editing : null;
  return (
    <>
      <Heading title="Xonalar" />
      <button
        className="button primary"
        onClick={() => {
          setEditing("new");
          setError("");
        }}
      >
        Xona qo‘shish
      </button>
      <ErrorNote error={error} />
      {error && (
        <button className="button" onClick={() => setVersion(version + 1)}>
          Qayta urinish
        </button>
      )}
      {editing && (
        <form
          key={room?.id ?? "new"}
          className="panel auth-form schedule-form"
          onSubmit={submit}
        >
          <h2>{room ? "Xonani tahrirlash" : "Xona qo‘shish"}</h2>
          <label>
            Nomi
            <input
              name="name"
              className="plain-input"
              required
              maxLength={120}
              defaultValue={room?.name}
            />
          </label>
          <label>
            Sig‘im
            <input
              name="capacity"
              className="plain-input"
              type="number"
              min={1}
              max={10000}
              defaultValue={room?.capacity ?? ""}
            />
          </label>
          <label>
            Tavsif
            <textarea
              className="plain-input"
              name="description"
              maxLength={2000}
              defaultValue={room?.description}
            />
          </label>
          <label>
            Holat
            <select
              className="plain-input"
              name="status"
              defaultValue={room?.status ?? "active"}
            >
              <option value="active">Faol</option>
              <option value="inactive">Nofaol</option>
            </select>
          </label>
          <ErrorNote error={error} />
          <button className="button primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : "Saqlash"}
          </button>
          <button
            type="button"
            className="button"
            disabled={busy}
            onClick={() => setEditing(null)}
          >
            Bekor qilish
          </button>
        </form>
      )}
      <section className="panel schedule-panel">
        {!data && !error && <p role="status">Xonalar yuklanmoqda…</p>}
        {data?.classrooms.length === 0 && (
          <p className="empty-state">Xonalar hali qo‘shilmagan.</p>
        )}
        <div className="schedule-list">
          {data?.classrooms.map((r) => (
            <article className="lesson-block" key={r.id}>
              <h3>{r.name}</h3>
              <span>
                {r.status === "active" ? "Faol" : "Nofaol"} · Sig‘im:{" "}
                {r.capacity ?? "—"}
              </span>
              <p>{r.description}</p>
              <button
                className="button"
                onClick={() => {
                  setEditing(r);
                  setError("");
                }}
              >
                Tahrirlash
              </button>
            </article>
          ))}
        </div>
        {data && (
          <Pages
            page={page}
            total={data.total}
            size={data.pageSize}
            change={setPage}
          />
        )}
      </section>
    </>
  );
}
