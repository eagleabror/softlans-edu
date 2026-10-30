import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, it, expect, vi } from "vitest";
import { DailyReports } from "./DailyReports";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
const settings = {
  enabled: false,
  time: "20:00",
  timezone: "Asia/Tashkent",
  sections: ["students", "financial", "attendance", "payroll"],
  quietStart: "21:00",
  quietEnd: "08:00",
};
beforeEach(() => {
  vi.mocked(api).mockReset();
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("history")
      ? { jobs: [], page: 1, total: 0 }
      : {
          settings,
          telegram: { available: true, connected: true, optedIn: true },
        },
  );
});
const mount = () =>
  render(
    <MemoryRouter>
      <DailyReports />
    </MemoryRouter>,
  );
it("saves owner preferences, previews saved report and enqueues a test", async () => {
  mount();
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("switch", { name: "Kunlik hisobotlarni yoqish" }),
  );
  await user.click(screen.getByRole("checkbox", { name: "Moliya" }));
  await user.click(screen.getByRole("button", { name: "Saqlash" }));
  await waitFor(() =>
    expect(api).toHaveBeenCalledWith("/daily-reports/settings", {
      method: "PATCH",
      body: JSON.stringify({
        ...settings,
        enabled: true,
        sections: ["students", "attendance", "payroll"],
      }),
    }),
  );
  await screen.findByText("Sozlamalar saqlandi.");
  vi.mocked(api).mockResolvedValueOnce({ text: "📊 Test hisobot" });
  await user.click(screen.getByRole("button", { name: "Oldindan ko‘rish" }));
  expect(await screen.findByLabelText("Hisobot matni")).toHaveTextContent(
    "Test hisobot",
  );
  await user.click(
    screen.getByRole("button", { name: "Sinov hisobotini yuborish" }),
  );
  expect(await screen.findByText(/Sinov navbati qayd etildi/)).toBeVisible();
});
it("disables sending for disconnected recipients and shows empty history", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("history")
      ? { jobs: [], page: 1, total: 0 }
      : {
          settings,
          telegram: { available: true, connected: false, optedIn: false },
        },
  );
  mount();
  expect(
    await screen.findByRole("button", { name: "Sinov hisobotini yuborish" }),
  ).toBeDisabled();
  expect(screen.getByText("Hisobotlar hali mavjud emas.")).toBeVisible();
});
it("shows request errors and allows refresh", async () => {
  vi.mocked(api).mockRejectedValueOnce(new Error("Ulanish xatosi"));
  mount();
  expect(await screen.findByRole("alert")).toHaveTextContent("Ulanish xatosi");
  await userEvent.click(screen.getByRole("button", { name: "Yangilash" }));
  expect(await screen.findByRole("switch")).toBeVisible();
});
it("shows uncertain delivery explicitly", async () => {
  vi.mocked(api).mockImplementation(async (path) =>
    path.includes("history")
      ? {
          jobs: [
            {
              _id: "a",
              kind: "owner_daily",
              eventDate: "2026-10-30",
              status: "failed",
              errorCode: "UNKNOWN_OUTCOME",
            },
          ],
          page: 1,
          total: 1,
        }
      : {
          settings,
          telegram: { available: true, connected: true, optedIn: true },
        },
  );
  mount();
  expect(await screen.findByText(/Yetkazilganligi noma’lum/)).toBeVisible();
});
