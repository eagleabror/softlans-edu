import { useEffect, useState } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Download, ChartNoAxesCombined } from "lucide-react";
import type { FinancialReport, GroupsView } from "@softlans/contracts";
import { api } from "./api";
import { uzs } from "./Billing";

export function reportDates(months: number, last = false, now = new Date()) {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const d = new Date(`${today.slice(0, 7)}-01T00:00:00Z`);
  if (last) {
    const end = new Date(+d - 86400000).toISOString().slice(0, 10);
    d.setUTCMonth(d.getUTCMonth() - 1);
    return { start: d.toISOString().slice(0, 10), end };
  }
  d.setUTCMonth(d.getUTCMonth() - months + 1);
  return { start: d.toISOString().slice(0, 10), end: today };
}
const methodNames: Record<string, string> = {
  cash: "Naqd",
  bank_transfer: "Bank o‘tkazmasi",
  click_manual: "Click (qo‘lda)",
};
const agingNames: Record<string, string> = {
  upcoming: "Muddati kelmagan",
  "1-7": "1–7 kun",
  "8-30": "8–30 kun",
  "31+": "30 kundan ortiq",
};
function Chart({
  title,
  rows,
  series,
  horizontal = false,
}: {
  title: string;
  horizontal?: boolean;
  rows: Record<string, string | number>[];
  series: { key: string; name: string; color: string }[];
}) {
  return (
    <section className="panel report-chart">
      <h2>{title}</h2>
      <p className="muted">
        UZS · Ustun ustiga kursor olib boring yoki klaviatura bilan tanlang.
      </p>
      <div className="report-chart-canvas" aria-label={title}>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart
            data={rows}
            accessibilityLayer
            layout={horizontal ? "vertical" : "horizontal"}
          >
            <CartesianGrid strokeDasharray="3 3" vertical={false} />
            {horizontal ? (
              <>
                <XAxis
                  type="number"
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("uz-UZ", {
                      notation: "compact",
                    }).format(v)
                  }
                />
                <YAxis
                  type="category"
                  dataKey="label"
                  width={120}
                  tick={{ fontSize: 12 }}
                  interval={0}
                />
              </>
            ) : (
              <>
                <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                <YAxis
                  width={60}
                  tickFormatter={(v) =>
                    new Intl.NumberFormat("uz-UZ", {
                      notation: "compact",
                    }).format(v)
                  }
                />
              </>
            )}
            <Tooltip formatter={(v) => uzs(Number(v))} />
            <Legend />
            {series.map((s) => (
              <Bar
                key={s.key}
                dataKey={s.key}
                name={s.name}
                fill={s.color}
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
      <details>
        <summary>Jadval ko‘rinishi</summary>
        <div className="table-scroll">
          <table>
            <caption>{title} (UZS)</caption>
            <thead>
              <tr>
                <th scope="col">Davr / tur</th>
                {series.map((s) => (
                  <th scope="col" key={s.key}>
                    {s.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <th scope="row">{r.label}</th>
                  {series.map((s) => (
                    <td key={s.key}>{uzs(Number(r[s.key]))}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
export function FinancialReports() {
  const [preset, setPreset] = useState("6"),
    [dates, setDates] = useState(() => reportDates(6)),
    [groupId, setGroup] = useState(""),
    [search, setSearch] = useState(""),
    [optionPage, setOptionPage] = useState(1),
    [options, setOptions] = useState<GroupsView | null>(null);
  const [data, setData] = useState<FinancialReport | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [page, setPage] = useState(1),
    [sort, setSort] = useState("billed"),
    [order, setOrder] = useState("desc"),
    [exporting, setExporting] = useState(false);
  const query = new URLSearchParams({
    ...dates,
    ...(groupId ? { groupId } : {}),
    page: String(page),
    pageSize: "20",
    sort,
    order,
  }).toString();
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<GroupsView>(
        `/groups?search=${encodeURIComponent(search)}&page=${optionPage}&pageSize=20`,
      )
        .then((r) => {
          if (active) setOptions(r);
        })
        .catch(() => {
          if (active) setError("Guruhlar yuklanmadi. Qayta urinib ko‘ring.");
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [search, optionPage, retry]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(null);
    setError("");
    api<FinancialReport>(`/analytics/dashboard?${query}`)
      .then((r) => {
        if (active) setData(r);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [query, retry]);
  async function download(report: string) {
    setExporting(true);
    try {
      const r = await fetch(`/api/analytics/export?${query}&report=${report}`, {
        credentials: "include",
      });
      if (!r.ok) {
        const e = await r.json();
        throw new Error(e.error?.message ?? "Eksport bajarilmadi.");
      }
      const url = URL.createObjectURL(await r.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = `moliyaviy-${report}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  return (
    <div className="financial-reports">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MOLIYA TAHLILI</p>
          <h1>Moliyaviy hisobotlar</h1>
          <p className="muted">
            Yig‘ilgan to‘lovlar, hisoblar va qarz holati bir joyda.
          </p>
        </div>
        <ChartNoAxesCombined aria-hidden size={30} />
      </div>
      <section className="panel report-filters" aria-label="Hisobot filtrlari">
        <label>
          Davr
          <select
            className="plain-input"
            value={preset}
            onChange={(e) => {
              const v = e.target.value;
              setPreset(v);
              setPage(1);
              if (v !== "custom")
                setDates(
                  reportDates(v === "last" ? 1 : Number(v), v === "last"),
                );
            }}
          >
            <option value="1">Shu oy</option>
            <option value="last">O‘tgan oy</option>
            {[3, 6, 12].map((n) => (
              <option key={n} value={n}>
                Oxirgi {n} oy
              </option>
            ))}
            <option value="custom">Ixtiyoriy davr</option>
          </select>
        </label>
        {(["start", "end"] as const).map((k) => (
          <label key={k}>
            {k === "start" ? "Boshlanish sanasi" : "Tugash sanasi"}
            <input
              className="plain-input"
              type="date"
              value={dates[k]}
              max={reportDates(1).end}
              onChange={(e) => {
                setPreset("custom");
                setDates({ ...dates, [k]: e.target.value });
                setPage(1);
              }}
            />
          </label>
        ))}
        <label>
          Guruh qidirish
          <input
            className="plain-input"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setOptionPage(1);
            }}
          />
        </label>
        <label>
          Guruh
          <select
            className="plain-input"
            value={groupId}
            onChange={(e) => {
              setGroup(e.target.value);
              setPage(1);
            }}
          >
            <option value="">Barcha guruhlar</option>
            {groupId && !options?.groups.some((g) => g.id === groupId) && (
              <option value={groupId}>Tanlangan guruh</option>
            )}
            {options?.groups.map((g) => (
              <option value={g.id} key={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {options && options.total > 20 && (
          <div className="report-actions">
            <button
              className="button light"
              disabled={optionPage === 1}
              onClick={() => setOptionPage((p) => p - 1)}
            >
              Oldingi guruhlar
            </button>
            <span>{optionPage}</span>
            <button
              className="button light"
              disabled={optionPage * 20 >= options.total}
              onClick={() => setOptionPage((p) => p + 1)}
            >
              Keyingi guruhlar
            </button>
          </div>
        )}
      </section>
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button
            className="button light"
            onClick={() => setRetry((r) => r + 1)}
          >
            Qayta urinish
          </button>
        </div>
      )}
      {loading && (
        <div role="status" className="report-skeleton">
          Yuklanmoqda…
          <div className="stats-grid" aria-hidden>
            {[1, 2, 3, 4].map((n) => (
              <div className="stat-card" key={n}>
                —
              </div>
            ))}
          </div>
        </div>
      )}
      {data && !loading && (
        <>
          <section className="panel report-context">
            <strong>
              {data.period.start} — {data.period.end} · Asia/Tashkent
            </strong>
            <p>
              To‘lovlar — to‘lov sanasi bo‘yicha. Hisoblar va yig‘im —{" "}
              {data.period.firstMonth} — {data.period.lastMonth} hisob oylariga
              tegishli, {data.period.end} kun oxirigacha yig‘ilgan summa.
            </p>
            <p>
              Muddati o‘tgan qarz, qarzdorlar va qarz muddati —{" "}
              {data.period.end} holatiga barcha oldingi hisob oylari bo‘yicha.
              Bekor qilingan hisoblar va qaytarilgan to‘lovlar chiqarilgan.
              Hisob tuzatishlari va qaytarishlar joriy holatda olinadi.
            </p>
          </section>
          <div className="stats-grid report-kpis">
            {[
              [
                "Qabul qilingan to‘lovlar",
                uzs(data.summary.payments),
                "To‘lov sanasi bo‘yicha",
              ],
              [
                "Hisoblangan summa",
                uzs(data.summary.billed),
                "Tanlangan hisob oylari",
              ],
              [
                "Qolgan balans",
                uzs(data.summary.outstanding),
                "Tanlangan hisob oylari",
              ],
              [
                "Muddati o‘tgan qarz",
                uzs(data.summary.overdue),
                "Barcha oldingi hisob oylari",
              ],
              [
                "Yig‘im darajasi",
                `${data.summary.rate}%`,
                "Hisob summasiga nisbatan, ko‘pi bilan 100%",
              ],
              [
                "To‘lovlar soni",
                data.summary.paymentCount,
                "To‘lov sanasi bo‘yicha",
              ],
              [
                "Qarzdor o‘quvchilar",
                data.summary.debtors,
                "Takrorlanmas, barcha oldingi hisob oylari",
              ],
            ].map(([label, value, note]) => (
              <section className="stat-card" key={label}>
                <p>{label}</p>
                <strong>{value}</strong>
                <p>{note}</p>
              </section>
            ))}
          </div>
          {data.summary.billed === 0 && data.summary.payments === 0 && (
            <p className="panel" role="status">
              Tanlangan davrda hisoblar va to‘lovlar topilmadi. Boshqa davr yoki
              guruhni tanlang.
            </p>
          )}
          <div className="report-actions" aria-label="CSV eksport">
            {[
              ["monthly", "Oylik xulosa"],
              ["groups", "Guruhlar"],
              ["methods", "To‘lov usullari"],
              ["aging", "Qarz muddati"],
            ].map(([key, label]) => (
              <button
                key={key}
                className="button light"
                disabled={exporting}
                onClick={() => download(key!)}
              >
                <Download size={16} aria-hidden />
                {label} CSV
              </button>
            ))}
            {exporting && <span role="status">Tayyorlanmoqda…</span>}
          </div>
          <div className="report-charts">
            <Chart
              title="Oylik to‘lovlar"
              rows={data.monthly.map((r) => ({ ...r, label: r.month }))}
              series={[
                {
                  key: "payments",
                  name: "To‘lov sanasi bo‘yicha",
                  color: "#263e35",
                },
              ]}
            />
            <Chart
              title="Hisoblar va yig‘im"
              rows={data.monthly.map((r) => ({ ...r, label: r.month }))}
              series={[
                { key: "billed", name: "Hisoblangan", color: "#899e66" },
                {
                  key: "collected",
                  name: "Hisob oyiga yig‘ilgan",
                  color: "#263e35",
                },
              ]}
            />
            <Chart
              horizontal
              title="Qarz muddati"
              rows={data.aging.map((r) => ({
                ...r,
                label: agingNames[r.bucket]!,
              }))}
              series={[
                { key: "amount", name: "Qolgan qarz", color: "#846122" },
              ]}
            />
            <Chart
              horizontal
              title="To‘lov usullari"
              rows={data.methods.map((r) => ({
                ...r,
                label: methodNames[r.method]!,
              }))}
              series={[
                {
                  key: "amount",
                  name: "Qabul qilingan to‘lovlar",
                  color: "#263e35",
                },
              ]}
            />
          </div>
          <section className="panel report-groups">
            <h2>Guruhlar bo‘yicha natijalar</h2>
            <p className="muted">
              O‘quvchilar — joriy faol a’zolar soni. Summalar — tanlangan hisob
              oylariga tegishli.
            </p>
            <div
              className="table-scroll"
              tabIndex={0}
              aria-label="Guruhlar moliyasi"
            >
              <table>
                <caption>Guruhlar moliyaviy ko‘rsatkichlari</caption>
                <thead>
                  <tr>
                    {[
                      ["name", "Guruh"],
                      ["students", "O‘quvchilar"],
                      ["billed", "Hisoblangan"],
                      ["collected", "Yig‘ilgan"],
                      ["outstanding", "Qoldiq"],
                      ["rate", "Yig‘im (%)"],
                    ].map(([key, label]) => (
                      <th
                        key={key}
                        scope="col"
                        aria-sort={
                          sort === key
                            ? order === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button
                          onClick={() => {
                            setSort(key!);
                            setOrder(
                              sort === key && order === "desc" ? "asc" : "desc",
                            );
                            setPage(1);
                          }}
                        >
                          {label}{" "}
                          {sort === key ? (order === "asc" ? "↑" : "↓") : ""}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.groups.map((g) => (
                    <tr key={g.id}>
                      <th scope="row">{g.name}</th>
                      <td>{g.students}</td>
                      <td>{uzs(g.billed)}</td>
                      <td>{uzs(g.collected)}</td>
                      <td>{uzs(g.outstanding)}</td>
                      <td>{g.rate}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.groups.length && <p>Guruhlar topilmadi.</p>}
            <div className="report-actions">
              <button
                className="button light"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Oldingi
              </button>
              <span>
                {page}-sahifa · {data.totalGroups} guruh
              </span>
              <button
                className="button light"
                disabled={page * 20 >= data.totalGroups}
                onClick={() => setPage((p) => p + 1)}
              >
                Keyingi
              </button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
