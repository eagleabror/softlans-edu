import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
type Settings = {
  enabled: boolean;
  time: string;
  timezone: "Asia/Tashkent";
  sections: string[];
  quietStart: string;
  quietEnd: string;
};
type State = {
  settings: Settings;
  telegram: { available: boolean; connected: boolean; optedIn: boolean };
};
type History = {
  jobs: {
    _id: string;
    kind: string;
    eventDate: string;
    status: string;
    errorCode?: string;
  }[];
  page: number;
  total: number;
};
const names: Record<string, string> = {
  students: "O‘quvchilar",
  financial: "Moliya",
  attendance: "Davomat",
  payroll: "O‘qituvchilar maoshi",
};
const statuses: Record<string, string> = {
  pending: "Navbatda",
  sending: "Yuborilmoqda",
  sent: "Yuborildi",
  failed: "Yuborilmadi",
  cancelled: "Bekor qilindi",
};
export function DailyReports() {
  const [state, setState] = useState<State | null>(null),
    [history, setHistory] = useState<History | null>(null);
  const [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  async function refresh(page = 1) {
    const [s, h] = await Promise.all([
      api<State>("/daily-reports/settings"),
      api<History>(`/daily-reports/history?page=${page}`),
    ]);
    setState(s);
    setHistory(h);
  }
  async function run(action: () => Promise<void>, message = "") {
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await action();
      setSuccess(message);
    } catch (e) {
      setError(e instanceof Error ? e.message : "So‘rov bajarilmadi.");
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(refresh);
  }, []);
  function change(patch: Partial<Settings>) {
    setState((s) => s && { ...s, settings: { ...s.settings, ...patch } });
    setPreview("");
  }
  return (
    <div className="daily-reports">
      <div className="page-heading">
        <div>
          <p>Sozlamalar · Telegram</p>
          <h1>Kunlik hisobotlar</h1>
          <p>
            Markazingizning kunlik natijalari. Vaqt mintaqasi: Asia/Tashkent.
          </p>
        </div>
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
      <button
        className="button light"
        disabled={busy}
        onClick={() => void run(refresh)}
      >
        Yangilash
      </button>
      {!state ? (
        <p role="status">Yuklanmoqda…</p>
      ) : (
        <>
          <section className="panel" aria-busy={busy}>
            <h2>Yetkazib berish sozlamalari</h2>
            <p>
              Telegram:{" "}
              <strong>
                {!state.telegram.available
                  ? "Sozlanmagan"
                  : state.telegram.connected
                    ? "Ulangan"
                    : "Ulanmagan"}
              </strong>{" "}
              · Bildirishnomalar:{" "}
              {state.telegram.optedIn ? "Rozilik berilgan" : "O‘chirilgan"}
            </p>
            <Link to="/settings/telegram">
              Telegramni ulash yoki xabarlardan voz kechish
            </Link>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void run(async () => {
                  await api("/daily-reports/settings", {
                    method: "PATCH",
                    body: JSON.stringify(state.settings),
                  });
                  setPreview("");
                  await refresh();
                }, "Sozlamalar saqlandi.");
              }}
            >
              <fieldset disabled={busy}>
                <legend>Shaxsiy hisobot</legend>
                <label>
                  <input
                    type="checkbox"
                    role="switch"
                    checked={state.settings.enabled}
                    onChange={(e) => change({ enabled: e.target.checked })}
                  />{" "}
                  Kunlik hisobotlarni yoqish
                </label>
                <label>
                  Yetkazish vaqti
                  <input
                    className="plain-input"
                    type="time"
                    required
                    value={state.settings.time}
                    onChange={(e) => change({ time: e.target.value })}
                  />
                </label>
                <div className="daily-time-grid">
                  <label>
                    Sokin vaqt boshlanishi
                    <input
                      className="plain-input"
                      type="time"
                      required
                      value={state.settings.quietStart}
                      onChange={(e) => change({ quietStart: e.target.value })}
                    />
                  </label>
                  <label>
                    Sokin vaqt tugashi
                    <input
                      className="plain-input"
                      type="time"
                      required
                      value={state.settings.quietEnd}
                      onChange={(e) => change({ quietEnd: e.target.value })}
                    />
                  </label>
                </div>
                <p>
                  Bir xil boshlanish va tugash sokin vaqtni o‘chiradi.
                  Markazning sokin vaqti ham hisobga olinadi.
                </p>
                <fieldset>
                  <legend>Hisobot bo‘limlari (kamida bitta)</legend>
                  {Object.entries(names).map(([key, label]) => (
                    <label key={key}>
                      <input
                        type="checkbox"
                        checked={state.settings.sections.includes(key)}
                        onChange={(e) =>
                          change({
                            sections: e.target.checked
                              ? [...state.settings.sections, key]
                              : state.settings.sections.filter(
                                  (s) => s !== key,
                                ),
                          })
                        }
                      />{" "}
                      {label}
                    </label>
                  ))}
                </fieldset>
                <button
                  className="button primary"
                  disabled={!state.settings.sections.length}
                >
                  {busy ? "Saqlanmoqda…" : "Saqlash"}
                </button>
              </fieldset>
            </form>
          </section>
          <section className="panel">
            <h2>Hisobotni ko‘rish</h2>
            <p>
              Ko‘rish va sinov saqlangan bo‘limlardan foydalanadi. Sinov har
              kuni bir marta, sokin vaqtdan tashqarida navbat orqali yuboriladi.
            </p>
            <div className="daily-actions">
              <button
                className="button light"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const p = await api<{ text: string }>(
                      "/daily-reports/preview",
                    );
                    setPreview(p.text);
                  })
                }
              >
                Oldindan ko‘rish
              </button>
              <button
                className="button primary"
                disabled={
                  busy ||
                  !state.telegram.available ||
                  !state.telegram.connected ||
                  !state.telegram.optedIn
                }
                onClick={() =>
                  void run(async () => {
                    await api("/daily-reports/test", {
                      method: "POST",
                      body: "{}",
                    });
                    await refresh();
                  }, "Sinov navbati qayd etildi. Yetkazilish holatini tarixdan tekshiring.")
                }
              >
                Sinov hisobotini yuborish
              </button>
            </div>
            {preview && <pre aria-label="Hisobot matni">{preview}</pre>}
          </section>
          <section className="panel">
            <h2>Hisobotlar tarixi</h2>
            {history &&
              (history.jobs.length ? (
                <>
                  <div
                    className="table-scroll"
                    tabIndex={0}
                    role="region"
                    aria-label="Hisobotlar tarixi"
                  >
                    <table>
                      <thead>
                        <tr>
                          <th scope="col">Sana</th>
                          <th scope="col">Turi</th>
                          <th scope="col">Holat</th>
                        </tr>
                      </thead>
                      <tbody>
                        {history.jobs.map((j) => (
                          <tr key={j._id}>
                            <td>{j.eventDate}</td>
                            <td>
                              {j.kind === "owner_test" ? "Sinov" : "Kunlik"}
                            </td>
                            <td>
                              {statuses[j.status] ?? j.status}
                              {j.errorCode === "UNKNOWN_OUTCOME"
                                ? " · Yetkazilganligi noma’lum; avtomatik takrorlanmaydi"
                                : j.errorCode
                                  ? ` · ${j.errorCode}`
                                  : ""}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="daily-actions">
                    <button
                      className="button light"
                      disabled={busy || history.page <= 1}
                      onClick={() => void run(() => refresh(history.page - 1))}
                    >
                      Oldingi
                    </button>
                    <span>{history.page}-sahifa</span>
                    <button
                      className="button light"
                      disabled={busy || history.page * 20 >= history.total}
                      onClick={() => void run(() => refresh(history.page + 1))}
                    >
                      Keyingi
                    </button>
                  </div>
                </>
              ) : (
                <p>Hisobotlar hali mavjud emas.</p>
              ))}
          </section>
        </>
      )}
    </div>
  );
}
