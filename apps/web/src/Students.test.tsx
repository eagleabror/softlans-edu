import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { StudentDetail, StudentForm, StudentsList } from "./Students";
const student = {
  id: "abc",
  firstName: "Sinov",
  lastName: "O‘quvchi",
  phone: "+0000000001",
  parentName: "",
  parentPhone: "",
  notes: "",
  birthDate: null,
  enrollmentDate: "2020-01-01",
  status: "active",
  createdBy: "test",
  createdAt: "2020-01-01",
  updatedAt: "2020-01-01",
};
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
        <Route path="/students" element={<StudentsList />} />
        <Route path="/students/new" element={<StudentForm />} />
        <Route path="/students/:id" element={<StudentDetail />} />
        <Route path="/students/:id/edit" element={<StudentForm edit />} />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
});
afterEach(() => vi.unstubAllGlobals());
it("lists students and sends server pagination, search and filters", async () => {
  const fetcher = vi.fn((_url: string) =>
    response({ students: [student], total: 21, page: 1, pageSize: 20 }),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage("/students");
  expect(await screen.findByText("Sinov O‘quvchi")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain("page=2"),
  );
  await userEvent.type(screen.getByLabelText("Ism yoki telefon"), "Sinov");
  await userEvent.click(screen.getByRole("button", { name: "Qidirish" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain("search=Sinov"),
  );
  await userEvent.selectOptions(screen.getByLabelText("Holati"), "archived");
  await waitFor(() =>
    expect(fetcher.mock.calls.at(-1)?.[0]).toContain("status=archived"),
  );
});
it("shows loading, a recoverable error and an empty state", async () => {
  const fetcher = vi
    .fn()
    .mockImplementationOnce(() =>
      response({ error: { message: "Sinov xatosi" } }, 500),
    )
    .mockImplementation(() =>
      response({ students: [], total: 0, page: 1, pageSize: 20 }),
    );
  vi.stubGlobal("fetch", fetcher);
  renderPage("/students");
  expect(await screen.findByRole("alert")).toHaveTextContent("Sinov xatosi");
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByText("Hali o‘quvchilar yo‘q")).toBeVisible();
});
it("submits only student fields with cookie authentication and shows success", async () => {
  const fetcher = vi.fn((url: string, options?: RequestInit) =>
    response({
      student: { ...student, ...JSON.parse((options?.body as string) || "{}") },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage("/students/new");
  await userEvent.type(screen.getByLabelText("Ism *"), "Sinov");
  await userEvent.type(screen.getByLabelText("Familiya *"), "O‘quvchi");
  await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "O‘quvchi qo‘shildi.",
  );
  const options = fetcher.mock.calls.find((c) => c[1]?.method === "POST")![1]!;
  const body = JSON.parse(options.body as string);
  expect(body).toMatchObject({
    firstName: "Sinov",
    lastName: "O‘quvchi",
    birthDate: null,
  });
  expect(body).not.toHaveProperty("tenantId");
  expect(body).not.toHaveProperty("status");
  expect(options.credentials).toBe("include");
});
it("loads an edit form and focuses a field rejected by the API", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, options?: RequestInit) =>
      options?.method === "PATCH"
        ? response(
            {
              error: {
                message: "Ma’lumotlarni tekshiring.",
                fields: { phone: ["Invalid"] },
              },
            },
            400,
          )
        : response({ student }),
    ),
  );
  renderPage("/students/abc/edit");
  expect(await screen.findByDisplayValue("Sinov")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Ma’lumotlarni tekshiring.",
  );
  expect(screen.getByLabelText("Telefon")).toHaveFocus();
  expect(screen.getByLabelText("Telefon")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
});
it("requires archive confirmation and displays the updated status", async () => {
  const fetcher = vi.fn((_url: string, options?: RequestInit) =>
    response({
      student: {
        ...student,
        ...(options?.method === "PATCH" ? { status: "archived" } : {}),
      },
    }),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPage("/students/abc");
  await userEvent.click(
    await screen.findByRole("button", { name: "Arxivlash" }),
  );
  expect(
    screen.getByRole("dialog", { name: "O‘quvchini arxivlash" }),
  ).toBeVisible();
  expect(
    fetcher.mock.calls.filter((c) => c[1]?.method === "PATCH"),
  ).toHaveLength(0);
  await userEvent.click(
    screen.getByRole("button", { name: "Arxivlashni tasdiqlash" }),
  );
  expect(await screen.findByText("Arxivlangan")).toBeVisible();
  expect(screen.getByRole("button", { name: "Faollashtirish" })).toBeVisible();
});
