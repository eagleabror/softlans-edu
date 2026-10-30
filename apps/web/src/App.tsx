import { Billing, FinancialStats } from "./Billing";
import {
  createContext,
  useContext,
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
  useNavigate,
} from "react-router-dom";
import {
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Building2,
  Check,
  CheckCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Eye,
  EyeOff,
  GraduationCap,
  LayoutDashboard,
  Layers,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  Mail,
  Menu,
  Plus,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
  X,
} from "lucide-react";
import type {
  DashboardView,
  Role,
  SessionView,
  UserView,
} from "@softlans/contracts";
import { api, HttpError } from "./api";

import { ScheduleList, ScheduleForm, Classrooms } from "./Scheduling";
import { GroupsList, GroupForm, GroupDetail } from "./Groups";
import { StudentsList, StudentDetail, StudentForm } from "./Students";

const roleNames: Record<Role, string> = {
  super_admin: "Super administrator",
  business_owner: "Markaz egasi",
  admin: "Administrator",
  teacher: "O‘qituvchi",
};
function uzbekDate(value: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: "Asia/Tashkent",
  }).formatToParts(value);
  const part = (type: string) =>
    parts.find((p) => p.type === type)?.value ?? "";
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
  return `${part("day")} ${months[Number(part("month")) - 1]}, ${part("year")}`;
}
const AuthContext = createContext<{
  session: SessionView;
  setSession: (s: SessionView | null) => void;
} | null>(null);
function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Missing session");
  return value;
}
function Logo({ light = false }: { light?: boolean }) {
  return (
    <span className={`brand ${light ? "brand-light" : ""}`}>
      <span className="brand-icon">
        <Layers size={23} strokeWidth={1.8} />
      </span>
      <span>
        SoftLans<span className="brand-edu"> edu</span>
        <span className="version">2.0</span>
      </span>
    </span>
  );
}
function Spinner() {
  return <LoaderCircle className="spin" size={19} aria-label="Yuklanmoqda" />;
}
function Notice({ children }: { children: ReactNode }) {
  return (
    <div className="notice" role="alert">
      {children}
    </div>
  );
}
function Password({
  minLength,
  autoComplete = "current-password",
}: {
  minLength?: number;
  autoComplete?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="input-wrap">
      <LockKeyhole size={17} />
      <input
        id="password"
        name="password"
        type={visible ? "text" : "password"}
        required
        minLength={minLength}
        maxLength={72}
        autoComplete={autoComplete}
        placeholder={minLength ? "Kamida 12 ta belgi" : "Parolingizni kiriting"}
      />
      <button
        className="icon-button"
        type="button"
        aria-label={visible ? "Parolni yashirish" : "Parolni ko‘rsatish"}
        onClick={() => setVisible(!visible)}
      >
        {visible ? <EyeOff size={17} /> : <Eye size={17} />}
      </button>
    </div>
  );
}
function AuthPage({
  register,
  onSession,
}: {
  register?: boolean;
  onSession: (s: SessionView) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const navigate = useNavigate();
  useEffect(() => {
    setError("");
  }, [register]);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const result = await api<SessionView>(
        register ? "/auth/register" : "/auth/login",
        { method: "POST", body: JSON.stringify(data) },
      );
      onSession(result);
      navigate("/");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-page">
      <section className="auth-story">
        <Logo light />
        <div className="story-content">
          <span className="eyebrow">
            <span className="status-dot" /> TA’LIM UCHUN YARATILGAN
          </span>
          <h1>
            Katta maqsadlar.
            <br />
            Tartibli <span>boshqaruv.</span>
          </h1>
          <p>
            Markazingiz, jamoangiz va yangi imkoniyatlar.
            <br />
            Barchasi bitta qulay maydonda.
          </p>
          <div className="story-art" aria-hidden="true">
            <div className="orbit orbit-one" />
            <div className="orbit orbit-two" />
            <div className="art-tile art-tile-back">
              <BookOpen size={35} strokeWidth={1.3} />
            </div>
            <div className="art-main">
              <div className="art-top">
                <span className="art-mark">
                  <GraduationCap size={25} />
                </span>
                <span>
                  Yangi bosqichga
                  <br />
                  <strong>birgalikda.</strong>
                </span>
                <ArrowUpRight size={22} />
              </div>
              <div className="art-line" />
              <div className="art-people">
                <span>AK</span>
                <span>MA</span>
                <span>SU</span>
                <span>
                  <Plus size={15} />
                </span>
                <div>
                  Bir jamoa.
                  <br />
                  <strong>Bir maqsad.</strong>
                </div>
              </div>
            </div>
            <div className="art-badge">
              <CheckCheck size={19} /> Hamma narsa o‘z joyida
            </div>
            <span className="art-spark">
              <Sparkles size={28} strokeWidth={1.2} />
            </span>
          </div>
        </div>
        <div className="story-footer">
          <span>O‘zbekistondagi ta’lim markazlari uchun</span>
          <span>✦</span>
        </div>
      </section>
      <section className="auth-form-area">
        <div className="auth-mobile-brand">
          <Logo />
        </div>
        <div className="auth-top-note">
          {register ? "Hisobingiz bormi?" : "SoftLans’da yangimisiz?"}{" "}
          <Link to={register ? "/login" : "/register"}>
            {register ? "Kirish" : "Hisob ochish"} <ArrowUpRight size={14} />
          </Link>
        </div>
        <div
          className="auth-form-content"
          key={register ? "register" : "login"}
        >
          <div className="auth-symbol">
            <GraduationCap size={26} strokeWidth={1.5} />
          </div>
          <span className="form-eyebrow">SOFTLANS EDU’GA XUSH KELIBSIZ</span>
          <h2>
            {register
              ? "Yangi boshlanish shu yerda."
              : "Yana ko‘rishganimizdan xursandmiz."}
          </h2>
          <p className="muted">
            {register
              ? "Markazingiz uchun hisob oching va jamoangizni birlashtiring."
              : "Hisobingizga kiring va markazingiz ishini davom ettiring."}
          </p>
          <form onSubmit={submit} className="auth-form">
            {register && (
              <>
                <label htmlFor="centerName">O‘quv markazi nomi</label>
                <div className="input-wrap">
                  <Building2 size={17} />
                  <input
                    id="centerName"
                    name="centerName"
                    required
                    minLength={2}
                    maxLength={120}
                    autoComplete="organization"
                    placeholder="Masalan, Kelajak Academy"
                  />
                </div>
                <label htmlFor="name">Ism va familiya</label>
                <div className="input-wrap">
                  <Users size={17} />
                  <input
                    id="name"
                    name="name"
                    required
                    minLength={2}
                    maxLength={100}
                    autoComplete="name"
                    placeholder="Ism va familiyangiz"
                  />
                </div>
              </>
            )}
            <label htmlFor="email">Email manzili</label>
            <div className="input-wrap">
              <Mail size={17} />
              <input
                id="email"
                name="email"
                type="email"
                required
                maxLength={254}
                autoComplete="email"
                placeholder="siz@markaz.uz"
              />
            </div>
            <label htmlFor="password">Parol</label>
            <Password
              minLength={register ? 12 : undefined}
              autoComplete={register ? "new-password" : "current-password"}
            />
            {error && <Notice>{error}</Notice>}
            <button className="button primary auth-submit" disabled={busy}>
              {busy ? (
                <Spinner />
              ) : (
                <>
                  {register ? "Markaz hisobini yaratish" : "Hisobga kirish"}
                  <ArrowRight size={18} />
                </>
              )}
            </button>
          </form>
          <div className="secure-note">
            <ShieldCheck size={16} />
            <span>
              {register
                ? "Siz markaz egasi sifatida ro‘yxatdan o‘tasiz."
                : "Ma’lumotlaringiz xavfsiz va faqat sizning markazingizga tegishli."}
            </span>
          </div>
          {!register && (
            <div className="auth-help">
              <CircleHelp size={16} />
              <span>
                Kirishda muammo bormi? Markaz administratoriga murojaat qiling.
              </span>
            </div>
          )}
        </div>
        <footer className="auth-footer">
          <span>© {new Date().getFullYear()} SoftLans Edu</span>
          <span>
            O‘zbekcha <ChevronDown size={13} />
          </span>
        </footer>
      </section>
    </main>
  );
}
function Shell() {
  const { session, setSession } = useAuth();
  const [open, setOpen] = useState(false);
  const [logoutError, setLogoutError] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = ["business_owner", "admin"].includes(session.user.role);
  async function logout() {
    setBusy(true);
    setLogoutError("");
    try {
      await api("/auth/logout", { method: "POST", body: "{}" });
      setSession(null);
    } catch (e) {
      if (e instanceof HttpError && e.status === 401) setSession(null);
      else setLogoutError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="app-shell">
      {open && (
        <button
          className="sidebar-overlay"
          aria-label="Menyuni yopish"
          onClick={() => setOpen(false)}
        />
      )}
      <aside className={`sidebar ${open ? "sidebar-open" : ""}`}>
        <Link className="logo-link" to="/" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        <button
          className="mobile-close icon-button"
          aria-label="Menyuni yopish"
          onClick={() => setOpen(false)}
        >
          <X size={20} />
        </button>
        <div className="workspace-card">
          <div className="workspace-icon">
            <Building2 size={20} />
          </div>
          <div>
            <strong>{session.tenant?.name ?? "SoftLans platformasi"}</strong>
            <span>
              {session.tenant ? "O‘quv markazi" : "Platforma boshqaruvi"}
            </span>
          </div>
          <span className="workspace-dot" />
        </div>
        <span className="nav-label">ASOSIY MENYU</span>
        <nav aria-label="Asosiy menyu">
          <NavLink to="/" end onClick={() => setOpen(false)}>
            <LayoutDashboard size={19} />
            Bosh sahifa
          </NavLink>
          {canManage && (
            <NavLink to="/billing" onClick={() => setOpen(false)}>
              <Layers size={19} />
              To‘lovlar
            </NavLink>
          )}
          {canManage && (
            <NavLink to="/team" onClick={() => setOpen(false)}>
              <Users size={19} />
              Jamoa
            </NavLink>
          )}
          {canManage && (
            <NavLink to="/students" onClick={() => setOpen(false)}>
              <GraduationCap size={19} />
              O‘quvchilar
            </NavLink>
          )}
          {session.tenant && (
            <NavLink to="/groups" onClick={() => setOpen(false)}>
              <Users size={19} />
              Guruhlar
            </NavLink>
          )}
          {session.tenant && (
            <NavLink to="/center" onClick={() => setOpen(false)}>
              <Building2 size={19} />
              Markaz ma’lumotlari
            </NavLink>
          )}
          {session.tenant && (
            <NavLink to="/schedules" onClick={() => setOpen(false)}>
              <Layers size={19} />
              Dars jadvali
            </NavLink>
          )}
          {session.tenant && (
            <NavLink to="/schedules/weekly" onClick={() => setOpen(false)}>
              <Layers size={19} />
              Haftalik kalendar
            </NavLink>
          )}
          {canManage && (
            <NavLink to="/classrooms" onClick={() => setOpen(false)}>
              <Building2 size={19} />
              Xonalar
            </NavLink>
          )}
          <NavLink to="/account" onClick={() => setOpen(false)}>
            <Settings2 size={19} />
            Hisobim
          </NavLink>
        </nav>
        <div className="sidebar-bottom">
          <div className="phase-card">
            <span className="phase-icon">
              <Sparkles size={17} />
            </span>
            <strong>Birgalikda rivojlanamiz</strong>
            <p>Ta’limdagi katta maqsadlar kichik qadamlardan boshlanadi.</p>
            <span>
              SoftLans Edu <span className="phase-badge">1-bosqich</span>
            </span>
          </div>
          <div className="sidebar-user">
            <span className="avatar">
              {session.user.name.slice(0, 1).toUpperCase()}
            </span>
            <div>
              <strong>{session.user.name}</strong>
              <span>{roleNames[session.user.role]}</span>
            </div>
            <button
              className="icon-button"
              onClick={logout}
              disabled={busy}
              aria-label="Hisobdan chiqish"
              title="Hisobdan chiqish"
            >
              {busy ? <Spinner /> : <LogOut size={18} />}
            </button>
          </div>
          {logoutError && <Notice>{logoutError}</Notice>}
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu icon-button"
              aria-label="Menyuni ochish"
              aria-expanded={open}
              onClick={() => setOpen(!open)}
            >
              <Menu size={22} />
            </button>
            <span className="breadcrumb">
              Ish maydoni <ChevronRight size={13} />
              <strong>
                {session.tenant ? "Mening markazim" : "Platforma"}
              </strong>
            </span>
          </div>
          <span className="topbar-safe">
            <span className="status-dot" /> Xavfsiz ish maydoni{" "}
            <ShieldCheck size={16} />
          </span>
        </header>
        <main className="page-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            {canManage && (
              <>
                <Route
                  path="/billing"
                  element={
                    <Billing owner={session.user.role === "business_owner"} />
                  }
                />
                <Route
                  path="/billing/history"
                  element={
                    <Billing
                      owner={session.user.role === "business_owner"}
                      history
                    />
                  }
                />
                <Route
                  path="/students/:id/finance"
                  element={
                    <Billing owner={session.user.role === "business_owner"} />
                  }
                />
                <Route
                  path="/students/:id/finance/history"
                  element={
                    <Billing
                      owner={session.user.role === "business_owner"}
                      history
                    />
                  }
                />
              </>
            )}
            {canManage && <Route path="/team" element={<Team />} />}
            {canManage && (
              <>
                <Route path="/students" element={<StudentsList />} />
                <Route path="/students/new" element={<StudentForm />} />
                <Route path="/students/:id" element={<StudentDetail />} />
                <Route
                  path="/students/:id/edit"
                  element={<StudentForm edit />}
                />
              </>
            )}
            {session.tenant && (
              <Route
                path="/groups"
                element={<GroupsList manage={canManage} />}
              />
            )}
            {session.tenant && (
              <Route
                path="/groups/:id"
                element={<GroupDetail manage={canManage} />}
              />
            )}
            {canManage && <Route path="/groups/new" element={<GroupForm />} />}
            {canManage && (
              <Route path="/groups/:id/edit" element={<GroupForm edit />} />
            )}
            {session.tenant && <Route path="/center" element={<Center />} />}
            {session.tenant && (
              <Route
                path="/schedules"
                element={<ScheduleList manage={canManage} />}
              />
            )}
            {session.tenant && (
              <Route
                path="/schedules/weekly"
                element={<ScheduleList manage={canManage} weekly />}
              />
            )}
            {canManage && (
              <Route path="/schedules/new" element={<ScheduleForm />} />
            )}
            {canManage && (
              <Route
                path="/schedules/:id/edit"
                element={<ScheduleForm edit />}
              />
            )}
            {canManage && <Route path="/classrooms" element={<Classrooms />} />}
            <Route path="/account" element={<Account />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          <footer className="page-footer">
            <Logo />
            <span>Ta’limni rivojlantirish uchun yaratilgan.</span>
            <span>© {new Date().getFullYear()} SoftLans</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function PageHeading({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <span className="form-eyebrow">{eyebrow}</span>
        <h1>{title}</h1>
        <p className="muted">{description}</p>
      </div>
      {children}
    </div>
  );
}
function Dashboard() {
  const { session } = useAuth();
  const [data, setData] = useState<DashboardView | null>(null);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    api<DashboardView>("/dashboard")
      .then((d) => {
        if (active) setData(d);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  const owner = ["business_owner", "admin"].includes(session.user.role);
  const platform = session.user.role === "super_admin";
  const date = uzbekDate(new Date());
  return (
    <>
      <PageHeading
        eyebrow="BUGUNGI IMKONIYATLAR"
        title={`Xush kelibsiz, ${session.user.name.split(" ")[0]}!`}
        description="Markazingizdagi yangi kun uchun hammasi tayyor."
      >
        <span className="date-chip">{date}</span>
      </PageHeading>
      <section className="welcome-banner">
        <div>
          <span className="welcome-label">
            <span className="status-dot" /> SIZNING ISH MAYDONINGIZ
          </span>
          <h2>
            {platform
              ? "Ta’lim uchun mustahkam poydevor."
              : "Tartibli jamoa. Katta imkoniyatlar."}
          </h2>
          <p>
            {platform
              ? "Markazlar va foydalanuvchilar haqidagi umumiy ma’lumotlar."
              : "Jamoangizni birlashtiring va ta’limga ko‘proq vaqt ajrating."}
          </p>
          {owner ? (
            <Link className="button light" to="/team">
              Jamoani boshqarish <ArrowUpRight size={17} />
            </Link>
          ) : (
            <Link className="button light" to="/account">
              Hisobimni ko‘rish <ArrowUpRight size={17} />
            </Link>
          )}
        </div>
        <div className="banner-art" aria-hidden="true">
          <div className="banner-ring" />
          <div className="banner-ring ring-small" />
          <div className="banner-block block-one">
            <BookOpen size={36} strokeWidth={1.3} />
          </div>
          <div className="banner-block block-two">
            <GraduationCap size={46} strokeWidth={1.2} />
          </div>
          <span className="banner-star">✦</span>
          <span className="banner-dot" />
        </div>
      </section>
      {error ? (
        <Notice>
          {error}{" "}
          <button className="text-button" onClick={() => setRetry(retry + 1)}>
            Qayta urinish
          </button>
        </Notice>
      ) : !data ? (
        <div className="loading-panel">
          <Spinner /> Ma’lumotlar yuklanmoqda…
        </div>
      ) : (
        <div className="stats-grid">
          <Stat
            title={platform ? "Faol markazlar" : "Jamoa a’zolari"}
            value={platform ? data.tenantCount : data.teamCount}
            icon={<Users size={21} />}
            note={
              platform
                ? "Platformadagi o‘quv markazlari"
                : owner
                  ? "Markazingizdagi faol hisoblar"
                  : "Jamoa ma’lumotlari rahbariyat uchun"
            }
          />
          <Stat
            title={platform ? "Faol foydalanuvchilar" : "Administratorlar"}
            value={platform ? data.teamCount : data.adminCount}
            icon={<ShieldCheck size={21} />}
            note={
              platform
                ? "Markazlardagi faol hisoblar"
                : "Markaz boshqaruvi jamoasi"
            }
          />
          <Stat
            title={platform ? "Sizning rolingiz" : "O‘qituvchilar"}
            value={platform ? "Super admin" : data.teacherCount}
            icon={<GraduationCap size={23} />}
            note={
              platform
                ? "Platforma darajasidagi kirish"
                : "Ta’lim beruvchi jamoa"
            }
          />
        </div>
      )}
      {owner && data?.students && (
        <div className="stats-grid student-stats">
          <Stat
            title="Jami o‘quvchilar"
            value={data.students.total}
            icon={<GraduationCap size={21} />}
            note="Arxivlanganlar bilan birga"
          />
          <Stat
            title="Faol o‘quvchilar"
            value={data.students.active}
            icon={<Users size={21} />}
            note="Ta’limni davom ettirayotganlar"
          />
          <Stat
            title="To‘xtatilgan o‘quvchilar"
            value={data.students.paused}
            icon={<Users size={21} />}
            note="Vaqtincha tanaffusdagi o‘quvchilar"
          />
          <Stat
            title="Yaqinda qabul qilinganlar"
            value={data.students.recent}
            icon={<Plus size={21} />}
            note="Oxirgi 30 kun ichida"
          />
        </div>
      )}
      {owner && data?.groups && (
        <div className="stats-grid">
          <Stat
            title="Jami guruhlar"
            value={data.groups.total}
            icon={<Users size={21} />}
            note="Arxivlanganlar bilan birga"
          />
          <Stat
            title="Faol guruhlar"
            value={data.groups.active}
            icon={<Users size={21} />}
            note="Amaldagi guruhlar"
          />
          <Stat
            title="Faol a’zoliklar"
            value={data.groups.activeMemberships}
            icon={<GraduationCap size={21} />}
            note="Guruhlardagi faol a’zoliklar"
          />
        </div>
      )}
      {data?.financial && <FinancialStats data={data.financial} />}
      {data?.scheduling && (
        <div className="stats-grid">
          <Stat
            title="Bugungi darslar"
            value={data.scheduling.todayLessons}
            icon={<Layers />}
            note="Asia/Tashkent"
          />
          <Stat
            title="Faol xonalar"
            value={data.scheduling.activeClassrooms}
            icon={<Building2 />}
            note="Markaz doirasida"
          />
          <Stat
            title="Haftalik darslar"
            value={data.scheduling.weeklyLessons}
            icon={<Layers />}
            note="Joriy hafta"
          />
        </div>
      )}
      <div className="dashboard-grid">
        <section className="panel quick-panel">
          <div className="section-heading">
            <h2>Keyingi qadam</h2>
            <span className="small-tag">SIZ UCHUN</span>
          </div>
          <p className="muted small">
            Ishni boshlash uchun kerakli bo‘limni tanlang.
          </p>
          {owner && (
            <QuickLink
              to="/team"
              icon={<Users size={21} />}
              title="Jamoangizni shakllantiring"
              text="Administrator va o‘qituvchilar hisoblarini yarating."
            />
          )}
          {session.tenant && (
            <QuickLink
              to="/center"
              icon={<Building2 size={21} />}
              title="Markazingiz bilan tanishing"
              text="Markaz ma’lumotlari va ish maydonini ko‘ring."
            />
          )}
          <QuickLink
            to="/account"
            icon={<Settings2 size={21} />}
            title="Shaxsiy hisobingiz"
            text="Hisob ma’lumotlari va kirish huquqlaringiz."
          />
        </section>
        <section className="panel account-summary">
          <div className="section-heading">
            <h2>Sizning maydoningiz</h2>
            <span className="status-pill">
              <span className="status-dot" /> Faol
            </span>
          </div>
          <span className="summary-art">
            <Layers size={35} strokeWidth={1.3} />
          </span>
          <h3>{session.tenant?.name ?? "SoftLans platformasi"}</h3>
          <p>{roleNames[session.user.role]}</p>
          <div className="summary-divider" />
          <div className="summary-row">
            <span>Hisob turi</span>
            <strong>{platform ? "Platforma" : "Markaz hisobi"}</strong>
          </div>
          <div className="summary-row">
            <span>Ro‘yxatdan o‘tgan</span>
            <strong>{data ? uzbekDate(new Date(data.joinedAt)) : "…"}</strong>
          </div>
          <div className="privacy-line">
            <ShieldCheck size={15} />{" "}
            {platform
              ? "Platforma ma’lumotlariga ruxsat berilgan"
              : "Ma’lumotlar markazingiz doirasida saqlanadi"}
          </div>
        </section>
      </div>
    </>
  );
}
function Stat({
  title,
  value,
  icon,
  note,
}: {
  title: string;
  value?: number | string | null;
  icon: ReactNode;
  note: string;
}) {
  return (
    <section className="stat-card">
      <div className="stat-top">
        <span>{title}</span>
        <span className="stat-icon">{icon}</span>
      </div>
      <strong className={typeof value === "string" ? "stat-text" : ""}>
        {value == null ? "—" : value.toLocaleString("uz-UZ")}
      </strong>
      <p>{note}</p>
    </section>
  );
}
function QuickLink({
  to,
  icon,
  title,
  text,
}: {
  to: string;
  icon: ReactNode;
  title: string;
  text: string;
}) {
  return (
    <Link className="quick-link" to={to}>
      <span className="quick-icon">{icon}</span>
      <div>
        <strong>{title}</strong>
        <p>{text}</p>
      </div>
      <ArrowUpRight size={19} />
    </Link>
  );
}
type TeamView = {
  users: UserView[];
  total: number;
  page: number;
  pageSize: number;
};
function Team() {
  const { session } = useAuth();
  const [data, setData] = useState<TeamView | null>(null);
  const [error, setError] = useState("");
  const [page, setPage] = useState(1);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const [success, setSuccess] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setData(null);
    api<TeamView>(`/team?page=${page}`)
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
  return (
    <>
      <PageHeading
        eyebrow="BIR JAMOA. BIR MAQSAD."
        title="Jamoa"
        description="Markazingizdagi insonlar va ularning kirish huquqlari."
      >
        <button
          className="button primary"
          onClick={() => {
            setAdding(true);
            setSuccess("");
          }}
        >
          <Plus size={18} /> A’zo qo‘shish
        </button>
      </PageHeading>
      {success && (
        <div className="success-note" role="status">
          <Check size={17} />
          {success}
        </div>
      )}
      {error && (
        <Notice>
          {error}{" "}
          <button
            className="text-button"
            onClick={() => setVersion(version + 1)}
          >
            Qayta urinish
          </button>
        </Notice>
      )}
      <section className="panel team-panel">
        <div className="section-heading">
          <h2>
            Jamoa a’zolari{" "}
            {data && <span className="count-tag">{data.total}</span>}
          </h2>
          <span className="muted small">Faqat sizning markazingiz</span>
        </div>
        {!data && !error ? (
          <div className="loading-panel">
            <Spinner /> Jamoa yuklanmoqda…
          </div>
        ) : (
          data && (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>FOYDALANUVCHI</th>
                      <th>EMAIL MANZILI</th>
                      <th>ROL</th>
                      <th>HISOB</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.users.map((user) => (
                      <tr key={user.id}>
                        <td>
                          <div className="table-name">
                            <span className="avatar">
                              {user.name.slice(0, 1)}
                            </span>
                            <strong>{user.name}</strong>
                            {user.id === session.user.id && (
                              <span className="you-tag">Siz</span>
                            )}
                          </div>
                        </td>
                        <td>{user.email}</td>
                        <td>
                          <span className={`role-tag role-${user.role}`}>
                            {roleNames[user.role]}
                          </span>
                        </td>
                        <td>
                          <span className="muted small">Yaratilgan</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {data.users.length === 0 && (
                  <p className="empty-state">
                    Bu sahifada foydalanuvchilar yo‘q.
                  </p>
                )}
              </div>
              <div className="pagination">
                <span>
                  {data.total} ta a’zo · {page}-sahifa
                </span>
                <div>
                  <button
                    className="icon-button"
                    aria-label="Oldingi sahifa"
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Keyingi sahifa"
                    disabled={page * data.pageSize >= data.total}
                    onClick={() => setPage(page + 1)}
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              </div>
            </>
          )
        )}
      </section>
      <div className="team-tip">
        <ShieldCheck size={20} />
        <p>
          {session.user.role === "business_owner"
            ? "Markaz egasi sifatida administrator va o‘qituvchi hisoblarini yarata olasiz."
            : "Administrator sifatida o‘qituvchi hisoblarini yarata olasiz."}{" "}
          Har bir a’zo faqat o‘z markazining ma’lumotlariga kiradi.
        </p>
      </div>
      {adding && (
        <AddMember
          onClose={() => setAdding(false)}
          onAdded={() => {
            setAdding(false);
            setPage(1);
            setVersion(version + 1);
            setSuccess("Yangi jamoa a’zosi muvaffaqiyatli qo‘shildi.");
          }}
        />
      )}
    </>
  );
}
function AddMember({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const { session } = useAuth();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      await api("/team", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(e.currentTarget))),
      });
      onAdded();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="member-dialog"
      onCancel={(e) => {
        if (busy) e.preventDefault();
        else onClose();
      }}
      aria-labelledby="member-title"
    >
      <div className="section-heading">
        <h2 id="member-title">Jamoaga a’zo qo‘shish</h2>
        <button
          className="icon-button"
          aria-label="Oynani yopish"
          onClick={onClose}
          disabled={busy}
        >
          <X size={21} />
        </button>
      </div>
      <p className="muted small">
        Yangi hisob sizning markazingizga biriktiriladi.
      </p>
      <form className="auth-form" onSubmit={submit}>
        <label htmlFor="name">Ism va familiya</label>
        <input
          className="plain-input"
          id="name"
          name="name"
          required
          minLength={2}
          maxLength={100}
          autoComplete="off"
        />
        <label htmlFor="email">Email manzili</label>
        <input
          className="plain-input"
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="off"
        />
        <label htmlFor="role">Rol</label>
        <select
          className="plain-input"
          id="role"
          name="role"
          defaultValue="teacher"
        >
          <option value="teacher">O‘qituvchi</option>
          {session.user.role === "business_owner" && (
            <option value="admin">Administrator</option>
          )}
        </select>
        <label htmlFor="password">Boshlang‘ich parol</label>
        <Password minLength={12} autoComplete="new-password" />
        <p className="muted small">
          Parolni a’zoga xavfsiz aloqa orqali yetkazing.
        </p>
        {error && <Notice>{error}</Notice>}
        <button className="button primary auth-submit" disabled={busy}>
          {busy ? (
            <Spinner />
          ) : (
            <>
              Hisob yaratish
              <Plus size={17} />
            </>
          )}
        </button>
      </form>
    </dialog>
  );
}
function Account() {
  const { session } = useAuth();
  return (
    <>
      <PageHeading
        eyebrow="SHAXSIY MAYDON"
        title="Hisobim"
        description="Hisob ma’lumotlaringiz va kirish huquqlaringiz."
      />
      <section className="panel info-panel">
        <div className="profile-intro">
          <span className="avatar avatar-large">
            {session.user.name.slice(0, 1)}
          </span>
          <div>
            <h2>{session.user.name}</h2>
            <span className="role-tag">{roleNames[session.user.role]}</span>
          </div>
        </div>
        <InfoRow label="Email manzili" value={session.user.email} />
        <InfoRow label="Hisob roli" value={roleNames[session.user.role]} />
        <InfoRow
          label="Ish maydoni"
          value={session.tenant?.name ?? "SoftLans platformasi"}
        />
        <div className="privacy-line">
          <ShieldCheck size={17} /> Kirish huquqlaringiz serverda tekshiriladi.
        </div>
      </section>
    </>
  );
}
function Center() {
  const { session } = useAuth();
  return (
    <>
      <PageHeading
        eyebrow="SIZNING MARKAZINGIZ"
        title="Markaz ma’lumotlari"
        description="Jamoangiz uchun yagona va xavfsiz ish maydoni."
      />
      <section className="panel info-panel">
        <div className="profile-intro">
          <span className="summary-art">
            <Building2 size={30} />
          </span>
          <div>
            <h2>{session.tenant?.name}</h2>
            <span className="status-pill">
              <span className="status-dot" /> Faol ish maydoni
            </span>
          </div>
        </div>
        <InfoRow label="Markaz nomi" value={session.tenant?.name ?? ""} />
        <InfoRow
          label="Sizning rolingiz"
          value={roleNames[session.user.role]}
        />
        <InfoRow label="Platforma" value="SoftLans Edu 2.0" />
        <div className="privacy-line">
          <ShieldCheck size={17} /> Barcha a’zolar va ma’lumotlar markazingizga
          biriktirilgan.
        </div>
      </section>
    </>
  );
}
function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="info-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}
export function App() {
  const [session, setSession] = useState<SessionView | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setError("");
    setReady(false);
    api<SessionView>("/auth/me")
      .then((s) => {
        if (active) setSession(s);
      })
      .catch((e) => {
        if (active && !(e instanceof HttpError && e.status === 401))
          setError(e.message);
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => {
      active = false;
    };
  }, [retry]);
  useEffect(() => {
    const expire = () => setSession(null);
    window.addEventListener("session-expired", expire);
    return () => window.removeEventListener("session-expired", expire);
  }, []);
  if (!ready)
    return (
      <div className="app-loading">
        <Logo />
        <Spinner />
        <p>Maydoningiz tayyorlanmoqda…</p>
      </div>
    );
  if (error)
    return (
      <div className="app-loading">
        <Logo />
        <Notice>{error}</Notice>
        <button className="button primary" onClick={() => setRetry(retry + 1)}>
          Qayta urinish
        </button>
      </div>
    );
  if (session)
    return (
      <AuthContext.Provider value={{ session, setSession }}>
        <Shell />
      </AuthContext.Provider>
    );
  return (
    <Routes>
      <Route path="/login" element={<AuthPage onSession={setSession} />} />
      <Route
        path="/register"
        element={<AuthPage register onSession={setSession} />}
      />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}
