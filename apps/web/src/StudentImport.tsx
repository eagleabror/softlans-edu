import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";
const fields = [
  ["firstName", "Ism *"],
  ["lastName", "Familiya *"],
  ["phone", "Telefon"],
  ["parentName", "Ota-ona ismi"],
  ["parentPhone", "Ota-ona telefoni"],
  ["birthDate", "Tug‘ilgan sana"],
  ["enrollmentDate", "Qabul sanasi"],
  ["notes", "Izoh"],
] as const;
type Preview = {
  id: string;
  revision: number;
  headers: string[];
  sheets?: string[];
  mapping: Record<string, number>;
  totalRows: number;
  validRows: number;
  invalidRows: number;
  duplicateRows: number;
  rows: {
    row: number;
    data?: Record<string, string>;
    errors: string[];
    duplicate: boolean;
  }[];
};
type Result = {
  id: string;
  filename: string;
  status: string;
  totalRows: number;
  importedRows: number;
  skippedRows: number;
  failedRows: number;
  errorSummary?: string;
  startedAt?: string;
};
const statuses: Record<string, string> = {
  preview: "Tasdiq kutilmoqda",
  running: "Bajarilmoqda",
  completed: "Yakunlandi",
  partial: "Qisman bajarildi",
  failed: "Bajarilmadi",
};
export function StudentImport() {
  const [file, setFile] = useState<File | null>(null),
    [sheet, setSheet] = useState(0);
  const [parsedSheet, setParsedSheet] = useState(0);
  const [preview, setPreview] = useState<Preview | null>(null),
    [mapping, setMapping] = useState<Record<string, number>>({});
  const [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [duplicates, setDuplicates] = useState("skip"),
    [consent, setConsent] = useState(false),
    [confirm, setConfirm] = useState(false);
  const [result, setResult] = useState<Result | null>(null),
    [history, setHistory] = useState<Result[]>([]),
    [historyError, setHistoryError] = useState(""),
    [historyLoading, setHistoryLoading] = useState(true),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [reload, setReload] = useState(0);
  const [key, setKey] = useState("");
  useEffect(() => {
    let active = true;
    setHistoryLoading(true);
    setHistoryError("");
    api<{ imports: Result[]; total: number }>(`/student-imports?page=${page}`)
      .then((d) => {
        if (active) {
          setHistory(d.imports);
          setTotal(d.total);
        }
      })
      .catch((e) => {
        if (active) setHistoryError(e.message);
      })
      .finally(() => {
        if (active) setHistoryLoading(false);
      });
    return () => {
      active = false;
    };
  }, [page, reload]);
  useEffect(() => {
    if (result?.status !== "running") return;
    const timer = setInterval(() => {
      api<{ import: Result }>(`/student-imports/${result.id}`)
        .then((d) => {
          setResult(d.import);
          if (d.import.status !== "running") setReload((v) => v + 1);
        })
        .catch((e) => setError(e.message));
    }, 2000);
    return () => clearInterval(timer);
  }, [result?.id, result?.status]);
  async function run(task: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await task();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload() {
    await run(async () => {
      if (
        !file ||
        !/\.(csv|xlsx)$/i.test(file.name) ||
        file.size > 5 * 1024 * 1024 ||
        !file.size
      )
        throw new Error(
          "Bo‘sh bo‘lmagan XLSX yoki CSV fayl tanlang. Hajmi 5 MB dan oshmasin.",
        );
      const data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result).split(",")[1]!);
        reader.onerror = () => reject(new Error("Faylni o‘qib bo‘lmadi."));
        reader.readAsDataURL(file);
      });
      const p = await api<Preview>("/student-imports/preview", {
        method: "POST",
        body: JSON.stringify({ filename: file.name, data, sheet }),
      });
      setParsedSheet(sheet);
      setPreview(p);
      setMapping(p.mapping);
      setDirty(false);
      setResult(null);
      setKey(crypto.randomUUID());
      setConfirm(false);
      setConsent(false);
      setReload((v) => v + 1);
    });
  }
  async function remap() {
    await run(async () => {
      const p = await api<Preview>(`/student-imports/${preview!.id}/mapping`, {
        method: "POST",
        body: JSON.stringify({ mapping, revision: preview!.revision }),
      });
      setPreview({ ...p, sheets: preview!.sheets });
      setDirty(false);
      setConfirm(false);
    });
  }
  async function commit() {
    await run(async () => {
      const d = await api<{ import: Result }>(
        `/student-imports/${preview!.id}/commit`,
        {
          method: "POST",
          body: JSON.stringify({
            revision: preview!.revision,
            idempotencyKey: key,
            duplicates,
            confirmDuplicates: consent,
          }),
        },
      );
      setResult(d.import);
      setReload((v) => v + 1);
    });
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>Excel import</h1>
          <p className="muted">O‘quvchilarni XLSX yoki CSV fayldan qo‘shing.</p>
        </div>
        <Link className="button light" to="/students">
          O‘quvchilar
        </Link>
      </div>
      {error && (
        <div className="notice" role="alert">
          {error}
        </div>
      )}
      <section className="panel student-form import-panel" aria-busy={busy}>
        <h2>1. Fayl tanlash</h2>
        <p>
          5 MB gacha · 2 000 qatorgacha · UTF-8 CSV. Ism va familiya majburiy.
          Sanalar: YYYY-MM-DD yoki DD.MM.YYYY. Formulalar qabul qilinmaydi.
        </p>
        <a
          className="button light"
          href="/api/student-imports/template"
          download
        >
          Excel namuna faylini yuklab olish
        </a>
        <fieldset disabled={busy || result?.status === "running"}>
          <label htmlFor="import-file">Import fayli</label>
          <input
            id="import-file"
            className="plain-input"
            type="file"
            accept=".xlsx,.csv"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setPreview(null);
              setResult(null);
              setSheet(0);
            }}
          />
          {!!preview?.sheets?.length && preview.sheets.length > 1 && (
            <label>
              Import uchun bitta varaq
              <select
                className="plain-input"
                value={sheet}
                onChange={(e) => {
                  setSheet(Number(e.target.value));
                  setDirty(true);
                }}
              >
                {preview.sheets.map((s, i) => (
                  <option key={i} value={i}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button
            className="button primary"
            disabled={!file}
            type="button"
            onClick={upload}
          >
            {busy ? "Tekshirilmoqda…" : "Faylni tekshirish"}
          </button>
        </fieldset>
        {busy && <p role="status">So‘rov bajarilmoqda. Natijani kuting…</p>}
      </section>
      {preview && !result && (
        <section className="panel student-form import-panel">
          <h2>2. Ustunlarni moslashtirish</h2>
          <p>
            Faqat tanlangan bitta varaq import qilinadi. Bo‘sh sana bugungi
            qabul sanasi bilan saqlanadi.
          </p>
          <fieldset disabled={busy}>
            <div className="student-form-grid">
              {fields.map(([field, label]) => (
                <label key={field}>
                  {label}
                  <select
                    className="plain-input"
                    value={mapping[field] ?? ""}
                    onChange={(e) => {
                      const next = { ...mapping };
                      if (e.target.value === "") delete next[field];
                      else next[field] = Number(e.target.value);
                      setMapping(next);
                      setDirty(true);
                      setConfirm(false);
                    }}
                  >
                    <option value="">Tanlanmagan</option>
                    {preview.headers.map((h, i) => (
                      <option key={i} value={i}>
                        {i + 1}. {h || "Sarlavhasiz"}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
            <button
              className="button light"
              type="button"
              disabled={sheet !== parsedSheet}
              onClick={remap}
            >
              Moslashtirish va previewni yangilash
            </button>
          </fieldset>
          <h2>3. Import preview</h2>
          <p role="status">
            Jami: {preview.totalRows} · Yaroqli: {preview.validRows} · Xatoli:{" "}
            {preview.invalidRows} · Ehtimoliy dublikat: {preview.duplicateRows}
          </p>
          {(dirty || sheet !== parsedSheet) && (
            <p className="notice">
              Tanlov o‘zgardi. Previewni yangilang; varaq o‘zgargan bo‘lsa,
              faylni qayta tekshiring.
            </p>
          )}
          <div
            className="table-scroll import-preview"
            tabIndex={0}
            role="region"
            aria-label="Import qatorlari"
          >
            <table>
              <caption>Har bir qator va uning tekshiruv natijasi</caption>
              <thead>
                <tr>
                  <th scope="col">Qator</th>
                  {fields.map(([k, l]) => (
                    <th scope="col" key={k}>
                      {l}
                    </th>
                  ))}
                  <th scope="col">Holat / xato</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((r) => (
                  <tr key={r.row}>
                    <td>{r.row}</td>
                    {fields.map(([k]) => (
                      <td key={k}>{r.data?.[k] || "—"}</td>
                    ))}
                    <td>
                      {r.errors.length
                        ? r.errors.join(" · ")
                        : r.duplicate
                          ? "Ehtimoliy dublikat"
                          : "Yaroqli"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <fieldset disabled={busy || dirty || sheet !== parsedSheet}>
            <label>
              Dublikatlar uchun
              <select
                className="plain-input"
                value={duplicates}
                onChange={(e) => {
                  setDuplicates(e.target.value);
                  setConsent(false);
                  setConfirm(false);
                }}
              >
                <option value="skip">O‘tkazib yuborish</option>
                <option value="add">Yangi o‘quvchi sifatida qo‘shish</option>
              </select>
            </label>
            {duplicates === "add" && (
              <label className="import-check">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(e) => setConsent(e.target.checked)}
                />
                Ehtimoliy dublikatlar ham yangi o‘quvchi sifatida qo‘shilishiga
                roziman.
              </label>
            )}
            <label className="import-check">
              <input
                type="checkbox"
                checked={confirm}
                onChange={(e) => setConfirm(e.target.checked)}
              />
              Previewni tekshirdim. Yaroqli qatorlarni markazimga import
              qilishni tasdiqlayman. Xatoli qatorlar qo‘shilmaydi.
            </label>
            <button
              className="button primary"
              disabled={
                !confirm ||
                !preview.validRows ||
                (duplicates === "add" && !consent)
              }
              type="button"
              onClick={commit}
            >
              {busy ? "Import bajarilmoqda…" : "Importni tasdiqlash"}
            </button>
          </fieldset>
        </section>
      )}
      {result && (
        <section className="panel student-form import-panel" role="status">
          <h2>Natija: {statuses[result.status]}</h2>
          <p>
            Jami: {result.totalRows} · Qo‘shildi: {result.importedRows} ·
            O‘tkazildi: {result.skippedRows} · Xatoli: {result.failedRows}
          </p>
          {result.status === "running" && (
            <progress
              max={result.totalRows}
              value={
                result.importedRows + result.skippedRows + result.failedRows
              }
              aria-label="Qayta ishlangan qatorlar"
            />
          )}
          <p>{result.errorSummary}</p>
          <p>Import ID: {result.id}</p>
          {result.status !== "running" && (
            <button
              className="button light"
              onClick={() => {
                setPreview(null);
                setResult(null);
                setFile(null);
              }}
            >
              Yangi import
            </button>
          )}
        </section>
      )}
      <section className="panel student-form import-panel">
        <h2>Import tarixi</h2>
        {historyLoading ? (
          <p role="status">Tarix yuklanmoqda…</p>
        ) : historyError ? (
          <div role="alert">
            {historyError}
            <button
              className="button light"
              onClick={() => setReload((v) => v + 1)}
            >
              Qayta urinish
            </button>
          </div>
        ) : history.length ? (
          <div className="table-scroll">
            <table>
              <caption>Markazingiz importlari</caption>
              <thead>
                <tr>
                  {[
                    "Fayl",
                    "Holat",
                    "Jami",
                    "Qo‘shildi",
                    "O‘tkazildi",
                    "Xatoli",
                    "Amal",
                  ].map((t) => (
                    <th scope="col" key={t}>
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id}>
                    <td>{h.filename}</td>
                    <td>{statuses[h.status]}</td>
                    <td>{h.totalRows}</td>
                    <td>{h.importedRows}</td>
                    <td>{h.skippedRows}</td>
                    <td>{h.failedRows}</td>
                    <td>
                      <button
                        className="button light"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            const d = await api<{ import: Result }>(
                              `/student-imports/${h.id}`,
                            );
                            setResult(d.import);
                          })
                        }
                      >
                        Natijani ko‘rish
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p>Hali importlar yo‘q.</p>
        )}
        <nav
          className="student-pagination"
          aria-label="Import tarixini sahifalash"
        >
          <button
            className="button light"
            disabled={page === 1 || historyLoading}
            onClick={() => setPage(page - 1)}
          >
            Oldingi
          </button>
          <span>
            {page}-sahifa · Jami: {total}
          </span>
          <button
            className="button light"
            disabled={page * 20 >= total || historyLoading}
            onClick={() => setPage(page + 1)}
          >
            Keyingi
          </button>
        </nav>
      </section>
    </>
  );
}
