import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import type { PlatformAuditEntry, PlatformStatisticsView, PlatformTenantView, SessionView } from "@softlans/contracts";
import { App } from "./App";

const session: SessionView = {
  user: { id: "platform-owner", name: "Platforma egasi", email: "platform@example.test", role: "super_admin" },
  tenant: null,
};
const tenant: PlatformTenantView = {
  id: "0123456789abcdef01234567",
  name: "Kelajak sinov markazi",
  status: "active",
  createdAt: "2026-10-01T08:00:00.000Z",
  statusRevision: 3,
  userCount: 7,
  studentCount: 43,
  lastActivityAt: null,
};
const owner = { id: "owner-1", name: "Sinov egasi", email: "owner@example.test" };
const statistics: PlatformStatisticsView = {
  totalTenants: 117,
  activeTenants: 103,
  blockedTenants: 14,
  todayTenants: 3,
  last30DaysTenants: 26,
  totalStudents: 9876,
  totalUsers: 432,
  growth: [{ date: "2026-10-29", count: 2 }, { date: "2026-10-30", count: 3 }],
  timezone: "Asia/Tashkent",
  generatedAt: "2026-10-30T12:00:00.000Z",
};
const auditEntry: PlatformAuditEntry = {
  id: "audit-1", actorId: "platform-owner", tenantId: tenant.id,
  action: "block", reason: "Markaz egasining so‘rovi", createdAt: "2026-10-30T12:00:00.000Z",
  previousStatus: "active", newStatus: "blocked", revision: 4,
};
const response = (data: unknown, status = 200) => Promise.resolve({
  ok: status < 400, status, json: async () => data,
} as Response);

function renderApp(path = "/super-admin") {
  return render(<MemoryRouter initialEntries={[path]}><App /></MemoryRouter>);
}
function defaultResponse(url: string) {
  if (url.endsWith("/auth/me")) return response(session);
  if (url.includes("/stats")) return response(statistics);
  if (url.includes("/audit")) return response({ entries: [auditEntry], total: 1, page: 1, pageSize: 20 });
  if (url.includes(`/tenants/${tenant.id}`)) return response({ tenant, owner });
  return response({ tenants: [tenant], total: 21, page: Number(new URL(url, "http://localhost").searchParams.get("page") || 1), pageSize: 20 });
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
});
afterEach(() => vi.unstubAllGlobals());

it("opens the separate platform dashboard after Super Admin authentication", async () => {
  const fetcher = vi.fn((url: string) => defaultResponse(url));
  vi.stubGlobal("fetch", fetcher);
  renderApp("/");
  expect(await screen.findByRole("heading", { name: "Platforma dashboardi" })).toBeVisible();
  await waitFor(() => expect(screen.getByText("117")).toBeVisible());
  for (const value of ["103", "14", "26", "432"]) expect(screen.getByText(value)).toBeVisible();
  expect(screen.getByText(/9[\s,.]?876/)).toBeVisible();
  expect(screen.getByText("Bugun qo‘shilgan").closest("article")).toHaveTextContent("3");
  expect(screen.getByRole("img", { name: "Oxirgi 30 kunda yangi markazlar grafigi" })).toBeVisible();
  await userEvent.click(screen.getByText("Grafik ma’lumotlarini jadvalda ko‘rish"));
  const chartTable = screen.getByRole("table", { name: "Kunlik yangi markazlar" });
  expect(within(chartTable).getByText("2026-10-29").closest("tr")).toHaveTextContent("2");
  expect(screen.getByRole("link", { name: /O‘quv markazlari/ })).toBeVisible();
  expect(screen.getByRole("link", { name: /Audit tarixi/ })).toBeVisible();
  expect(screen.queryByRole("link", { name: "To‘lovlar" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "O‘quvchilar" })).not.toBeInTheDocument();
  expect(fetcher.mock.calls.some(([url]) => url === "/api/dashboard")).toBe(false);
});

it("denies an ordinary tenant account without requesting platform data", async () => {
  const fetcher = vi.fn((url: string) => url.endsWith("/auth/me")
    ? response({ user: { ...session.user, role: "business_owner" }, tenant: { id: tenant.id, name: tenant.name } })
    : response({ scope: "tenant", teamCount: 7, adminCount: 1, teacherCount: 5, joinedAt: tenant.createdAt }));
  vi.stubGlobal("fetch", fetcher);
  renderApp();
  expect(await screen.findByText("Bu sahifaga kirish uchun ruxsat yo‘q.")).toBeVisible();
  expect(fetcher.mock.calls.some(([url]) => url.startsWith("/api/super-admin"))).toBe(false);
});

it("paginates, searches and filters centers using bounded server queries", async () => {
  const fetcher = vi.fn((url: string) => defaultResponse(url));
  vi.stubGlobal("fetch", fetcher);
  renderApp("/super-admin/tenants");
  expect(await screen.findByRole("link", { name: tenant.name })).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain("page=2"));
  await userEvent.type(screen.getByLabelText("Markaz nomi"), "Kelajak");
  await userEvent.click(screen.getByRole("button", { name: "Qidirish" }));
  await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain("search=Kelajak"));
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain("page=1");
  await userEvent.selectOptions(screen.getByLabelText("Holati"), "blocked");
  await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain("status=blocked"));
});

it("shows the minimal owner account and honest missing activity in center details", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => defaultResponse(url)));
  renderApp(`/super-admin/tenants/${tenant.id}`);
  expect(await screen.findByRole("heading", { name: tenant.name })).toBeVisible();
  expect(screen.getByText(owner.name)).toBeVisible();
  expect(screen.getByText(owner.email)).toBeVisible();
  expect(screen.getByText("Ma’lumot mavjud emas")).toBeVisible();
  expect(screen.getByText("43")).toBeVisible();
  expect(screen.queryByText(/passwordHash|sessionVersion/)).not.toBeInTheDocument();
});

it("requires block confirmation and a reason, then sends the observed revision", async () => {
  let blocked = false;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      blocked = true;
      return response({ tenant: { id: tenant.id, status: "blocked", statusRevision: 4 } });
    }
    if (url.includes(`/tenants/${tenant.id}`)) return response({ tenant: { ...tenant, status: blocked ? "blocked" : "active", statusRevision: blocked ? 4 : 3 }, owner });
    return defaultResponse(url);
  });
  vi.stubGlobal("fetch", fetcher);
  renderApp(`/super-admin/tenants/${tenant.id}`);
  await userEvent.click(await screen.findByRole("button", { name: "Bloklash" }));
  const dialog = screen.getByRole("dialog");
  expect(dialog).toHaveTextContent(tenant.name);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  const reason = within(dialog).getByLabelText("Sabab");
  expect(reason).toBeRequired();
  await userEvent.click(within(dialog).getByRole("button", { name: "Bloklashni tasdiqlash" }));
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  await userEvent.type(reason, "Markaz egasining so‘rovi");
  await userEvent.click(within(dialog).getByRole("button", { name: "Bloklashni tasdiqlash" }));
  expect(await screen.findByRole("button", { name: "Faollashtirish" })).toBeVisible();
  const mutation = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(mutation[0]).toBe(`/api/super-admin/tenants/${tenant.id}/block`);
  expect(JSON.parse(mutation[1]!.body as string)).toEqual({ reason: "Markaz egasining so‘rovi", expectedRevision: 3 });
  expect(mutation[1]?.credentials).toBe("include");
});

it("preserves the reason on a failed block and does not show success", async () => {
  const fetcher = vi.fn((url: string, options?: RequestInit) => options?.method === "POST"
    ? response({ error: { message: "Holat o‘zgargan. Sahifani yangilang." } }, 409)
    : defaultResponse(url));
  vi.stubGlobal("fetch", fetcher);
  renderApp(`/super-admin/tenants/${tenant.id}`);
  await userEvent.click(await screen.findByRole("button", { name: "Bloklash" }));
  await userEvent.type(screen.getByLabelText("Sabab"), "Tekshiruv zarur");
  await userEvent.click(screen.getByRole("button", { name: "Bloklashni tasdiqlash" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Holat o‘zgargan");
  expect(screen.getByLabelText("Sabab")).toHaveValue("Tekshiruv zarur");
  expect(screen.getByRole("dialog")).toBeVisible();
  expect(screen.getByRole("button", { name: "Holatni yangilash" })).toBeVisible();
  expect(screen.queryByRole("button", { name: "Bloklashni tasdiqlash" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "Faollashtirish" })).not.toBeInTheDocument();
});

it("prevents duplicate submissions while the status change is pending", async () => {
  let finish!: (value: Response) => void;
  const fetcher = vi.fn((url: string, options?: RequestInit) => options?.method === "POST"
    ? new Promise<Response>(resolve => { finish = resolve; })
    : defaultResponse(url));
  vi.stubGlobal("fetch", fetcher);
  renderApp(`/super-admin/tenants/${tenant.id}`);
  await userEvent.click(await screen.findByRole("button", { name: "Bloklash" }));
  await userEvent.type(screen.getByLabelText("Sabab"), "Markaz egasining so‘rovi");
  await userEvent.click(screen.getByRole("button", { name: "Bloklashni tasdiqlash" }));
  const pending = screen.getByRole("button", { name: "Saqlanmoqda…" });
  expect(pending).toBeDisabled();
  expect(screen.getByRole("button", { name: "Bekor qilish" })).toBeDisabled();
  await userEvent.click(pending);
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
  await act(async () => finish(await response({ error: { message: "Sinov uchun vaqtinchalik xato" } }, 500)));
  expect(await screen.findByRole("button", { name: "Bloklashni tasdiqlash" })).toBeEnabled();
  expect(screen.getByLabelText("Sabab")).toHaveValue("Markaz egasining so‘rovi");
});

it("reactivates a blocked center only after explicit confirmation", async () => {
  let activated = false;
  const fetcher = vi.fn((url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      activated = true;
      return response({ tenant: { id: tenant.id, status: "active", statusRevision: 5 } });
    }
    if (url.includes(`/tenants/${tenant.id}`)) return response({ tenant: { ...tenant, status: activated ? "active" : "blocked", statusRevision: activated ? 5 : 4 }, owner });
    return defaultResponse(url);
  });
  vi.stubGlobal("fetch", fetcher);
  renderApp(`/super-admin/tenants/${tenant.id}`);
  await userEvent.click(await screen.findByRole("button", { name: "Faollashtirish" }));
  expect(fetcher.mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  await userEvent.type(screen.getByLabelText("Sabab"), "Tekshiruv yakunlandi");
  await userEvent.click(screen.getByRole("button", { name: "Faollashtirishni tasdiqlash" }));
  expect(await screen.findByRole("button", { name: "Bloklash" })).toBeVisible();
  const mutation = fetcher.mock.calls.find(([, options]) => options?.method === "POST")!;
  expect(mutation[0]).toBe(`/api/super-admin/tenants/${tenant.id}/activate`);
  expect(JSON.parse(mutation[1]!.body as string)).toEqual({ reason: "Tekshiruv yakunlandi", expectedRevision: 4 });
});

it("renders audit actor, center, reason and status transition without editing controls", async () => {
  const fetcher = vi.fn((url: string) => url.includes("/audit")
    ? response({ entries: [auditEntry], total: 21, page: 1, pageSize: 20 })
    : defaultResponse(url));
  vi.stubGlobal("fetch", fetcher);
  renderApp(`/super-admin/audit?tenantId=${tenant.id}`);
  expect(await screen.findByText(auditEntry.reason)).toBeVisible();
  expect(screen.getByText(auditEntry.actorId)).toBeVisible();
  expect(screen.getByText(auditEntry.tenantId)).toBeVisible();
  expect(screen.getByText("Faol → Bloklangan")).toBeVisible();
  expect(screen.queryByRole("button", { name: /Tahrirlash|O‘chirish/ })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() => expect(fetcher.mock.calls.at(-1)?.[0]).toContain("page=2"));
  expect(fetcher.mock.calls.at(-1)?.[0]).toContain(`tenantId=${tenant.id}`);
});

it("keeps unavailable platform statistics in a loading state rather than displaying zeroes", async () => {
  let finish!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn((url: string) => url.endsWith("/auth/me")
    ? response(session)
    : new Promise<Response>(resolve => { finish = resolve; })));
  renderApp();
  expect(await screen.findByRole("status")).toHaveTextContent("Yuklanmoqda…");
  expect(screen.queryByText("Jami markazlar")).not.toBeInTheDocument();
  await act(async () => finish(await response(statistics)));
  expect(await screen.findByText("117")).toBeVisible();
});

it("offers retry after a failed list load and distinguishes an empty platform", async () => {
  let attempts = 0;
  vi.stubGlobal("fetch", vi.fn((url: string) => {
    if (url.endsWith("/auth/me")) return response(session);
    attempts++;
    return attempts === 1
      ? response({ error: { message: "Markazlarni yuklab bo‘lmadi" } }, 500)
      : response({ tenants: [], total: 0, page: 1, pageSize: 20 });
  }));
  renderApp("/super-admin/tenants");
  expect(await screen.findByRole("alert")).toHaveTextContent("Markazlarni yuklab bo‘lmadi");
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByText(/Hali.*markaz|Markazlar topilmadi|Ma’lumotlar topilmadi/)).toBeVisible();
});
