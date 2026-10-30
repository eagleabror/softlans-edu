import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { Classrooms, ScheduleForm, ScheduleList } from "./Scheduling";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const room = {
  id: "r",
  name: "Test xona",
  status: "active",
  capacity: 20,
  description: "",
};
const group = { id: "g", name: "Test guruh", teacherId: "t", status: "active" };
const lesson = {
  id: "s",
  groupId: "g",
  teacherId: "t",
  classroomId: "r",
  groupName: "Test guruh",
  teacherName: "Test ustoz",
  classroomName: "Test xona",
  dayOfWeek: 1,
  startTime: "10:00",
  endTime: "11:00",
  status: "active",
};
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups/teachers"))
      return {
        teachers: [{ id: "t", name: "Test ustoz" }],
        total: 1,
        pageSize: 20,
      };
    if (path.startsWith("/groups"))
      return { groups: [group], total: 1, pageSize: 20 };
    if (path.startsWith("/classrooms"))
      return { classrooms: [room], total: 1, pageSize: 20 };
    return {
      schedules: [lesson],
      total: 1,
      pageSize: 20,
      weekStart: "2026-11-02",
      weekEnd: "2026-11-08",
    };
  });
});
it("renders weekly blocks and sends filters and week navigation", async () => {
  render(
    <MemoryRouter>
      <ScheduleList manage weekly />
    </MemoryRouter>,
  );
  expect(await screen.findByText("10:00 – 11:00")).toBeInTheDocument();
  expect(
    screen.getByText("2026-11-02 — 2026-11-08 · Asia/Tashkent"),
  ).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText("Xona"), "r");
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      expect.stringMatching(/schedules\/weekly\?.*classroomId=r/),
    ),
  );
  await userEvent.click(screen.getByRole("button", { name: "Hafta →" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(expect.stringContaining("date=")),
  );
});
it("hides management controls for teachers", async () => {
  render(
    <MemoryRouter>
      <ScheduleList manage={false} />
    </MemoryRouter>,
  );
  expect(await screen.findByText("10:00 – 11:00")).toBeInTheDocument();
  expect(screen.queryByText("Dars qo‘shish")).not.toBeInTheDocument();
  expect(screen.queryByText("Tahrirlash")).not.toBeInTheDocument();
  expect(api).not.toHaveBeenCalledWith(expect.stringContaining("/classrooms"));
});
it("shows errors and retries into the empty state", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups"))
      return { groups: [], total: 0, pageSize: 20 };
    throw new Error("Sinov xatosi");
  });
  render(
    <MemoryRouter>
      <ScheduleList manage={false} />
    </MemoryRouter>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Sinov xatosi");
  vi.mocked(api).mockResolvedValue({ schedules: [], total: 0, pageSize: 20 });
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByText("Darslar topilmadi.")).toBeInTheDocument();
});
it("creates a classroom using validated numeric capacity", async () => {
  render(
    <MemoryRouter>
      <Classrooms />
    </MemoryRouter>,
  );
  expect(await screen.findByText("Test xona")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Xona qo‘shish" }));
  await userEvent.type(screen.getByLabelText("Nomi"), "Yangi xona");
  await userEvent.type(screen.getByLabelText("Sig‘im"), "12");
  await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/classrooms",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          name: "Yangi xona",
          capacity: 12,
          description: "",
          status: "active",
        }),
      }),
    ),
  );
});
it("derives teacher from selected group and displays conflict messages", async () => {
  render(
    <MemoryRouter>
      <ScheduleForm />
    </MemoryRouter>,
  );
  await screen.findByRole("option", { name: "Test guruh" });
  await userEvent.selectOptions(screen.getByLabelText("Guruh"), "g");
  await userEvent.selectOptions(screen.getByLabelText("Xona"), "r");
  await userEvent.type(screen.getByLabelText("Boshlanish vaqti"), "10:00");
  await userEvent.type(screen.getByLabelText("Tugash vaqti"), "11:00");
  vi.mocked(api).mockRejectedValue(
    new Error("Xona uchun bu vaqtda boshqa dars mavjud."),
  );
  await userEvent.click(screen.getByRole("button", { name: "Saqlash" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/schedules",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining('"teacherId":"t"'),
      }),
    ),
  );
  expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent(
    "Xona uchun",
  );
});
it("loads edit details and deactivates a schedule", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path === "/schedules/s"
      ? { schedule: lesson }
      : path.startsWith("/groups/teachers")
        ? {
            teachers: [{ id: "t", name: "Test ustoz" }],
            total: 1,
            pageSize: 20,
          }
        : path.startsWith("/groups")
          ? { groups: [group], total: 1, pageSize: 20 }
          : { classrooms: [room], total: 1, pageSize: 20 },
  );
  render(
    <MemoryRouter initialEntries={["/schedules/s/edit"]}>
      <Routes>
        <Route path="/schedules/:id/edit" element={<ScheduleForm edit />} />
        <Route path="/schedules" element={<p>Jadvalga qaytildi</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "Darsni o‘chirish" }),
  );
  expect(await screen.findByText("Jadvalga qaytildi")).toBeInTheDocument();
  expect(api).toHaveBeenCalledWith("/schedules/s/deactivate", {
    method: "POST",
    body: "{}",
  });
});
