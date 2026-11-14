import { useEffect, useRef, useState, type FormEvent } from "react";
import type { StudentAccountView, StudentStatus } from "@softlans/contracts";
import { KeyRound } from "lucide-react";
import { api, HttpError } from "./api";
import { ErrorState, LoadingSkeleton, StatusBadge } from "./ui";

export function StudentAccount({
  studentId,
  status,
}: {
  studentId: string;
  status: StudentStatus;
}) {
  const [data, setData] = useState<StudentAccountView | null>(null),
    [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0),
    [editing, setEditing] = useState(false),
    [busy, setBusy] = useState(false),
    [success, setSuccess] = useState("");
  const [fields, setFields] = useState<Record<string, string>>({});
  const form = useRef<HTMLFormElement>(null),
    opener = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    setData(null);
    setError("");
    setEditing(false);
    setSuccess("");
    api<StudentAccountView>(`/students/${studentId}/account`)
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError((e as Error).message);
      });
    return () => {
      active = false;
    };
  }, [studentId, attempt]);
  useEffect(() => {
    if (editing)
      form.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, [editing]);
  function reject(errors: Record<string, string>) {
    setFields(errors);
    setError("Kiritilgan ma’lumotlarni tekshiring.");
    (
      form.current?.elements.namedItem(
        Object.keys(errors)[0] ?? "",
      ) as HTMLInputElement | null
    )?.focus();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || status === "archived") return;
    const values = new FormData(event.currentTarget),
      email = String(values.get("email") ?? "").trim(),
      password = String(values.get("password") ?? "");
    const invalid: Record<string, string> = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254)
      invalid.email = "To‘g‘ri email manzilini kiriting.";
    if (password.length < 12)
      invalid.password = "Parol kamida 12 ta belgidan iborat bo‘lsin.";
    else if (new TextEncoder().encode(password).length > 72)
      invalid.password = "Parol 72 UTF-8 baytdan oshmasin.";
    if (Object.keys(invalid).length) {
      reject(invalid);
      return;
    }
    setBusy(true);
    setError("");
    setFields({});
    setSuccess("");
    try {
      const result = await api<StudentAccountView>(
        `/students/${studentId}/account`,
        { method: "POST", body: JSON.stringify({ email, password }) },
      );
      setData(result);
      form.current?.reset();
      setEditing(false);
      setSuccess(
        "O‘quvchi kabineti ochildi. Kirish ma’lumotlarini o‘quvchiga alohida yetkazing.",
      );
    } catch (e) {
      if (e instanceof HttpError && e.fields)
        reject(
          Object.fromEntries(
            Object.entries(e.fields).map(([key, errors]) => [
              key,
              errors[0] ?? "Maydonni tekshiring.",
            ]),
          ),
        );
      else setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section
      className="panel student-account-panel"
      aria-labelledby="student-account-title"
    >
      <div className="section-heading">
        <h2 id="student-account-title">
          <KeyRound size={20} aria-hidden="true" /> O‘quvchi kabineti
        </h2>
        {data?.account && (
          <StatusBadge>
            {status === "archived" || !data.account.active
              ? "Kirish yopiq"
              : "Kirish ochiq"}
          </StatusBadge>
        )}
      </div>
      {success && (
        <p className="student-success" role="status">
          {success}
        </p>
      )}
      {!data ? (
        error ? (
          <ErrorState
            message={error}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        ) : (
          <LoadingSkeleton label="Kabinet holati yuklanmoqda…" />
        )
      ) : data.account ? (
        <>
          <p>O‘quvchi ushbu email orqali tizimga kiradi.</p>
          <div className="info-row">
            <span>Email</span>
            <strong>{data.account.email}</strong>
          </div>
        </>
      ) : (
        <>
          <p className="muted">
            O‘quvchi dars jadvali, davomati va to‘lovlarini shaxsiy kabinetida
            ko‘radi.
          </p>
          {status === "archived" ? (
            <p>Kabinet ochish uchun avval o‘quvchini faollashtiring.</p>
          ) : !editing ? (
            <button
              ref={opener}
              className="button primary"
              onClick={() => {
                setError("");
                setFields({});
                setEditing(true);
              }}
            >
              Kabinet ochish
            </button>
          ) : (
            <form
              ref={form}
              className="auth-form"
              noValidate
              onSubmit={submit}
              aria-busy={busy}
            >
              <label htmlFor="student-account-email">Kabinet emaili</label>
              <input
                className="plain-input"
                id="student-account-email"
                name="email"
                type="email"
                autoComplete="off"
                maxLength={254}
                required
                disabled={busy}
                aria-invalid={!!fields.email}
                aria-describedby={
                  fields.email ? "student-account-email-error" : undefined
                }
              />
              {fields.email && (
                <p
                  className="password-field-error"
                  id="student-account-email-error"
                >
                  {fields.email}
                </p>
              )}
              <label htmlFor="student-account-password">
                Boshlang‘ich parol
              </label>
              <input
                className="plain-input"
                id="student-account-password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                disabled={busy}
                aria-invalid={!!fields.password}
                aria-describedby={
                  fields.password
                    ? "student-account-password-error"
                    : "student-account-password-help"
                }
              />
              <p className="muted" id="student-account-password-help">
                Kamida 12 ta belgi, ko‘pi bilan 72 UTF-8 bayt.
              </p>
              {fields.password && (
                <p
                  className="password-field-error"
                  id="student-account-password-error"
                >
                  {fields.password}
                </p>
              )}
              {error && (
                <p className="notice" role="alert">
                  {error}
                </p>
              )}
              <div className="student-actions">
                <button
                  className="button primary"
                  disabled={busy}
                  type="submit"
                >
                  {busy ? "Ochilmoqda…" : "Kabinetni ochish"}
                </button>
                <button
                  className="button light"
                  disabled={busy}
                  type="button"
                  onClick={() => {
                    setEditing(false);
                    setError("");
                    setFields({});
                    requestAnimationFrame(() => opener.current?.focus());
                  }}
                >
                  Bekor qilish
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </section>
  );
}
