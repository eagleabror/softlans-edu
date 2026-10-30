import {
  render,
  screen,
  waitFor,
  within,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { PayrollPage, PayrollDetail } from "./Payroll";
import { api, HttpError } from "./api";
vi.mock("./api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./api")>()),
  api: vi.fn(),
}));
const statement = {
  id: "a".repeat(24),
  teacherId: "b".repeat(24),
  teacherName: "Sinov Ustoz",
  payrollMonth: "2025-02",
  calculationBasis: { lines: [], grossSalary: 1000 },
  grossSalary: 1000,
  adjustments: [],
  finalSalary: 1000,
  paidAmount: 400,
  outstandingAmount: 600,
  status: "approved",
  revision: 1,
};
beforeEach(() => {
  vi.resetAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups/teachers"))
      return {
        teachers: [{ id: statement.teacherId, name: "Sinov Ustoz" }],
        total: 1,
      };
    if (path.startsWith("/groups")) return { groups: [], total: 0 };
    if (path.startsWith("/payroll/rules")) return { rules: [], total: 0 };
    if (path.startsWith("/payroll/summary"))
      return { approvedSalary: 1000, paidSalary: 400, outstandingSalary: 600 };
    if (path.endsWith("/payouts")) return { payouts: [] };
    if (path.startsWith("/payroll/" + statement.id))
      return { payroll: statement };
    return { payrolls: [statement], total: 1 };
  });
});
it("shows own statements without manager controls or a summary fetch", async () => {
  render(
    <MemoryRouter>
      <PayrollPage owner={false} />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Sinov Ustoz")).toBeInTheDocument();
  expect(screen.queryByText("Maosh sozlamalari")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("O‘qituvchi")).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining("/summary"));
});
it("renders separate expense, cash and liability cards and sends teacher filters", async () => {
  render(
    <MemoryRouter>
      <PayrollPage owner />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Maosh majburiyati")).toBeInTheDocument();
  await userEvent.selectOptions(
    await screen.findByLabelText("O‘qituvchi"),
    statement.teacherId,
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining("teacherId=" + statement.teacherId),
    ),
  );
  expect(screen.getByText("Tasdiqlangan maosh xarajati")).toBeInTheDocument();
});
it("does not show payout or approval controls on teacher detail", async () => {
  render(
    <MemoryRouter initialEntries={["/payroll/" + statement.id]}>
      <Routes>
        <Route path="/payroll/:id" element={<PayrollDetail owner={false} />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(
    await screen.findByText("Maosh to‘lovlari tarixi"),
  ).toBeInTheDocument();
  expect(screen.queryByText("To‘lovni qayd etish")).not.toBeInTheDocument();
  expect(screen.queryByText("Maoshni tasdiqlash")).not.toBeInTheDocument();
});
it("displays a failed load with a working retry", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Ulanish xatosi"));
  render(
    <MemoryRouter>
      <PayrollPage owner={false} />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Ulanish xatosi");
  await userEvent.click(screen.getByText("Qayta urinish"));
  expect(await screen.findByText("Sinov Ustoz")).toBeInTheDocument();
});
it("requires explicit confirmation before approving a draft", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.endsWith("/payouts")
      ? { payouts: [] }
      : { payroll: { ...statement, status: "draft" } },
  );
  render(
    <MemoryRouter initialEntries={["/payroll/" + statement.id]}>
      <Routes>
        <Route path="/payroll/:id" element={<PayrollDetail owner />} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(await screen.findByText("Maoshni tasdiqlash"));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Maoshni tasdiqlaysizmi?",
  );
  expect(api).not.toHaveBeenCalledWith(
    expect.stringContaining("/approve"),
    expect.anything(),
  );
  await userEvent.click(screen.getByRole("button", { name: "Tasdiqlash" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/payroll/" + statement.id + "/approve",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ revision: 1, confirmed: true }),
      }),
    ),
  );
});

it.each(["collected", "fixed"])(
  "saves a %s rule with a canonical first-of-month date",
  async (type) => {
    render(
      <MemoryRouter>
        <PayrollPage owner settings />
      </MemoryRouter>,
    );
    const form = within(screen.getByRole("form", { name: "Maosh qoidasi" }));
    await waitFor(() =>
      expect(
        form.getByRole("option", { name: "Sinov Ustoz" }),
      ).toBeInTheDocument(),
    );
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await userEvent.selectOptions(
      form.getByLabelText("O‘qituvchi"),
      statement.teacherId,
    );
    await userEvent.selectOptions(form.getByLabelText("Maosh turi"), type);
    const start = form.getByLabelText("Amal boshlanish oyi");
    expect(start).toHaveAttribute("type", "month");
    fireEvent.change(start, { target: { value: "2026-10" } });
    await userEvent.type(
      form.getByLabelText(
        type === "fixed" ? "Belgilangan summa (UZS)" : "Foiz",
      ),
      type === "fixed" ? "3000000" : "40",
    );
    await userEvent.type(form.getByLabelText("Sabab"), "Kelishilgan maosh");
    await userEvent.click(form.getByRole("button", { name: "Saqlash" }));
    await waitFor(() =>
      expect(api).toHaveBeenCalledWith("/payroll/rules", {
        method: "POST",
        body: JSON.stringify({
          teacherId: statement.teacherId,
          groupId: null,
          salaryType: type,
          percentage: type === "fixed" ? null : 40,
          fixedAmount: type === "fixed" ? 3000000 : null,
          effectiveFrom: "2026-10-01",
          effectiveUntil: null,
          reason: "Kelishilgan maosh",
        }),
      }),
    );
    expect(await screen.findByText("Amal bajarildi.")).toBeInTheDocument();
  },
);

it("focuses and explains the rejected salary field, preserving values for a corrected retry", async () => {
  const original = vi.mocked(api).getMockImplementation()!;
  let submitted = false;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/payroll/rules" && options?.method === "POST" && !submitted) {
      submitted = true;
      throw new HttpError(400, "Kiritilgan ma’lumotlarni tekshiring.", {
        percentage: ["Invalid input"],
      });
    }
    return original(path, options);
  });
  render(
    <MemoryRouter>
      <PayrollPage owner settings />
    </MemoryRouter>,
  );
  const form = within(screen.getByRole("form", { name: "Maosh qoidasi" }));
  await waitFor(() =>
    expect(
      form.getByRole("option", { name: "Sinov Ustoz" }),
    ).toBeInTheDocument(),
  );
  await userEvent.selectOptions(
    form.getByLabelText("O‘qituvchi"),
    statement.teacherId,
  );
  const percentage = form.getByLabelText("Foiz");
  await userEvent.type(percentage, "40");
  await userEvent.type(form.getByLabelText("Sabab"), "Kelishilgan maosh");
  await userEvent.click(form.getByRole("button", { name: "Saqlash" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Belgilangan maydonlarni tuzatib, qayta saqlang.",
  );
  expect(percentage).toHaveFocus();
  expect(percentage).toHaveAttribute("aria-invalid", "true");
  expect(percentage).toHaveAccessibleDescription(
    "Foiz 0–100 oralig‘ida, ko‘pi bilan ikki kasr xonali bo‘lsin.",
  );
  expect(percentage).toHaveValue(40);
  expect(form.getByLabelText("Sabab")).toHaveValue("Kelishilgan maosh");
  await userEvent.click(form.getByRole("button", { name: "Saqlash" }));
  expect(await screen.findByText("Amal bajarildi.")).toBeInTheDocument();
  expect(percentage).toHaveAttribute("aria-invalid", "false");
});
