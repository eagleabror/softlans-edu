import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Building2,
  ChartNoAxesCombined,
  ChevronLeft,
  ChevronRight,
  GraduationCap,
  History,
  Layers,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Users,
} from "lucide-react";
import type {
  PlatformStatisticsView,
  PlatformTenantView,
  PlatformTenantsView,
  PlatformTenantDetailView,
  PlatformAuditView,
  SessionView,
} from "@softlans/contracts";
import { api, HttpError } from "./api";
import "./SuperAdmin.css";

const root = "/super-admin";
const number = (value: number) => new Intl.NumberFormat("uz-UZ").format(value);
const date = (value: string) =>
  new Intl.DateTimeFormat("uz-UZ", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Tashkent",
  }).format(new Date(value));
const statusName = (status: string) =>
  status === "active" ? "Faol" : "Bloklangan";

function useResource<T>(path: string) {
  const [result, setResult] = useState<{ path: string; value: T } | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true);
    setError("");
    api<T>(path)
      .then((value) => {
        if (current) setResult({ path, value });
      })
      .catch((e: Error) => {
        if (current) setError(e.message);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, version]);
  return {
    data: result?.path === path ? result.value : null,
    error,
    loading: loading || (result?.path !== path && !error),
    reload: () => setVersion((v) => v + 1),
  };
}
function Heading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="page-heading">
      <div>
        <span className="platform-eyebrow">PLATFORMA BOSHQARUVI</span>
        <h1>{title}</h1>
        <p>{children}</p>
      </div>
    </div>
  );
}
function Feedback({
  loading,
  error,
  reload,
}: {
  loading: boolean;
  error: string;
  reload: () => void;
}) {
  if (error)
    return (
      <div className="notice platform-feedback" role="alert">
        <span>{error}</span>
        <button className="button light" onClick={reload}>
          Qayta urinish
        </button>
      </div>
    );
  return loading ? (
    <div className="panel platform-feedback" role="status">
      Yuklanmoqda…
    </div>
  ) : null;
}
function Status({ status }: { status: string }) {
  return (
    <span
      className={`platform-status ${status === "blocked" ? "is-blocked" : ""}`}
    >
      {statusName(status)}
    </span>
  );
}
function Pagination({
  page,
  total,
  pageSize,
  setPage,
}: {
  page: number;
  total: number;
  pageSize: number;
  setPage: (n: number) => void;
}) {
  return (
    <div className="platform-pagination">
      <span>
        Jami {number(total)} ta · {page}-sahifa
      </span>
      <div>
        <button
          className="button light"
          disabled={page <= 1}
          onClick={() => setPage(page - 1)}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Oldingi
        </button>
        <button
          className="button light"
          disabled={page * pageSize >= total}
          onClick={() => setPage(page + 1)}
        >
          Keyingi
          <ChevronRight size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
function Kpi({
  label,
  value,
  icon,
  note,
}: {
  label: string;
  value: number;
  icon: ReactNode;
  note?: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <strong>{number(value)}</strong>
      {note && <p>{note}</p>}
    </article>
  );
}

export function SuperAdminDashboard() {
  const state = useResource<PlatformStatisticsView>(`${root}/stats`);
  const data = state.data;
  return (
    <>
      <Heading title="Platforma dashboardi">
        O‘quv markazlari va platforma o‘sishining umumiy ko‘rinishi.
      </Heading>
      <Feedback {...state} />
      {data && !state.loading && !state.error && (
        <>
          <div className="stats-grid platform-kpis">
            <Kpi
              label="Jami markazlar"
              value={data.totalTenants}
              icon={<Building2 size={20} />}
            />
            <Kpi
              label="Faol markazlar"
              value={data.activeTenants}
              icon={<ShieldCheck size={20} />}
            />
            <Kpi
              label="Bloklangan markazlar"
              value={data.blockedTenants}
              icon={<Building2 size={20} />}
            />
            <Kpi
              label="Bugun qo‘shilgan"
              value={data.todayTenants}
              icon={<ChartNoAxesCombined size={20} />}
            />
            <Kpi
              label="Oxirgi 30 kunda"
              value={data.last30DaysTenants}
              icon={<ChartNoAxesCombined size={20} />}
            />
            <Kpi
              label="Jami o‘quvchilar"
              value={data.totalStudents}
              icon={<GraduationCap size={20} />}
              note="Barcha markazlar bo‘yicha umumiy son"
            />
            <Kpi
              label="Jami foydalanuvchilar"
              value={data.totalUsers}
              icon={<Users size={20} />}
              note="Platformadagi akkauntlar soni"
            />
          </div>
          <section className="panel platform-growth">
            <div className="section-heading">
              <h2>Markazlar o‘sishi</h2>
              <span>Oxirgi 30 kun</span>
            </div>
            <p>
              Kun davomida ro‘yxatdan o‘tgan markazlar soni · Toshkent vaqti
            </p>
            {data.growth.length > 0 ? (
              <GrowthChart growth={data.growth} />
            ) : (
              <p>Ma’lumotlar mavjud emas.</p>
            )}
            <details>
              <summary>Grafik ma’lumotlarini jadvalda ko‘rish</summary>
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Markazlar o‘sishi jadvali"
              >
                <table>
                  <caption className="platform-sr-only">
                    Kunlik yangi markazlar
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Sana</th>
                      <th scope="col">Yangi markazlar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.growth.map((item) => (
                      <tr key={item.date}>
                        <td>{item.date}</td>
                        <td>{number(item.count)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </section>
          <p className="platform-note">
            Yangilangan: {date(data.generatedAt)}. Ko‘rsatkichlar umumiy
            sonlarni ifodalaydi; shaxsiy o‘quvchi va to‘lov yozuvlari bu panelda
            ko‘rsatilmaydi.
          </p>
        </>
      )}
    </>
  );
}
function GrowthChart({ growth }: { growth: PlatformStatisticsView["growth"] }) {
  const max = Math.max(1, ...growth.map((item) => item.count));
  const width = 900,
    height = 220,
    base = 180,
    step = 820 / growth.length;
  return (
    <div>
      <p className="platform-note">
        Kunlik eng ko‘p: {number(Math.max(...growth.map((item) => item.count)))}{" "}
        ta markaz
      </p>
      <svg
        className="platform-chart"
        viewBox={`0 0 ${width} ${height}`}
        role="img"
        aria-label="Oxirgi 30 kunda yangi markazlar grafigi"
      >
        <title>Markazlar o‘sishi</title>
        <desc>
          Har bir ustun bir kunlik yangi markazlar sonini ko‘rsatadi. To‘liq
          qiymatlar quyidagi jadvalda mavjud.
        </desc>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1="48"
              x2="880"
              y1={base - f * 150}
              y2={base - f * 150}
              stroke="#dfe5d8"
            />
          </g>
        ))}
        {growth.map((item, i) => (
          <rect
            key={item.date}
            x={54 + i * step}
            y={base - (item.count / max) * 150}
            width={Math.max(2, step - 6)}
            height={(item.count / max) * 150}
            rx="3"
            fill="#526b43"
          >
            <title>
              {item.date}: {item.count} ta
            </title>
          </rect>
        ))}
      </svg>
      <div className="platform-chart-labels">
        <span>{growth[0]?.date}</span>
        <span>{growth.at(-1)?.date}</span>
      </div>
    </div>
  );
}

export function SuperAdminTenants() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const search = params.get("search") ?? "";
  const status = params.get("status") ?? "";
  const [draft, setDraft] = useState(search);
  useEffect(() => setDraft(search), [search]);
  const query = new URLSearchParams({ page: String(page) });
  if (search) query.set("search", search);
  if (status) query.set("status", status);
  const state = useResource<PlatformTenantsView>(`${root}/tenants?${query}`);
  const update = (values: Record<string, string>) =>
    setParams({ ...Object.fromEntries(query), ...values });
  return (
    <>
      <Heading title="O‘quv markazlari">
        Markazlarni qidiring, holatini tekshiring va boshqaring.
      </Heading>
      <section className="panel platform-list">
        <form
          className="platform-filters"
          onSubmit={(e) => {
            e.preventDefault();
            update({ search: draft.trim(), page: "1" });
          }}
        >
          <label>
            Markaz nomi
            <input
              className="plain-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={120}
              placeholder="Nom bo‘yicha qidirish"
            />
          </label>
          <label>
            Holati
            <select
              className="plain-input"
              value={status}
              onChange={(e) => update({ status: e.target.value, page: "1" })}
            >
              <option value="">Barcha markazlar</option>
              <option value="active">Faol</option>
              <option value="blocked">Bloklangan</option>
            </select>
          </label>
          <button className="button primary">Qidirish</button>
        </form>
        <Feedback {...state} />
        {state.data && !state.loading && !state.error && (
          <>
            {state.data.tenants.length ? (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Markazlar ro‘yxati"
              >
                <table>
                  <caption className="platform-sr-only">
                    O‘quv markazlari va umumiy ko‘rsatkichlar
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Markaz</th>
                      <th scope="col">Holati</th>
                      <th scope="col">Yaratilgan sana</th>
                      <th scope="col">Foydalanuvchilar</th>
                      <th scope="col">O‘quvchilar</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.tenants.map((tenant) => (
                      <tr key={tenant.id}>
                        <th scope="row">
                          <Link
                            className="platform-link"
                            to={`${root}/tenants/${tenant.id}`}
                          >
                            {tenant.name}
                          </Link>
                        </th>
                        <td>
                          <Status status={tenant.status} />
                        </td>
                        <td>{date(tenant.createdAt)}</td>
                        <td>{number(tenant.userCount)}</td>
                        <td>{number(tenant.studentCount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="platform-empty">
                <Building2 size={28} aria-hidden="true" />
                <h2>
                  {search || status
                    ? "Mos markazlar topilmadi."
                    : "Hali markazlar yo‘q."}
                </h2>
                {(search || status) && (
                  <button
                    className="button light"
                    onClick={() => setParams({})}
                  >
                    Filtrlarni tozalash
                  </button>
                )}
              </div>
            )}
            <Pagination
              {...state.data}
              page={page}
              setPage={(n) => update({ page: String(n) })}
            />
          </>
        )}
      </section>
    </>
  );
}

export function SuperAdminTenantDetail() {
  const { id } = useParams();
  const state = useResource<PlatformTenantDetailView>(`${root}/tenants/${id}`);
  const [confirm, setConfirm] = useState(false);
  const [success, setSuccess] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const detail = state.data;
  const close = () => {
    setConfirm(false);
    trigger.current?.focus();
  };
  return (
    <>
      <Link className="platform-back" to={`${root}/tenants`}>
        <ChevronLeft size={18} aria-hidden="true" />
        Markazlar ro‘yxatiga qaytish
      </Link>
      <Heading title={detail?.tenant.name ?? "Markaz tafsilotlari"}>
        Markaz akkaunti va umumiy ko‘rsatkichlar.
      </Heading>
      {success && (
        <div className="platform-success" role="status">
          {success}
        </div>
      )}
      <Feedback {...state} />
      {detail && !state.loading && !state.error && (
        <>
          <div className="platform-detail-grid">
            <section className="panel">
              <div className="section-heading">
                <h2>Markaz ma’lumotlari</h2>
                <Status status={detail.tenant.status} />
              </div>
              <dl className="platform-details">
                <div>
                  <dt>Markaz nomi</dt>
                  <dd>{detail.tenant.name}</dd>
                </div>
                <div>
                  <dt>Yaratilgan sana</dt>
                  <dd>{date(detail.tenant.createdAt)}</dd>
                </div>
                <div>
                  <dt>Oxirgi faollik</dt>
                  <dd>
                    {detail.tenant.lastActivityAt
                      ? date(detail.tenant.lastActivityAt)
                      : "Ma’lumot mavjud emas"}
                  </dd>
                </div>
              </dl>
              <p className="platform-note">
                Oxirgi faollik uchun tasdiqlangan ma’lumot mavjud bo‘lmasa, vaqt
                ko‘rsatilmaydi.
              </p>
            </section>
            <section className="panel">
              <h2>Markaz egasi</h2>
              {detail.owner ? (
                <dl className="platform-details">
                  <div>
                    <dt>Ism va familiya</dt>
                    <dd>{detail.owner.name}</dd>
                  </div>
                  <div>
                    <dt>Email</dt>
                    <dd>{detail.owner.email}</dd>
                  </div>
                </dl>
              ) : (
                <p className="platform-note">
                  Markaz egasi haqida ma’lumot mavjud emas.
                </p>
              )}
            </section>
          </div>
          <div className="stats-grid platform-detail-kpis">
            <Kpi
              label="Foydalanuvchilar"
              value={detail.tenant.userCount}
              icon={<Users size={20} />}
            />
            <Kpi
              label="O‘quvchilar"
              value={detail.tenant.studentCount}
              icon={<GraduationCap size={20} />}
            />
          </div>
          <section className="panel">
            <h2>Markaz holatini boshqarish</h2>
            <p className="platform-note">
              Bloklangan markaz foydalanuvchilari hisobga kira olmaydi va yangi
              operatsiyalar bajara olmaydi. Mavjud ma’lumotlar saqlanadi. Har
              bir o‘zgarish audit tarixiga yoziladi.
            </p>
            <div className="platform-actions">
              <button
                ref={trigger}
                className={`button ${detail.tenant.status === "active" ? "platform-danger" : "primary"}`}
                onClick={() => {
                  setSuccess("");
                  setConfirm(true);
                }}
              >
                {detail.tenant.status === "active"
                  ? "Bloklash"
                  : "Faollashtirish"}
              </button>
              <Link
                className="button light"
                to={`${root}/audit?tenantId=${detail.tenant.id}`}
              >
                Markaz audit tarixi
              </Link>
            </div>
          </section>
          {confirm && (
            <StatusDialog
              tenant={detail.tenant}
              onClose={close}
              onSaved={() => {
                close();
                setSuccess("Markaz holati yangilandi.");
                state.reload();
              }}
              onConflict={() => {
                close();
                state.reload();
              }}
            />
          )}
        </>
      )}
    </>
  );
}
function StatusDialog({
  tenant,
  onClose,
  onSaved,
  onConflict,
}: {
  tenant: PlatformTenantView;
  onClose: () => void;
  onSaved: () => void;
  onConflict: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const reasonInput = useRef<HTMLTextAreaElement>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [invalidReason, setInvalidReason] = useState(false);
  const blocking = tenant.status === "active";
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    reasonInput.current?.focus();
    return () => element?.close();
  }, []);
  function dismiss() {
    dialog.current?.close();
    onClose();
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setInvalidReason(false);
    if (reason.trim().length < 3) {
      setInvalidReason(true);
      setError("Kamida 3 belgidan iborat sabab kiriting.");
      reasonInput.current?.focus();
      return;
    }
    setBusy(true);
    try {
      await api(
        `${root}/tenants/${tenant.id}/${blocking ? "block" : "activate"}`,
        {
          method: "POST",
          body: JSON.stringify({
            reason: reason.trim(),
            expectedRevision: tenant.statusRevision,
          }),
        },
      );
      dialog.current?.close();
      onSaved();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof HttpError && e.status === 409) setConflict(true);
      if (e instanceof HttpError && e.fields?.reason) {
        setInvalidReason(true);
        reasonInput.current?.focus();
      }
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      className="member-dialog platform-dialog"
      ref={dialog}
      aria-labelledby="platform-dialog-title"
      aria-describedby="platform-dialog-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) dismiss();
      }}
    >
      <h2 id="platform-dialog-title">
        {blocking ? "Markazni bloklash" : "Markazni faollashtirish"}
      </h2>
      <p id="platform-dialog-description">
        <strong>{tenant.name}</strong> markazini{" "}
        {blocking ? "bloklashni" : "faollashtirishni"} tasdiqlang.
        {blocking && " Markazdagi amaldagi sessiyalar bekor qilinadi."}
      </p>
      <form onSubmit={submit}>
        <label htmlFor="platform-reason">Sabab</label>
        <textarea
          className="plain-input"
          id="platform-reason"
          ref={reasonInput}
          rows={3}
          required
          minLength={3}
          maxLength={300}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={busy || conflict}
          aria-invalid={invalidReason}
          aria-describedby={`platform-reason-hint${invalidReason ? " platform-change-error" : ""}`}
        />
        <p id="platform-reason-hint" className="platform-note">
          Faqat tashkiliy sababni yozing. Parol, token yoki shaxsiy ma’lumot
          kiritmang.
        </p>
        {error && (
          <div id="platform-change-error" className="notice" role="alert">
            {error}
          </div>
        )}
        <div className="platform-actions">
          <button
            type="button"
            className="button light"
            disabled={busy}
            onClick={dismiss}
          >
            Bekor qilish
          </button>
          {conflict ? (
            <button
              type="button"
              className="button primary"
              onClick={() => {
                dialog.current?.close();
                onConflict();
              }}
            >
              Holatni yangilash
            </button>
          ) : (
            <button
              className={`button ${blocking ? "platform-danger" : "primary"}`}
              disabled={busy}
            >
              {busy
                ? "Saqlanmoqda…"
                : blocking
                  ? "Bloklashni tasdiqlash"
                  : "Faollashtirishni tasdiqlash"}
            </button>
          )}
        </div>
      </form>
    </dialog>
  );
}

export function SuperAdminAudit() {
  const [params, setParams] = useSearchParams();
  const page = Math.max(1, Number(params.get("page")) || 1);
  const tenantId = params.get("tenantId") ?? "";
  const [draft, setDraft] = useState(tenantId);
  useEffect(() => setDraft(tenantId), [tenantId]);
  const query = new URLSearchParams({ page: String(page) });
  if (tenantId) query.set("tenantId", tenantId);
  const state = useResource<PlatformAuditView>(`${root}/audit?${query}`);
  return (
    <>
      <Heading title="Audit tarixi">
        Markaz holatiga kiritilgan o‘zgarishlarning o‘zgarmas tarixi.
      </Heading>
      <section className="panel platform-list">
        <form
          className="platform-filters"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(
              draft.trim() ? { tenantId: draft.trim(), page: "1" } : {},
            );
          }}
        >
          <label>
            Markaz ID
            <input
              className="plain-input"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              maxLength={24}
              placeholder="Barcha markazlar"
            />
          </label>
          <button className="button primary">Filtrlash</button>
          {tenantId && (
            <button
              type="button"
              className="button light"
              onClick={() => setParams({})}
            >
              Filtrni tozalash
            </button>
          )}
        </form>
        <Feedback {...state} />
        {state.data && !state.loading && !state.error && (
          <>
            {state.data.entries.length ? (
              <div
                className="table-scroll"
                tabIndex={0}
                role="region"
                aria-label="Audit yozuvlari"
              >
                <table>
                  <caption className="platform-sr-only">
                    Markaz holatining o‘zgarishlari
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Sana va vaqt</th>
                      <th scope="col">Kim bajardi</th>
                      <th scope="col">Markaz</th>
                      <th scope="col">Amal</th>
                      <th scope="col">Sabab</th>
                      <th scope="col">Oldingi → yangi holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {state.data.entries.map((entry) => (
                      <tr key={entry.id}>
                        <td>{date(entry.createdAt)}</td>
                        <td>
                          <span className="platform-id" title={entry.actorId}>
                            {entry.actorId}
                          </span>
                        </td>
                        <td>
                          <Link
                            className="platform-link platform-id"
                            to={`${root}/tenants/${entry.tenantId}`}
                          >
                            {entry.tenantId}
                          </Link>
                        </td>
                        <td>
                          {entry.action === "block"
                            ? "Bloklash"
                            : "Faollashtirish"}
                        </td>
                        <td className="platform-reason-cell">{entry.reason}</td>
                        <td>
                          {statusName(entry.previousStatus)} →{" "}
                          {statusName(entry.newStatus)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="platform-empty">
                <History size={28} aria-hidden="true" />
                <h2>Audit yozuvlari topilmadi.</h2>
                <p>
                  Markaz holati o‘zgartirilganda bu yerda qayd paydo bo‘ladi.
                </p>
              </div>
            )}
            <Pagination
              {...state.data}
              page={page}
              setPage={(n) =>
                setParams({ ...Object.fromEntries(query), page: String(n) })
              }
            />
          </>
        )}
      </section>
    </>
  );
}

export function SuperAdminLayout({
  session,
  onLogout,
}: {
  session: SessionView;
  onLogout: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
      onLogout();
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) onLogout();
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (session.user.role !== "super_admin" || session.tenant !== null)
    return <Navigate to="/" replace />;
  return (
    <div className="platform-shell">
      <a className="platform-skip" href="#platform-content">
        Asosiy mazmunga o‘tish
      </a>
      <aside className="platform-sidebar">
        <Link to={root} className="platform-brand">
          <Layers size={27} aria-hidden="true" />
          <span>
            SoftLans <span>edu</span>
            <small>Platforma boshqaruvi</small>
          </span>
        </Link>
        <nav aria-label="Platforma menyusi">
          <NavLink to={root} end>
            <LayoutDashboard size={20} aria-hidden="true" />
            Dashboard
          </NavLink>
          <NavLink to={`${root}/tenants`}>
            <Building2 size={20} aria-hidden="true" />
            O‘quv markazlari
          </NavLink>
          <NavLink to={`${root}/audit`}>
            <History size={20} aria-hidden="true" />
            Audit tarixi
          </NavLink>
        </nav>
        <div className="platform-identity">
          <ShieldCheck size={22} aria-hidden="true" />
          <div>
            <strong>{session.user.name}</strong>
            <span>Super administrator</span>
          </div>
        </div>
        <button className="button light" disabled={busy} onClick={logout}>
          <LogOut size={18} aria-hidden="true" />
          {busy ? "Chiqilmoqda…" : "Hisobdan chiqish"}
        </button>
        {error && (
          <div className="notice" role="alert">
            {error}
          </div>
        )}
      </aside>
      <div className="platform-main">
        <header className="platform-topbar">
          <span>SoftLans Edu 2.0</span>
          <span>
            <ShieldCheck size={17} aria-hidden="true" />
            Platforma egasi
          </span>
        </header>
        <main id="platform-content" tabIndex={-1}>
          <Routes>
            <Route path={root} element={<SuperAdminDashboard />} />
            <Route path={`${root}/tenants`} element={<SuperAdminTenants />} />
            <Route
              path={`${root}/tenants/:id`}
              element={<SuperAdminTenantDetail />}
            />
            <Route path={`${root}/audit`} element={<SuperAdminAudit />} />
            <Route path="*" element={<Navigate to={root} replace />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
