import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import { beforeEach, it, expect, vi } from "vitest";
import { Attendance, AttendanceMark } from "./Attendance";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const roster = () => ({
  session: {
    id: "session",
    groupId: "group",
    groupName: "Matematika",
    lessonDate: "2026-10-30",
    startTime: "10:00",
    endTime: "11:00",
    status: "scheduled",
    revision: 0,
  },
  students: [
    {
      studentId: "one",
      name: "Synthetic One",
      status: null,
      note: "",
      markedAt: null,
    },
    {
      studentId: "two",
      name: "Synthetic Two",
      status: "late",
      note: "",
      markedAt: null,
    },
  ],
});
function mark(manage = false) {
  render(
    <MemoryRouter initialEntries={["/attendance/sessions/session"]}>
      <Routes>
        <Route
          path="/attendance/sessions/:id"
          element={<AttendanceMark manage={manage} />}
        />
      </Routes>
    </MemoryRouter>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api).mockResolvedValue(roster() as never);
});
it("keeps unmarked distinct, confirms bulk present and submits only changed records with revision", async () => {
  const u = userEvent.setup();
  mark();
  expect(screen.getByRole("status")).toHaveTextContent("Yuklanmoqda");
  await screen.findByText("Synthetic One");
  expect(screen.getByText("Belgilanmagan")).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Davomatni saqlash" }),
  ).toBeDisabled();
  await u.click(screen.getByRole("button", { name: /Belgilanmaganlarni/ }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
  await u.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Tasdiqlash",
    }),
  );
  expect(
    screen.getAllByRole("button", { name: "Kechikdi" })[1],
  ).toHaveAttribute("aria-pressed", "true");
  expect(api).toHaveBeenCalledTimes(1);
  await u.click(screen.getByRole("button", { name: "Davomatni saqlash" }));
  await u.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Tasdiqlash",
    }),
  );
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith(
      "/attendance/sessions/session/attendance",
      {
        method: "PATCH",
        body: JSON.stringify({
          revision: 0,
          records: [{ studentId: "one", status: "present", note: "" }],
        }),
      },
    ),
  );
  expect(await screen.findByText("Davomat saqlandi.")).toBeInTheDocument();
});
it("retains edits on conflict and exposes no teacher cancellation control", async () => {
  const u = userEvent.setup();
  mark();
  await screen.findByText("Synthetic One");
  expect(
    screen.queryByRole("button", { name: "Darsni bekor qilish" }),
  ).not.toBeInTheDocument();
  await u.click(screen.getAllByRole("button", { name: "Kelmadi" })[0]!);
  vi.mocked(api).mockRejectedValueOnce(
    new Error("Davomat o‘zgargan. Sahifani yangilang."),
  );
  await u.click(screen.getByRole("button", { name: "Davomatni saqlash" }));
  await u.click(
    within(screen.getByRole("dialog")).getByRole("button", {
      name: "Tasdiqlash",
    }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Davomat o‘zgargan",
  );
  expect(screen.getAllByRole("button", { name: "Kelmadi" })[0]).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(screen.queryByText("Davomat saqlandi.")).not.toBeInTheDocument();
});
it("shows empty and retry states without fabricated counts", async () => {
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.startsWith("/groups")) return { groups: [] } as never;
    if (path === "/attendance/generate") return undefined as never;
    if (path.startsWith("/attendance/summary"))
      return {
        present: 0,
        absent: 0,
        late: 0,
        excused: 0,
        unmarked: 0,
        attendancePercentage: null,
        coveragePercentage: null,
        totalSessions: 0,
        completedSessions: 0,
        awaitingSessions: 0,
      } as never;
    return { sessions: [], total: 0, pageSize: 20 } as never;
  });
  render(
    <MemoryRouter>
      <Attendance />
    </MemoryRouter>,
  );
  expect(
    await screen.findByText("Tanlangan davrda darslar topilmadi."),
  ).toBeInTheDocument();
  expect(
    screen.getByText(/Belgilanmaganlar kelmadi deb hisoblanmaydi/),
  ).toBeInTheDocument();
});
