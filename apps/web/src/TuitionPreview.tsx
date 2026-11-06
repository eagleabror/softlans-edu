import { useEffect, useState } from "react";
import type { BillingCalculation, TuitionPreview } from "@softlans/contracts";
import { api } from "./api";
const uzs = (n: number) => `${Math.round(n).toLocaleString("uz-UZ")} UZS`;
export function TuitionCalculation({
  calculation: c,
}: {
  calculation: BillingCalculation;
}) {
  return (
    <section
      className="tuition-preview"
      aria-label="Darslar bo‘yicha to‘lov hisobi"
    >
      <h3>{c.month} · Darslar bo‘yicha hisob</h3>
      <dl>
        <div>
          <dt>Oylik narx</dt>
          <dd>{uzs(c.monthlyFee)}</dd>
        </div>
        <div>
          <dt>Jami darslar</dt>
          <dd>{c.totalLessons}</dd>
        </div>
        <div>
          <dt>Qolgan darslar</dt>
          <dd>{c.eligibleLessons}</dd>
        </div>
        <div>
          <dt>Bir darsning taxminiy narxi</dt>
          <dd>{uzs(c.approximateLessonPrice)}</dd>
        </div>
        <div>
          <dt>Yakuniy to‘lov</dt>
          <dd>
            <strong>{uzs(c.calculatedAmount)}</strong>
          </dd>
        </div>
        <div>
          <dt>To‘lov muddati</dt>
          <dd>
            {new Intl.DateTimeFormat("uz-UZ", {
              timeZone: "Asia/Tashkent",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
              hourCycle: "h23",
            }).format(new Date(c.dueDate))}
          </dd>
        </div>
      </dl>
      <p className="muted">
        {c.policy === "first_partial_month"
          ? "Faqat birinchi qisman oy darslarga mutanosib hisoblanadi. Keyingi oylar — to‘liq oylik narx."
          : "To‘liq oylik narx siyosati qo‘llanadi."}{" "}
        Qo‘lda chegirma alohida kiritiladi.
      </p>
      {c.totalLessons === 0 && (
        <p>Bu oyda rejalashtirilgan darslar yo‘q. To‘lov: 0 UZS.</p>
      )}
    </section>
  );
}
export function EnrollmentBilling({
  groupId,
  studentId,
  disabled,
  onEnroll,
}: {
  groupId: string;
  studentId: string;
  disabled: boolean;
  onEnroll: (key: string) => Promise<void>;
}) {
  const [preview, setPreview] = useState<
    (TuitionPreview & { previewKey: string }) | null
  >(null);
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!studentId) return;
    let active = true;
    setPreview(null);
    setError("");
    api<TuitionPreview & { previewKey: string }>(
      `/groups/${groupId}/billing-preview?studentId=${studentId}`,
    )
      .then((p) => {
        if (active) setPreview(p);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [groupId, studentId, version]);
  if (!studentId) return null;
  return (
    <form
      className="enrollment-billing auth-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!preview || disabled) return;
        await onEnroll(preview.previewKey);
        // Always refresh: a lesson may have started between preview and submission.
        setVersion((v) => v + 1);
      }}
    >
      {!preview && !error && <p role="status">To‘lov hisoblanmoqda…</p>}
      {error && (
        <p className="notice" role="alert">
          {error}
        </p>
      )}
      <button
        type="button"
        className="button light"
        disabled={disabled}
        onClick={() => setVersion((v) => v + 1)}
      >
        Hisobni yangilash
      </button>
      {preview && (
        <>
          {preview.existingCharge ? (
            <p role="status">
              Bu oy uchun hisob mavjud. Yangi hisob yaratilmaydi va mavjud summa
              o‘zgarmaydi.
            </p>
          ) : (
            <>
              <TuitionCalculation calculation={preview.calculation} />
              {!preview.automatic && (
                <p>
                  Hozir hisob yaratilmaydi. Faol o‘quvchi va faol guruh uchun
                  guruh boshlangan oyda avtomatik hisoblanadi.
                </p>
              )}
            </>
          )}
          {preview.automatic && !preview.existingCharge && (
            <label>
              <input
                key={preview.previewKey}
                type="checkbox"
                required
                disabled={disabled}
              />{" "}
              To‘lov hisobini ko‘rdim va tasdiqlayman
            </label>
          )}
        </>
      )}
      <button className="button primary" disabled={disabled || !preview}>
        {disabled ? "Saqlanmoqda…" : "Qo‘shish"}
      </button>
    </form>
  );
}
