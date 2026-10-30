import { useEffect, useState } from "react";
import { Link, NavLink, useParams } from "react-router-dom";
import type {
  DebtSummary,
  DebtsView,
  GroupDebt,
  GroupsView,
} from "@softlans/contracts";
import { api } from "./api";
import { uzs } from "./Billing";

export function DebtStats({
  data,
  month,
}: {
  data: DebtSummary;
  month?: string;
}) {
  return (
    <>
      <p className="muted">
        {month ? `${month} hisob oyi` : "Barcha hisob oylari"} · Asia/Tashkent
      </p>
      <div className="stats-grid financial-stats">
        {[
          ["Jami qolgan qarz", uzs(data.outstandingAmount)],
          ["Muddati o‘tgan qarz", uzs(data.overdueAmount)],
          ["Qarzdor o‘quvchilar", data.debtorCount],
          ["Muddati o‘tgan qarzdorlar", data.overdueDebtorCount],
          ["Muddati kelmagan", uzs(data.upcomingAmount)],
          ["1–7 kun", uzs(data.overdue1To7)],
          ["8–30 kun", uzs(data.overdue8To30)],
          ["30 kundan ortiq", uzs(data.overdueMoreThan30)],
        ].map(([label, value]) => (
          <section className="stat-card" key={label}>
            <p>{label}</p>
            <strong>{value}</strong>
          </section>
        ))}
      </div>
    </>
  );
}
export function Debts({
  overdue = false,
  groups = false,
}: {
  overdue?: boolean;
  groups?: boolean;
}) {
  const { id } = useParams();
  const [search, setSearch] = useState(""),
    [groupId, setGroup] = useState(""),
    [month, setMonth] = useState(""),
    [status, setStatus] = useState(""),
    [min, setMin] = useState(""),
    [max, setMax] = useState(""),
    [sort, setSort] = useState("dueDate"),
    [order, setOrder] = useState("asc"),
    [page, setPage] = useState(1);
  const [data, setData] = useState<DebtsView | null>(null),
    [groupData, setGroupData] = useState<GroupDebt[]>([]),
    [summary, setSummary] = useState<DebtSummary | null>(null),
    [total, setTotal] = useState(0),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [retry, setRetry] = useState(0),
    [exporting, setExporting] = useState(false);
  const [groupSearch, setGroupSearch] = useState(""),
    [groupPage, setGroupPage] = useState(1),
    [groupOptions, setGroupOptions] = useState<GroupsView | null>(null);
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      api<GroupsView>(
        `/groups?search=${encodeURIComponent(groupSearch)}&page=${groupPage}&pageSize=20`,
      )
        .then((result) => {
          if (active) setGroupOptions(result);
        })
        .catch(() => {
          if (active) setError("Guruhlar yuklanmadi. Qayta urinib ko‘ring.");
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [groupSearch, groupPage, retry]);
  const filters = new URLSearchParams();
  if (search) filters.set("search", search);
  if (groupId) filters.set("groupId", groupId);
  if (month) filters.set("month", month);
  if (status || overdue) filters.set("status", status || "overdue");
  if (min) filters.set("minAmount", min);
  if (max) filters.set("maxAmount", max);
  if (id) filters.set("studentId", id);
  filters.set("sort", sort);
  filters.set("order", order);
  const filterKey = filters.toString();
  useEffect(() => {
    setPage(1);
  }, [filterKey, groups, overdue, id]);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setData(null);
    setGroupData([]);
    setSummary(null);
    const query = `${filterKey}&page=${page}&pageSize=20`;
    const endpoint = groups
      ? "/debts/groups"
      : id
        ? `/debts/students/${id}`
        : overdue
          ? "/debts/overdue"
          : "/debts";
    const timer = setTimeout(() => {
      Promise.all([
        api<DebtsView & { groups?: GroupDebt[] }>(`${endpoint}?${query}`),
        api<DebtSummary>(`/debts/summary?${filterKey}`),
      ])
        .then(([rows, stats]) => {
          if (active) {
            setData(rows);
            setGroupData(rows.groups ?? []);
            setSummary(stats);
            setTotal(rows.total);
          }
        })
        .catch((e) => {
          if (active)
            setError(e instanceof Error ? e.message : "Ma’lumot yuklanmadi.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    }, 250);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [filterKey, page, retry, groups, overdue, id]);
  async function download() {
    setExporting(true);
    setError("");
    try {
      const response = await fetch(`/api/debts/export?${filterKey}`, {
        credentials: "include",
      });
      if (!response.ok) {
        if (response.status === 401)
          window.dispatchEvent(new Event("session-expired"));
        const payload = await response.json();
        throw new Error(payload.error?.message ?? "Eksport bajarilmadi.");
      }
      const url = URL.createObjectURL(await response.blob());
      const a = document.createElement("a");
      a.href = url;
      a.download = "qarzdorlar.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Eksport bajarilmadi.");
    } finally {
      setExporting(false);
    }
  }
  const title = id
    ? "Qarzdorlik tafsilotlari"
    : groups
      ? "Guruhlar bo‘yicha qarzlar"
      : overdue
        ? "Muddati o‘tgan to‘lovlar"
        : "Qarzdorlar";
  function toggleSort(field: string) {
    setSort(field);
    setOrder(sort === field && order === "asc" ? "desc" : "asc");
  }
  return (
    <div className="debts-page">
      <div className="page-heading">
        <div>
          <h1>{title}</h1>
          <p className="muted">
            Qarzlar amaldagi hisoblar va qaytarilmagan to‘lovlardan hisoblanadi.
          </p>
        </div>
        <button
          className="btn btn-primary"
          disabled={loading || exporting}
          onClick={download}
        >
          {exporting ? "Tayyorlanmoqda…" : "CSV yuklab olish"}
        </button>
      </div>
      <nav className="billing-tabs" aria-label="Qarzdorlik">
        <NavLink to="/debts" end>
          Qarzdorlar
        </NavLink>
        <NavLink to="/debts/overdue">Muddati o‘tgan to‘lovlar</NavLink>
        <NavLink to="/debts/groups">Guruhlar bo‘yicha qarzlar</NavLink>
      </nav>
      {id && (
        <Link to={`/students/${id}/finance`}>
          O‘quvchining moliyaviy profili
        </Link>
      )}
      <form className="billing-filters" onSubmit={(e) => e.preventDefault()}>
        <label>
          O‘quvchi ismi
          <input
            value={search}
            maxLength={100}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Ism yoki familiya"
          />
        </label>
        <label>
          Guruhni qidirish
          <input
            value={groupSearch}
            maxLength={100}
            onChange={(e) => {
              setGroupSearch(e.target.value);
              setGroupPage(1);
            }}
            placeholder="Guruh nomi"
          />
        </label>
        <label>
          Guruh
          <select value={groupId} onChange={(e) => setGroup(e.target.value)}>
            <option value="">Barcha guruhlar</option>
            {groupId && !groupOptions?.groups.some((g) => g.id === groupId) && (
              <option value={groupId}>Tanlangan guruh</option>
            )}
            {groupOptions?.groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
          </select>
        </label>
        {groupOptions && groupOptions.total > 20 && (
          <div>
            <button
              disabled={groupPage === 1}
              onClick={() => setGroupPage((p) => p - 1)}
            >
              Oldingi guruhlar
            </button>
            <button
              disabled={groupPage * 20 >= groupOptions.total}
              onClick={() => setGroupPage((p) => p + 1)}
            >
              Keyingi guruhlar
            </button>
          </div>
        )}
        <label>
          Hisob oyi
          <input
            type="month"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
        </label>
        <label>
          Muddat holati
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">
              {overdue ? "Barcha kechikkanlar" : "Barchasi"}
            </option>
            {!overdue && <option value="upcoming">Muddati kelmagan</option>}
            <option value="overdue">Muddati o‘tgan</option>
            <option value="1-7">1–7 kun</option>
            <option value="8-30">8–30 kun</option>
            <option value="31+">30 kundan ortiq</option>
          </select>
        </label>
        <label>
          Eng kam qarz (UZS)
          <input
            type="number"
            min="0"
            max="1000000000000"
            step="1"
            value={min}
            onChange={(e) => setMin(e.target.value)}
          />
        </label>
        <label>
          Eng ko‘p qarz (UZS)
          <input
            type="number"
            min="0"
            max="1000000000000"
            step="1"
            value={max}
            onChange={(e) => setMax(e.target.value)}
          />
        </label>
      </form>
      {error && (
        <div role="alert">
          {error}{" "}
          <button onClick={() => setRetry((x) => x + 1)}>Qayta urinish</button>
        </div>
      )}
      {loading ? (
        <p role="status">Qarzdorlik yuklanmoqda…</p>
      ) : (
        <>
          {summary && <DebtStats data={summary} month={month} />}
          {!error && total === 0 && (
            <section className="panel">
              <p>Tanlangan filtrlar bo‘yicha qarzdorlik topilmadi.</p>
            </section>
          )}
          {total > 0 && (
            <div className="table-wrap">
              <table>
                <thead>
                  {groups ? (
                    <tr>
                      <th>Guruh</th>
                      <th>Qarzdorlar</th>
                      <th>Muddati o‘tgan qarzdorlar</th>
                      <th>
                        <button onClick={() => toggleSort("remainingAmount")}>
                          Qolgan qarz ↕
                        </button>
                      </th>
                      <th>Muddati o‘tgan qarz</th>
                      <th>1–7 kun</th>
                      <th>8–30 kun</th>
                      <th>30 kundan ortiq</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>O‘quvchi</th>
                      <th>Guruh</th>
                      <th>Hisob oyi</th>
                      <th>Asl summa</th>
                      <th>To‘langan</th>
                      <th
                        aria-sort={
                          sort === "remainingAmount"
                            ? order === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button onClick={() => toggleSort("remainingAmount")}>
                          Qolgan qarz ↕
                        </button>
                      </th>
                      <th
                        aria-sort={
                          sort === "dueDate"
                            ? order === "asc"
                              ? "ascending"
                              : "descending"
                            : "none"
                        }
                      >
                        <button onClick={() => toggleSort("dueDate")}>
                          Muddat ↕
                        </button>
                      </th>
                      <th>Kechikkan kunlar</th>
                      <th>Holat</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {groups
                    ? groupData.map((g) => (
                        <tr key={g.groupId}>
                          <td>
                            <button
                              onClick={() => {
                                setGroup(g.groupId);
                              }}
                            >
                              {g.groupName}
                            </button>
                          </td>
                          <td>{g.debtorCount}</td>
                          <td>{g.overdueDebtorCount}</td>
                          <td>{uzs(g.outstandingAmount)}</td>
                          <td>{uzs(g.overdueAmount)}</td>
                          <td>{uzs(g.overdue1To7)}</td>
                          <td>{uzs(g.overdue8To30)}</td>
                          <td>{uzs(g.overdueMoreThan30)}</td>
                        </tr>
                      ))
                    : data?.charges.map((c) => (
                        <tr key={c.id}>
                          <td>
                            <Link to={`/debts/students/${c.studentId}`}>
                              {c.studentName}
                            </Link>
                            <br />
                            <Link to={`/students/${c.studentId}/finance`}>
                              Moliyaviy profil
                            </Link>
                          </td>
                          <td>{c.groupName}</td>
                          <td>{c.billingMonth}</td>
                          <td>{uzs(c.originalAmount)}</td>
                          <td>{uzs(c.paidAmount)}</td>
                          <td>
                            <strong>{uzs(c.remainingAmount)}</strong>
                          </td>
                          <td>
                            {new Intl.DateTimeFormat("uz-UZ", {
                              timeZone: "Asia/Tashkent",
                              dateStyle: "medium",
                            }).format(new Date(c.dueDate))}
                          </td>
                          <td>{c.daysOverdue}</td>
                          <td>
                            {c.status === "partial"
                              ? "Qisman to‘langan"
                              : "To‘lanmagan"}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="pagination">
            <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Oldingi
            </button>
            <span>
              {page}-sahifa · {total} ta {groups ? "guruh" : "hisob"}
            </span>
            <button
              disabled={page * 20 >= total}
              onClick={() => setPage((p) => p + 1)}
            >
              Keyingi
            </button>
          </div>
        </>
      )}
    </div>
  );
}
