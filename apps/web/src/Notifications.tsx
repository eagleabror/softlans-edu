import { useEffect, useRef, useState } from "react";
import { api } from "./api";
type Settings = {
  debt: boolean;
  attendance: boolean;
  lesson: boolean;
  debtDays: number[];
  lessonHours: number[];
  late: boolean;
  excused: boolean;
  corrections: boolean;
  quietStart: string;
  quietEnd: string;
  language: string;
  debtTemplate: string;
  attendanceTemplate: string;
  lessonTemplate: string;
};
type Guardian = {
  id: string;
  name: string;
  verifiedAt?: string;
  consentAt?: string;
  enabled: boolean;
  debt: boolean;
  attendance: boolean;
  lesson: boolean;
};
type Job = {
  _id: string;
  kind: string;
  status: string;
  attempts: number;
  errorCode?: string;
  createdAt: string;
  sentAt?: string;
  nextAttemptAt: string;
};
const base = "/notifications";
const statuses: Record<string, string> = {
  pending: "Navbatda",
  sending: "Yuborilmoqda",
  sent: "Yuborilgan",
  failed: "Xatolik",
  cancelled: "Bekor qilingan",
};
export function Notifications({ owner }: { owner: boolean }) {
  const [tab, setTab] = useState("overview"),
    [settings, setSettings] = useState<Settings | null>(null),
    [counts, setCounts] = useState<Record<string, number>>({});
  const [students, setStudents] = useState<
      { id: string; firstName: string; lastName: string }[]
    >([]),
    [search, setSearch] = useState(""),
    [studentId, setStudentId] = useState("");
  const [guardians, setGuardians] = useState<Guardian[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [total, setTotal] = useState(0),
    [page, setPage] = useState(1),
    [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [link, setLink] = useState("");
  const [disconnect, setDisconnect] = useState<Guardian | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  async function run(fn: () => Promise<void>, message = "") {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await fn();
      setSuccess(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "So‘rov bajarilmadi.");
    } finally {
      setBusy(false);
    }
  }
  async function history() {
    const h = await api<{ jobs: Job[]; total: number }>(
      `${base}/${failed ? "failed" : "history"}?page=${page}`,
    );
    setJobs(h.jobs);
    setTotal(h.total);
  }
  async function links(id = studentId) {
    const r = await api<{ guardians: Guardian[] }>(
      `${base}/guardians?studentId=${id}`,
    );
    setGuardians(r.guardians);
  }
  useEffect(() => {
    void run(async () => {
      setCounts(
        (await api<{ counts: Record<string, number> }>(base + "/summary"))
          .counts,
      );
      if (owner)
        setSettings(
          (await api<{ settings: Settings }>(base + "/settings")).settings,
        );
    });
  }, [owner]);
  useEffect(() => {
    if (tab === "history") void run(history);
  }, [tab, page, failed]);
  const toggle = (
    key: "debt" | "attendance" | "lesson" | "late" | "excused" | "corrections",
    label: string,
  ) =>
    settings && (
      <label className="flex items-center gap-3 py-2">
        <input
          type="checkbox"
          checked={settings[key]}
          disabled={busy}
          onChange={(e) =>
            setSettings({ ...settings, [key]: e.target.checked })
          }
        />
        {label}
      </label>
    );
  return (
    <>
      <div className="page-heading">
        <div>
          <p>Telegram</p>
          <h1>Telegram xabarnomalari</h1>
          <p>
            Faqat tasdiqlangan va rozilik bergan ota-onalarga xabar yuboriladi.
          </p>
        </div>
      </div>
      <nav
        aria-label="Xabarnoma bo‘limlari"
        className="flex flex-wrap gap-2 mb-6"
      >
        {[
          ["overview", "Umumiy ko‘rinish"],
          ["guardians", "Ota-onalarni ulash"],
          ...(owner ? [["settings", "Avtomatik eslatmalar"]] : []),
          ["history", "Xabarlar tarixi"],
        ].map(([key, label]) => (
          <button
            key={key}
            className={`button ${tab === key ? "primary" : "light"}`}
            aria-current={tab === key ? "page" : undefined}
            onClick={() => setTab(key!)}
          >
            {label}
          </button>
        ))}
      </nav>
      {error && (
        <p className="notice" role="alert">
          {error}{" "}
          <button
            className="button light"
            onClick={() => window.location.reload()}
          >
            Qayta urinish
          </button>
        </p>
      )}
      {success && (
        <p className="success-note" role="status">
          {success}
        </p>
      )}
      {busy && <p role="status">Yuklanmoqda…</p>}
      {tab === "overview" && (
        <>
          <div className="stats-grid">
            {Object.entries(statuses).map(([key, label]) => (
              <section className="stat-card" key={key}>
                <h2>{label}</h2>
                <strong className="text-3xl">
                  {busy || error ? "—" : (counts[key] ?? 0)}
                </strong>
              </section>
            ))}
          </div>
          <section className="panel p-6 mt-6">
            <h2>Xavfsiz ulanish</h2>
            <p>
              Markaz egasi vasiylikni alohida tekshiradi. Ota-ona botda /id
              orqali Telegram ID oladi va shaxsan markazga taqdim etadi. Taklif
              10 daqiqada tugaydi. Botdagi /consent buyrug‘i rozilikni
              tasdiqlaydi; /stop uni bekor qiladi.
            </p>
            <p>
              Xabarlar Asia/Tashkent vaqti bo‘yicha yuboriladi. /debt_off,
              /attendance_off va /lesson_off alohida xabarlarni o‘chiradi.
            </p>
          </section>
        </>
      )}
      {tab === "settings" && owner && settings && (
        <form
          className="panel p-6 grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await api(base + "/settings", {
                method: "PATCH",
                body: JSON.stringify(settings),
              });
            }, "Sozlamalar saqlandi.");
          }}
        >
          <h2>Avtomatik eslatmalar</h2>
          {toggle("debt", "To‘lov eslatmalari")}
          <fieldset>
            <legend>To‘lov muddati</legend>
            {[
              [-3, "3 kun oldin"],
              [0, "To‘lov kuni"],
              [3, "3 kun keyin"],
              [7, "7 kun keyin"],
            ].map(([day, label]) => (
              <label key={day} className="flex gap-3 py-2">
                <input
                  type="checkbox"
                  checked={settings.debtDays.includes(Number(day))}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      debtDays: e.target.checked
                        ? [...settings.debtDays, Number(day)]
                        : settings.debtDays.filter((v) => v !== day),
                    })
                  }
                />
                {label}
              </label>
            ))}
          </fieldset>
          {toggle("attendance", "Davomat xabarlari")}
          {toggle("late", "Kechikish")}
          {toggle("excused", "Sababli qatnashmaslik")}
          {toggle("corrections", "Davomat tuzatishlari")}
          {toggle("lesson", "Dars eslatmalari")}
          <fieldset>
            <legend>Darsdan oldin</legend>
            {[24, 1].map((hour) => (
              <label key={hour} className="flex gap-3 py-2">
                <input
                  type="checkbox"
                  checked={settings.lessonHours.includes(hour)}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      lessonHours: e.target.checked
                        ? [...settings.lessonHours, hour]
                        : settings.lessonHours.filter((v) => v !== hour),
                    })
                  }
                />
                {hour} soat oldin
              </label>
            ))}
          </fieldset>
          <div className="grid sm:grid-cols-2 gap-4">
            {(["quietStart", "quietEnd"] as const).map((key, i) => (
              <label key={key}>
                {i ? "Tinch vaqt tugashi" : "Tinch vaqt boshlanishi"}
                <input
                  className="plain-input w-full"
                  type="time"
                  required
                  value={settings[key]}
                  onChange={(e) =>
                    setSettings({ ...settings, [key]: e.target.value })
                  }
                />
              </label>
            ))}
          </div>
          <p>
            Asia/Tashkent. Boshlanish va tugash teng bo‘lsa, tinch vaqt
            o‘chiriladi.
          </p>
          <label>
            Xabar tili
            <select
              className="plain-input w-full"
              value={settings.language}
              onChange={(e) =>
                setSettings({ ...settings, language: e.target.value })
              }
            >
              <option value="uz">O‘zbekcha</option>
              <option value="ru">Русский</option>
            </select>
          </label>
          <p>
            Shablonlar: bo‘sh maydon standart matndan foydalanadi. Maxfiy yoki
            moliyaviy tafsilotlarni kiritmang. O‘zgaruvchilar qo‘llanmaydi.
          </p>
          {(
            ["debtTemplate", "attendanceTemplate", "lessonTemplate"] as const
          ).map((key, i) => (
            <label key={key}>
              {["To‘lov matni", "Davomat matni", "Dars matni"][i]}
              <textarea
                className="plain-input w-full"
                maxLength={500}
                value={settings[key]}
                onChange={(e) =>
                  setSettings({ ...settings, [key]: e.target.value })
                }
              />
            </label>
          ))}
          <button className="button primary" disabled={busy}>
            Saqlash
          </button>
        </form>
      )}
      {tab === "guardians" && (
        <section className="panel p-6 grid gap-4">
          <h2>Ota-onalarni ulash</h2>
          <form
            className="flex flex-wrap gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void run(async () => {
                setStudents(
                  (
                    await api<{ students: typeof students }>(
                      `/students?search=${encodeURIComponent(search)}&pageSize=20`,
                    )
                  ).students,
                );
              });
            }}
          >
            <label>
              O‘quvchini izlash
              <input
                className="plain-input"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button className="button light" disabled={busy}>
              Izlash
            </button>
          </form>
          <label>
            O‘quvchi
            <select
              className="plain-input w-full"
              value={studentId}
              onChange={(e) => {
                const value = e.target.value;
                setStudentId(value);
                setLink("");
                setGuardians([]);
                if (value) void run(() => links(value));
              }}
            >
              <option value="">O‘quvchini tanlang</option>
              {students.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </select>
          </label>
          {studentId && (
            <>
              {owner && (
                <form
                  className="grid gap-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const data = new FormData(e.currentTarget);
                    void run(async () => {
                      const r = await api<{ link: string }>(
                        base + "/invitations",
                        {
                          method: "POST",
                          body: JSON.stringify({
                            studentId,
                            guardianName: data.get("name"),
                            telegramId: data.get("telegramId"),
                            guardianshipConfirmed:
                              data.get("confirmed") === "on",
                          }),
                        },
                      );
                      setLink(r.link);
                      await links();
                    });
                  }}
                >
                  <label>
                    Ota-ona ismi
                    <input
                      className="plain-input w-full"
                      name="name"
                      required
                      maxLength={120}
                    />
                  </label>
                  <label>
                    Ota-onaning Telegram ID raqami
                    <input
                      className="plain-input w-full"
                      name="telegramId"
                      required
                      inputMode="numeric"
                      pattern="[1-9][0-9]{0,15}"
                    />
                  </label>
                  <p>
                    Ota-ona botga /id yuborib ID raqamini oladi. Telefon raqami
                    vasiylik dalili hisoblanmaydi.
                  </p>
                  <label className="flex gap-3">
                    <input type="checkbox" name="confirmed" required />
                    Vasiylik va Telegram hisob egasini markaz tartibi bo‘yicha
                    shaxsan tekshirdim.
                  </label>
                  <button className="button primary" disabled={busy}>
                    Xavfsiz taklif yaratish
                  </button>
                </form>
              )}
              {link && (
                <div role="status">
                  <p>
                    Faqat tekshirilgan ota-onaga yetkazing. Havola bir martalik,
                    10 daqiqa amal qiladi.
                  </p>
                  <a
                    href={link}
                    referrerPolicy="no-referrer"
                    rel="noreferrer"
                    target="_blank"
                  >
                    Telegram taklif havolasi
                  </a>
                </div>
              )}
              <button
                className="button light"
                disabled={busy}
                onClick={() => void run(() => links())}
              >
                Ulanish holatini yangilash
              </button>
              {!guardians.length && <p>Ulanishlar topilmadi.</p>}
              {guardians.map((g) => (
                <article
                  key={g.id}
                  className="border rounded-xl p-4 grid gap-3"
                >
                  <h3>{g.name}</h3>
                  <p>
                    {g.verifiedAt ? "Tasdiqlangan" : "Tasdiq kutilmoqda"} ·{" "}
                    {g.enabled && g.consentAt
                      ? "Rozilik berilgan"
                      : "Rozilik faol emas"}
                  </p>
                  <p>
                    To‘lov: {g.debt ? "yoqilgan" : "o‘chirilgan"} · Davomat:{" "}
                    {g.attendance ? "yoqilgan" : "o‘chirilgan"} · Dars:{" "}
                    {g.lesson ? "yoqilgan" : "o‘chirilgan"}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      className="button light"
                      disabled={busy}
                      onClick={() => {
                        setDisconnect(g);
                        dialog.current?.showModal();
                      }}
                    >
                      Ulanishni uzish
                    </button>
                    {owner && (
                      <button
                        className="button light"
                        disabled={busy || !g.enabled}
                        onClick={() =>
                          void run(async () => {
                            await api(base + "/test", {
                              method: "POST",
                              body: JSON.stringify({ guardianId: g.id }),
                            });
                          }, "Sinov xabari navbatga qo‘shildi.")
                        }
                      >
                        Sinov xabari
                      </button>
                    )}
                  </div>
                </article>
              ))}
            </>
          )}
        </section>
      )}
      {tab === "history" && (
        <section className="panel p-6">
          <h2>Xabarlar tarixi</h2>
          <label className="flex gap-3 py-4">
            <input
              type="checkbox"
              checked={failed}
              onChange={(e) => {
                setFailed(e.target.checked);
                setPage(1);
              }}
            />
            Faqat xatoliklar
          </label>
          <div className="table-scroll">
            <table aria-label="Telegram xabarlar tarixi">
              <thead>
                <tr>
                  {["Tur", "Holat", "Urinishlar", "Vaqt", "Amal"].map((v) => (
                    <th scope="col" key={v}>
                      {v}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j._id}>
                    <td>
                      {
                        {
                          debt: "To‘lov",
                          attendance: "Davomat",
                          lesson: "Dars",
                          test: "Sinov",
                        }[j.kind]
                      }
                    </td>
                    <td>
                      {statuses[j.status]}{" "}
                      {j.errorCode && <span>({j.errorCode})</span>}
                    </td>
                    <td>{j.attempts}/5</td>
                    <td>
                      {new Date(j.sentAt ?? j.createdAt).toLocaleString(
                        "uz-UZ",
                        { timeZone: "Asia/Tashkent" },
                      )}
                      {j.status === "pending" && (
                        <p>
                          Keyingi urinish:{" "}
                          {new Date(j.nextAttemptAt).toLocaleString("uz-UZ", {
                            timeZone: "Asia/Tashkent",
                          })}
                        </p>
                      )}
                    </td>
                    <td>
                      {owner &&
                        j.status === "failed" &&
                        j.attempts < 5 &&
                        /^TELEGRAM_(429|500|502|503|504)$/.test(
                          j.errorCode ?? "",
                        ) && (
                          <button
                            className="button light"
                            disabled={busy}
                            onClick={() =>
                              void run(async () => {
                                await api(`${base}/jobs/${j._id}/retry`, {
                                  method: "POST",
                                  body: "{}",
                                });
                                await history();
                              }, "Qayta urinish navbatga qo‘shildi.")
                            }
                          >
                            Qayta urinish
                          </button>
                        )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!jobs.length && !busy && !error && <p>Ma’lumotlar topilmadi.</p>}
          <div className="flex flex-wrap gap-3 mt-4">
            <button
              className="button light"
              disabled={busy || page === 1}
              onClick={() => setPage(page - 1)}
            >
              Oldingi
            </button>
            <span>
              {page}-sahifa · {total} ta xabar
            </span>
            <button
              className="button light"
              disabled={busy || page * 20 >= total}
              onClick={() => setPage(page + 1)}
            >
              Keyingi
            </button>
          </div>
        </section>
      )}
      <dialog
        className="member-dialog"
        ref={dialog}
        aria-labelledby="guardian-disconnect"
      >
        <h2 id="guardian-disconnect">
          {disconnect?.name}: ulanishni uzasizmi?
        </h2>
        <p>Taklif bekor qilinadi va xabarlar to‘xtatiladi.</p>
        <button
          className="button light"
          disabled={busy}
          onClick={() => dialog.current?.close()}
        >
          Bekor qilish
        </button>
        <button
          className="button primary"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await api(`${base}/guardians/${disconnect?.id}/disconnect`, {
                method: "POST",
                body: "{}",
              });
              await links();
              dialog.current?.close();
            }, "Ulanish uzildi.")
          }
        >
          Ulanishni uzish
        </button>
      </dialog>
    </>
  );
}
