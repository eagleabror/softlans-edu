import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { Expenses } from "./Expenses";
import { api, HttpError } from "./api";
vi.mock("./api", async (original) => ({
  ...(await original<typeof import("./api")>()),
  api: vi.fn(),
}));
const account = {
  id: "a".repeat(24),
  name: "Naqd kassa",
  kind: "cash",
  active: true,
  openingDate: null,
};
const category = { id: "b".repeat(24), name: "Ijara", active: true };
const expense = {
  id: "c".repeat(24),
  amount: 1000,
  accountId: account.id,
  categoryId: category.id,
  description: "Sintetik ijara",
  expenseDate: "2025-02-10",
  status: "draft",
  supplier: "",
  reference: "",
  method: "cash",
  createdBy: "Sinov",
  createdAt: "2025-02-10T00:00:00Z",
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
    if (path === "/cash/draft-options")
      return { accounts: [account], categories: [category] };
    if (path === "/cash/accounts") return { rows: [account] };
    if (path === "/cash/categories") return { rows: [category] };
    if (path === `/cash/expenses/${expense.id}`) return { expense, audit: [] };
    return { rows: [expense], total: 1 };
  });
});
function show(path = "/expenses", owner = true) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/expenses/:id" element={<Expenses owner={owner} />} />
        <Route path="/expenses" element={<Expenses owner={owner} />} />
        <Route path="/cash/*" element={<Expenses owner={owner} />} />
      </Routes>
    </MemoryRouter>,
  );
}
it("restricts admin navigation to own drafts and sends date/category/account filters", async () => {
  show("/expenses", false);
  expect(await screen.findByText(expense.description)).toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Kunlik kassa" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByLabelText("Holat")).not.toBeInTheDocument();
  await userEvent.selectOptions(
    screen.getByLabelText("Hisob bo‘yicha"),
    account.id,
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringContaining(`accountId=${account.id}`),
    ),
  );
});
it("requires a reason and confirmation before changing money", async () => {
  show(`/expenses/${expense.id}`);
  await userEvent.click(
    await screen.findByRole("button", { name: "Tasdiqlash" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "hisobdan chiqim qilinadi",
  );
  expect(api).not.toHaveBeenCalledWith(
    expect.stringContaining("/confirm"),
    expect.anything(),
  );
  await userEvent.type(
    screen.getByLabelText("Amal sababi"),
    "Ijara tekshirildi",
  );
  await userEvent.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Tasdiqlash",
    }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      `/cash/expenses/${expense.id}/confirm`,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"confirmed":true'),
      }),
    ),
  );
});
it("preserves form values and idempotency key after a failed draft request", async () => {
  let fail = true;
  const base = vi.mocked(api).getMockImplementation()!;
  vi.mocked(api).mockImplementation(async (path, options) => {
    if (path === "/cash/expenses" && options?.method === "POST") {
      if (fail) {
        fail = false;
        throw new HttpError(0, "Aloqa uzildi");
      }
      return { expense };
    }
    return base(path, options);
  });
  show("/expenses/new");
  await userEvent.type(await screen.findByLabelText("Summa (UZS)"), "1000");
  await userEvent.selectOptions(
    screen.getByLabelText("Kategoriya", { exact: true }),
    category.id,
  );
  await userEvent.selectOptions(
    screen.getByLabelText("Hisob", { exact: true }),
    account.id,
  );
  await userEvent.type(screen.getByLabelText("Tavsif"), "Sinov ijara xarajati");
  await userEvent.click(
    screen.getByRole("button", { name: "Qoralamani saqlash" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Aloqa uzildi");
  expect(screen.getByLabelText("Summa (UZS)")).toHaveValue(1000);
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  await waitFor(() =>
    expect(
      vi
        .mocked(api)
        .mock.calls.filter(
          ([p, o]) => p === "/cash/expenses" && o?.method === "POST",
        ),
    ).toHaveLength(2),
  );
  const calls = vi
    .mocked(api)
    .mock.calls.filter(
      ([p, o]) => p === "/cash/expenses" && o?.method === "POST",
    );
  expect(calls).toHaveLength(2);
  expect(calls[0]![1]!.body).toBe(calls[1]![1]!.body);
});
it("opens a reasoned opening-balance dialog and cancels with no API mutation", async () => {
  show("/cash/accounts");
  await userEvent.type(
    await screen.findByLabelText("Boshlang‘ich qoldiq (UZS)"),
    "0",
  );
  fireEvent.change(screen.getByLabelText("Qoldiq sanasi"), {
    target: { value: "2025-02-01" },
  });
  await userEvent.click(
    screen.getByRole("button", { name: "Qoldiqni belgilash" }),
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "Boshlang‘ich qoldiqni belgilash",
  );
  await userEvent.click(screen.getByRole("button", { name: "Bekor qilish" }));
  expect(api).not.toHaveBeenCalledWith(
    expect.stringContaining("/opening"),
    expect.anything(),
  );
});
it("distinguishes loading, API errors and retry", async () => {
  vi.mocked(api).mockRejectedValueOnce(new HttpError(500, "Yuklash xatosi"));
  show();
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(await screen.findByRole("alert")).toHaveTextContent("Yuklash xatosi");
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByText(expense.description)).toBeInTheDocument();
});
