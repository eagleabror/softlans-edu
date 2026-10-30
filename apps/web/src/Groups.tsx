import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type {
  GroupInput,
  GroupView,
  GroupsView,
  GroupMembersView,
  StudentsView,
} from "@softlans/contracts";
import { ScheduleList } from "./Scheduling";
import { api, HttpError } from "./api";
const statuses = {
  active: "Faol",
  paused: "To‘xtatilgan",
  archived: "Arxivlangan",
};
function Notice({ error }: { error: string }) {
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
        <span className="form-eyebrow">TA’LIM BOSHQARUVI</span>
        <h1>{title}</h1>
      </div>
      <Link className="button" to="/groups">
        Guruhlar ro‘yxati
      </Link>
    </div>
  );
}
function Pages({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (p: number) => void;
}) {
  return (
    <div className="group-pagination">
      <button
        className="button"
        disabled={page <= 1}
        onClick={() => onChange(page - 1)}
      >
        Oldingi
      </button>
      <span>
        {page} / {Math.max(1, Math.ceil(total / size))}
      </span>
      <button
        className="button"
        disabled={page * size >= total}
        onClick={() => onChange(page + 1)}
      >
        Keyingi
      </button>
    </div>
  );
}
export function GroupsList({ manage }: { manage: boolean }) {
  const [data, setData] = useState<GroupsView | null>(null),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const q = new URLSearchParams({
      search,
      page: String(page),
      ...(status ? { status } : {}),
    });
    api<GroupsView>(`/groups?${q}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [search, status, page, retry]);
  return (
    <>
      <Heading title="Guruhlar" />
      {manage && (
        <Link className="button primary" to="/groups/new">
          Guruh yaratish
        </Link>
      )}
      <section className="panel group-panel">
        <div className="student-filters">
          <label>
            Guruh yoki kurs
            <input
              className="plain-input"
              type="search"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
            />
          </label>
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
              {Object.entries(statuses).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </label>
        </div>
        <Notice error={error} />
        {error && (
          <button className="button" onClick={() => setRetry(retry + 1)}>
            Qayta urinish
          </button>
        )}
        {!data && !error && <p role="status">Yuklanmoqda…</p>}
        {data && (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Guruh / Kurs</th>
                    <th>Sig‘im</th>
                    <th>Oylik to‘lov</th>
                    <th>Holat</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.id}>
                      <td>
                        <Link to={`/groups/${g.id}`}>{g.name}</Link>
                        <p className="muted small">{g.courseName}</p>
                      </td>
                      <td>
                        {g.activeMemberCount} / {g.capacity}
                      </td>
                      <td>{g.monthlyFee.toLocaleString("uz-UZ")} UZS</td>
                      <td>{statuses[g.status]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.total && <p>Guruhlar topilmadi.</p>}
            <Pages
              page={page}
              total={data.total}
              size={data.pageSize}
              onChange={setPage}
            />
          </>
        )}
      </section>
    </>
  );
}
function TeacherSelector({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [search, setSearch] = useState(""),
    [page, setPage] = useState(1),
    [data, setData] = useState<{
      teachers: { id: string; name: string }[];
      total: number;
      pageSize: number;
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    api<{
      teachers: { id: string; name: string }[];
      total: number;
      pageSize: number;
    }>(
      `/groups/teachers?${new URLSearchParams({ search, page: String(page) })}`,
    )
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [search, page]);
  return (
    <div className="group-selector">
      <label>
        O‘qituvchini qidirish
        <input
          className="plain-input"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </label>
      <Notice error={error} />
      <label>
        O‘qituvchi
        <select
          className="plain-input"
          required
          value={value}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">O‘qituvchini tanlang</option>
          {value && !data?.teachers.some((t) => t.id === value) && (
            <option value={value}>Tanlangan o‘qituvchi</option>
          )}
          {data?.teachers.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {!data && !error && <p role="status">O‘qituvchilar yuklanmoqda…</p>}
      {data && (
        <>
          <p className="muted small">{data.total} ta o‘qituvchi</p>
          <Pages
            page={page}
            total={data.total}
            size={data.pageSize}
            onChange={setPage}
          />
        </>
      )}
    </div>
  );
}
export function GroupForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams(),
    navigate = useNavigate();
  const [form, setForm] = useState<GroupInput>({
      name: "",
      courseName: "",
      teacherId: "",
      capacity: 20,
      monthlyFee: 0,
      status: "active",
      startDate: new Date().toISOString().slice(0, 10),
      description: "",
    }),
    [loading, setLoading] = useState(edit),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    if (!edit) return;
    let active = true;
    api<{ group: GroupView }>(`/groups/${id}`)
      .then(({ group: g }) => {
        if (active) {
          setForm({
            name: g.name,
            courseName: g.courseName,
            teacherId: g.teacherId,
            capacity: g.capacity,
            monthlyFee: g.monthlyFee,
            status: g.status,
            startDate: g.startDate,
            description: g.description,
          });
          setLoading(false);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, edit]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { group } = await api<{ group: GroupView }>(
        edit ? `/groups/${id}` : "/groups",
        { method: edit ? "PATCH" : "POST", body: JSON.stringify(form) },
      );
      navigate(`/groups/${group.id}`);
    } catch (e) {
      setError(e instanceof HttpError ? e.message : "Saqlashda xatolik.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={edit ? "Guruhni tahrirlash" : "Guruh yaratish"} />
      <Notice error={error} />
      {loading ? (
        <p role="status">Yuklanmoqda…</p>
      ) : (
        <form className="panel group-panel group-form" onSubmit={submit}>
          <fieldset disabled={busy}>
            <div className="group-form-grid">
              {(["name", "courseName"] as const).map((key, i) => (
                <label key={key}>
                  {i ? "Kurs nomi" : "Guruh nomi"}
                  <input
                    className="plain-input"
                    required
                    maxLength={120}
                    value={form[key]}
                    onChange={(e) =>
                      setForm({ ...form, [key]: e.target.value })
                    }
                  />
                </label>
              ))}
              <label>
                Sig‘im
                <input
                  className="plain-input"
                  type="number"
                  required
                  min={1}
                  max={10000}
                  step={1}
                  value={form.capacity}
                  onChange={(e) =>
                    setForm({ ...form, capacity: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Oylik to‘lov (UZS)
                <input
                  className="plain-input"
                  type="number"
                  required
                  min={0}
                  max={Number.MAX_SAFE_INTEGER}
                  step={1}
                  value={form.monthlyFee}
                  onChange={(e) =>
                    setForm({ ...form, monthlyFee: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Boshlanish sanasi
                <input
                  className="plain-input"
                  type="date"
                  required
                  value={form.startDate}
                  onChange={(e) =>
                    setForm({ ...form, startDate: e.target.value })
                  }
                />
              </label>
              <label>
                Holat
                <select
                  className="plain-input"
                  value={form.status}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      status: e.target.value as GroupInput["status"],
                    })
                  }
                >
                  {Object.entries(statuses).map(([v, t]) => (
                    <option key={v} value={v}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <TeacherSelector
              value={form.teacherId}
              onChange={(teacherId) => setForm({ ...form, teacherId })}
            />
            <label>
              Izoh
              <textarea
                className="plain-input"
                maxLength={2000}
                value={form.description}
                onChange={(e) =>
                  setForm({ ...form, description: e.target.value })
                }
              />
            </label>
            <button className="button primary" type="submit">
              {busy ? "Saqlanmoqda…" : "Saqlash"}
            </button>
          </fieldset>
        </form>
      )}
    </>
  );
}
export function GroupDetail({ manage }: { manage: boolean }) {
  const { id } = useParams();
  const [g, setG] = useState<GroupView | null>(null),
    [members, setMembers] = useState<GroupMembersView | null>(null),
    [error, setError] = useState(""),
    [page, setPage] = useState(1),
    [status, setStatus] = useState("active"),
    [retry, setRetry] = useState(0),
    [busy, setBusy] = useState(false);
  const [search, setSearch] = useState(""),
    [studentPage, setStudentPage] = useState(1),
    [students, setStudents] = useState<StudentsView | null>(null),
    [studentId, setStudentId] = useState(""),
    [studentError, setStudentError] = useState(""),
    [enrollmentStatus, setEnrollmentStatus] = useState("active");
  useEffect(() => {
    let active = true;
    setError("");
    setG(null);
    setMembers(null);
    Promise.all([
      api<{ group: GroupView }>(`/groups/${id}`),
      api<GroupMembersView>(
        `/groups/${id}/members?page=${page}&status=${status}`,
      ),
    ])
      .then(([a, b]) => {
        if (active) {
          setG(a.group);
          setMembers(b);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, page, status, retry]);
  useEffect(() => {
    if (!manage) return;
    let active = true;
    setStudents(null);
    setStudentError("");
    setStudentId("");
    api<StudentsView>(
      `/students?${new URLSearchParams({ search, page: String(studentPage), status: enrollmentStatus })}`,
    )
      .then((d) => {
        if (active) setStudents(d);
      })
      .catch((e) => {
        if (active) setStudentError(e.message);
      });
    return () => {
      active = false;
    };
  }, [manage, search, studentPage, retry, enrollmentStatus]);
  async function action(path: string, body: object = {}) {
    setBusy(true);
    setError("");
    try {
      await api(path, { method: "POST", body: JSON.stringify(body) });
      setRetry((v) => v + 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : "So‘rov bajarilmadi.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={g?.name ?? "Guruh ma’lumotlari"} />
      <Notice error={error} />
      {error && (
        <button className="button" onClick={() => setRetry((v) => v + 1)}>
          Qayta urinish
        </button>
      )}
      {!g && !error && <p role="status">Yuklanmoqda…</p>}
      {g && (
        <>
          <section className="panel group-panel">
            <h2>{g.courseName}</h2>
            <p>
              {statuses[g.status]} · {g.startDate} ·{" "}
              {g.monthlyFee.toLocaleString("uz-UZ")} UZS / oy
            </p>
            <p>O‘qituvchi: {g.teacherName}</p>
            <ScheduleList manage={manage} groupId={g.id} />
            <p>
              Sig‘im: {g.activeMemberCount} / {g.capacity}
            </p>
            <progress
              aria-label="Guruh sig‘imi"
              max={g.capacity}
              value={g.activeMemberCount}
            />
            <p>{g.description}</p>
            {manage && (
              <div className="group-actions">
                <Link className="button" to={`/groups/${id}/edit`}>
                  Tahrirlash / O‘qituvchi tayinlash
                </Link>
                {g.status !== "archived" && (
                  <button
                    className="button"
                    disabled={busy}
                    onClick={() => {
                      if (window.confirm("Guruh arxivlansinmi?"))
                        void action(`/groups/${id}/archive`);
                    }}
                  >
                    Arxivlash
                  </button>
                )}
              </div>
            )}
          </section>
          {manage && g.status !== "archived" && (
            <section className="panel group-panel">
              <h2>O‘quvchi qo‘shish</h2>
              <label>
                O‘quvchi holati
                <select
                  className="plain-input"
                  value={enrollmentStatus}
                  onChange={(e) => {
                    setEnrollmentStatus(e.target.value);
                    setStudentPage(1);
                  }}
                >
                  <option value="active">Faol</option>
                  <option value="paused">To‘xtatilgan</option>
                </select>
              </label>
              <label>
                O‘quvchini qidirish
                <input
                  className="plain-input"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setStudentPage(1);
                  }}
                />
              </label>
              <Notice error={studentError} />
              {!students && !studentError && (
                <p role="status">O‘quvchilar yuklanmoqda…</p>
              )}
              {students && (
                <>
                  <form
                    className="group-actions"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(`/groups/${id}/members`, { studentId });
                    }}
                  >
                    <select
                      aria-label="O‘quvchi"
                      className="plain-input"
                      required
                      value={studentId}
                      onChange={(e) => setStudentId(e.target.value)}
                    >
                      <option value="">O‘quvchini tanlang</option>
                      {students.students.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.firstName} {s.lastName}
                        </option>
                      ))}
                    </select>
                    <button
                      className="button primary"
                      disabled={
                        busy || g.activeMemberCount >= g.capacity || !studentId
                      }
                    >
                      Qo‘shish
                    </button>
                  </form>
                  {!students.total && <p>Faol o‘quvchilar topilmadi.</p>}
                  <Pages
                    page={studentPage}
                    total={students.total}
                    size={students.pageSize}
                    onChange={setStudentPage}
                  />
                </>
              )}
            </section>
          )}
          <section className="panel group-panel">
            <h2>Guruh a’zolari</h2>
            {manage && (
              <label>
                A’zolik holati
                <select
                  className="plain-input"
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="active">Faol</option>
                  <option value="removed">Chiqarilganlar tarixi</option>
                </select>
              </label>
            )}
            {members && (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>O‘quvchi</th>
                        <th>Qo‘shilgan sana</th>
                        {manage && <th>Amal</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {members.members.map((m) => (
                        <tr key={m.id}>
                          <td>
                            {m.student
                              ? `${m.student.firstName} ${m.student.lastName}`
                              : "Ma’lumot mavjud emas"}
                          </td>
                          <td>{m.enrolledAt.slice(0, 10)}</td>
                          {manage && (
                            <td>
                              {m.status === "active" && (
                                <button
                                  className="button"
                                  disabled={busy}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        "O‘quvchi guruhdan chiqarilsinmi?",
                                      )
                                    )
                                      void action(
                                        `/groups/${id}/members/${m.studentId}/remove`,
                                      );
                                  }}
                                >
                                  Chiqarish
                                </button>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {!members.total && <p>Hozircha a’zolar yo‘q.</p>}
                <Pages
                  page={page}
                  total={members.total}
                  size={members.pageSize}
                  onChange={setPage}
                />
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}
