import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import { GraduationCap, Plus } from "lucide-react";
import type {
  StudentInput,
  StudentStatus,
  StudentsView,
  StudentView,
} from "@softlans/contracts";
import { api, HttpError } from "./api";

const statuses: Record<StudentStatus, string> = {
  active: "Faol",
  paused: "To‘xtatilgan",
  archived: "Arxivlangan",
};
const date = (value: string) =>
  new Intl.DateTimeFormat("uz-UZ", { timeZone: "UTC" }).format(new Date(value));
function ErrorNotice({ error }: { error: string }) {
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
        <span className="form-eyebrow">O‘QUVCHILAR BOSHQARUVI</span>
        <h1>{title}</h1>
        <p className="muted">
          Markazingiz o‘quvchilari haqida barcha ma’lumotlar.
        </p>
      </div>
      <Link className="button" to="/students">
        Ro‘yxatga qaytish
      </Link>
    </div>
  );
}
export function StudentsList() {
  const [data, setData] = useState<StudentsView | null>(null);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  const [status, setStatus] = useState("");
  const [sort, setSort] = useState("desc");
  const [page, setPage] = useState(1);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    const query = new URLSearchParams({
      page: String(page),
      search: term,
      sort,
      ...(status ? { status } : {}),
    });
    api<StudentsView>(`/students?${query}`)
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [page, term, status, sort, retry]);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="form-eyebrow">TA’LIM SIZDAN BOSHLANADI</span>
          <h1>O‘quvchilar</h1>
          <p className="muted">
            Har bir o‘quvchiga e’tibor. Barcha ma’lumotlar bir joyda.
          </p>
        </div>
        <Link to="/students/new" className="button primary">
          <Plus size={17} /> O‘quvchi qo‘shish
        </Link>
      </div>
      <section className="panel team-panel">
        <form
          className="student-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setTerm(search.trim());
            setPage(1);
          }}
        >
          <label>
            Ism yoki telefon
            <input
              className="plain-input"
              type="search"
              value={search}
              maxLength={100}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Qidirish…"
            />
          </label>
          <button className="button" type="submit">
            Qidirish
          </button>
          <label>
            Holati
            <select
              className="plain-input"
              value={status}
              onChange={(e) => {
                setStatus(e.target.value);
                setPage(1);
              }}
            >
              <option value="">Barchasi</option>
              {Object.entries(statuses).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Qabul sanasi
            <select
              className="plain-input"
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="desc">Avval yangilari</option>
              <option value="asc">Avval eskilari</option>
            </select>
          </label>
        </form>
        {error ? (
          <div className="empty-state">
            <ErrorNotice error={error} />
            <button className="button" onClick={() => setRetry(retry + 1)}>
              Qayta urinish
            </button>
          </div>
        ) : !data ? (
          <div className="loading-panel" role="status">
            O‘quvchilar yuklanmoqda…
          </div>
        ) : (
          <>
            {data.students.length ? (
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>O‘quvchi</th>
                      <th>Telefon</th>
                      <th>Qabul sanasi</th>
                      <th>Holati</th>
                      <th>Amal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.students.map((s) => (
                      <tr key={s.id}>
                        <td>
                          <Link to={`/students/${s.id}`}>
                            <strong>
                              {s.firstName} {s.lastName}
                            </strong>
                          </Link>
                        </td>
                        <td>{s.phone || "—"}</td>
                        <td>{date(s.enrollmentDate)}</td>
                        <td>
                          <span className={`status-pill student-${s.status}`}>
                            {statuses[s.status]}
                          </span>
                        </td>
                        <td>
                          <Link
                            className="text-button"
                            to={`/students/${s.id}`}
                          >
                            Profilni ko‘rish
                          </Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">
                <GraduationCap size={32} />
                <h2>
                  {term || status
                    ? "O‘quvchilar topilmadi"
                    : "Hali o‘quvchilar yo‘q"}
                </h2>
                <p>
                  {term || status
                    ? "Qidiruv yoki holat filtrini o‘zgartiring."
                    : "Birinchi o‘quvchini qo‘shib, ishni boshlang."}
                </p>
                <Link className="button primary" to="/students/new">
                  O‘quvchi qo‘shish
                </Link>
              </div>
            )}
            <nav className="student-pagination" aria-label="Sahifalash">
              <span>
                Jami: {data.total} · {page}-sahifa /{" "}
                {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <button
                className="button"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Oldingi
              </button>
              <button
                className="button"
                disabled={page * data.pageSize >= data.total}
                onClick={() => setPage(page + 1)}
              >
                Keyingi
              </button>
            </nav>
          </>
        )}
      </section>
    </>
  );
}
export function StudentDetail() {
  const { id } = useParams();
  const location = useLocation();
  const [student, setStudent] = useState<StudentView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [message, setMessage] = useState(location.state?.message ?? "");
  const [confirm, setConfirm] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    let active = true;
    setStudent(null);
    setError("");
    api<{ student: StudentView }>(`/students/${id}`)
      .then((d) => {
        if (active) setStudent(d.student);
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
    else dialog.current?.close();
  }, [confirm]);
  async function changeStatus(status: StudentStatus) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const d = await api<{ student: StudentView }>(`/students/${id}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      setStudent(d.student);
      setConfirm(false);
      setMessage("O‘quvchi holati yangilandi.");
    } catch (e) {
      setError((e as Error).message);
      setConfirm(false);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Link className="button" to={`/students/${id}/finance`}>
        Moliyaviy profil
      </Link>
      <Heading title="O‘quvchi profili" />
      <ErrorNotice error={error} />
      {error && !student && (
        <button className="button" onClick={() => setRetry(retry + 1)}>
          Qayta urinish
        </button>
      )}
      {message && (
        <div className="student-success" role="status">
          {message}
        </div>
      )}
      {!student ? (
        !error && (
          <div className="loading-panel" role="status">
            Profil yuklanmoqda…
          </div>
        )
      ) : (
        <section className="panel info-panel">
          <div className="profile-intro">
            <span className="avatar avatar-large">{student.firstName[0]}</span>
            <div>
              <h2>
                {student.firstName} {student.lastName}
              </h2>
              <span className="status-pill">{statuses[student.status]}</span>
            </div>
          </div>
          {[
            ["Telefon", student.phone],
            ["Ota-ona ismi", student.parentName],
            ["Ota-ona telefoni", student.parentPhone],
            [
              "Tug‘ilgan sana",
              student.birthDate ? date(student.birthDate) : "",
            ],
            ["Qabul sanasi", date(student.enrollmentDate)],
            ["Izoh", student.notes],
          ].map(([label, value]) => (
            <div className="info-row" key={label}>
              <span>{label}</span>
              <strong className="student-note">{value || "—"}</strong>
            </div>
          ))}
          <div className="student-actions">
            <Link className="button primary" to={`/students/${id}/edit`}>
              Tahrirlash
            </Link>
            {student.status !== "active" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => changeStatus("active")}
              >
                Faollashtirish
              </button>
            )}
            {student.status === "active" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => changeStatus("paused")}
              >
                Vaqtincha to‘xtatish
              </button>
            )}
            {student.status !== "archived" && (
              <button
                className="button"
                disabled={busy}
                onClick={() => setConfirm(true)}
              >
                Arxivlash
              </button>
            )}
          </div>
        </section>
      )}
      <dialog
        ref={dialog}
        className="member-dialog student-dialog"
        onCancel={(e) => {
          if (busy) e.preventDefault();
          else setConfirm(false);
        }}
        aria-labelledby="archive-title"
      >
        <h2 id="archive-title">O‘quvchini arxivlash</h2>
        <p>
          O‘quvchi arxivga o‘tkaziladi. Ma’lumotlari saqlanadi va keyin qayta
          faollashtirish mumkin.
        </p>
        <div className="student-actions">
          <button
            className="button"
            disabled={busy}
            onClick={() => setConfirm(false)}
          >
            Bekor qilish
          </button>
          <button
            className="button primary"
            disabled={busy}
            onClick={() => changeStatus("archived")}
          >
            {busy ? "Saqlanmoqda…" : "Arxivlashni tasdiqlash"}
          </button>
        </div>
      </dialog>
    </>
  );
}
const fields = [
  ["firstName", "Ism", "text", 100, true],
  ["lastName", "Familiya", "text", 100, true],
  ["phone", "Telefon", "tel", 32, false],
  ["parentName", "Ota-ona ismi", "text", 100, false],
  ["parentPhone", "Ota-ona telefoni", "tel", 32, false],
  ["birthDate", "Tug‘ilgan sana", "date", undefined, false],
  ["enrollmentDate", "Qabul sanasi", "date", undefined, true],
] as const;
export function StudentForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [student, setStudent] = useState<StudentView | null>(null);
  const [error, setError] = useState("");
  const [invalid, setInvalid] = useState<string[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!edit) return;
    let active = true;
    setError("");
    setStudent(null);
    api<{ student: StudentView }>(`/students/${id}`)
      .then((d) => {
        if (active) setStudent(d.student);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [id, edit, retry]);
  useEffect(() => {
    if (!busy && invalid[0])
      (
        formRef.current?.elements.namedItem(invalid[0]) as HTMLElement | null
      )?.focus();
  }, [busy, invalid]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setInvalid([]);
    const form = e.currentTarget;
    const values = Object.fromEntries(
      new FormData(form),
    ) as unknown as StudentInput;
    values.birthDate = values.birthDate || null;
    try {
      const result = await api<{ student: StudentView }>(
        edit ? `/students/${id}` : "/students",
        { method: edit ? "PATCH" : "POST", body: JSON.stringify(values) },
      );
      navigate(`/students/${result.student.id}`, {
        replace: true,
        state: {
          message: edit
            ? "O‘quvchi ma’lumotlari saqlandi."
            : "O‘quvchi qo‘shildi.",
        },
      });
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof HttpError) {
        const keys = Object.keys(e.fields ?? {});
        setInvalid(keys);
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <Heading title={edit ? "O‘quvchini tahrirlash" : "O‘quvchi qo‘shish"} />
      <ErrorNotice error={error} />
      {edit && !student ? (
        error ? (
          <button className="button" onClick={() => setRetry(retry + 1)}>
            Qayta urinish
          </button>
        ) : (
          <div className="loading-panel" role="status">
            Ma’lumotlar yuklanmoqda…
          </div>
        )
      ) : (
        <form
          ref={formRef}
          className="panel student-form"
          onSubmit={submit}
          key={id ?? "new"}
        >
          <p className="muted">
            * — majburiy maydon. Telefonni 7–15 ta raqam bilan kiriting.
          </p>
          <fieldset disabled={busy}>
            <div className="student-form-grid">
              {fields.map(([key, label, type, maxLength, required]) => (
                <div key={key}>
                  <label htmlFor={`student-${key}`}>
                    {label}
                    {required ? " *" : ""}
                  </label>
                  <input
                    className="plain-input"
                    id={`student-${key}`}
                    name={key}
                    type={type}
                    required={required}
                    maxLength={maxLength}
                    min={type === "date" ? "1900-01-01" : undefined}
                    max={
                      type === "date"
                        ? new Date().toISOString().slice(0, 10)
                        : undefined
                    }
                    defaultValue={
                      student?.[key] ??
                      (key === "enrollmentDate"
                        ? new Date().toISOString().slice(0, 10)
                        : "")
                    }
                    aria-invalid={invalid.includes(key)}
                    aria-describedby={
                      invalid.includes(key) ? `${key}-error` : undefined
                    }
                  />
                  {invalid.includes(key) && (
                    <span className="student-field-error" id={`${key}-error`}>
                      Bu maydonni tekshiring.
                    </span>
                  )}
                </div>
              ))}
            </div>
            <label htmlFor="student-notes">Izoh</label>
            <textarea
              className="plain-input"
              id="student-notes"
              name="notes"
              maxLength={2000}
              rows={4}
              defaultValue={student?.notes ?? ""}
              aria-invalid={invalid.includes("notes")}
            />
            <div className="student-actions">
              <button className="button primary" disabled={busy}>
                {busy ? "Saqlanmoqda…" : "Saqlash"}
              </button>
              <Link
                className="button"
                to={edit ? `/students/${id}` : "/students"}
              >
                Bekor qilish
              </Link>
            </div>
          </fieldset>
        </form>
      )}
    </>
  );
}
