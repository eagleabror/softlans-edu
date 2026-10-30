import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Link, NavLink, useNavigate, useParams } from "react-router-dom";
import type { LeadStatistics } from "@softlans/contracts";
import { api, HttpError } from "./api";
export const labels: Record<string, string> = {
  new: "Yangi murojaat",
  contacted: "Bog‘lanildi",
  trial_scheduled: "Sinov darsi belgilandi",
  trial_completed: "Sinov darsi o‘tkazildi",
  converted: "O‘quvchiga aylantirildi",
  lost: "Rad etildi",
};
const sourceLabels: Record<string, string> = {
  instagram: "Instagram",
  telegram: "Telegram",
  website: "Veb-sayt",
  referral: "Tavsiya",
  walk_in: "Tashrif",
  phone: "Telefon",
  other: "Boshqa",
};
const transitions: Record<string, string[]> = {
  new: ["contacted", "lost"],
  contacted: ["trial_scheduled", "lost"],
  trial_scheduled: ["contacted", "trial_completed", "lost"],
  trial_completed: ["trial_scheduled", "lost"],
  converted: [],
  lost: ["new"],
};
type Lead = {
  id: string;
  fullName: string;
  phone: string;
  parentName?: string;
  parentPhone?: string;
  interestedCourse: string;
  source: string;
  status: string;
  assignedTo?: string;
  notes?: string;
  nextFollowUpAt?: string;
  archivedAt?: string;
  convertedStudentId?: string;
};
type Choice = { id: string; name: string };
type Trial = {
  id: string;
  leadId: string;
  groupId?: string;
  teacherId?: string;
  trialDate: string;
  startTime: string;
  endTime: string;
  result: string;
  notes?: string;
};
type Task = {
  id: string;
  leadId: string;
  assignedTo: string;
  title: string;
  dueAt: string;
  note?: string;
  status: string;
};
type History = {
  id: string;
  action: string;
  createdAt: string;
  fromStatus?: string;
  toStatus?: string;
  reason?: string;
};
type List<T> = { items: T[]; total: number };
function useData<T>(path: string) {
  const [data, setData] = useState<T>();
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    setData(undefined);
    setError("");
    api<T>(path)
      .then((d) => {
        if (live) setData(d);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [path, version]);
  return { data, error, reload: () => setVersion((v) => v + 1) };
}
function State({
  error,
  loading,
  retry,
}: {
  error: string;
  loading: boolean;
  retry: () => void;
}) {
  return error ? (
    <div className="notice" role="alert">
      {error}{" "}
      <button className="button light" onClick={retry}>
        Qayta urinish
      </button>
    </div>
  ) : loading ? (
    <div className="crm-loading panel" role="status">
      Yuklanmoqda…
      <div aria-hidden="true" className="crm-skeleton" />
    </div>
  ) : null;
}
function Heading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="crm-eyebrow">MIJOZLAR BILAN ISHLASH</span>
        <h1>{title}</h1>
        <p>Har bir murojaatdan yangi imkoniyat sari.</p>
      </div>
      {children}
    </div>
  );
}
function Nav() {
  return (
    <nav className="crm-nav" aria-label="CRM bo‘limlari">
      <NavLink end to="/leads">
        Leadlar
      </NavLink>
      <NavLink end to="/leads/pipeline">
        Sotuv voronkasi
      </NavLink>
      <NavLink end to="/trial-lessons">
        Sinov darslari
      </NavLink>
      <NavLink end to="/follow-ups">
        Qayta bog‘lanish
      </NavLink>
      <NavLink end to="/leads/analytics">
        Analitika
      </NavLink>
    </nav>
  );
}
function Options({ items }: { items: Record<string, string> }) {
  return (
    <>
      {Object.entries(items).map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </>
  );
}
function StaffSelect({
  value,
  onChange,
  staff,
  label = "Mas’ul xodim",
  optional = true,
}: {
  value: string;
  onChange: (v: string) => void;
  staff: Choice[];
  label?: string;
  optional?: boolean;
}) {
  return (
    <label>
      {label}
      <select
        className="plain-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        required={!optional}
      >
        <option value="">{optional ? "Tanlanmagan" : "Tanlang"}</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
    </label>
  );
}
function Pagination({
  page,
  total,
  setPage,
}: {
  page: number;
  total: number;
  setPage: (p: number) => void;
}) {
  return (
    <div className="crm-toolbar">
      <span>
        {total} ta yozuv · {page}-sahifa
      </span>
      <button
        className="button light"
        disabled={page === 1}
        onClick={() => setPage(page - 1)}
      >
        Oldingi
      </button>
      <button
        className="button light"
        disabled={page * 20 >= total}
        onClick={() => setPage(page + 1)}
      >
        Keyingi
      </button>
    </div>
  );
}
export function LeadsList({ pipeline = false }: { pipeline?: boolean }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [source, setSource] = useState("");
  const [assigned, setAssigned] = useState("");
  const [archived, setArchived] = useState(false);
  const [page, setPage] = useState(1);
  const [sort, setSort] = useState("desc");
  const params = new URLSearchParams({
    page: String(page),
    search,
    sort,
    archived: String(archived),
  });
  if (status) params.set("status", status);
  if (source) params.set("source", source);
  if (assigned) params.set("assignedTo", assigned);
  const list = useData<List<Lead>>("/leads?" + params);
  const staff = useData<{ staff: Choice[] }>("/leads/staff");
  const filter = (set: (v: string) => void) => (v: string) => {
    set(v);
    setPage(1);
  };
  return (
    <>
      <Heading title={pipeline ? "Sotuv voronkasi" : "Leadlar"}>
        <Link className="button primary" to="/leads/new">
          Lead qo‘shish
        </Link>
      </Heading>
      <Nav />
      <div className="panel crm-toolbar">
        <label>
          Qidiruv
          <input
            className="plain-input"
            value={search}
            onChange={(e) => filter(setSearch)(e.target.value)}
            placeholder="Ism yoki telefon"
          />
        </label>
        <label>
          Status
          <select
            className="plain-input"
            value={status}
            onChange={(e) => filter(setStatus)(e.target.value)}
          >
            <option value="">Barchasi</option>
            <Options items={labels} />
          </select>
        </label>
        <label>
          Manba
          <select
            className="plain-input"
            value={source}
            onChange={(e) => filter(setSource)(e.target.value)}
          >
            <option value="">Barchasi</option>
            <Options items={sourceLabels} />
          </select>
        </label>
        <StaffSelect
          value={assigned}
          onChange={filter(setAssigned)}
          staff={staff.data?.staff ?? []}
        />
        <label>
          Tartib
          <select
            className="plain-input"
            value={sort}
            onChange={(e) => filter(setSort)(e.target.value)}
          >
            <option value="desc">Avval yangilari</option>
            <option value="asc">Avval eskilari</option>
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={archived}
            onChange={(e) => {
              setArchived(e.target.checked);
              setPage(1);
            }}
          />{" "}
          Arxiv
        </label>
      </div>
      <State
        error={list.error || staff.error}
        loading={!list.data}
        retry={() => {
          list.reload();
          staff.reload();
        }}
      />
      {list.data && (
        <>
          <p>
            {pipeline
              ? "Joriy sahifadagi leadlar bosqichlar bo‘yicha ko‘rsatiladi. Statusni lead profilida o‘zgartiring."
              : ""}
          </p>
          {!list.data.items.length ? (
            <div className="panel">
              Leadlar topilmadi. Filtrlarni o‘zgartiring yoki yangi lead
              qo‘shing.
            </div>
          ) : pipeline ? (
            <div className="crm-kanban">
              {Object.entries(labels).map(([s, l]) => (
                <section className="crm-column" key={s}>
                  <h2>{l}</h2>
                  {list
                    .data!.items.filter((i) => i.status === s)
                    .map((i) => (
                      <article className="panel" key={i.id}>
                        <Link to={`/leads/${i.id}`}>
                          <strong>{i.fullName}</strong>
                        </Link>
                        <p>{i.interestedCourse}</p>
                        <p>{i.phone || "Telefon kiritilmagan"}</p>
                        <small>{sourceLabels[i.source]}</small>
                      </article>
                    ))}
                </section>
              ))}
            </div>
          ) : (
            <div
              className="panel table-scroll crm-table"
              tabIndex={0}
              aria-label="Leadlar jadvali"
            >
              <table>
                <caption className="sr-only">Leadlar ro‘yxati</caption>
                <thead>
                  <tr>
                    {[
                      "Mijoz",
                      "Telefon",
                      "Kurs",
                      "Status",
                      "Manba",
                      "Mas’ul",
                    ].map((t) => (
                      <th scope="col" key={t}>
                        {t}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {list.data.items.map((i) => (
                    <tr key={i.id}>
                      <td>
                        <Link to={`/leads/${i.id}`}>{i.fullName}</Link>
                      </td>
                      <td>{i.phone || "—"}</td>
                      <td>{i.interestedCourse}</td>
                      <td>
                        <span className="status-badge">{labels[i.status]}</span>
                      </td>
                      <td>{sourceLabels[i.source]}</td>
                      <td>
                        {staff.data?.staff.find((s) => s.id === i.assignedTo)
                          ?.name || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <Pagination page={page} total={list.data.total} setPage={setPage} />
        </>
      )}
    </>
  );
}
const emptyLead = {
  fullName: "",
  phone: "",
  parentName: "",
  parentPhone: "",
  interestedCourse: "",
  source: "other",
  assignedTo: "",
  notes: "",
  nextFollowUpAt: "",
};
export function LeadForm({ edit = false }: { edit?: boolean }) {
  const { id } = useParams();
  const navigate = useNavigate();
  const [form, setForm] = useState(emptyLead);
  const [loaded, setLoaded] = useState(!edit);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [retry, setRetry] = useState(0);
  const staff = useData<{ staff: Choice[] }>("/leads/staff");
  useEffect(() => {
    let live = true;
    if (edit)
      api<{ lead: Lead }>(`/leads/${id}`)
        .then(({ lead: l }) => {
          if (!live) return;
          setForm({
            ...emptyLead,
            ...l,
            assignedTo: l.assignedTo ?? "",
            nextFollowUpAt: l.nextFollowUpAt ? toLocal(l.nextFollowUpAt) : "",
          });
          setLoaded(true);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [edit, id, retry]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setFields({});
    try {
      const payload: Record<string, unknown> = Object.fromEntries(
        Object.keys(emptyLead).map((k) => [k, form[k as keyof typeof form]]),
      );
      payload.assignedTo = form.assignedTo || null;
      payload.nextFollowUpAt = form.nextFollowUpAt
        ? new Date(form.nextFollowUpAt + ":00+05:00").toISOString()
        : null;
      const { lead } = await api<{ lead: Lead }>(
        edit ? `/leads/${id}` : "/leads",
        { method: edit ? "PATCH" : "POST", body: JSON.stringify(payload) },
      );
      navigate(`/leads/${lead.id}`);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof HttpError && e.fields) {
        setFields(e.fields);
        const key = Object.keys(e.fields)[0];
        document.getElementById(`lead-${key}`)?.focus();
      }
    } finally {
      setBusy(false);
    }
  }
  const field = (
    key: keyof typeof emptyLead,
    label: string,
    type = "text",
    required = false,
    maxLength = 200,
  ) => (
    <label>
      {label}
      <input
        id={`lead-${key}`}
        aria-invalid={!!fields[key]}
        aria-describedby={fields[key] ? `lead-${key}-error` : undefined}
        className="plain-input"
        type={type}
        value={form[key]}
        required={required}
        maxLength={maxLength}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
      />
      {fields[key] && (
        <span id={`lead-${key}-error`}>{fields[key]?.join(" ")}</span>
      )}
    </label>
  );
  return (
    <>
      <Heading title={edit ? "Leadni tahrirlash" : "Yangi lead"} />
      <Nav />
      {error && (
        <p role="alert" className="notice">
          {error}
          {!loaded && (
            <button
              className="button light"
              onClick={() => {
                setError("");
                setRetry((v) => v + 1);
              }}
            >
              Qayta urinish
            </button>
          )}
        </p>
      )}
      <State error={staff.error} loading={!staff.data} retry={staff.reload} />
      {!loaded ? (
        <p role="status">Yuklanmoqda…</p>
      ) : (
        <form className="panel crm-form" onSubmit={submit}>
          {field("fullName", "To‘liq ism", "text", true)}
          {field("phone", "Telefon", "tel", false, 32)}
          {field("parentName", "Ota-ona ismi", "text", false, 100)}
          {field("parentPhone", "Ota-ona telefoni", "tel", false, 32)}
          {field("interestedCourse", "Qiziqayotgan kurs", "text", true, 160)}
          <label>
            Manba
            <select
              className="plain-input"
              value={form.source}
              onChange={(e) => setForm({ ...form, source: e.target.value })}
            >
              <Options items={sourceLabels} />
            </select>
          </label>
          <StaffSelect
            value={form.assignedTo}
            onChange={(v) => setForm({ ...form, assignedTo: v })}
            staff={staff.data?.staff ?? []}
          />
          {field(
            "nextFollowUpAt",
            "Keyingi bog‘lanish (Toshkent)",
            "datetime-local",
          )}
          <label className="crm-wide">
            Izoh
            <textarea
              className="plain-input"
              value={form.notes}
              maxLength={2000}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="crm-toolbar crm-wide">
            <button className="button primary" disabled={busy || !!staff.error}>
              {busy ? "Saqlanmoqda…" : "Saqlash"}
            </button>
            <Link
              className="button light"
              to={edit ? `/leads/${id}` : "/leads"}
            >
              Bekor qilish
            </Link>
          </div>
        </form>
      )}
    </>
  );
}
const toLocal = (v: string) =>
  new Date(new Date(v).getTime() + 5 * 3600000).toISOString().slice(0, 16);
const dateTime = (v: string) =>
  new Intl.DateTimeFormat("uz-UZ", {
    timeZone: "Asia/Tashkent",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(v));
const actionLabels: Record<string, string> = {
  created: "Lead yaratildi",
  edit: "Ma’lumotlar tahrirlandi",
  status: "Status o‘zgartirildi",
  assign: "Mas’ul biriktirildi",
  archive: "Arxivlandi",
  converted: "O‘quvchiga aylantirildi",
  trial_created: "Sinov darsi yaratildi",
  trial_updated: "Sinov darsi yangilandi",
  follow_up_created: "Qayta bog‘lanish vazifasi yaratildi",
  follow_up_completed: "Vazifa bajarildi",
  follow_up_cancelled: "Vazifa bekor qilindi",
};
export function LeadDetail() {
  const { id } = useParams();
  const lead = useData<{ lead: Lead }>(`/leads/${id}`);
  const [page, setPage] = useState(1);
  const history = useData<List<History>>(`/leads/${id}/history?page=${page}`);
  const dup = useData<{
    leads: Lead[];
    students: {
      id: string;
      firstName: string;
      lastName: string;
      phone?: string;
    }[];
  }>(`/leads/${id}/duplicates`);
  const staff = useData<{ staff: Choice[] }>("/leads/staff");
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("");
  const [assigned, setAssigned] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [archive, setArchive] = useState(false);
  const [convert, setConvert] = useState(false);
  async function mutate(path: string, body: object) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(`/leads/${id}${path}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      setSuccess("O‘zgarish saqlandi.");
      lead.reload();
      history.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const l = lead.data?.lead;
  return (
    <>
      <Heading title={l?.fullName ?? "Lead profili"} />
      <Nav />
      <State error={lead.error} loading={!l} retry={lead.reload} />
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success-note" role="status">
          {success}
        </p>
      )}
      {l && (
        <>
          <div className="panel crm-profile">
            <h2>
              {labels[l.status]} {l.archivedAt && "· Arxiv"}
            </h2>
            <dl>
              {[
                ["Telefon", l.phone || "Kiritilmagan"],
                ["Ota-ona", l.parentName],
                ["Ota-ona telefoni", l.parentPhone],
                ["Kurs", l.interestedCourse],
                ["Manba", sourceLabels[l.source]],
                ["Izoh", l.notes],
                [
                  "Keyingi bog‘lanish",
                  l.nextFollowUpAt ? dateTime(l.nextFollowUpAt) : "—",
                ],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt>{k}</dt>
                  <dd>{v || "—"}</dd>
                </div>
              ))}
            </dl>
            {l.convertedStudentId && (
              <Link to={`/students/${l.convertedStudentId}`}>
                O‘quvchi profilini ochish
              </Link>
            )}
            {!l.archivedAt && (
              <div className="crm-toolbar">
                {l.status !== "converted" && (
                  <>
                    <Link className="button light" to={`/leads/${id}/edit`}>
                      Tahrirlash
                    </Link>
                    {["contacted", "trial_completed"].includes(l.status) && (
                      <button
                        className="button primary"
                        onClick={() => setConvert((v) => !v)}
                      >
                        O‘quvchiga aylantirish
                      </button>
                    )}
                  </>
                )}
                <button
                  className="button light"
                  onClick={() => setArchive(true)}
                >
                  Arxivlash
                </button>
              </div>
            )}
            {archive && (
              <div className="notice">
                <p>{l.fullName} leadini arxivlashni tasdiqlaysizmi?</p>
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => {
                    void mutate("/archive", {});
                    setArchive(false);
                  }}
                >
                  Arxivlashni tasdiqlash
                </button>
                <button
                  className="button light"
                  onClick={() => setArchive(false)}
                >
                  Bekor qilish
                </button>
              </div>
            )}
          </div>
          <State error={dup.error} loading={!dup.data} retry={dup.reload} />
          {dup.data &&
            (dup.data.leads.length > 0 || dup.data.students.length > 0) && (
              <div className="notice">
                <h2>Telefon bo‘yicha ehtimoliy dublikatlar</h2>
                {dup.data.leads.map((d) => (
                  <p key={d.id}>
                    <Link to={`/leads/${d.id}`}>{d.fullName}</Link>
                  </p>
                ))}
                {dup.data.students.map((s) => (
                  <p key={s.id}>
                    <Link to={`/students/${s.id}`}>
                      {s.firstName} {s.lastName}
                    </Link>
                  </p>
                ))}
                <p>Yozuvlar avtomatik birlashtirilmaydi.</p>
              </div>
            )}
          {!l.archivedAt && l.status !== "converted" && (
            <div className="panel crm-form">
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate("/status", {
                    status,
                    ...(status === "lost" ? { reason } : {}),
                  });
                }}
              >
                <h2>Statusni o‘zgartirish</h2>
                <label>
                  Yangi status
                  <select
                    className="plain-input"
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    required
                  >
                    <option value="">Tanlang</option>
                    {(transitions[l.status] ?? []).map((s) => (
                      <option key={s} value={s}>
                        {labels[s]}
                      </option>
                    ))}
                  </select>
                </label>
                {status === "lost" && (
                  <label>
                    Rad etish sababi
                    <textarea
                      className="plain-input"
                      value={reason}
                      onChange={(e) => setReason(e.target.value)}
                      required
                      maxLength={1000}
                    />
                  </label>
                )}
                <button className="button primary" disabled={busy}>
                  Statusni saqlash
                </button>
              </form>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void mutate("/assign", { assignedTo: assigned || null });
                }}
              >
                <h2>Mas’ul xodim</h2>
                <p>
                  Hozir:{" "}
                  {staff.data?.staff.find((s) => s.id === l.assignedTo)?.name ||
                    "Biriktirilmagan"}
                </p>
                <StaffSelect
                  value={assigned}
                  onChange={setAssigned}
                  staff={staff.data?.staff ?? []}
                />
                <button className="button light" disabled={busy || !staff.data}>
                  Biriktirish
                </button>
              </form>
            </div>
          )}
          {convert && (
            <ConvertLead
              lead={l}
              onDone={() => {
                setConvert(false);
                lead.reload();
                history.reload();
                dup.reload();
              }}
            />
          )}
          <TrialLessons leadId={l.id} />
          <FollowUps leadId={l.id} />
          <section className="panel">
            <h2>Lead tarixi</h2>
            <State
              error={history.error}
              loading={!history.data}
              retry={history.reload}
            />
            {history.data?.items.map((h) => (
              <article className="crm-history" key={h.id}>
                <strong>{actionLabels[h.action] ?? h.action}</strong>
                <p>
                  {h.fromStatus && labels[h.fromStatus]}
                  {h.toStatus && ` → ${labels[h.toStatus]}`}
                </p>
                {h.reason && <p>{h.reason}</p>}
                <time>{dateTime(h.createdAt)}</time>
              </article>
            ))}
            {history.data && (
              <Pagination
                page={page}
                total={history.data.total}
                setPage={setPage}
              />
            )}
          </section>
        </>
      )}
    </>
  );
}
function ConvertLead({ lead, onDone }: { lead: Lead; onDone: () => void }) {
  const [search, setSearch] = useState(lead.phone);
  const existing = useData<{
    students: {
      id: string;
      firstName: string;
      lastName: string;
      phone?: string;
    }[];
  }>("/students?" + new URLSearchParams({ search, pageSize: "20" }));
  const [studentId, setStudentId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api(`/leads/${lead.id}/convert`, {
        method: "POST",
        body: JSON.stringify({
          confirmed,
          ...(studentId
            ? { existingStudentId: studentId }
            : {
                student: {
                  firstName,
                  lastName,
                  phone: lead.phone,
                  parentName: lead.parentName,
                  parentPhone: lead.parentPhone,
                  notes: lead.notes,
                },
              }),
        }),
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>O‘quvchiga aylantirish</h2>
      <p>
        Avval dublikatlarni tekshiring. Guruh va to‘lovlar alohida boshqariladi.
      </p>
      <form className="crm-form" onSubmit={submit}>
        <label>
          Mavjud o‘quvchilarni qidirish
          <input
            className="plain-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label>
          O‘quvchini tanlash
          <select
            className="plain-input"
            value={studentId}
            onChange={(e) => setStudentId(e.target.value)}
          >
            <option value="">Yangi o‘quvchi yaratish</option>
            {existing.data?.students.map((s) => (
              <option value={s.id} key={s.id}>
                {s.firstName} {s.lastName} · {s.phone}
              </option>
            ))}
          </select>
        </label>
        {!studentId && (
          <>
            <label>
              Ism
              <input
                className="plain-input"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
            <label>
              Familiya
              <input
                className="plain-input"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                required
                maxLength={100}
              />
            </label>
          </>
        )}
        <label className="crm-wide">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            required
          />{" "}
          {studentId
            ? "Tanlangan mavjud o‘quvchiga bog‘lashni"
            : "Yangi o‘quvchi yaratishni"}{" "}
          tasdiqlayman.
        </label>
        {(error || existing.error) && (
          <p className="notice crm-wide" role="alert">
            {error || existing.error}
          </p>
        )}
        <button
          className="button primary"
          disabled={busy || !confirmed || !existing.data}
        >
          {busy ? "Konvertatsiya qilinmoqda…" : "Konvertatsiyani tasdiqlash"}
        </button>
      </form>
    </section>
  );
}
function LeadPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [search, setSearch] = useState("");
  const list = useData<List<Lead>>("/leads?" + new URLSearchParams({ search }));
  return (
    <>
      <label>
        Leadni qidirish
        <input
          className="plain-input"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </label>
      <label>
        Lead
        <select
          className="plain-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          required
        >
          <option value="">Tanlang</option>
          {list.data?.items.map((l) => (
            <option key={l.id} value={l.id}>
              {l.fullName} · {l.phone}
            </option>
          ))}
        </select>
      </label>
      <State error={list.error} loading={!list.data} retry={list.reload} />
    </>
  );
}
export function TrialLessons({ leadId }: { leadId?: string }) {
  const [page, setPage] = useState(1);
  const [date, setDate] = useState("");
  const [teacher, setTeacher] = useState("");
  const [form, setForm] = useState({
    leadId: leadId ?? "",
    groupId: "",
    teacherId: "",
    trialDate: "",
    startTime: "09:00",
    endTime: "10:00",
    result: "pending",
    notes: "",
  });
  const [edit, setEdit] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const resources = useData<{ groups: Choice[]; teachers: Choice[] }>(
    "/leads/resources",
  );
  const params = new URLSearchParams({ page: String(page), sort: "asc" });
  if (leadId) params.set("leadId", leadId);
  if (date) params.set("date", date);
  if (teacher) params.set("assignedTo", teacher);
  const list = useData<List<Trial>>("/trial-lessons?" + params);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(edit ? `/trial-lessons/${edit}` : "/trial-lessons", {
        method: edit ? "PATCH" : "POST",
        body: JSON.stringify({
          ...form,
          groupId: form.groupId || null,
          teacherId: form.teacherId || null,
        }),
      });
      setShow(false);
      setEdit("");
      list.reload();
      setSuccess("Sinov darsi saqlandi.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      {!leadId && (
        <>
          <Heading title="Sinov darslari" />
          <Nav />
        </>
      )}
      <div className="section-heading">
        <h2>Sinov darslari · Toshkent vaqti</h2>
        <button
          className="button primary"
          onClick={() => {
            setForm({
              leadId: leadId ?? "",
              groupId: "",
              teacherId: "",
              trialDate: "",
              startTime: "09:00",
              endTime: "10:00",
              result: "pending",
              notes: "",
            });
            setEdit("");
            setShow(true);
          }}
        >
          Sinov darsi qo‘shish
        </button>
      </div>
      <p>Sinov darslari davomat yoki to‘lov hisobini yaratmaydi.</p>
      <div className="crm-toolbar">
        <label>
          Sana
          <input
            className="plain-input"
            type="date"
            value={date}
            onChange={(e) => {
              setDate(e.target.value);
              setPage(1);
            }}
          />
        </label>
        <StaffSelect
          label="O‘qituvchi filtri"
          value={teacher}
          onChange={(v) => {
            setTeacher(v);
            setPage(1);
          }}
          staff={resources.data?.teachers ?? []}
        />
      </div>
      {success && (
        <p role="status" className="success-note">
          {success}
        </p>
      )}
      {error && (
        <p role="alert" className="notice">
          {error}
        </p>
      )}
      {show && (
        <form className="crm-form" onSubmit={submit}>
          {!leadId && (
            <LeadPicker
              value={form.leadId}
              onChange={(v) => setForm({ ...form, leadId: v })}
            />
          )}
          <StaffSelect
            label="Guruh (ixtiyoriy)"
            value={form.groupId}
            onChange={(v) => setForm({ ...form, groupId: v })}
            staff={resources.data?.groups ?? []}
          />
          <StaffSelect
            label="O‘qituvchi (ixtiyoriy)"
            value={form.teacherId}
            onChange={(v) => setForm({ ...form, teacherId: v })}
            staff={resources.data?.teachers ?? []}
          />
          {(
            [
              ["trialDate", "Sinov sanasi", "date"],
              ["startTime", "Boshlanish", "time"],
              ["endTime", "Tugash", "time"],
            ] as const
          ).map(([k, l, t]) => (
            <label key={k}>
              {l}
              <input
                className="plain-input"
                required
                type={t}
                value={form[k]}
                onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              />
            </label>
          ))}
          <label>
            Natija
            <select
              className="plain-input"
              value={form.result}
              onChange={(e) => setForm({ ...form, result: e.target.value })}
            >
              <Options
                items={{
                  pending: "Kutilmoqda",
                  attended: "Qatnashdi",
                  absent: "Kelmadi",
                  cancelled: "Bekor qilindi",
                }}
              />
            </select>
          </label>
          <label>
            Izoh
            <textarea
              className="plain-input"
              maxLength={2000}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="crm-toolbar crm-wide">
            <button
              className="button primary"
              disabled={busy || !resources.data}
            >
              {busy ? "Saqlanmoqda…" : "Sinovni saqlash"}
            </button>
            <button
              type="button"
              className="button light"
              disabled={busy}
              onClick={() => setShow(false)}
            >
              Bekor qilish
            </button>
          </div>
        </form>
      )}
      <State
        error={list.error || resources.error}
        loading={!list.data}
        retry={() => {
          list.reload();
          resources.reload();
        }}
      />
      {list.data?.items.map((t) => (
        <article className="crm-history" key={t.id}>
          <Link to={`/leads/${t.leadId}`}>Lead profili</Link>
          <p>
            {t.trialDate} · {t.startTime}–{t.endTime} ·{" "}
            {
              (
                {
                  pending: "Kutilmoqda",
                  attended: "Qatnashdi",
                  absent: "Kelmadi",
                  cancelled: "Bekor qilindi",
                } as Record<string, string>
              )[t.result]
            }
          </p>
          <p>{t.notes}</p>
          <button
            className="button light"
            onClick={() => {
              setForm({
                leadId: t.leadId,
                groupId: t.groupId ?? "",
                teacherId: t.teacherId ?? "",
                trialDate: t.trialDate,
                startTime: t.startTime,
                endTime: t.endTime,
                result: t.result,
                notes: t.notes ?? "",
              });
              setEdit(t.id);
              setShow(true);
            }}
          >
            Ko‘chirish / natija / bekor qilish
          </button>
        </article>
      ))}
      {list.data && !list.data.items.length && <p>Sinov darslari topilmadi.</p>}
      {list.data && (
        <Pagination page={page} total={list.data.total} setPage={setPage} />
      )}
    </section>
  );
}
export function FollowUps({ leadId }: { leadId?: string }) {
  const [page, setPage] = useState(1);
  const [bucket, setBucket] = useState("");
  const [assigned, setAssigned] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState({
    leadId: leadId ?? "",
    assignedTo: "",
    dueAt: "",
    title: "",
    note: "",
  });
  const staff = useData<{ staff: Choice[] }>("/leads/staff");
  const params = new URLSearchParams({ page: String(page), sort: "asc" });
  if (leadId) params.set("leadId", leadId);
  if (bucket) params.set("bucket", bucket);
  if (assigned) params.set("assignedTo", assigned);
  const list = useData<List<Task>>("/follow-ups?" + params);
  async function write(path: string, body: object, method: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await api(path, { method, body: JSON.stringify(body) });
      setSuccess("Vazifa saqlandi.");
      setShow(false);
      list.reload();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      {!leadId && (
        <>
          <Heading title="Qayta bog‘lanish" />
          <Nav />
        </>
      )}
      <div className="section-heading">
        <h2>Qayta bog‘lanish vazifalari</h2>
        <button className="button primary" onClick={() => setShow(true)}>
          Vazifa qo‘shish
        </button>
      </div>
      <div className="crm-toolbar">
        <label>
          Muddat
          <select
            className="plain-input"
            value={bucket}
            onChange={(e) => {
              setBucket(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Barcha tarix</option>
            <option value="today">Bugungi</option>
            <option value="overdue">Muddati o‘tgan</option>
            <option value="upcoming">Kelgusi kunlar</option>
          </select>
        </label>
        <StaffSelect
          label="Mas’ul filtri"
          value={assigned}
          onChange={(v) => {
            setAssigned(v);
            setPage(1);
          }}
          staff={staff.data?.staff ?? []}
        />
      </div>
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      {success && (
        <p className="success-note" role="status">
          {success}
        </p>
      )}
      {show && (
        <form
          className="crm-form"
          onSubmit={(e) => {
            e.preventDefault();
            void write(
              "/follow-ups",
              {
                ...form,
                dueAt: new Date(form.dueAt + ":00+05:00").toISOString(),
              },
              "POST",
            );
          }}
        >
          {!leadId && (
            <LeadPicker
              value={form.leadId}
              onChange={(v) => setForm({ ...form, leadId: v })}
            />
          )}
          <StaffSelect
            value={form.assignedTo}
            onChange={(v) => setForm({ ...form, assignedTo: v })}
            staff={staff.data?.staff ?? []}
            optional={false}
          />
          <label>
            Muddat (Toshkent)
            <input
              className="plain-input"
              type="datetime-local"
              required
              value={form.dueAt}
              onChange={(e) => setForm({ ...form, dueAt: e.target.value })}
            />
          </label>
          <label>
            Vazifa nomi
            <input
              className="plain-input"
              required
              maxLength={200}
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
            />
          </label>
          <label>
            Izoh
            <textarea
              className="plain-input"
              maxLength={2000}
              value={form.note}
              onChange={(e) => setForm({ ...form, note: e.target.value })}
            />
          </label>
          <div className="crm-toolbar crm-wide">
            <button className="button primary" disabled={busy || !staff.data}>
              {busy ? "Saqlanmoqda…" : "Vazifani saqlash"}
            </button>
            <button
              className="button light"
              type="button"
              disabled={busy}
              onClick={() => setShow(false)}
            >
              Bekor qilish
            </button>
          </div>
        </form>
      )}
      <State
        error={list.error || staff.error}
        loading={!list.data}
        retry={() => {
          list.reload();
          staff.reload();
        }}
      />
      {list.data?.items.map((t) => (
        <article className="crm-history" key={t.id}>
          <strong>{t.title}</strong>
          <p>
            {dateTime(t.dueAt)} ·{" "}
            {staff.data?.staff.find((s) => s.id === t.assignedTo)?.name ?? "—"}{" "}
            ·{" "}
            {
              (
                {
                  pending: "Kutilmoqda",
                  completed: "Bajarildi",
                  cancelled: "Bekor qilindi",
                } as Record<string, string>
              )[t.status]
            }
          </p>
          <p>{t.note}</p>
          <div className="crm-toolbar">
            <Link to={`/leads/${t.leadId}`}>Lead profili</Link>
            {t.status === "pending" && (
              <>
                <button
                  className="button light"
                  disabled={busy}
                  onClick={() =>
                    void write(
                      `/follow-ups/${t.id}`,
                      { status: "completed" },
                      "PATCH",
                    )
                  }
                >
                  Bajarildi
                </button>
                <button
                  className="button light"
                  disabled={busy}
                  onClick={() =>
                    void write(
                      `/follow-ups/${t.id}`,
                      { status: "cancelled" },
                      "PATCH",
                    )
                  }
                >
                  Vazifani bekor qilish
                </button>
              </>
            )}
          </div>
        </article>
      ))}
      {list.data && !list.data.items.length && <p>Vazifalar topilmadi.</p>}
      {list.data && (
        <Pagination page={page} total={list.data.total} setPage={setPage} />
      )}
    </section>
  );
}
export function LeadKpis({ data }: { data: LeadStatistics }) {
  return (
    <div className="stats-grid crm-stats">
      {[
        ["Bugungi yangi leadlar", data.todayNew],
        ["Shu oydagi leadlar", data.monthNew],
        ["Konvertatsiya qilingan", data.converted],
        ["Konvertatsiya foizi", `${data.conversionRate}%`],
        ["Bugungi sinov darslari", data.todayTrials],
        ["Kechikkan vazifalar", data.overdue],
      ].map(([label, value]) => (
        <div className="stat-card" key={label}>
          <span>{label}</span>
          <strong>{value}</strong>
        </div>
      ))}
    </div>
  );
}
export function LeadAnalytics() {
  const stats = useData<LeadStatistics>("/leads/statistics");
  return (
    <>
      <Heading title="Lead analitikasi" />
      <Nav />
      <State error={stats.error} loading={!stats.data} retry={stats.reload} />
      {stats.data && (
        <>
          <LeadKpis data={stats.data} />
          <p>
            Konvertatsiya foizi = barcha konvertatsiya qilingan leadlar / barcha
            leadlar × 100. Arxiv ham hisoblanadi. Lead bo‘lmasa: 0%.
          </p>
          <div className="crm-form">
            <section className="panel">
              <h2>Status bo‘yicha taqsimot</h2>
              {stats.data.byStatus.map((s) => (
                <div className="crm-history" key={s._id}>
                  {labels[s._id]} <strong>{s.count}</strong>
                  <progress
                    aria-label={labels[s._id]}
                    max={stats.data!.total || 1}
                    value={s.count}
                  />
                </div>
              ))}
              {!stats.data.total && <p>Leadlar hali mavjud emas.</p>}
            </section>
            <section className="panel table-scroll crm-table">
              <h2>Marketing manbalari</h2>
              <table>
                <thead>
                  <tr>
                    <th scope="col">Manba</th>
                    <th scope="col">Leadlar</th>
                    <th scope="col">Konvertatsiya</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.data.bySource.map((s) => (
                    <tr key={s._id}>
                      <td>{sourceLabels[s._id]}</td>
                      <td>{s.count}</td>
                      <td>{s.converted}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>
        </>
      )}
    </>
  );
}
