import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { MfaLoginChallenge, SecuritySettings } from "./MfaSecurity";
import { App } from "./App";
const response = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
const status = { enabled: false, available: true, recoveryCodesRemaining: 0, superAdminEnforced: false };
function setup(handler: (url: string, init?: RequestInit) => Promise<Response>, element = <SecuritySettings onSignedOut={() => {}} />) {
  const fetchMock = vi.fn(handler); vi.stubGlobal("fetch", fetchMock);
  render(<MemoryRouter initialEntries={["/login"]}>{element}</MemoryRouter>); return fetchMock;
}
afterEach(() => vi.unstubAllGlobals());
describe("Uzbek MFA security interface", () => {
  it("keeps password-only MFA login outside the authenticated shell and completes only the challenge", async () => {
    const session = { user: { id: "u", name: "Sinov", email: "test@synthetic.test", role: "teacher" }, tenant: { id: "t", name: "Sinov markazi" } };
    const fetchMock = setup(url => {
      if (url.endsWith("/auth/me")) return response({}, 401);
      if (url.endsWith("/auth/login")) return response({ mfaRequired: true });
      return response(session);
    }, <App />);
    await userEvent.type(await screen.findByLabelText("Email manzili"), "test@synthetic.test");
    await userEvent.type(screen.getByLabelText("Parol", { exact: true }), "Synthetic-password!");
    await userEvent.click(screen.getByRole("button", { name: "Hisobga kirish" }));
    expect(await screen.findByRole("heading", { name: "Ikki bosqichli tasdiqlash" })).toBeVisible();
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url.includes("dashboard"))).toBe(false);
  });
  it("shows a failed challenge, permits retry, and never persists the code", async () => {
    const signedIn = vi.fn(); const cancel = vi.fn();
    const fetchMock = setup(() => response({ error: { message: "Kod yaroqsiz." } }, 401), <MfaLoginChallenge onSession={signedIn} onCancel={cancel} />);
    await userEvent.type(screen.getByLabelText("Tasdiqlash yoki tiklash kodi"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Kirishni tasdiqlash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Kod yaroqsiz."); expect(signedIn).not.toHaveBeenCalled();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ code: "123456" });
    expect(localStorage.length).toBe(0); expect(sessionStorage.length).toBe(0);
    fetchMock.mockImplementation(() => response(undefined, 204));
    await userEvent.click(screen.getByRole("button", { name: "Kirishga qaytish" })); expect(cancel).toHaveBeenCalledOnce();
  });
  it("loads settings with retry and disables enrollment when server configuration is absent", async () => {
    const fetchMock = setup(() => response({ error: { message: "Vaqtincha xatolik." } }, 500));
    expect(await screen.findByRole("alert")).toHaveTextContent("Vaqtincha xatolik.");
    fetchMock.mockImplementation(url => response(url.endsWith("/security") ? { ...status, available: false } : { legacy: false, sessions: [] }));
    await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
    expect(await screen.findByRole("button", { name: "Himoyani yoqish" })).toBeDisabled();
  });
  it("uses password-verified enrollment and code confirmation, displays recovery codes once and clears form secrets", async () => {
    const synthetic = "abcd-1234-abcd-1234-abcd-1234-abcd-1234";
    const fetchMock = setup((url, init) => {
      if (url.endsWith("/enroll")) return response({ qrDataUrl: "data:image/png;base64,synthetic" });
      if (url.endsWith("/confirm")) return response({ recoveryCodes: [synthetic] });
      return response(url.endsWith("/security") ? status : { legacy: false, sessions: [] });
    });
    await userEvent.click(await screen.findByRole("button", { name: "Himoyani yoqish" }));
    expect(screen.getByLabelText("Joriy parol")).toHaveFocus();
    await userEvent.type(screen.getByLabelText("Joriy parol"), "Synthetic-password!");
    await userEvent.click(screen.getByRole("button", { name: "Tasdiqlash" }));
    expect(await screen.findByRole("heading", { name: "QR-kod orqali ulash" })).toBeVisible();
    expect(screen.queryByLabelText("Joriy parol")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Kodni kiritish" }));
    await userEvent.type(screen.getByLabelText("Joriy parol"), "Synthetic-password!");
    await userEvent.type(screen.getByLabelText("Tasdiqlash kodi"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Tasdiqlash" }));
    expect(await screen.findByText(synthetic)).toBeVisible();
    const confirm = fetchMock.mock.calls.find(([url]) => url.endsWith("/confirm"))!;
    expect(JSON.parse(confirm[1]!.body as string)).toEqual({ password: "Synthetic-password!", code: "123456" });
    await userEvent.click(screen.getByRole("button", { name: "Kodlarni saqladim" }));
    expect(screen.queryByText(synthetic)).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("qayta ko‘rib bo‘lmaydi");
  });
  it("keeps the user in the confirmation view after failure and shows the Super Admin enforcement policy", async () => {
    setup(url => url.endsWith("/disable") ? response({ error: { message: "Kod yaroqsiz." } }, 401) : response(url.endsWith("/security") ? { ...status, enabled: true, superAdminEnforced: true, recoveryCodesRemaining: 9 } : { legacy: false, sessions: [] }));
    expect(await screen.findByText("Super administrator uchun ushbu himoya majburiy.")).toBeVisible();
    expect(screen.queryByRole("button", { name: "Himoyani o‘chirish" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Tiklash kodlarini yangilash" }));
    expect(screen.getByText("Avvalgi barcha tiklash kodlari bekor qilinadi.")).toBeVisible();
    expect(screen.getByLabelText("Tasdiqlash yoki tiklash kodi")).toBeRequired();
  });
  it("marks the current device and opens and closes an accessible native dialog", async () => {
    const show = vi.fn(function (this: HTMLDialogElement) { this.setAttribute("open", ""); });
    Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: show });
    Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute("open"); } });
    setup(url => response(url.endsWith("/security") ? status : { legacy: false, sessions: [{ id: "device", current: true, device: "Linux · Chrome", signedInAt: "2026-11-01T10:00:00Z", lastActivityAt: "2026-11-01T10:02:00Z" }] }));
    expect(await screen.findByText("Joriy qurilma")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Sessiyani tugatish" }));
    expect(show).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "Sessiyani tugatish" })).toHaveTextContent("Bu joriy qurilma.");
    await userEvent.click(screen.getByRole("button", { name: "Bekor qilish" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    vi.restoreAllMocks();
  });
});
