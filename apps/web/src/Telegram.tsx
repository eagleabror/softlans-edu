import { useEffect, useRef, useState } from "react";
import { api } from "./api";
type Connection = {
  available: boolean;
  connected: boolean;
  linkedAt: string | null;
  notificationPreferences: { enabled: boolean };
};
export function TelegramSettings() {
  const [state, setState] = useState<Connection | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [link, setLink] = useState<{ link: string; expiresAt: string } | null>(
    null,
  );
  const dialog = useRef<HTMLDialogElement>(null);
  async function refresh() {
    const result = await api<Connection>("/integrations/telegram");
    setState(result);
    if (result.connected) setLink(null);
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
  return (
    <>
      <div className="page-heading">
        <div>
          <p>Sozlamalar</p>
          <h1>Telegram</h1>
          <p>Shaxsiy hisobingizni SoftLans Edu botiga ulang.</p>
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
      <section className="panel telegram-settings" aria-busy={busy}>
        <h2>Telegram bilan ulanish</h2>
        {!state ? (
          <p role="status">Yuklanmoqda…</p>
        ) : (
          <>
            <p>
              Holat:{" "}
              <strong>{state.connected ? "Ulangan" : "Ulanmagan"}</strong>
            </p>
            {!state.available && (
              <p>
                Telegram integratsiyasi hozircha sozlanmagan. Mas’ul shaxsga
                murojaat qiling.
              </p>
            )}
            {state.connected ? (
              <>
                <label>
                  <input
                    type="checkbox"
                    checked={state.notificationPreferences.enabled}
                    disabled={busy}
                    onChange={(e) => {
                      const enabled = e.target.checked;
                      void run(async () => {
                        await api("/integrations/telegram/preferences", {
                          method: "PATCH",
                          body: JSON.stringify({ enabled }),
                        });
                        await refresh();
                      }, "Sozlamalar saqlandi.");
                    }}
                  />{" "}
                  Telegram bildirishnomalarini olish
                </label>
                <p>
                  Shaxsiy hisob sozlamalari. Ota-onalar xabarlari alohida
                  boshqariladi. /stop buyrug‘i bildirishnomalarni o‘chiradi.
                </p>
                <button
                  className="button light"
                  disabled={busy}
                  onClick={() => dialog.current?.showModal()}
                >
                  Telegramni uzish
                </button>
              </>
            ) : (
              <button
                className="button primary"
                disabled={busy || !state.available}
                onClick={() =>
                  void run(async () => {
                    setLink(
                      await api("/integrations/telegram/link", {
                        method: "POST",
                        body: "{}",
                      }),
                    );
                  })
                }
              >
                Telegramni ulash
              </button>
            )}
            {link && (
              <div>
                <p>
                  Havola bir marta ishlaydi va 10 daqiqada tugaydi. Uni boshqa
                  kishiga yubormang.
                </p>
                <a
                  className="button primary"
                  href={link.link}
                  target="_blank"
                  rel="noopener noreferrer"
                  referrerPolicy="no-referrer"
                >
                  Telegramda ochish
                </a>
                <p>
                  Amal qilish muddati:{" "}
                  {new Date(link.expiresAt).toLocaleTimeString("uz-UZ")}
                </p>
              </div>
            )}
          </>
        )}
        <button
          className="button light"
          disabled={busy}
          onClick={() => void run(refresh)}
        >
          {busy ? "Yuklanmoqda…" : "Holatni yangilash"}
        </button>
      </section>
      <dialog
        className="member-dialog"
        ref={dialog}
        aria-labelledby="telegram-disconnect-title"
      >
        <h2 id="telegram-disconnect-title">Telegram ulanishini uzasizmi?</h2>
        <p>Ulash havolalari bekor qilinadi va bildirishnomalar to‘xtatiladi.</p>
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
              await api("/integrations/telegram/disconnect", {
                method: "POST",
                body: "{}",
              });
              setLink(null);
              await refresh();
              dialog.current?.close();
            }, "Telegram ulanishi uzildi.")
          }
        >
          Ulanishni uzish
        </button>
      </dialog>
    </>
  );
}
