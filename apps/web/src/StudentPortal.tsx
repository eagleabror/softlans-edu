import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Link,
  Navigate,
  NavLink,
  Route,
  Routes,
  useLocation,
} from "react-router-dom";
import {
  ArrowRight,
  BookOpen,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  CreditCard,
  GraduationCap,
  LayoutDashboard,
  LogOut,
  Menu,
  ShieldCheck,
  UserRound,
  X,
} from "lucide-react";
import type {
  SessionView,
  StudentAttendanceView,
  StudentChargesView,
  StudentDashboardView,
  StudentLessonView,
  StudentPage,
  StudentPaymentsView,
  StudentProfileView,
  StudentScheduleView,
} from "@softlans/contracts";
import { api, HttpError } from "./api";
import {
  DataTable,
  EmptyState,
  ErrorState,
  LoadingSkeleton,
  PageHeading,
  Stat,
  StatusBadge,
} from "./ui";
import { PasswordSecurity } from "./PasswordSecurity";
import { SecuritySettings } from "./MfaSecurity";
import "./StudentPortal.css";

const money = (value: number) =>
  `${new Intl.NumberFormat("uz-UZ").format(value)} so‘m`;
const localDate = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const months = [
  "yanvar",
  "fevral",
  "mart",
  "aprel",
  "may",
  "iyun",
  "iyul",
  "avgust",
  "sentabr",
  "oktabr",
  "noyabr",
  "dekabr",
];
const weekDays = [
  "Yakshanba",
  "Dushanba",
  "Seshanba",
  "Chorshanba",
  "Payshanba",
  "Juma",
  "Shanba",
];
// Use numeric Intl parts: some browsers ship no Uzbek month-name locale data.
const dateLabel = (date: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Tashkent",
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).formatToParts(
    new Date(date.length === 10 ? `${date}T12:00:00+05:00` : date),
  );
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${Number(part("day"))}-${months[Number(part("month")) - 1]} ${part("year")}`;
};
const monthLabel = (month: string) =>
  `${months[Number(month.slice(5)) - 1]} ${month.slice(0, 4)}`;
const dayLabel = (date: string) =>
  `${weekDays[new Date(`${date}T12:00:00Z`).getUTCDay()]} · ${dateLabel(date)}`;
const statuses = {
  present: "Kelgan",
  absent: "Kelmagan",
  late: "Kechikkan",
  excused: "Sababli",
};
const chargeStatuses = {
  unpaid: "To‘lanmagan",
  partial: "Qisman to‘langan",
  paid: "To‘langan",
  cancelled: "Bekor qilingan",
};
const paymentMethods = {
  cash: "Naqd",
  bank_transfer: "Bank o‘tkazmasi",
  click_manual: "Click (qo‘lda)",
};
function usePortalData<T>(path: string) {
  const [state, setState] = useState<{
    path: string;
    data: T | null;
    error: string;
  }>({ path, data: null, error: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setState({ path, data: null, error: "" });
    api<T>(path)
      .then((data) => {
        if (active) setState({ path, data, error: "" });
      })
      .catch((e) => {
        if (active) setState({ path, data: null, error: (e as Error).message });
      });
    return () => {
      active = false;
    };
  }, [path, attempt]);
  return {
    data: state.path === path ? state.data : null,
    error: state.path === path ? state.error : "",
    retry: () => setAttempt((n) => n + 1),
  };
}
function DataState<T>({
  resource,
  children,
}: {
  resource: ReturnType<typeof usePortalData<T>>;
  children: (data: T) => ReactNode;
}) {
  return resource.error ? (
    <ErrorState message={resource.error} onRetry={resource.retry} />
  ) : resource.data ? (
    children(resource.data)
  ) : (
    <LoadingSkeleton />
  );
}
function Pagination({
  data,
  onChange,
  label,
}: {
  data: StudentPage;
  onChange: (page: number) => void;
  label: string;
}) {
  return data.total > data.pageSize ? (
    <nav className="pagination portal-pagination" aria-label={label}>
      <span>
        {data.total} ta yozuv · {data.page}-sahifa
      </span>
      <div>
        <button
          className="button light"
          disabled={data.page <= 1}
          onClick={() => onChange(data.page - 1)}
        >
          Oldingi
        </button>
        <button
          className="button light"
          disabled={data.page * data.pageSize >= data.total}
          onClick={() => onChange(data.page + 1)}
        >
          Keyingi
        </button>
      </div>
    </nav>
  ) : null;
}
function MonthField({
  month,
  onChange,
}: {
  month: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="portal-month">
      Oy{" "}
      <input
        className="plain-input"
        type="month"
        value={month}
        min="2000-01"
        max="2199-12"
        onChange={(e) => {
          if (/^(20|21)\d{2}-(0[1-9]|1[0-2])$/.test(e.target.value))
            onChange(e.target.value);
        }}
      />
    </label>
  );
}
function Lesson({ lesson }: { lesson: StudentLessonView }) {
  return (
    <article
      className={`portal-lesson ${lesson.status === "cancelled" ? "portal-lesson-cancelled" : ""}`}
    >
      <div className="portal-lesson-time">
        <CalendarDays aria-hidden="true" size={20} />
        <strong>
          {lesson.startTime}–{lesson.endTime}
        </strong>
      </div>
      <div>
        <h3>{lesson.courseName || lesson.groupName}</h3>
        <p>
          {lesson.groupName} · {lesson.classroomName}
        </p>
        <p className="muted">O‘qituvchi: {lesson.teacherName}</p>
      </div>
      <StatusBadge>
        {lesson.status === "cancelled"
          ? "Bekor qilingan"
          : lesson.status === "completed"
            ? "Yakunlangan"
            : "Rejadagi dars"}
      </StatusBadge>
    </article>
  );
}
function Home({ name }: { name: string }) {
  const resource = usePortalData<StudentDashboardView>("/student/dashboard");
  return (
    <>
      <PageHeading
        eyebrow="SHAXSIY O‘QUV MAYDONI"
        title={`Xush kelibsiz, ${name.split(" ")[0]}!`}
        description="Darslaringiz, davomatingiz va to‘lovlaringiz bir joyda."
      >
        <span className="date-chip">{dateLabel(localDate())}</span>
      </PageHeading>
      <DataState resource={resource}>
        {(data) => (
          <>
            <div className="portal-welcome">
              <div>
                <span className="form-eyebrow">O‘QUVCHI KABINETI</span>
                <h2>Bilim sari navbatdagi qadam</h2>
                <p>
                  Yaqin darsingizni tekshiring va haftangizni rejalashtiring.
                </p>
                <Link className="button primary" to="/student/schedule">
                  Dars jadvali <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </div>
              <GraduationCap
                className="portal-welcome-icon"
                size={92}
                strokeWidth={1.2}
                aria-hidden="true"
              />
            </div>
            <div className="stats-grid portal-stats">
              <Stat
                title="Guruhlarim"
                value={data.groups.length}
                icon={<BookOpen aria-hidden="true" />}
                note="Faol guruhlar"
              />
              <Stat
                title="Davomatim"
                value={
                  data.attendance.attendancePercentage == null
                    ? null
                    : `${data.attendance.attendancePercentage}%`
                }
                icon={<ClipboardCheck aria-hidden="true" />}
                note={monthLabel(data.month)}
              />
              <Stat
                title="Qarzdorlik"
                value={money(data.outstandingAmount)}
                icon={<CreditCard aria-hidden="true" />}
                note="Barcha davrlar bo‘yicha qolgan summa"
              />
            </div>
            <div className="portal-columns">
              <section className="panel">
                <div className="section-heading">
                  <h2>Yaqin dars</h2>
                  <Link className="text-button" to="/student/schedule">
                    Jadvalni ko‘rish
                  </Link>
                </div>
                {data.nextLesson ? (
                  <>
                    <p className="muted portal-date">
                      {dateLabel(data.nextLesson.date)}
                    </p>
                    <Lesson lesson={data.nextLesson} />
                  </>
                ) : (
                  <EmptyState title="Yaqin yetti kunda dars rejalashtirilmagan" />
                )}
              </section>
              <section className="panel portal-payment-summary">
                <CreditCard size={24} aria-hidden="true" />
                <h2>To‘lov holati</h2>
                <strong>{money(data.outstandingAmount)}</strong>
                <p className="muted">
                  {data.nextDueDate
                    ? `Eng yaqin to‘lov muddati: ${dateLabel(data.nextDueDate)}`
                    : "Hozircha to‘lanishi kerak bo‘lgan summa yo‘q."}
                </p>
                <Link className="button light" to="/student/payments">
                  To‘lovlarimni ko‘rish{" "}
                  <ArrowRight size={18} aria-hidden="true" />
                </Link>
              </section>
            </div>
            <section className="panel portal-groups">
              <div className="section-heading">
                <h2>Guruhlarim</h2>
                <span className="muted">
                  {data.groups.length} ta faol guruh
                </span>
              </div>
              {!data.groups.length ? (
                <EmptyState title="Siz hali guruhga biriktirilmagansiz">
                  Guruhga qo‘shilish uchun markaz administratoriga murojaat
                  qiling.
                </EmptyState>
              ) : (
                <ul>
                  {data.groups.map((group) => (
                    <li key={group.id}>
                      <span className="portal-group-icon">
                        <BookOpen size={22} aria-hidden="true" />
                      </span>
                      <div>
                        <h3>{group.courseName}</h3>
                        <p className="muted">
                          {group.name} · {group.teacherName}
                        </p>
                      </div>
                      <StatusBadge>Faol</StatusBadge>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </DataState>
    </>
  );
}
function StudentSchedule() {
  const [date, setDate] = useState(localDate);
  const resource = usePortalData<StudentScheduleView>(
    `/student/schedule?date=${date}`,
  );
  function move(days: number) {
    const next = new Date(`${date}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + days);
    setDate(next.toISOString().slice(0, 10));
  }
  return (
    <>
      <PageHeading
        eyebrow="O‘QUV JARAYONI"
        title="Dars jadvali"
        description="Haftalik darslaringiz va ularning vaqti."
      />
      <div className="portal-toolbar">
        <div className="portal-week-controls">
          <button
            className="button light"
            onClick={() => move(-7)}
            aria-label="Oldingi hafta"
          >
            <ChevronLeft size={18} aria-hidden="true" />
            Oldingi
          </button>
          <button className="button light" onClick={() => setDate(localDate())}>
            Bu hafta
          </button>
          <button
            className="button light"
            onClick={() => move(7)}
            aria-label="Keyingi hafta"
          >
            Keyingi
            <ChevronRight size={18} aria-hidden="true" />
          </button>
        </div>
        <span className="muted">Asia/Tashkent</span>
      </div>
      <DataState resource={resource}>
        {(data) => (
          <section className="panel">
            <div className="section-heading">
              <h2>
                {dateLabel(data.weekStart)} — {dateLabel(data.weekEnd)}
              </h2>
            </div>
            {!data.lessons.length ? (
              <EmptyState title="Bu haftada darslar yo‘q" />
            ) : (
              <div className="portal-day-list">
                {[...new Set(data.lessons.map((l) => l.date))].map((day) => (
                  <section key={day}>
                    <h3 className="portal-day-heading">{dayLabel(day)}</h3>
                    {data.lessons
                      .filter((l) => l.date === day)
                      .map((lesson) => (
                        <Lesson key={lesson.key} lesson={lesson} />
                      ))}
                  </section>
                ))}
              </div>
            )}
          </section>
        )}
      </DataState>
    </>
  );
}
function StudentAttendance() {
  const [month, setMonth] = useState(() => localDate().slice(0, 7)),
    [page, setPage] = useState(1);
  const resource = usePortalData<StudentAttendanceView>(
    `/student/attendance?month=${month}&page=${page}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="O‘QUV JARAYONI"
        title="Davomatim"
        description="Faqat o‘zingizga tegishli darslar va davomat belgilari."
      >
        <MonthField
          month={month}
          onChange={(v) => {
            setMonth(v);
            setPage(1);
          }}
        />
      </PageHeading>
      <DataState resource={resource}>
        {(data) => (
          <>
            <div className="stats-grid portal-stats">
              <Stat
                title="Davomat"
                value={
                  data.summary.attendancePercentage == null
                    ? null
                    : `${data.summary.attendancePercentage}%`
                }
                icon={<ClipboardCheck aria-hidden="true" />}
                note="Belgilangan davomat bo‘yicha"
              />
              <Stat
                title="Kelgan / kechikkan"
                value={`${data.summary.present} / ${data.summary.late}`}
                icon={<GraduationCap aria-hidden="true" />}
                note={`Kelmagan: ${data.summary.absent} · Sababli: ${data.summary.excused}`}
              />
              <Stat
                title="Belgilanmagan"
                value={data.summary.unmarked}
                icon={<CalendarDays aria-hidden="true" />}
                note="Boshlanish vaqti o‘tgan darslar"
              />
            </div>
            <section className="panel">
              <h2>Darslar tarixi</h2>
              {!data.lessons.length ? (
                <EmptyState title="Bu oy uchun davomat yozuvlari yo‘q" />
              ) : (
                <DataTable
                  caption="Shaxsiy davomat tarixi"
                  headings={["Sana / vaqt", "Guruh", "Davomat"]}
                >
                  {data.lessons.map((lesson) => (
                    <tr key={lesson.id}>
                      <td>
                        {dateLabel(lesson.date)}
                        <p className="muted">
                          {lesson.startTime}–{lesson.endTime}
                        </p>
                      </td>
                      <td>{lesson.groupName}</td>
                      <td>
                        <StatusBadge>
                          {lesson.lessonStatus === "cancelled"
                            ? "Dars bekor qilingan"
                            : lesson.status
                              ? statuses[lesson.status]
                              : new Date(
                                    `${lesson.date}T${lesson.startTime}:00+05:00`,
                                  ) > new Date()
                                ? "Kutilmoqda"
                                : "Belgilanmagan"}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
              <Pagination
                data={data}
                onChange={setPage}
                label="Davomat sahifalari"
              />
            </section>
          </>
        )}
      </DataState>
    </>
  );
}
function StudentPayments() {
  const [month, setMonth] = useState(() => localDate().slice(0, 7)),
    [chargesPage, setChargesPage] = useState(1),
    [paymentsPage, setPaymentsPage] = useState(1);
  const charges = usePortalData<StudentChargesView>(
    `/student/charges?month=${month}&page=${chargesPage}`,
  );
  const payments = usePortalData<StudentPaymentsView>(
    `/student/payments?month=${month}&page=${paymentsPage}`,
  );
  return (
    <>
      <PageHeading
        eyebrow="SHAXSIY MOLIYA"
        title="To‘lovlarim"
        description="Hisoblangan summalar va amalga oshirilgan to‘lovlar."
      >
        <MonthField
          month={month}
          onChange={(v) => {
            setMonth(v);
            setChargesPage(1);
            setPaymentsPage(1);
          }}
        />
      </PageHeading>
      <DataState resource={charges}>
        {(data) => (
          <>
            <div className="stats-grid portal-stats">
              <Stat
                title="Hisoblangan"
                value={money(data.summary.billed)}
                icon={<CreditCard aria-hidden="true" />}
                note={monthLabel(data.month)}
              />
              <Stat
                title="To‘langan"
                value={money(data.summary.paid)}
                icon={<ClipboardCheck aria-hidden="true" />}
                note="Tanlangan oy hisoblariga qoplangan summa"
              />
              <Stat
                title="Qolgan summa"
                value={money(data.summary.remaining)}
                icon={<CreditCard aria-hidden="true" />}
                note="Tanlangan oy hisoblari bo‘yicha"
              />
            </div>
            <section className="panel">
              <h2>Hisoblangan summalar</h2>
              {!data.charges.length ? (
                <EmptyState title="Bu oy uchun to‘lov hisoblanmagan" />
              ) : (
                <DataTable
                  caption="Shaxsiy hisoblangan to‘lovlar"
                  headings={[
                    "Guruh / muddat",
                    "Hisoblangan",
                    "To‘langan",
                    "Qolgan",
                    "Holat",
                  ]}
                >
                  {data.charges.map((charge) => (
                    <tr key={charge.id}>
                      <td>
                        <strong>{charge.groupName}</strong>
                        <p className="muted">{dateLabel(charge.dueDate)}</p>
                      </td>
                      <td>{money(charge.finalAmount)}</td>
                      <td>{money(charge.paidAmount)}</td>
                      <td>{money(charge.remainingAmount)}</td>
                      <td>
                        <StatusBadge>
                          {chargeStatuses[charge.status]}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
              <Pagination
                data={data}
                onChange={setChargesPage}
                label="Hisoblar sahifalari"
              />
            </section>
          </>
        )}
      </DataState>
      <section className="panel portal-history">
        <h2>To‘lovlar tarixi</h2>
        <p className="muted">Tanlangan oyda amalga oshirilgan to‘lovlar.</p>
        <DataState resource={payments}>
          {(data) => (
            <>
              {!data.payments.length ? (
                <EmptyState title="Bu oyda to‘lovlar qayd etilmagan" />
              ) : (
                <DataTable
                  caption="Shaxsiy to‘lovlar tarixi"
                  headings={["Sana", "Summa", "Usul", "Holat"]}
                >
                  {data.payments.map((payment) => (
                    <tr key={payment.id}>
                      <td>{dateLabel(payment.paidAt)}</td>
                      <td>{money(payment.amount)}</td>
                      <td>{paymentMethods[payment.method]}</td>
                      <td>
                        <StatusBadge>
                          {payment.reversed
                            ? "Bekor qilingan"
                            : "Qabul qilingan"}
                        </StatusBadge>
                      </td>
                    </tr>
                  ))}
                </DataTable>
              )}
              <Pagination
                data={data}
                onChange={setPaymentsPage}
                label="To‘lovlar sahifalari"
              />
            </>
          )}
        </DataState>
      </section>
    </>
  );
}
function StudentProfile() {
  const resource = usePortalData<StudentProfileView>("/student/profile");
  return (
    <>
      <PageHeading
        eyebrow="SHAXSIY MA’LUMOTLAR"
        title="Profilim"
        description="Ma’lumotlarni yangilash uchun markaz administratoriga murojaat qiling."
      />
      <DataState resource={resource}>
        {(data) => (
          <section className="panel info-panel">
            <div className="profile-intro">
              <span className="avatar avatar-large">{data.name[0]}</span>
              <div>
                <h2>{data.name}</h2>
                <StatusBadge>
                  {data.status === "paused"
                    ? "Ta’lim vaqtincha to‘xtatilgan"
                    : "Faol o‘quvchi"}
                </StatusBadge>
              </div>
            </div>
            {[
              ["Markaz", data.centerName],
              ["Email", data.email],
              ["Telefon", data.phone],
              ["Qabul sanasi", dateLabel(data.enrollmentDate)],
            ].map(([label, value]) => (
              <div className="info-row" key={label}>
                <span>{label}</span>
                <strong>{value || "—"}</strong>
              </div>
            ))}
            <div className="student-actions">
              <Link className="button primary" to="/account/change-password">
                Parolni o‘zgartirish
              </Link>
              <Link className="button light" to="/account/security">
                <ShieldCheck size={18} aria-hidden="true" />
                Hisob xavfsizligi
              </Link>
            </div>
          </section>
        )}
      </DataState>
    </>
  );
}
const navigation = [
  { to: "/student", label: "Asosiy", icon: LayoutDashboard, end: true },
  { to: "/student/schedule", label: "Dars jadvali", icon: CalendarDays },
  { to: "/student/attendance", label: "Davomatim", icon: ClipboardCheck },
  { to: "/student/payments", label: "To‘lovlarim", icon: CreditCard },
  { to: "/student/profile", label: "Profilim", icon: UserRound },
];
export function StudentPortal({
  session,
  onSignedOut,
  onPasswordUpdated,
}: {
  session: SessionView;
  onSignedOut: () => void;
  onPasswordUpdated: (updated?: boolean) => void;
}) {
  const location = useLocation(),
    drawer = useRef<HTMLDialogElement>(null),
    menuButton = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);
  useEffect(() => {
    const element = drawer.current;
    if (!element || !menuOpen) return;
    const overflow = document.body.style.overflow;
    element.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      element.close();
      document.body.style.overflow = overflow;
      menuButton.current?.focus();
    };
  }, [menuOpen]);
  useEffect(() => {
    const media = window.matchMedia?.("(max-width: 700px)");
    if (!media) return;
    const changed = () => {
      if (!media.matches) setMenuOpen(false);
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  async function logout() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
      onSignedOut();
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) onSignedOut();
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const nav = (
    <nav aria-label="O‘quvchi kabineti">
      {navigation.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}>
          <Icon size={20} aria-hidden="true" />
          {label}
        </NavLink>
      ))}
    </nav>
  );
  const identity = (
    <>
      <Link className="brand" to="/student">
        <span className="brand-icon">
          <GraduationCap size={26} aria-hidden="true" />
        </span>
        <span>
          SoftLans <span className="brand-edu">edu</span>
        </span>
      </Link>
      <div className="workspace-card">
        <span className="workspace-icon">
          <GraduationCap size={22} aria-hidden="true" />
        </span>
        <div>
          <strong>{session.tenant?.name}</strong>
          <p className="muted">O‘quvchi kabineti</p>
        </div>
      </div>
    </>
  );
  const user = (
    <div className="portal-user">
      <span className="avatar">{session.user.name[0]}</span>
      <div>
        <strong>{session.user.name}</strong>
        <p className="muted">O‘quvchi</p>
      </div>
      <button
        className="icon-button"
        aria-label="Hisobdan chiqish"
        disabled={busy}
        onClick={logout}
      >
        <LogOut size={20} aria-hidden="true" />
      </button>
    </div>
  );
  return (
    <div className="app-shell student-portal">
      <a className="skip-content" href="#student-content">
        Asosiy mazmunga o‘tish
      </a>
      <aside className="sidebar portal-sidebar">
        {identity}
        {nav}
        <div className="sidebar-bottom">{user}</div>
      </aside>
      <dialog
        id="student-mobile-menu"
        ref={drawer}
        className="student-menu-dialog"
        aria-labelledby="student-menu-title"
        onCancel={() => setMenuOpen(false)}
        onClick={(e) => {
          if (e.target === drawer.current) setMenuOpen(false);
        }}
      >
        <div className="portal-drawer-heading">
          <h2 id="student-menu-title">O‘quvchi kabineti</h2>
          <button
            className="icon-button"
            aria-label="Menyuni yopish"
            onClick={() => setMenuOpen(false)}
          >
            <X aria-hidden="true" />
          </button>
        </div>
        {identity}
        {nav}
        {user}
        {error && (
          <p role="alert" className="notice">
            {error}
          </p>
        )}
      </dialog>
      <div className="app-main">
        <header className="topbar">
          <div className="portal-topbar-left">
            <button
              ref={menuButton}
              className="icon-button portal-menu-toggle"
              aria-label="Menyuni ochish"
              aria-controls="student-mobile-menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              <Menu aria-hidden="true" />
            </button>
            <span className="breadcrumb">Shaxsiy kabinet</span>
          </div>
          <Link className="portal-topbar-profile" to="/student/profile">
            <span className="avatar">{session.user.name[0]}</span>
            <span>{session.user.name}</span>
          </Link>
        </header>
        <main id="student-content" className="page-content">
          {error && <ErrorState message={error} onRetry={logout} />}
          <Routes>
            <Route
              path="/student"
              element={<Home name={session.user.name} />}
            />
            <Route path="/student/schedule" element={<StudentSchedule />} />
            <Route path="/student/attendance" element={<StudentAttendance />} />
            <Route path="/student/payments" element={<StudentPayments />} />
            <Route path="/student/profile" element={<StudentProfile />} />
            <Route
              path="/account"
              element={<Navigate to="/student/profile" replace />}
            />
            <Route
              path="/account/security"
              element={<SecuritySettings onSignedOut={onSignedOut} />}
            />
            <Route
              path="/account/change-password"
              element={
                <>
                  <PageHeading
                    eyebrow="SHAXSIY KABINET"
                    title="Hisob xavfsizligi"
                    description="Parolingizni yangilang."
                  />
                  <PasswordSecurity
                    mode="change"
                    onSignedOut={onPasswordUpdated}
                  />
                </>
              }
            />
            <Route path="*" element={<Navigate to="/student" replace />} />
          </Routes>
          <footer className="portal-footer">
            SoftLans Edu · Ta’lim uchun yaratilgan
          </footer>
        </main>
      </div>
    </div>
  );
}
