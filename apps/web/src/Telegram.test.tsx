import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { it, expect, vi, beforeEach } from "vitest";
import { TelegramSettings } from "./Telegram";
import { api } from "./api";
vi.mock("./api", () => ({ api: vi.fn() }));
beforeEach(() => vi.mocked(api).mockReset());
it("creates a private deep link with explicit refresh and handles errors", async () => {
  vi.mocked(api)
    .mockResolvedValueOnce({
      available: true,
      connected: false,
      notificationPreferences: { enabled: false },
    })
    .mockResolvedValueOnce({
      link: "https://t.me/test_bot?start=test",
      expiresAt: new Date(Date.now() + 600000).toISOString(),
    })
    .mockRejectedValueOnce(new Error("Xatolik"));
  render(<TelegramSettings />);
  const user = userEvent.setup();
  await user.click(
    await screen.findByRole("button", { name: "Telegramni ulash" }),
  );
  expect(
    await screen.findByRole("link", { name: "Telegramda ochish" }),
  ).toHaveAttribute("referrerpolicy", "no-referrer");
  await user.click(screen.getByRole("button", { name: "Holatni yangilash" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Xatolik");
});
it("shows opt-out and confirms disconnect", async () => {
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute("open", "");
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute("open");
  };
  vi.mocked(api)
    .mockResolvedValueOnce({
      available: true,
      connected: true,
      notificationPreferences: { enabled: true },
    })
    .mockResolvedValueOnce(undefined)
    .mockResolvedValueOnce({
      available: true,
      connected: true,
      notificationPreferences: { enabled: false },
    });
  render(<TelegramSettings />);
  const user = userEvent.setup();
  await user.click(await screen.findByRole("checkbox"));
  await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeChecked());
  await user.click(screen.getByRole("button", { name: "Telegramni uzish" }));
  expect(screen.getByRole("dialog")).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Bekor qilish" }));
  expect(api).not.toHaveBeenCalledWith(
    "/integrations/telegram/disconnect",
    expect.anything(),
  );
});
