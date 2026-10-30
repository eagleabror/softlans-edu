import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import {
  LeadsList,
  LeadForm,
  LeadDetail,
  FollowUps,
  TrialLessons,
  LeadAnalytics,
} from "./Leads";
const lead = {
  id: "a".repeat(24),
  fullName: "Sinov Mijoz",
  phone: "+998901234567",
  source: "telegram",
  status: "contacted",
  interestedCourse: "Ingliz tili",
  notes: "Bog‘lanish kerak",
};
const staff = { id: "b".repeat(24), name: "Mas’ul Admin" };
const response = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: async () => data,
  } as Response);
function renderPage(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/leads" element={<LeadsList />} />
        <Route path="/leads/pipeline" element={<LeadsList pipeline />} />
        <Route path="/leads/new" element={<LeadForm />} />
        <Route path="/leads/:id" element={<LeadDetail />} />
        <Route path="/follow-ups" element={<FollowUps />} />
        <Route path="/trial-lessons" element={<TrialLessons />} />
        <Route path="/leads/analytics" element={<LeadAnalytics />} />
      </Routes>
    </MemoryRouter>,
  );
}
function fixture(url: string, options?: RequestInit): Promise<Response> {
  if (url.includes("/staff")) return response({ staff: [staff] });
  if (url.includes("/resources")) return response({ teachers: [], groups: [] });
  if (url.includes("/history")) return response({ items: [], total: 0 });
  if (url.includes("/duplicates")) return response({ leads: [], students: [] });
  if (url.includes("/students")) return response({ students: [] });
  if (url.includes("/trial-lessons") || url.includes("/follow-ups"))
    return response({ items: [], total: 0 });
  if (url.includes("/leads?")) return response({ items: [lead], total: 21 });
  if (options?.method === "POST") return response({ lead });
  return response({ lead });
}
afterEach(() => vi.unstubAllGlobals());
it("sends server pagination, search and status/source/staff filters", async () => {
  const fetcher = vi.fn(fixture);
  vi.stubGlobal("fetch", fetcher);
  renderPage("/leads");
  expect(await screen.findByText(lead.fullName)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain("page=2"),
  );
  await userEvent.type(screen.getByLabelText("Qidiruv"), "Sinov");
  await userEvent.selectOptions(screen.getByLabelText("Status"), "contacted");
  await userEvent.selectOptions(screen.getByLabelText("Manba"), "telegram");
  await userEvent.selectOptions(
    screen.getByLabelText("Mas’ul xodim"),
    staff.id,
  );
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain("assignedTo=");
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain("page=1");
});
it("shows recoverable error then an empty state", async () => {
  let failed = true;
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      url.includes("staff")
        ? response({ staff: [] })
        : failed
          ? ((failed = false),
            response({ error: { message: "Sinov xatosi" } }, 500))
          : response({ items: [], total: 0 }),
    ),
  );
  renderPage("/leads");
  expect(await screen.findByRole("alert")).toHaveTextContent("Sinov xatosi");
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByText(/Leadlar topilmadi/)).toBeVisible();
});
it("creates only permitted lead fields with cookie authentication", async () => {
  const fetcher = vi.fn(fixture);
  vi.stubGlobal("fetch", fetcher);
  renderPage("/leads/new");
  await userEvent.type(screen.getByLabelText("To‘liq ism"), lead.fullName);
  await userEvent.type(
    screen.getByLabelText("Qiziqayotgan kurs"),
    lead.interestedCourse,
  );
  await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.some(([, o]) => o?.method === "POST")).toBe(true),
  );
  const call = fetcher.mock.calls.find(([, o]) => o?.method === "POST")!;
  expect(call[1]?.credentials).toBe("include");
  expect(JSON.parse(call[1]!.body as string)).toMatchObject({
    fullName: lead.fullName,
    phone: "",
    interestedCourse: lead.interestedCourse,
  });
  expect(JSON.parse(call[1]!.body as string)).not.toHaveProperty("tenantId");
});
it("supports accessible pipeline navigation without dragging", async () => {
  vi.stubGlobal("fetch", vi.fn(fixture));
  renderPage("/leads/pipeline");
  expect(
    await screen.findByRole("link", { name: lead.fullName }),
  ).toHaveAttribute("href", `/leads/${lead.id}`);
  expect(screen.getByRole("heading", { name: "Bog‘lanildi" })).toBeVisible();
  expect(screen.getByText(/Statusni lead profilida/)).toBeVisible();
});
it("requires explicit confirmation before student conversion and disables double submission", async () => {
  let release: ((r: Response) => void) | undefined;
  const fetcher = vi.fn((url: string, o?: RequestInit) =>
    o?.method === "POST" && url.endsWith("/convert")
      ? new Promise<Response>((resolve) => {
          release = resolve;
        })
      : fixture(url, o),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage(`/leads/${lead.id}`);
  await userEvent.click(
    await screen.findByRole("button", { name: "O‘quvchiga aylantirish" }),
  );
  const confirm = screen.getByRole("button", {
    name: "Konvertatsiyani tasdiqlash",
  });
  expect(confirm).toBeDisabled();
  await userEvent.type(screen.getByLabelText("Ism", { exact: true }), "Sinov");
  await userEvent.type(screen.getByLabelText("Familiya"), "Mijoz");
  await userEvent.click(
    screen.getByRole("checkbox", { name: /Yangi o‘quvchi yaratishni/ }),
  );
  await userEvent.click(confirm);
  expect(
    screen.getByRole("button", { name: "Konvertatsiya qilinmoqda…" }),
  ).toBeDisabled();
  expect(
    fetcher.mock.calls.filter(([, o]) => o?.method === "POST"),
  ).toHaveLength(1);
  release?.({
    ok: false,
    status: 409,
    json: async () => ({ error: { message: "Allaqachon aylantirilgan" } }),
  } as Response);
  expect(await screen.findByText("Allaqachon aylantirilgan")).toBeVisible();
});
it("submits Tashkent follow-up datetime and preserves form on error", async () => {
  const fetcher = vi.fn((u: string, o?: RequestInit) =>
    o?.method === "POST"
      ? response({ error: { message: "Vazifa saqlanmadi" } }, 409)
      : fixture(u, o),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage("/follow-ups");
  await userEvent.click(
    screen.getByRole("button", { name: "Vazifa qo‘shish" }),
  );
  await screen.findByRole("option", { name: /Sinov Mijoz/ });
  await userEvent.selectOptions(
    screen.getByLabelText("Lead", { exact: true }),
    lead.id,
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Mas’ul xodim"),
    staff.id,
  );
  await userEvent.type(
    screen.getByLabelText("Vazifa nomi"),
    "Qo‘ng‘iroq qilish",
  );
  const date = screen.getByLabelText("Muddat (Toshkent)");
  await userEvent.type(date, "2026-11-02T10:00");
  await userEvent.click(
    screen.getByRole("button", { name: "Vazifani saqlash" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Vazifa saqlanmadi",
  );
  const call = fetcher.mock.calls.find(([, o]) => o?.method === "POST")!;
  expect(JSON.parse(call[1]!.body as string).dueAt).toBe(
    "2026-11-02T05:00:00.000Z",
  );
  expect(screen.getByLabelText("Vazifa nomi")).toHaveValue("Qo‘ng‘iroq qilish");
});
it("displays zero-safe real analytics", async () => {
  vi.stubGlobal("fetch", () =>
    response({
      total: 0,
      converted: 0,
      todayNew: 0,
      monthNew: 0,
      todayTrials: 0,
      overdue: 0,
      conversionRate: 0,
      byStatus: [],
      bySource: [],
    }),
  );
  renderPage("/leads/analytics");
  expect(await screen.findByText("0%")).toBeVisible();
  expect(
    screen.getByText(/barcha konvertatsiya qilingan leadlar/),
  ).toBeVisible();
  expect(screen.getByText("Leadlar hali mavjud emas.")).toBeVisible();
});
