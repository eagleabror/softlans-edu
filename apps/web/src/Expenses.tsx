import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  Link,
  NavLink,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { api, HttpError } from "./api";
import { uzs } from "./Billing";
import {
  PageHeading,
  DataTable,
  LoadingSkeleton,
  ErrorState,
  EmptyState,
  StatusBadge,
} from "./ui";

type Named = {
  id: string;
  name: string;
  active?: boolean;
  kind?: string;
  openingDate?: string | null;
};
type ExpenseRow = {
  id: string;
  amount: number;
  categoryId: string;
  accountId: string;
  description: string;
  expenseDate: string;
  status: string;
  supplier: string;
  reference: string;
  method: string;
  createdBy: string;
  createdAt: string;
};
type Movement = {
  id: string;
  accountId: string;
  delta: number;
  date: string;
  kind: string;
  reason: string;
  sourceId: string;
};
type DailyRow = Named & {
  opening: number;
  inflow: number;
  outflow: number;
  closing: number;
  confirmedBalance: number;
  complete: boolean;
};
type Daily = {
  rows: DailyRow[];
  unallocated: Record<string, { count: number; amount: number }>;
};
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tashkent",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const statuses: Record<string, string> = {
  draft: "Qoralama",
  confirmed: "Tasdiqlangan",
  voided: "Bekor qilingan",
};
const kinds: Record<string, string> = {
  opening: "Boshlang‘ich qoldiq",
  manual_in: "Qo‘lda kirim",
  manual_out: "Qo‘lda chiqim",
  transfer: "Hisoblararo o‘tkazma",
  expense: "Xarajat",
  expense_void: "Xarajat qaytarilishi",
  payment: "Ta’lim to‘lovi",
  payment_reversal: "Ta’lim to‘lovi qaytarilishi",
  salary: "Maosh to‘lovi",
  salary_reversal: "Maosh qaytarilishi",
  movement_void: "Harakat qaytarilishi",
};
const kindNames: Record<string, string> = {
  cash: "Naqd",
  bank: "Bank",
  manual: "Qo‘lda boshqariladigan",
};
const send = <T,>(path: string, data: object, method = "POST") =>
  api<T>(`/cash${path}`, { method, body: JSON.stringify(data) });
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label>
      {label}
      {children}
    </label>
  );
}
function AccountOptions({ rows }: { rows: Named[] }) {
  return (
    <>
      <option value="">Hisobni tanlang</option>
      {rows.map((r) => (
        <option key={r.id} value={r.id}>
          {r.name}
        </option>
      ))}
    </>
  );
}

function ConfirmDialog({
  title,
  detail,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  title: string;
  detail: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = ref.current!;
    const previous = document.activeElement as HTMLElement;
    element.showModal();
    return () => {
      element.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="member-dialog cash-dialog"
      aria-labelledby="cash-confirm-title"
      aria-describedby="cash-confirm-detail"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onConfirm(String(new FormData(e.currentTarget).get("reason")));
        }}
      >
        <h2 id="cash-confirm-title">{title}</h2>
        <p id="cash-confirm-detail">{detail}</p>
        {error && (
          <p className="notice" role="alert">
            {error}
          </p>
        )}
        <Field label="Amal sababi">
          <textarea
            name="reason"
            required
            minLength={3}
            maxLength={1000}
            autoFocus
          />
        </Field>
        <div className="cash-actions">
          <button
            className="button light"
            type="button"
            disabled={busy}
            onClick={onClose}
          >
            Bekor qilish
          </button>
          <button className="button primary" disabled={busy}>
            {busy ? "Saqlanmoqda…" : "Tasdiqlash"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
export function Expenses({ owner }: { owner: boolean }) {
  const path = useLocation().pathname,
    navigate = useNavigate(),
    { id } = useParams();
  const mode =
    path === "/expenses/new"
      ? "new"
      : path === "/expenses/categories"
        ? "categories"
        : path === "/cash/accounts"
          ? "accounts"
          : path === "/cash/movements"
            ? "movements"
            : path === "/cash/daily"
              ? "daily"
              : id
                ? "detail"
                : "expenses";
  const titles: Record<string, string> = {
    expenses: "Xarajatlar",
    new: "Yangi xarajat",
    categories: "Xarajat kategoriyalari",
    accounts: "Kassa va bank hisoblari",
    movements: "Pul harakatlari",
    daily: "Kunlik kassa ko‘rinishi",
    detail: "Xarajat tafsilotlari",
  };
  const [options, setOptions] = useState<{
    categories: Named[];
    accounts: Named[];
  }>({ categories: [], accounts: [] });
  const [expenseRows, setExpenseRows] = useState<ExpenseRow[]>([]);
  const [namedRows, setNamedRows] = useState<Named[]>([]);
  const [movementRows, setMovementRows] = useState<Movement[]>([]);
  const [total, setTotal] = useState(0),
    [page, setPage] = useState(1);
  const [daily, setDaily] = useState<Daily | null>(null),
    [expense, setExpense] = useState<ExpenseRow | null>(null),
    [audit, setAudit] = useState<
      {
        id: string;
        action: string;
        reason: string;
        createdAt: string;
        recordedBy: string;
      }[]
    >([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [success, setSuccess] = useState(""),
    [busy, setBusy] = useState(false),
    [version, refresh] = useState(0);
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [accountId, setAccount] = useState(""),
    [categoryId, setCategory] = useState(""),
    [status, setStatus] = useState(""),
    [day, setDay] = useState(today);
  const [action, setAction] = useState<{
    title: string;
    detail: string;
    path: string;
    data: object;
    method?: string;
  } | null>(null);
  const pending = useRef<{
    signature: string;
    key: string;
    path: string;
    data: object;
    method: string;
  } | null>(null);
  useEffect(() => {
    setPage(1);
    pending.current = null;
    setSuccess("");
  }, [mode, id, from, to, accountId, categoryId, status]);
  useEffect(() => {
    let live = true;
    setLoading(true);
    setLoadFailed(false);
    setError("");
    const query = new URLSearchParams({ page: String(page) });
    for (const [k, v] of Object.entries({
      from,
      to,
      accountId,
      categoryId,
      status,
    }))
      if (v) query.set(k, v);
    const url =
      mode === "new"
        ? null
        : mode === "detail"
          ? `/expenses/${id}`
          : mode === "daily"
            ? `/daily?date=${day}${accountId ? `&accountId=${accountId}` : ""}`
            : mode === "categories" || mode === "accounts"
              ? `/${mode}`
              : `/${mode}?${query}`;
    Promise.all([
      api<{ categories: Named[]; accounts: Named[] }>("/cash/draft-options"),
      url
        ? api<{
            rows?: (ExpenseRow | Named | Movement | DailyRow)[];
            total?: number;
            expense?: ExpenseRow;
            audit?: typeof audit;
            unallocated?: Daily["unallocated"];
          }>(`/cash${url}`)
        : Promise.resolve(null),
    ])
      .then(([o, r]) => {
        if (!live) return;
        setOptions(o);
        setExpenseRows(
          mode === "expenses" ? ((r?.rows ?? []) as ExpenseRow[]) : [],
        );
        setNamedRows(
          ["accounts", "categories"].includes(mode)
            ? ((r?.rows ?? []) as Named[])
            : [],
        );
        setMovementRows(
          mode === "movements" ? ((r?.rows ?? []) as Movement[]) : [],
        );
        setTotal(r?.total ?? 0);
        setDaily(
          mode === "daily" && r?.unallocated
            ? { rows: (r.rows ?? []) as DailyRow[], unallocated: r.unallocated }
            : null,
        );
        setExpense(r?.expense ?? null);
        setAudit(r?.audit ?? []);
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoadFailed(true);
        }
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [mode, id, page, from, to, accountId, categoryId, status, day, version]);
  async function mutate(path: string, data: object, method = "POST") {
    if (busy) return;
    const signature = JSON.stringify({ path, data, method });
    if (!pending.current || pending.current.signature !== signature)
      pending.current = {
        signature,
        key: crypto.randomUUID(),
        path,
        data,
        method,
      };
    setBusy(true);
    setError("");
    setSuccess("");
    try {
      await send(
        path,
        { ...data, idempotencyKey: pending.current.key },
        method,
      );
      pending.current = null;
      setAction(null);
      setSuccess("Amal muvaffaqiyatli bajarildi.");
      refresh((v) => v + 1);
      if (mode === "new") navigate("/expenses");
    } catch (e) {
      setError(
        e instanceof HttpError
          ? e.message
          : "Amal bajarilmadi. Qayta urinib ko‘ring.",
      );
    } finally {
      setBusy(false);
    }
  }
  function formAction(
    e: FormEvent<HTMLFormElement>,
    title: string,
    path: string,
    data: (f: FormData) => Record<string, unknown>,
  ) {
    e.preventDefault();
    const fields = data(new FormData(e.currentTarget));
    setAction({
      title,
      path,
      data: fields,
      detail: [
        fields.name,
        typeof fields.amount === "number" ? uzs(fields.amount) : "",
        options.accounts.find((a) => a.id === fields.accountId)?.name,
        fields.toAccountId
          ? `Qabul qiluvchi: ${options.accounts.find((a) => a.id === fields.toAccountId)?.name}`
          : "",
        fields.date,
        "Tasdiqlangan yozuv tarixda saqlanadi; tuzatish teskari yozuv bilan bajariladi.",
      ]
        .filter(Boolean)
        .join(" · "),
    });
  }
  const name = (items: Named[], value: string) =>
    items.find((i) => i.id === value)?.name ?? value;
  const accountField = (
    <Field label="Hisob">
      <select name="accountId" required className="plain-input">
        <AccountOptions
          rows={options.accounts.filter((a) => a.active !== false)}
        />
      </select>
    </Field>
  );
  return (
    <div className="cash-page">
      <PageHeading
        eyebrow="MOLIYA"
        title={titles[mode]!}
        description={
          owner
            ? "Xarajatlar va tasdiqlangan pul harakatlari. Summalar butun UZSda."
            : "Faqat o‘zingiz yaratgan qoralamalar ko‘rsatiladi."
        }
      >
        {mode === "expenses" && (
          <Link className="button primary" to="/expenses/new">
            Yangi xarajat
          </Link>
        )}
      </PageHeading>
      <nav className="cash-tabs" aria-label="Xarajat va kassa bo‘limlari">
        <NavLink to="/expenses" end>
          Xarajatlar
        </NavLink>
        {owner && (
          <>
            <NavLink to="/expenses/categories">Kategoriyalar</NavLink>
            <NavLink to="/cash/accounts">Kassa va bank hisoblari</NavLink>
            <NavLink to="/cash/movements">Pul harakatlari</NavLink>
            <NavLink to="/cash/daily">Kunlik kassa</NavLink>
          </>
        )}
      </nav>
      {error && (
        <ErrorState
          message={error}
          onRetry={() => {
            const request = pending.current;
            if (!loadFailed && request)
              void mutate(request.path, request.data, request.method);
            else refresh((v) => v + 1);
          }}
        />
      )}
      {success && (
        <p className="success-note" role="status">
          {success}
        </p>
      )}
      {loading ? (
        <LoadingSkeleton />
      ) : loadFailed ? null : (
        <>
          {["expenses", "movements", "daily"].includes(mode) && (
            <div className="panel cash-filters">
              {mode === "daily" ? (
                <Field label="Kun">
                  <input
                    type="date"
                    value={day}
                    onChange={(e) => setDay(e.target.value)}
                    required
                  />
                </Field>
              ) : (
                <>
                  <Field label="Boshlanish sanasi">
                    <input
                      type="date"
                      value={from}
                      onChange={(e) => setFrom(e.target.value)}
                    />
                  </Field>
                  <Field label="Tugash sanasi">
                    <input
                      type="date"
                      value={to}
                      onChange={(e) => setTo(e.target.value)}
                    />
                  </Field>
                </>
              )}
              <Field label="Hisob bo‘yicha">
                <select
                  value={accountId}
                  onChange={(e) => setAccount(e.target.value)}
                >
                  <option value="">Barcha hisoblar</option>
                  {options.accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              {mode === "expenses" && (
                <>
                  <Field label="Kategoriya">
                    <select
                      value={categoryId}
                      onChange={(e) => setCategory(e.target.value)}
                    >
                      <option value="">Barcha kategoriyalar</option>
                      {options.categories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                  {owner && (
                    <Field label="Holat">
                      <select
                        value={status}
                        onChange={(e) => setStatus(e.target.value)}
                      >
                        <option value="">Barcha holatlar</option>
                        {Object.entries(statuses).map(([k, v]) => (
                          <option key={k} value={k}>
                            {v}
                          </option>
                        ))}
                      </select>
                    </Field>
                  )}
                </>
              )}
            </div>
          )}
          {mode === "new" && (
            <form
              className="panel cash-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                void mutate("/expenses", {
                  amount: Number(f.get("amount")),
                  categoryId: f.get("categoryId"),
                  accountId: f.get("accountId"),
                  description: f.get("description"),
                  expenseDate: f.get("expenseDate"),
                  method: f.get("method"),
                  supplier: f.get("supplier"),
                  reference: f.get("reference"),
                });
              }}
            >
              <h2>Xarajat qoralamasi</h2>
              <p>
                Maoshlar «O‘qituvchilar maoshi» bo‘limida to‘lanadi. Ularni bu
                yerga qayta kiritmang.
              </p>
              <Field label="Summa (UZS)">
                <input
                  name="amount"
                  type="number"
                  min={1}
                  max={1_000_000_000_000}
                  step={1}
                  required
                />
              </Field>
              <Field label="Kategoriya">
                <select name="categoryId" required>
                  <option value="">Kategoriyani tanlang</option>
                  {options.categories
                    .filter((c) => c.active !== false)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                      </option>
                    ))}
                </select>
              </Field>
              {accountField}
              <Field label="To‘lov usuli">
                <select name="method">
                  <option value="cash">Naqd</option>
                  <option value="bank_transfer">Bank o‘tkazmasi</option>
                </select>
              </Field>
              <Field label="Xarajat sanasi">
                <input
                  name="expenseDate"
                  type="date"
                  max={today()}
                  defaultValue={today()}
                  required
                />
              </Field>
              <Field label="Tavsif">
                <textarea
                  name="description"
                  minLength={3}
                  maxLength={1000}
                  required
                />
              </Field>
              <Field label="Yetkazib beruvchi (ixtiyoriy)">
                <input name="supplier" maxLength={200} />
              </Field>
              <Field label="Hujjat raqami (ixtiyoriy)">
                <input name="reference" maxLength={200} />
              </Field>
              <button className="button primary" disabled={busy}>
                {busy ? "Saqlanmoqda…" : "Qoralamani saqlash"}
              </button>
            </form>
          )}
          {mode === "expenses" && (
            <section className="panel">
              <DataTable
                caption="Xarajatlar ro‘yxati"
                headings={[
                  "Sana",
                  "Tavsif",
                  "Kategoriya",
                  "Hisob",
                  "Summa",
                  "Holat",
                  "Amal",
                ]}
              >
                {expenseRows.map((e) => (
                  <tr key={e.id}>
                    <td>{e.expenseDate}</td>
                    <td>{e.description}</td>
                    <td>{name(options.categories, e.categoryId)}</td>
                    <td>{name(options.accounts, e.accountId)}</td>
                    <td className="cash-money">{uzs(e.amount)}</td>
                    <td>
                      <StatusBadge>{statuses[e.status]}</StatusBadge>
                    </td>
                    <td>
                      <Link className="button light" to={`/expenses/${e.id}`}>
                        Ko‘rish
                      </Link>
                    </td>
                  </tr>
                ))}
              </DataTable>
              {!expenseRows.length && (
                <EmptyState title="Xarajatlar topilmadi." />
              )}
            </section>
          )}
          {mode === "detail" && expense && (
            <section className="panel cash-detail">
              <h2>{expense.description}</h2>
              <dl>
                {[
                  ["Summa", uzs(expense.amount)],
                  ["Sana", expense.expenseDate],
                  ["Kategoriya", name(options.categories, expense.categoryId)],
                  ["Hisob", name(options.accounts, expense.accountId)],
                  ["Holat", statuses[expense.status]],
                  [
                    "To‘lov usuli",
                    expense.method === "cash" ? "Naqd" : "Bank o‘tkazmasi",
                  ],
                  ["Yetkazib beruvchi", expense.supplier || "—"],
                  ["Hujjat raqami", expense.reference || "—"],
                  ["Yaratgan foydalanuvchi", expense.createdBy],
                  [
                    "Yaratilgan vaqt",
                    new Date(expense.createdAt).toLocaleString("uz-UZ", {
                      timeZone: "Asia/Tashkent",
                    }),
                  ],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{v}</dd>
                  </div>
                ))}
              </dl>
              {owner && expense.status !== "voided" && (
                <div className="cash-actions">
                  {expense.status === "draft" && (
                    <button
                      className="button primary"
                      onClick={() =>
                        setAction({
                          title: "Xarajatni tasdiqlash",
                          detail: `${uzs(expense.amount)} hisobdan chiqim qilinadi.`,
                          path: `/expenses/${expense.id}/confirm`,
                          data: { confirmed: true },
                        })
                      }
                    >
                      Tasdiqlash
                    </button>
                  )}
                  <button
                    className="button light"
                    onClick={() =>
                      setAction({
                        title: "Xarajatni bekor qilish",
                        detail: `${expense.description}: asl yozuv saqlanadi. Tasdiqlangan summa bugungi sanada hisobga qaytariladi.`,
                        path: `/expenses/${expense.id}/void`,
                        data: { confirmed: true },
                      })
                    }
                  >
                    Xarajatni bekor qilish
                  </button>
                </div>
              )}
              <h3>Audit tarixi</h3>
              <ul>
                {audit.map((a) => (
                  <li key={a.id}>
                    {new Date(a.createdAt).toLocaleString("uz-UZ", {
                      timeZone: "Asia/Tashkent",
                    })}{" "}
                    · {a.reason} · {a.recordedBy}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {(mode === "categories" || mode === "accounts") && (
            <>
              <section className="panel">
                <h2>{mode === "categories" ? "Kategoriyalar" : "Hisoblar"}</h2>
                <p>
                  Moliyaviy tarixga ega yozuvlar o‘chirilmaydi. Faolsizlantirish
                  tarixni saqlaydi.
                </p>
                <button
                  className="button light"
                  disabled={busy}
                  onClick={() =>
                    setAction({
                      title: "Boshlang‘ich sozlash",
                      detail:
                        "Standart kategoriyalar, Naqd kassa va Bank hisobi yaratiladi. Pul yozuvlari yaratilmaydi.",
                      path: "/setup",
                      data: { confirmed: true },
                    })
                  }
                >
                  Standart ro‘yxatni yaratish
                </button>
                <DataTable
                  caption={titles[mode]!}
                  headings={["Nomi", "Holat", "Boshqarish"]}
                >
                  {namedRows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        {r.name}
                        {r.kind && <small> · {kindNames[r.kind]}</small>}
                      </td>
                      <td>{r.active ? "Faol" : "Faol emas"}</td>
                      <td>
                        <form
                          className="cash-inline"
                          onSubmit={(e) =>
                            formAction(
                              e,
                              "Ma’lumotni o‘zgartirish",
                              `/${mode}/${r.id}`,
                              (f) => ({
                                name: f.get("name"),
                                active: r.active,
                              }),
                            )
                          }
                        >
                          <input
                            name="name"
                            defaultValue={r.name}
                            maxLength={120}
                            required
                            aria-label={`${r.name} yangi nomi`}
                          />
                          <button className="button light">
                            Nomini saqlash
                          </button>
                        </form>
                        <button
                          className="button light"
                          onClick={() =>
                            setAction({
                              title: r.active
                                ? "Faolsizlantirish"
                                : "Faollashtirish",
                              detail: r.name,
                              path: `/${mode}/${r.id}`,
                              method: "PATCH",
                              data: { name: r.name, active: !r.active },
                            })
                          }
                        >
                          {r.active ? "Faolsizlantirish" : "Faollashtirish"}
                        </button>
                        {mode === "accounts" && !r.openingDate && (
                          <form
                            className="cash-inline"
                            onSubmit={(e) =>
                              formAction(
                                e,
                                "Boshlang‘ich qoldiqni belgilash",
                                `/accounts/${r.id}/opening`,
                                (f) => ({
                                  amount: Number(f.get("amount")),
                                  date: f.get("date"),
                                  confirmed: true,
                                }),
                              )
                            }
                          >
                            <Field label="Boshlang‘ich qoldiq (UZS)">
                              <input
                                name="amount"
                                type="number"
                                min={0}
                                max={1_000_000_000_000}
                                step={1}
                                required
                              />
                            </Field>
                            <Field label="Qoldiq sanasi">
                              <input
                                name="date"
                                type="date"
                                max={today()}
                                required
                              />
                            </Field>
                            <button className="button primary">
                              Qoldiqni belgilash
                            </button>
                          </form>
                        )}
                        {r.openingDate && (
                          <p>Boshlang‘ich sana: {r.openingDate}</p>
                        )}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </section>
              <form
                className="panel cash-form"
                onSubmit={(e) =>
                  formAction(
                    e,
                    mode === "accounts"
                      ? "Hisob yaratish"
                      : "Kategoriya yaratish",
                    `/${mode}`,
                    (f) => ({
                      name: f.get("name"),
                      ...(mode === "accounts" ? { kind: f.get("kind") } : {}),
                    }),
                  )
                }
              >
                <h2>
                  {mode === "accounts" ? "Yangi hisob" : "Yangi kategoriya"}
                </h2>
                <Field label="Nomi">
                  <input name="name" required maxLength={120} />
                </Field>
                {mode === "accounts" && (
                  <Field label="Hisob turi">
                    <select name="kind">
                      <option value="cash">Naqd</option>
                      <option value="bank">Bank</option>
                      <option value="manual">Qo‘lda boshqariladigan</option>
                    </select>
                  </Field>
                )}
                <button className="button primary" disabled={busy}>
                  Yaratish
                </button>
              </form>
            </>
          )}
          {mode === "movements" && (
            <>
              <form
                className="panel cash-form"
                onSubmit={(e) =>
                  formAction(
                    e,
                    "Pul harakatini tasdiqlash",
                    "/movements",
                    (f) => ({
                      accountId: f.get("accountId"),
                      ...(f.get("toAccountId")
                        ? { toAccountId: f.get("toAccountId") }
                        : {}),
                      amount: Number(f.get("amount")),
                      date: f.get("date"),
                      kind: f.get("kind"),
                      confirmed: true,
                    }),
                  )
                }
              >
                <h2>Qo‘lda pul harakati</h2>
                <p>
                  O‘tkazma daromad yaratmaydi. Maosh yoki ta’lim to‘lovini qayta
                  kiritmang. Bankka haqiqiy so‘rov yuborilmaydi.
                </p>
                <Field label="Harakat turi">
                  <select name="kind">
                    <option value="transfer">Hisoblararo o‘tkazma</option>
                    <option value="manual_in">Boshqa kirim</option>
                    <option value="manual_out">Boshqa chiqim</option>
                  </select>
                </Field>
                {accountField}
                <Field label="Qabul qiluvchi hisob (faqat o‘tkazma)">
                  <select name="toAccountId">
                    <option value="">Tanlanmagan</option>
                    {options.accounts.map((a) => (
                      <option value={a.id} key={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Summa (UZS)">
                  <input
                    name="amount"
                    type="number"
                    required
                    min={1}
                    max={1_000_000_000_000}
                    step={1}
                  />
                </Field>
                <Field label="Harakat sanasi">
                  <input
                    type="date"
                    name="date"
                    defaultValue={today()}
                    max={today()}
                    required
                  />
                </Field>
                <button className="button primary" disabled={busy}>
                  Davom etish
                </button>
              </form>
              <section className="panel">
                <DataTable
                  caption="Pul harakatlari"
                  headings={[
                    "Sana",
                    "Hisob",
                    "Harakat",
                    "Summa",
                    "Sabab",
                    "Amal",
                  ]}
                >
                  {movementRows.map((m) => (
                    <tr key={m.id}>
                      <td>{m.date}</td>
                      <td>{name(options.accounts, m.accountId)}</td>
                      <td>{kinds[m.kind]}</td>
                      <td className="cash-money">{uzs(m.delta)}</td>
                      <td>{m.reason}</td>
                      <td>
                        {["manual_in", "manual_out", "transfer"].includes(
                          m.kind,
                        ) && (
                          <button
                            className="button light"
                            onClick={() =>
                              setAction({
                                title: "Harakatni bekor qilish",
                                detail:
                                  "Asl harakat saqlanadi. O‘tkazmaning ikkala tomoni ham bugungi sanada qaytariladi.",
                                path: `/movements/${m.id}/void`,
                                data: { confirmed: true },
                              })
                            }
                          >
                            Qaytarish
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </DataTable>
                {!movementRows.length && (
                  <EmptyState title="Pul harakatlari topilmadi." />
                )}
              </section>
            </>
          )}
          {mode === "daily" && daily && (
            <>
              <section className="panel">
                <h2>{day} · Toshkent vaqti</h2>
                <p>
                  Qoldiq faqat hisobga biriktirilgan tasdiqlangan harakatlardan
                  tuziladi. Manfiy qoldiqni boshlang‘ich qoldiq va
                  taqsimlanmagan tarix bilan solishtiring.
                </p>
                <DataTable
                  caption="Kunlik kassa qoldiqlari"
                  headings={[
                    "Hisob",
                    "Kun boshi",
                    "Kirim",
                    "Chiqim",
                    "Kun oxiri",
                    "Joriy qoldiq",
                    "To‘liqlik",
                  ]}
                >
                  {daily.rows.map((a) => (
                    <tr key={a.id}>
                      <td>{a.name}</td>
                      <td>{uzs(a.opening)}</td>
                      <td>{uzs(a.inflow)}</td>
                      <td>{uzs(a.outflow)}</td>
                      <td>{uzs(a.closing)}</td>
                      <td>{uzs(a.confirmedBalance)}</td>
                      <td>
                        {a.complete
                          ? "Boshlang‘ich qoldiq belgilangan"
                          : "Boshlang‘ich qoldiq yetishmaydi"}
                      </td>
                    </tr>
                  ))}
                </DataTable>
              </section>
              <section className="panel">
                <h2>Hisobga taqsimlanmagan tarix</h2>
                <p>
                  Barcha sanalar bo‘yicha, qaytarishlar chiqarib tashlangan.
                  Ushbu summalar kassa qoldig‘iga qo‘shilmaydi.
                </p>
                {Object.entries(daily.unallocated).map(([k, v]) => (
                  <p key={k}>
                    {k === "payment" ? "Ta’lim to‘lovlari" : "Maosh to‘lovlari"}
                    : {v.count} ta · {uzs(v.amount)}
                  </p>
                ))}
                <p>
                  Pul oqimi tan olingan daromad yoki xarajat bilan bir xil emas.
                  Bu modul to‘liq buxgalteriya yoki foyda va zarar hisoboti
                  emas.
                </p>
              </section>
            </>
          )}
          {["expenses", "movements"].includes(mode) && (
            <div className="cash-pagination">
              <span>
                Jami: {total} · Sahifa: {page}
              </span>
              <button
                className="button light"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Oldingi
              </button>
              <button
                className="button light"
                disabled={page * 20 >= total}
                onClick={() => setPage((p) => p + 1)}
              >
                Keyingi
              </button>
            </div>
          )}
        </>
      )}
      {action && (
        <ConfirmDialog
          title={action.title}
          detail={action.detail}
          busy={busy}
          error={error}
          onClose={() => setAction(null)}
          onConfirm={(reason) =>
            void mutate(
              action.path,
              { ...action.data, reason },
              action.method ??
                ((mode === "categories" || mode === "accounts") &&
                /\/[a-f\d]{24}$/.test(action.path)
                  ? "PATCH"
                  : "POST"),
            )
          }
        />
      )}
    </div>
  );
}
