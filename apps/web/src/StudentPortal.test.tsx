import { afterEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
import { StudentAccount } from "./StudentAccount";
import type { StudentStatus } from "@softlans/contracts";

const session = {
  user: {
    id: "student-user",
    name: "Sinov O‘quvchi",
    email: "student@synthetic.test",
    role: "student",
  },
  tenant: { id: "center", name: "Sinov markazi" },
};
const summary = {
  present: 0,
  absent: 0,
  late: 0,
  excused: 0,
  marked: 0,
  unmarked: 0,
  attendancePercentage: null,
};
const lesson = {
  key: "lesson",
  groupId: "group",
  groupName: "IELTS-03",
  courseName: "Ingliz tili",
  date: "2026-11-16",
  startTime: "16:00",
  endTime: "17:30",
  teacherName: "Sinov ustoz",
  classroomName: "204-xona",
  status: "scheduled",
};
const dashboard = {
  month: "2026-11",
  groups: [],
  attendance: summary,
  outstandingAmount: 0,
  nextDueDate: null,
  nextLesson: null,
};
const response = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: async () => data,
  } as Response);
function renderPortal(path = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
afterEach(() => vi.unstubAllGlobals());
it("routes student logins to their own shell without requesting staff APIs", async () => {
  const fetcher = vi.fn((url: string) =>
    response(url === "/api/auth/me" ? session : dashboard),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPortal("/students");
  expect(
    await screen.findByRole("heading", { name: "Xush kelibsiz, Sinov!" }),
  ).toBeVisible();
  expect(
    await screen.findByText("Siz hali guruhga biriktirilmagansiz"),
  ).toBeVisible();
  expect(screen.getAllByText("0 so‘m")).toHaveLength(2);
  expect(screen.getByText("—")).toBeVisible();
  expect(screen.queryByRole("link", { name: "Jamoa" })).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "O‘quvchilar" }),
  ).not.toBeInTheDocument();
  expect(fetcher.mock.calls.map((c) => c[0])).toEqual([
    "/api/auth/me",
    "/api/student/dashboard",
  ]);
});
it("recovers from a failed dashboard request and shows real next-lesson information", async () => {
  let attempts = 0;
  const fetcher = vi.fn((url: string) =>
    url === "/api/auth/me"
      ? response(session)
      : ++attempts === 1
        ? response({ error: { message: "Vaqtincha xatolik" } }, 503)
        : response({
            ...dashboard,
            groups: [
              {
                id: "g",
                name: "IELTS-03",
                courseName: "Ingliz tili",
                teacherName: "Sinov ustoz",
              },
            ],
            nextLesson: lesson,
          }),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPortal();
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Vaqtincha xatolik",
  );
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(await screen.findByText("16:00–17:30")).toBeVisible();
  expect(screen.getByText("IELTS-03 · 204-xona")).toBeVisible();
});
it("shows weekly cancellation and requests the selected week without changing CRM records", async () => {
  const fetcher = vi.fn((url: string) =>
    response(
      url === "/api/auth/me"
        ? session
        : {
            lessons: [{ ...lesson, status: "cancelled" }],
            weekStart: "2026-11-16",
            weekEnd: "2026-11-22",
            timezone: "Asia/Tashkent",
          },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPortal("/student/schedule");
  expect(await screen.findByText("Bekor qilingan")).toBeVisible();
  const initial = fetcher.mock.calls.at(-1)![0];
  await userEvent.click(screen.getByRole("button", { name: "Keyingi hafta" }));
  await waitFor(() => expect(fetcher.mock.calls.at(-1)![0]).not.toBe(initial));
  expect(fetcher.mock.calls.at(-1)![0]).toContain(
    "/api/student/schedule?date=",
  );
  await userEvent.click(screen.getByRole("button", { name: "Bu hafta" }));
  await waitFor(() => expect(fetcher.mock.calls.at(-1)![0]).toBe(initial));
});
it("shows unmarked attendance separately from absence and resets pagination on month changes", async () => {
  const fetcher = vi.fn((url: string) =>
    response(
      url === "/api/auth/me"
        ? session
        : {
            month: "2026-11",
            summary: {
              ...summary,
              absent: 1,
              unmarked: 1,
              marked: 1,
              attendancePercentage: 0,
            },
            total: 21,
            page:
              new URL(`http://local${url}`).searchParams.get("page") === "2"
                ? 2
                : 1,
            pageSize: 20,
            lessons: [
              {
                id: "a",
                date: "2020-01-01",
                startTime: "10:00",
                endTime: "11:00",
                groupName: "Ingliz tili",
                lessonStatus: "completed",
                status: null,
              },
              {
                id: "b",
                date: "2020-01-02",
                startTime: "10:00",
                endTime: "11:00",
                groupName: "Ingliz tili",
                lessonStatus: "completed",
                status: "absent",
              },
            ],
          },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPortal("/student/attendance");
  expect(await screen.findByText("0%")).toBeVisible();
  expect(screen.getByText("Kelmagan")).toBeVisible();
  const rows = screen.getAllByRole("row");
  expect(within(rows[1]!).getByText("Belgilanmagan")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.at(-1)![0]).toContain("page=2"),
  );
  fireEvent.change(screen.getByLabelText("Oy"), {
    target: { value: "2025-03" },
  });
  await waitFor(() =>
    expect(fetcher.mock.calls.at(-1)![0]).toContain("month=2025-03&page=1"),
  );
});
it("keeps charge balances and reversed payments visible and paginates payment history", async () => {
  const fetcher = vi.fn((url: string) =>
    response(
      url === "/api/auth/me"
        ? session
        : url.startsWith("/api/student/charges")
          ? {
              month: "2026-11",
              total: 1,
              page: 1,
              pageSize: 20,
              summary: { billed: 300000, paid: 100000, remaining: 200000 },
              charges: [
                {
                  id: "charge",
                  groupName: "IELTS-03",
                  dueDate: "2026-11-10T18:59:59Z",
                  finalAmount: 300000,
                  paidAmount: 100000,
                  remainingAmount: 200000,
                  status: "partial",
                },
              ],
            }
          : {
              month: "2026-11",
              total: 21,
              page: url.includes("page=2") ? 2 : 1,
              pageSize: 20,
              payments: [
                {
                  id: "payment",
                  amount: 100000,
                  paidAt: "2026-11-01T10:00:00Z",
                  method: "cash",
                  reversed: true,
                },
              ],
            },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPortal("/student/payments");
  expect(await screen.findByText("Qisman to‘langan")).toBeVisible();
  expect(await screen.findByText("Bekor qilingan")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: /to‘lash/i }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Keyingi" }));
  await waitFor(() =>
    expect(fetcher.mock.calls.at(-1)![0]).toContain("/api/student/payments?"),
  );
  expect(fetcher.mock.calls.at(-1)![0]).toContain("page=2");
});
it("shows profile information with existing password and security links", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      response(
        url === "/api/auth/me"
          ? session
          : {
              name: "Sinov O‘quvchi",
              email: session.user.email,
              centerName: "Sinov markazi",
              phone: "",
              enrollmentDate: "2020-01-01",
              status: "paused",
            },
      ),
    ),
  );
  renderPortal("/student/profile");
  expect(
    await screen.findByText("Ta’lim vaqtincha to‘xtatilgan"),
  ).toBeVisible();
  expect(
    screen.getByRole("link", { name: "Parolni o‘zgartirish" }),
  ).toHaveAttribute("href", "/account/change-password");
  expect(
    screen.getByRole("link", { name: "Hisob xavfsizligi" }),
  ).toHaveAttribute("href", "/account/security");
});
it("exits the student session using existing logout", async () => {
  const fetcher = vi.fn((url: string) =>
    url === "/api/auth/me"
      ? response(session)
      : url === "/api/auth/logout"
        ? response(null, 204)
        : response(dashboard),
  );
  vi.stubGlobal("fetch", fetcher);
  renderPortal();
  await screen.findByRole("heading", { name: "Xush kelibsiz, Sinov!" });
  await userEvent.click(
    screen.getByRole("button", { name: "Hisobdan chiqish" }),
  );
  expect(
    await screen.findByRole("button", { name: "Hisobga kirish" }),
  ).toBeVisible();
});
function renderAccount(status: StudentStatus = "active") {
  render(<StudentAccount studentId="student" status={status} />);
}
it("opens an account with only email and password and clears the credential fields", async () => {
  const fetcher = vi.fn((_url: string, options?: RequestInit) =>
    response(
      options?.method === "POST"
        ? {
            account: {
              id: "account",
              email: "new@synthetic.test",
              active: true,
            },
          }
        : { account: null },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  renderAccount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Kabinet ochish" }),
  );
  expect(screen.getByLabelText("Kabinet emaili")).toHaveFocus();
  await userEvent.type(
    screen.getByLabelText("Kabinet emaili"),
    "new@synthetic.test",
  );
  await userEvent.type(
    screen.getByLabelText("Boshlang‘ich parol"),
    "synthetic-student-password",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kabinetni ochish" }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "O‘quvchi kabineti ochildi.",
  );
  const call = fetcher.mock.calls.find((c) => c[1]?.method === "POST")!;
  expect(call[0]).toBe("/api/students/student/account");
  expect(JSON.parse(call[1]!.body as string)).toEqual({
    email: "new@synthetic.test",
    password: "synthetic-student-password",
  });
  expect(screen.queryByLabelText("Boshlang‘ich parol")).not.toBeInTheDocument();
  expect(screen.getByText("new@synthetic.test")).toBeVisible();
});
it("validates account fields and retains values after a duplicate account error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, options?: RequestInit) =>
      options?.method === "POST"
        ? response({ error: { message: "Hisob mavjud." } }, 409)
        : response({ account: null }),
    ),
  );
  renderAccount();
  await userEvent.click(
    await screen.findByRole("button", { name: "Kabinet ochish" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kabinetni ochish" }),
  );
  expect(screen.getByLabelText("Kabinet emaili")).toHaveFocus();
  expect(screen.getByLabelText("Kabinet emaili")).toHaveAttribute(
    "aria-invalid",
    "true",
  );
  await userEvent.type(
    screen.getByLabelText("Kabinet emaili"),
    "existing@synthetic.test",
  );
  await userEvent.type(
    screen.getByLabelText("Boshlang‘ich parol"),
    "synthetic-student-password",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Kabinetni ochish" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Hisob mavjud.");
  expect(screen.getByLabelText("Kabinet emaili")).toHaveValue(
    "existing@synthetic.test",
  );
});
it("does not allow account creation for archived students", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => response({ account: null })),
  );
  renderAccount("archived");
  expect(
    await screen.findByText(
      "Kabinet ochish uchun avval o‘quvchini faollashtiring.",
    ),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Kabinet ochish" }),
  ).not.toBeInTheDocument();
});
