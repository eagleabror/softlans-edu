import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, it, expect, vi } from "vitest";
import { Notifications } from "./Notifications";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const settings = {
  debt: false,
  attendance: false,
  lesson: false,
  debtDays: [-3, 0, 3, 7],
  lessonHours: [24, 1],
  late: false,
  excused: false,
  corrections: false,
  quietStart: "21:00",
  quietEnd: "08:00",
  language: "uz",
  debtTemplate: "",
  attendanceTemplate: "",
  lessonTemplate: "",
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) => {
    if (path.endsWith("/summary")) return { counts: { sent: 3 } };
    if (path.endsWith("/settings")) return { settings };
    if (path.startsWith("/students"))
      return {
        students: [{ id: "student1", firstName: "Ali", lastName: "Vali" }],
      };
    if (path.includes("/guardians?")) return { guardians: [] };
    if (path.includes("/history?")) return { jobs: [], total: 0 };
    return {};
  });
});
it("shows real summary and owner-only settings", async () => {
  render(<Notifications owner={false} />);
  expect(
    await screen.findByRole("heading", { name: "Telegram xabarnomalari" }),
  ).toBeVisible();
  await waitFor(() => expect(screen.getByText("3")).toBeVisible());
  expect(
    screen.queryByRole("button", { name: "Avtomatik eslatmalar" }),
  ).not.toBeInTheDocument();
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Xabarlar tarixi" }));
  expect(await screen.findByText("Ma’lumotlar topilmadi.")).toBeVisible();
});
it("saves configurable reminders without overriding recipient consent", async () => {
  render(<Notifications owner />);
  const user = userEvent.setup();
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/notifications/settings"),
  );
  await user.click(
    screen.getByRole("button", { name: "Avtomatik eslatmalar" }),
  );
  await user.click(
    await screen.findByRole("checkbox", { name: "To‘lov eslatmalari" }),
  );
  await user.click(screen.getByRole("button", { name: "Saqlash" }));
  expect(api).toHaveBeenCalledWith(
    "/notifications/settings",
    expect.objectContaining({
      method: "PATCH",
      body: JSON.stringify({ ...settings, debt: true }),
    }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "Sozlamalar saqlandi.",
  );
});
it("guardian invitation requires a selected student and guardianship confirmation", async () => {
  render(<Notifications owner />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Ota-onalarni ulash" }));
  expect(
    screen.queryByRole("button", { name: "Xavfsiz taklif yaratish" }),
  ).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Izlash" }));
  await user.selectOptions(screen.getByLabelText("O‘quvchi"), "student1");
  expect(await screen.findByRole("checkbox")).toBeRequired();
  expect(
    screen.getByLabelText("Ota-onaning Telegram ID raqami"),
  ).toBeRequired();
});
it("failed loads show an error without empty success", async () => {
  vi.mocked(api).mockRejectedValue(new Error("Server xatosi"));
  render(<Notifications owner={false} />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Server xatosi");
  expect(screen.queryByText("Ma’lumotlar topilmadi.")).not.toBeInTheDocument();
});
