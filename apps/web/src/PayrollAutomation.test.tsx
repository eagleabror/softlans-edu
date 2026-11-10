import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { PayrollAutomation } from "./PayrollAutomation";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
beforeEach(() => vi.resetAllMocks());
const mount = (done = vi.fn()) =>
  render(
    <MemoryRouter>
      <PayrollAutomation month="2026-10" onComplete={done} />
    </MemoryRouter>,
  );
it("follows teacher cursors and confirms readiness only from final batch", async () => {
  let calls = 0;
  const done = vi.fn();
  vi.mocked(api).mockImplementation(async (_path, options) => {
    if (!options) return { run: null, items: [], total: 0 };
    calls++;
    return {
      month: "2026-10",
      status: calls === 1 ? "processing" : "completed",
      nextTeacher: calls === 1 ? "a".repeat(24) : null,
    };
  });
  mount(done);
  await userEvent.click(
    await screen.findByRole("button", { name: "Oylik qoralamalarni yaratish" }),
  );
  expect(
    await screen.findByText("Qoralamalar tayyor. Maoshlarni ko‘rib chiqing."),
  ).toBeInTheDocument();
  expect(done).toHaveBeenCalledTimes(1);
  expect(api).toHaveBeenCalledWith("/payroll/automation/run", {
    method: "POST",
    body: JSON.stringify({
      month: "2026-10",
      confirmed: true,
      afterTeacher: "a".repeat(24),
    }),
  });
});
it("shows recoverable rule exceptions and review links", async () => {
  vi.mocked(api).mockResolvedValue({
    run: { status: "exceptions" },
    total: 1,
    items: [
      {
        _id: "1",
        teacherName: "Sardor Ustoz",
        status: "exception",
        code: "NO_SALARY_RULE",
        message: "Maosh qoidasini kiriting.",
      },
    ],
  });
  mount();
  expect(
    await screen.findByText("Maosh qoidasini kiriting."),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Maosh sozlamalari" }),
  ).toHaveAttribute("href", "/payroll/settings");
  expect(screen.getByText("Sardor Ustoz")).toBeInTheDocument();
});
it("keeps failures visible and permits a safe retry after an uncertain acknowledgement", async () => {
  let submissions = 0;
  vi.mocked(api).mockImplementation(async (_path, options) => {
    if (!options) return { run: null, items: [], total: 0 };
    submissions++;
    return submissions === 1
      ? { status: "accepted" }
      : { month: "2026-10", status: "exceptions", nextTeacher: null };
  });
  const done = vi.fn();
  mount(done);
  const run = screen.getByRole("button", {
    name: "Oylik qoralamalarni yaratish",
  });
  await userEvent.click(run);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Yakun natijasi tasdiqlanmadi",
  );
  expect(done).not.toHaveBeenCalled();
  await waitFor(() => expect(run).toBeEnabled());
  await userEvent.click(run);
  expect(
    await screen.findByText(
      "Ayrim maoshlar tayyor emas. Istisnolarni tekshiring va qayta urining.",
    ),
  ).toBeInTheDocument();
  expect(
    screen.queryByText("Qoralamalar tayyor. Maoshlarni ko‘rib chiqing."),
  ).not.toBeInTheDocument();
});
it("recovers from status load failure without hiding it as an empty result", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Ulanish xatosi"))
    .mockResolvedValue({ run: { status: "completed" }, items: [], total: 0 });
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Ulanish xatosi");
  await userEvent.click(
    screen.getByRole("button", { name: "Holatni yangilash" }),
  );
  expect(await screen.findByText("Qoralamalar tayyor")).toBeInTheDocument();
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

it("explains when an inactive teacher has left payroll eligibility", async () => {
  vi.mocked(api).mockResolvedValue({ run: { status: "completed" }, total: 1, items: [
    { _id: "1", teacherName: "Sardor Ustoz", status: "excluded", code: "TEACHER_INELIGIBLE", message: "O‘qituvchi faol emas." },
  ] });
  mount();
  expect(await screen.findByText("Hisob-kitobdan chiqarilgan")).toBeInTheDocument();
  expect(screen.getByText("O‘qituvchi faol emas.")).toBeInTheDocument();
});

it("shows a read-only preview with calculation basis without triggering draft generation", async () => {
  vi.mocked(api).mockImplementation(async (_path, options) => {
    if (!options) return { run: null, items: [], total: 0 };
    return { month: "2026-10", nextTeacher: null, items: [{ teacherId: "1", teacherName: "Ustoz", status: "would_create", basis: { grossSalary: 500, lines: [{ groupName: "Ingliz tili", salaryType: "billed", basisAmount: 1000, salary: 500 }] } }] };
  });
  mount();
  await userEvent.click(screen.getByRole("button", { name: "Yozuvsiz tekshirish" }));
  expect(await screen.findByText(/Ingliz tili · Hisoblangan ta’lim haqidan foiz · asos:/)).toBeInTheDocument();
  expect(screen.getByText(/Qoralama, audit yoki xabar yaratilmaydi/)).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/payroll/automation/preview", { method: "POST", body: JSON.stringify({ month: "2026-10" }) });
  expect(vi.mocked(api).mock.calls.some(([path]) => path === "/payroll/automation/run")).toBe(false);
});
it("shows failed/interrupted history and pending outbox without claiming delivery", async () => {
  vi.mocked(api).mockResolvedValue({ run: { status: "completed" }, items: [], total: 0,
    notifications: [{ _id: "pending", count: 1 }], attempts: { total: 2, runs: [
      { _id: "1", source: "scheduled", status: "running", startedAt: "2026-11-01T00:00:00Z" },
      { _id: "2", source: "manual", status: "failed", errorCode: "PAYROLL_RUN_FAILED", startedAt: "2026-11-01T01:00:00Z" },
    ] } });
  mount();
  expect(await screen.findByText(/Yakun tasdiqlanmagan/)).toBeInTheDocument();
  expect(screen.getByText(/PAYROLL_RUN_FAILED/)).toBeInTheDocument();
  expect(screen.getByText(/Navbatda: 1/)).toHaveTextContent("yetkazib berish tasdig‘i emas");
  expect(screen.queryByText(/Yuborildi:/)).not.toBeInTheDocument();
});
it("paginates attempt history separately from monthly teacher results", async () => {
  vi.mocked(api).mockResolvedValue({ run: null, items: [], total: 0, attempts: { total: 21, runs: [] } });
  mount();
  await userEvent.click(await screen.findByRole("button", { name: "Keyingi urinishlar" }));
  await waitFor(() => expect(api).toHaveBeenLastCalledWith("/payroll/automation/status?month=2026-10&page=1&historyPage=2"));
});
