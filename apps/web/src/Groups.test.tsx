import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { GroupsList, GroupDetail, GroupForm } from "./Groups";
import { api } from "./api";
vi.mock("./api", async () => {
  const actual = await vi.importActual("./api");
  return { ...actual, api: vi.fn() };
});
const group = {
  id: "abc",
  name: "Guruh A",
  courseName: "Ingliz tili",
  teacherId: "teacher",
  teacherName: "Ustoz",
  capacity: 20,
  activeMemberCount: 1,
  monthlyFee: 250000,
  status: "active",
  startDate: "2026-11-01",
  description: "Sinov",
};
beforeEach(() => vi.resetAllMocks());
it("shows groups, capacity and filters", async () => {
  vi.mocked(api).mockResolvedValue({
    groups: [group],
    total: 1,
    page: 1,
    pageSize: 20,
  });
  render(
    <MemoryRouter>
      <GroupsList manage />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Guruh A")).toBeInTheDocument();
  expect(screen.getByText("1 / 20")).toBeInTheDocument();
  await userEvent.type(screen.getByRole("searchbox"), "English");
  await waitFor(() =>
    expect(api).toHaveBeenLastCalledWith(
      expect.stringContaining("search=English"),
    ),
  );
  expect(
    screen.getByRole("link", { name: "Guruh yaratish" }),
  ).toBeInTheDocument();
});
it("supports loading, empty and retry after errors", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Server xatosi"))
    .mockResolvedValueOnce({ groups: [], total: 0, page: 1, pageSize: 20 });
  render(
    <MemoryRouter>
      <GroupsList manage={false} />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Server xatosi");
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByText("Guruhlar topilmadi.")).toBeInTheDocument();
  expect(screen.queryByText("Guruh yaratish")).not.toBeInTheDocument();
});
it("shows teacher members without management controls", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("/members")
      ? {
          members: [
            {
              id: "m",
              studentId: "s",
              enrolledAt: "2026-10-01",
              status: "active",
              student: { firstName: "Ali", lastName: "Valiyev" },
            },
          ],
          total: 1,
          page: 1,
          pageSize: 20,
        }
      : { group },
  );
  render(
    <MemoryRouter initialEntries={["/groups/abc"]}>
      <Routes>
        <Route path="/groups/:id" element={<GroupDetail manage={false} />} />
      </Routes>
    </MemoryRouter>,
  );
  expect(await screen.findByText("Ali Valiyev")).toBeInTheDocument();
  expect(screen.getByText("O‘qituvchi: Ustoz")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "Chiqarish" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("O‘quvchi qo‘shish")).not.toBeInTheDocument();
});
it("creates group with selected teacher and integer UZS fee", async () => {
  vi.mocked(api).mockImplementation(async (path, options) =>
    options?.method === "POST"
      ? { group }
      : {
          teachers: [{ id: "teacher", name: "Ustoz" }],
          total: 1,
          pageSize: 20,
        },
  );
  render(
    <MemoryRouter>
      <GroupForm />
    </MemoryRouter>,
  );
  await screen.findByRole("option", { name: "Ustoz" });
  await userEvent.type(screen.getByLabelText("Guruh nomi"), "Guruh A");
  await userEvent.type(screen.getByLabelText("Kurs nomi"), "English");
  await userEvent.selectOptions(screen.getByLabelText("O‘qituvchi"), "teacher");
  await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/groups",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"monthlyFee":0'),
      }),
    ),
  );
});
