import { useEffect, useState } from "react";
import { Download, ChartNoAxesCombined } from "lucide-react";
import { Link } from "react-router-dom";
import type { ManagementReport } from "@softlans/contracts";
import { api } from "./api";
import { uzs } from "./Billing";
import { Chart, reportDates } from "./FinancialReports";

const classes: Record<string, string> = {
  operating: "Operatsion",
  capital: "Kapital xaridi",
  prepayment: "Oldindan to‘lov",
  unclassified: "Tasniflanmagan",
};
export function ManagementReports() {
  const [dates, setDates] = useState(() => reportDates(6));
  const [asOf, setAsOf] = useState("");
  const [data, setData] = useState<ManagementReport | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [groupPage, setGroupPage] = useState(1);
  const query = new URLSearchParams({
    ...dates,
    ...(asOf
      ? { asOf: new Date(`${asOf}T23:59:59.999+05:00`).toISOString() }
      : {}),
  }).toString();
  useEffect(() => {
    let active = true;
    setData(null);
    setGroupPage(1);
    setLoading(true);
    setError("");
    api<ManagementReport>(`/management-reports?${query}`)
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
  async function download() {
    if (!data) return;
    setExporting(true);
    setError("");
    try {
      // Pin export to the displayed recorded cutoff, including newly recorded backdated entries.
      const params = new URLSearchParams({
        start: data.period.start,
        end: data.period.end,
        asOf: data.period.asOf,
      });
      const response = await fetch(`/api/management-reports/export?${params}`, {
        credentials: "include",
      });
      if (!response.ok) {
        const body = await response.json();
        throw new Error(body.error?.message ?? "Eksport bajarilmadi.");
      }
      const url = URL.createObjectURL(await response.blob()),
        a = document.createElement("a");
      a.href = url;
      a.download = "boshqaruv-moliyaviy-hisobot.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  const stats: [string, number | null, string][] = data
    ? [
        [
          "Hisoblangan ta’lim haqi",
          data.summary.billed,
          "Hisob oyiga · invoice asosidagi taxmin",
        ],
        [
          "Haqiqiy tushum",
          data.summary.receipts,
          "To‘lov sanasi · qaytarishlar tuzatish kuniga",
        ],
        [
          "Qarzdorlik",
          data.summary.debt,
          "Davr oxirigacha barcha hisob oylari",
        ],
        [
          "Tasdiqlangan maosh xarajati",
          data.summary.approvedSalary,
          "Payroll oyiga · to‘langan degani emas",
        ],
        [
          "To‘langan maosh",
          data.summary.salaryPaid,
          "Maosh to‘lovi sanasi · qaytarishlar bilan",
        ],
        [
          "Operatsion xarajatlar",
          data.summary.operatingExpenses,
          "Tasniflangan, tasdiqlangan yozuvlar",
        ],
        [
          "Taxminiy moliyaviy natija",
          data.summary.estimatedResult,
          "Boshqaruv bahosi · sertifikatlangan foyda emas",
        ],
        [
          "Kassa va bank qoldiqlari",
          data.cash.accounts.length &&
          data.cash.accounts.every((a) => a.initialized)
            ? data.cash.closing
            : null,
          "Hisobga biriktirilgan tasdiqlangan harakatlar",
        ],
      ]
    : [];
  return (
    <div className="financial-reports management-reports">
      <header className="page-heading">
        <div>
          <h1>Foyda va pul oqimi</h1>
          <p>
            Boshqaruv P&amp;L taxmini va tasdiqlangan kassa harakatlari ·
            Asia/Tashkent
          </p>
        </div>
        <button
          className="button light"
          disabled={!data || exporting || loading}
          onClick={() => void download()}
        >
          <Download size={18} />
          {exporting ? "Yuklanmoqda…" : "CSV eksport"}
        </button>
      </header>
      <section className="panel">
        <h2>Hisobot asoslari</h2>
        <p>
          Hisoblangan ta’lim haqi — invoice asosidagi taxmin; u avtomatik
          ravishda qonuniy tan olingan daromad emas. Maosh qoralamasi xarajat
          yoki to‘lov hisoblanmaydi. Kapital xaridlari va oldindan to‘lovlar
          operatsion xarajatga kiritilmaydi.
        </p>
        <p>
          Ta’lim haqi va maosh tanlangan hisob oylariga tegishli. Tushum,
          xarajat va pul oqimi kunlar oralig‘i bo‘yicha. Xarajatni bekor qilish
          tuzatish oyida ko‘rsatiladi. Bu soliq yoki statut hisobot tizimi emas.
        </p>
      </section>
      <section className="panel report-filters" aria-label="Hisobot filtrlari">
        <label>
          Boshlanish sanasi
          <input
            className="plain-input"
            type="date"
            value={dates.start}
            max={dates.end}
            onChange={(e) => {
              if (e.target.value)
                setDates((d) => ({ ...d, start: e.target.value }));
            }}
          />
        </label>
        <label>
          Tugash sanasi
          <input
            className="plain-input"
            type="date"
            value={dates.end}
            min={dates.start}
            max={reportDates(1).end}
            onChange={(e) => {
              if (e.target.value)
                setDates((d) => ({ ...d, end: e.target.value }));
            }}
          />
        </label>
        <label>
          Qayd chegarasi (kun oxiri)
          <input
            className="plain-input"
            type="date"
            value={asOf}
            min={dates.end}
            max={new Date(Date.parse(reportDates(1).end) - 86400000)
              .toISOString()
              .slice(0, 10)}
            onChange={(e) => setAsOf(e.target.value)}
          />
        </label>
        <button
          className="button light"
          onClick={() => {
            setDates(reportDates(1, true));
            setAsOf("");
          }}
        >
          O‘tgan oy
        </button>
        <button
          className="button light"
          onClick={() => {
            setDates(reportDates(6));
            setAsOf("");
          }}
        >
          6 oy
        </button>
      </section>
      {loading && <p role="status">Yuklanmoqda…</p>}
      {error && (
        <div className="notice" role="alert">
          {error}{" "}
          <button
            className="button light"
            onClick={() => setRetry((v) => v + 1)}
          >
            Qayta urinish
          </button>
        </div>
      )}
      {data && (
        <>
          <section className="stats-grid report-kpis">
            {stats.map(([label, value, note]) => (
              <article className="stat-card" key={label}>
                <div className="stat-top">
                  <p>{label}</p>
                  <ChartNoAxesCombined size={20} aria-hidden="true" />
                </div>
                <strong>
                  {value === null ? "Ma’lumot yetarli emas" : uzs(value)}
                </strong>
                <small>{note}</small>
              </article>
            ))}
          </section>
          <section
            className="panel management-warnings"
            aria-label="Ma’lumot to‘liqligi ogohlantirishlari"
          >
            <h2>Ma’lumot to‘liqligi ogohlantirishlari</h2>
            <p>
              Qayd chegarasi:{" "}
              {new Intl.DateTimeFormat("uz-UZ", {
                dateStyle: "medium",
                timeStyle: "medium",
                timeZone: "Asia/Tashkent",
              }).format(new Date(data.period.asOf))}
              . Manbalar mavjudligi barcha majburiyatlar kiritilganini
              kafolatlamaydi.
            </p>
            {data.warnings.length ? (
              <ul>
                {data.warnings.map((w) => (
                  <li key={w.code + (w.month ?? "")}>
                    {w.month && <strong>{w.month} · </strong>}
                    {w.message}
                  </li>
                ))}
              </ul>
            ) : (
              <p>
                Avtomatik tekshiruvlarda yetishmovchilik topilmadi. Natija
                baribir boshqaruv taxminidir.
              </p>
            )}
            <p>
              Tasniflanmagan operatsiyalar: {data.summary.unclassifiedExpenses}{" "}
              xarajat yozuvi, {data.summary.unclassifiedMovements} qo‘lda pul
              harakati.
            </p>
            <Link to="/expenses/categories">
              Kategoriya tasniflarini ko‘rish
            </Link>
          </section>
          <div className="report-charts">
            <Chart
              title="Oylik ta’lim haqi va tushum"
              rows={data.monthly.map((m) => ({
                label: m.month,
                billed: m.billed,
                receipts: m.receipts,
              }))}
              series={[
                {
                  key: "billed",
                  name: "Hisoblangan (taxmin)",
                  color: "#263e35",
                },
                { key: "receipts", name: "Haqiqiy tushum", color: "#526b43" },
              ]}
            />
            <Chart
              title="Oylik maosh va xarajatlar"
              rows={data.monthly.map((m) => ({
                label: m.month,
                salary: m.approvedSalary,
                paid: m.salaryPaid,
                operating: m.operatingExpenses,
              }))}
              series={[
                { key: "salary", name: "Tasdiqlangan maosh", color: "#263e35" },
                { key: "paid", name: "To‘langan maosh", color: "#526b43" },
                {
                  key: "operating",
                  name: "Operatsion xarajatlar",
                  color: "#846122",
                },
              ]}
            />
          </div>
          <section className="panel">
            <h2>Oylik boshqaruv natijasi · taxmin</h2>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Oylik natijalar"
            >
              <table>
                <caption>
                  UZS · to‘liq ma’lumot bo‘lmaganda natija berilmaydi
                </caption>
                <thead>
                  <tr>
                    {[
                      "Oy",
                      "Hisoblangan",
                      "Tasdiqlangan maosh",
                      "Operatsion xarajatlar",
                      "Taxminiy natija",
                    ].map((x) => (
                      <th scope="col" key={x}>
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.monthly.map((m) => (
                    <tr key={m.month}>
                      <th scope="row">{m.month}</th>
                      <td>{uzs(m.billed)}</td>
                      <td>{uzs(m.approvedSalary)}</td>
                      <td>{uzs(m.operatingExpenses)}</td>
                      <td>
                        {m.estimatedResult === null
                          ? "Ma’lumot yetarli emas"
                          : uzs(m.estimatedResult)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Pul oqimi · hisoblar bo‘yicha</h2>
            <p>
              Boshlang‘ich qoldiq daromad emas. Hisoblararo o‘tkazmalar jami
              pulni o‘zgartirmaydi. Qo‘lda harakatlar noma’lum; ular tarkibida
              qarz mablag‘i bo‘lishi mumkin.
            </p>
            <div
              className="table-scroll"
              tabIndex={0}
              role="region"
              aria-label="Hisoblar bo‘yicha pul oqimi"
            >
              <table>
                <caption>Kassa va bank hisoblari · UZS</caption>
                <thead>
                  <tr>
                    {[
                      "Hisob",
                      "Davr boshi",
                      "Boshlang‘ich yozuv",
                      "Ta’lim tushumi",
                      "Maosh",
                      "Xarajat",
                      "Tasniflanmagan qo‘lda",
                      "O‘tkazmalar",
                      "Davr oxiri",
                    ].map((x) => (
                      <th scope="col" key={x}>
                        {x}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {[
                    ...data.cash.accounts,
                    {
                      id: "total",
                      name: "Jami",
                      initialized: true,
                      ...data.cash,
                    },
                  ].map((a) => (
                    <tr key={a.id}>
                      <th scope="row">
                        {a.name}
                        {!a.initialized && " · Boshlang‘ich qoldiq yo‘q"}
                      </th>
                      {(
                        [
                          "opening",
                          "openingEntries",
                          "tuition",
                          "salary",
                          "expenses",
                          "manual",
                          "transfers",
                          "closing",
                        ] as const
                      ).map((k) => (
                        <td key={k}>{uzs(a[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
          <section className="panel">
            <h2>Hisobga taqsimlanmagan tarix</h2>
            <p>
              Davr oxirigacha qaytarilmagan hisobsiz to‘lovlar. Kassa qoldig‘iga
              qo‘shilmaydi.
            </p>
            <p>
              Ta’lim: {data.unallocated.payments.count} ta ·{" "}
              {uzs(data.unallocated.payments.amount)}
            </p>
            <p>
              Maosh: {data.unallocated.salaries.count} ta ·{" "}
              {uzs(data.unallocated.salaries.amount)}
            </p>
          </section>
          <section className="panel">
            <h2>Xarajat kategoriyalari</h2>
            <div className="table-scroll">
              <table>
                <caption>Tasniflar · UZS</caption>
                <thead>
                  <tr>
                    <th scope="col">Kategoriya</th>
                    <th scope="col">Hisob tasnifi</th>
                    <th scope="col">Summa</th>
                  </tr>
                </thead>
                <tbody>
                  {data.expenseCategories.map((c) => (
                    <tr key={c.id}>
                      <th scope="row">{c.name}</th>
                      <td>{classes[c.classification]}</td>
                      <td>{uzs(c.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!data.expenseCategories.length && (
              <p>Davrda tasdiqlangan xarajatlar yo‘q.</p>
            )}
          </section>
          <section className="panel">
            <h2>Guruhlar bo‘yicha ta’lim haqi</h2>
            <p>
              Faqat ta’lim hisoblariga ishonchli bog‘langan summalar. Guruh
              foydasi hisoblanmaydi; maosh va umumiy xarajatlar taqsimlanmagan.
            </p>
            <div className="table-scroll">
              <table>
                <caption>
                  Hisob oyiga ta’lim haqi va to‘lov sanasiga tushum · UZS
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Guruh</th>
                    <th scope="col">Hisoblangan (taxmin)</th>
                    <th scope="col">Haqiqiy tushum</th>
                  </tr>
                </thead>
                <tbody>
                  {data.groups
                    .slice((groupPage - 1) * 20, groupPage * 20)
                    .map((g) => (
                      <tr key={g.id}>
                        <th scope="row">{g.name}</th>
                        <td>{uzs(g.billed)}</td>
                        <td>{uzs(g.receipts)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            {data.groups.length > 20 && (
              <div className="report-actions">
                <button
                  className="button light"
                  disabled={groupPage === 1}
                  onClick={() => setGroupPage((p) => p - 1)}
                >
                  Oldingi guruhlar
                </button>
                <span>
                  {groupPage}-sahifa · {data.groups.length} guruh
                </span>
                <button
                  className="button light"
                  disabled={groupPage * 20 >= data.groups.length}
                  onClick={() => setGroupPage((p) => p + 1)}
                >
                  Keyingi guruhlar
                </button>
              </div>
            )}
            {!data.groups.length && (
              <p>Guruhlarga bog‘langan ma’lumotlar yo‘q.</p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
