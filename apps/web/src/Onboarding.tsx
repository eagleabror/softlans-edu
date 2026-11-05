import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "./api";
import { AddMember } from "./App";
import { GroupForm } from "./Groups";
import { StudentForm } from "./Students";
import { TelegramSettings } from "./Telegram";
import "./Onboarding.css";
const steps = [
  "center",
  "teacher",
  "group",
  "students",
  "telegram",
  "completion",
] as const;
type Step = (typeof steps)[number];
const titles = [
  "Markaz ma’lumotlari",
  "O‘qituvchi qo‘shish",
  "Birinchi guruh",
  "O‘quvchilar",
  "Telegram",
  "Tayyor!",
];
export type SetupView = {
  state: {
    tenantId: string;
    status: string;
    currentStep: Step;
    completedSteps: Step[];
    revision: number;
    dismissedAt: string | null;
  } | null;
  center: { name: string; phone: string; address: string };
  facts: Record<Exclude<Step, "completion">, boolean>;
  counts: { teachers: number; groups: number; students: number };
  subscription: {
    planName: string;
    remainingDays: number;
    status: string;
  } | null;
};
const progress = (d: SetupView) =>
  Object.values(d.facts).filter(Boolean).length;
export function SetupChecklist() {
  const [data, setData] = useState<SetupView | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api<SetupView>("/onboarding")
      .then((d) => {
        if (active) setData(d);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  if (
    !data?.state ||
    data.state.status === "completed" ||
    data.state.dismissedAt
  )
    return null;
  return (
    <section className="panel setup-checklist" aria-label="Markazni sozlash">
      <div className="section-heading">
        <h2>Markazingizni ishga tayyorlang</h2>
        <button
          className="button light"
          onClick={async () => {
            try {
              await api("/onboarding/progress", {
                method: "PATCH",
                body: JSON.stringify({
                  revision: data.state!.revision,
                  action: "dismiss",
                }),
              });
              setData(null);
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          Ro‘yxatni yashirish
        </button>
      </div>
      <p>{progress(data)} / 5 vazifa bajarilgan</p>
      <progress max={5} value={progress(data)} aria-label="Sozlash jarayoni" />
      <ul>
        {steps
          .slice(0, 5)
          .filter((s) => !data.facts[s as keyof SetupView["facts"]])
          .map((s) => (
            <li key={s}>
              <Link to={`/onboarding?step=${s}`}>
                {titles[steps.indexOf(s)]}
              </Link>
            </li>
          ))}
      </ul>
      <Link to="/onboarding">Sozlashga qaytish</Link>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
export function Onboarding({
  onCenterSaved,
}: {
  onCenterSaved?: (name: string) => void;
}) {
  const [data, setData] = useState<SetupView | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false),
    [student, setStudent] = useState(false),
    [group, setGroup] = useState(false);
  const [teachers, setTeachers] = useState<{ id: string; name: string }[]>([]);
  const [params, setParams] = useSearchParams(),
    navigate = useNavigate(),
    heading = useRef<HTMLHeadingElement>(null);
  const requested = params.get("step");
  const step: Step = steps.includes(requested as Step)
    ? (requested as Step)
    : (data?.state?.currentStep ?? "center");
  const index = steps.indexOf(step);
  async function refresh() {
    const result = await api<SetupView>("/onboarding");
    setData(result);
    const list = await api<{ teachers: { id: string; name: string }[] }>(
      "/groups/teachers",
    );
    setTeachers(list.teachers);
  }
  useEffect(() => {
    void refresh().catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    heading.current?.focus();
    setStudent(false);
    setGroup(false);
  }, [step, !!data]);
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function move(next: Step, action = "save") {
    await api("/onboarding/progress", {
      method: "PATCH",
      body: JSON.stringify({
        revision: data!.state!.revision,
        action,
        currentStep: next,
      }),
    });
    await refresh();
    setParams({ step: next });
  }
  async function saveCenter(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const values = Object.fromEntries(new FormData(e.currentTarget));
    await run(async () => {
      await api("/onboarding/center", {
        method: "PATCH",
        body: JSON.stringify(values),
      });
      onCenterSaved?.(String(values.name));
      // Business write succeeded: refresh revision before advancing metadata.
      const fresh = await api<SetupView>("/onboarding");
      setData(fresh);
      await api("/onboarding/progress", {
        method: "PATCH",
        body: JSON.stringify({
          revision: fresh.state!.revision,
          action: "save",
          currentStep: "teacher",
        }),
      });
      await refresh();
      setParams({ step: "teacher" });
    });
  }
  if (!data)
    return (
      <section className="panel onboarding">
        <p role="status">Yuklanmoqda…</p>
        {error && <p role="alert">{error}</p>}
        <button className="button light" onClick={() => void run(refresh)}>
          Qayta urinish
        </button>
      </section>
    );
  if (!data.state)
    return (
      <section className="panel onboarding">
        <h1>Markazingiz foydalanishga tayyor</h1>
        <Link to="/">Boshqaruv paneliga o‘tish</Link>
      </section>
    );
  return (
    <div className="onboarding" aria-busy={busy}>
      <header className="onboarding-intro">
        <span className="form-eyebrow">SOFTLANS EDU · BOSHLASH</span>
        <h1>Yangi imkoniyatlarga xush kelibsiz</h1>
        <p>
          Markazingizni bir necha oddiy qadamda tayyorlang. Istalgan vaqtda
          davom etishingiz mumkin.
        </p>
      </header>
      <nav aria-label="Sozlash bosqichlari">
        <ol className="onboarding-steps">
          {steps.map((s, i) => (
            <li key={s}>
              <button
                disabled={busy}
                aria-current={step === s ? "step" : undefined}
                onClick={() => void run(() => move(s))}
              >
                <span aria-hidden="true">{i + 1}</span>
                {titles[i]}
              </button>
            </li>
          ))}
        </ol>
      </nav>
      <section className="panel onboarding-card">
        <p className="muted">{index + 1} / 6 bosqich</p>
        <progress value={index + 1} max={6} aria-label="Bosqichlar" />
        <h2 ref={heading} tabIndex={-1}>
          {titles[index]}
        </h2>
        {error && (
          <div className="notice" role="alert">
            {error}{" "}
            <button className="button light" onClick={() => void run(refresh)}>
              Yangilash
            </button>
          </div>
        )}
        {step === "center" && (
          <form className="auth-form" onSubmit={saveCenter}>
            <label>
              O‘quv markazi nomi
              <input
                className="plain-input"
                name="name"
                required
                minLength={2}
                maxLength={120}
                defaultValue={data.center.name}
              />
            </label>
            <label>
              Telefon raqami (ixtiyoriy)
              <input
                className="plain-input"
                name="phone"
                type="tel"
                maxLength={16}
                pattern="\+?[0-9]{7,15}|"
                defaultValue={data.center.phone}
              />
            </label>
            <label>
              Manzil (ixtiyoriy)
              <input
                className="plain-input"
                name="address"
                maxLength={300}
                defaultValue={data.center.address}
              />
            </label>
            <button className="button primary" disabled={busy}>
              {busy ? "Saqlanmoqda…" : "Saqlash va davom etish"}
            </button>
          </form>
        )}
        {step === "teacher" && (
          <>
            <p>
              {data.counts.teachers} ta faol o‘qituvchi. Yangi hisob uchun ism,
              email va xavfsiz boshlang‘ich parol kerak.
            </p>
            {teachers.length ? (
              <>
                <ul>
                  {teachers.map((t) => (
                    <li key={t.id}>{t.name}</li>
                  ))}
                </ul>
                <Link to="/team">Barcha jamoa a’zolari</Link>
              </>
            ) : (
              <p>Hali o‘qituvchi qo‘shilmagan.</p>
            )}
            <button
              className="button primary"
              disabled={busy}
              onClick={() => setAdding(true)}
            >
              O‘qituvchi qo‘shish
            </button>
          </>
        )}
        {adding && (
          <AddMember
            teacherOnly
            onClose={() => setAdding(false)}
            onAdded={() => {
              setAdding(false);
              void run(refresh);
            }}
          />
        )}
        {step === "group" && (
          <>
            <p>
              {data.counts.groups} ta faol guruh. Guruhni haqiqiy o‘qituvchiga
              biriktiring.
            </p>
            {!data.counts.teachers ? (
              <>
                <p>
                  Avval o‘qituvchi qo‘shing yoki guruh yaratishni keyinga
                  qoldiring.
                </p>
                <button
                  className="button light"
                  onClick={() => void run(() => move("teacher"))}
                >
                  O‘qituvchi qo‘shishga o‘tish
                </button>
              </>
            ) : group ? (
              <GroupForm
                onSaved={() => {
                  setGroup(false);
                  void run(refresh);
                }}
              />
            ) : (
              <button className="button primary" onClick={() => setGroup(true)}>
                Guruh yaratish
              </button>
            )}
          </>
        )}
        {step === "students" && (
          <>
            <p>
              {data.counts.students} ta faol o‘quvchi. Bitta o‘quvchi qo‘shing
              yoki mavjud faylingizni import qiling.
            </p>
            <div className="onboarding-actions">
              <button
                className="button primary"
                onClick={() => setStudent(true)}
              >
                Bitta o‘quvchi qo‘shish
              </button>
              <Link className="button light" to="/students/import">
                Excel / CSV importini ochish
              </Link>
            </div>
            {student && (
              <StudentForm
                onSaved={() => {
                  setStudent(false);
                  void run(refresh);
                }}
              />
            )}
          </>
        )}
        {step === "telegram" && (
          <>
            <p>
              Telegram orqali muhim eslatmalarni oling. Bildirishnomalar faqat
              roziligingiz bilan yoqiladi. Ulash ixtiyoriy.
            </p>
            <TelegramSettings embedded />
          </>
        )}
        {step === "completion" && (
          <>
            <p>Markazingiz bo‘yicha joriy ma’lumotlar:</p>
            <dl className="onboarding-summary">
              <dt>Markaz sozlamalari</dt>
              <dd>{data.facts.center ? "Saqlandi" : "Hali tasdiqlanmagan"}</dd>
              <dt>O‘qituvchilar</dt>
              <dd>{data.counts.teachers}</dd>
              <dt>Guruhlar</dt>
              <dd>{data.counts.groups}</dd>
              <dt>O‘quvchilar</dt>
              <dd>{data.counts.students}</dd>
              <dt>Telegram</dt>
              <dd>{data.facts.telegram ? "Ulangan" : "Ulanmagan"}</dd>
              <dt>Tanlangan tarif</dt>
              <dd>{data.subscription?.planName ?? "Biriktirilmagan"}</dd>
              <dt>Sinov muddati</dt>
              <dd>
                {data.subscription?.status === "trialing"
                  ? `${data.subscription.remainingDays} kun qoldi`
                  : "Faol sinov yo‘q"}
              </dd>
            </dl>
            <p>Ixtiyoriy vazifalarni keyin ham bajarishingiz mumkin.</p>
            <button
              className="button primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await move("completion", "complete");
                  navigate("/");
                })
              }
            >
              O‘quv markazini boshqarishga o‘tish
            </button>
          </>
        )}
        <footer className="onboarding-actions">
          <button
            className="button light"
            disabled={busy || index === 0}
            onClick={() => void run(() => move(steps[index - 1]!))}
          >
            Oldingi
          </button>
          {index > 0 && index < 5 && (
            <button
              className="button primary"
              disabled={busy}
              onClick={() => void run(() => move(steps[index + 1]!))}
            >
              Saqlash va davom etish
            </button>
          )}
          {index > 0 && index < 5 && (
            <button
              className="button light"
              disabled={busy}
              onClick={() => void run(() => move(steps[index + 1]!))}
            >
              Bu bosqichni keyinga qoldirish
            </button>
          )}
          {index < 5 && (
            <button
              className="button light"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  await move(step, "skip");
                  navigate("/");
                })
              }
            >
              Hozircha o‘tkazib yuborish
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
