import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { PasswordSecurity } from "./PasswordSecurity";
const response = (body: unknown, status = 200) => Promise.resolve({ ok: status < 400, status, json: async () => body } as Response);
function setup(mode: "change" | "forgot" | "reset", handler?: (url: string, init?: RequestInit) => Promise<Response>) {
  const fetchMock = vi.fn(handler ?? (() => response({ enabled: true })));
  vi.stubGlobal("fetch", fetchMock);
  const signedOut = vi.fn();
  render(<MemoryRouter initialEntries={["/form"]}><Routes><Route path="/form" element={<PasswordSecurity mode={mode} onSignedOut={signedOut} />} />
    <Route path="/login" element={<h1>Kirish</h1>} /></Routes></MemoryRouter>);
  return { fetchMock, signedOut };
}
const valid = "Valid-new-password!";
async function fillPasswords(change = false) {
  if (change) await userEvent.type(screen.getByLabelText("Joriy parol"), "Current-password!");
  await userEvent.type(screen.getByLabelText("Yangi parol", { exact: true }), valid);
  await userEvent.type(screen.getByLabelText("Yangi parolni tasdiqlang"), valid);
}
afterEach(() => { vi.unstubAllGlobals(); window.history.replaceState(null, "", "/"); });
describe("Uzbek password security UI", () => {
  it("validates byte length and confirmation locally, focuses invalid fields and toggles visibility", async () => {
    const { fetchMock } = setup("change");
    await userEvent.type(screen.getByLabelText("Joriy parol"), "Current-password!");
    await userEvent.type(screen.getByLabelText("Yangi parol", { exact: true }), "ü".repeat(37));
    await userEvent.type(screen.getByLabelText("Yangi parolni tasdiqlang"), "different");
    await userEvent.click(screen.getByRole("button", { name: "Parolni yangilash" }));
    expect(screen.getByText("Parol 72 UTF-8 baytdan oshmasin.")).toBeVisible();
    expect(screen.getByText("Parollar mos kelmadi.")).toBeVisible();
    expect(screen.getByLabelText("Yangi parol", { exact: true })).toHaveFocus();
    expect(fetchMock).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Yangi parol: ko‘rsatish" }));
    expect(screen.getByLabelText("Yangi parol", { exact: true })).toHaveAttribute("type", "text");
  });
  it("rejects reuse and weak passwords without a request", async () => {
    const { fetchMock } = setup("change");
    await userEvent.click(screen.getByRole("button", { name: "Parolni yangilash" }));
    expect(screen.getByText("Joriy parolni kiriting.")).toBeVisible();
    expect(screen.getByText("Parol kamida 12 ta belgidan iborat bo‘lsin.")).toBeVisible();
    await userEvent.type(screen.getByLabelText("Joriy parol"), valid);
    await fillPasswords();
    await userEvent.click(screen.getByRole("button", { name: "Parolni yangilash" }));
    expect(screen.getByText("Yangi parol joriy paroldan farq qilishi kerak.")).toBeVisible();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("submits only server fields, blocks duplicate submission and clears local auth after success", async () => {
    let complete!: (r: Response) => void;
    const { fetchMock, signedOut } = setup("change", () => new Promise(r => { complete = r; }));
    await fillPasswords(true);
    await userEvent.click(screen.getByRole("button", { name: "Parolni yangilash" }));
    expect(screen.getByRole("button", { name: "Yuborilmoqda…" })).toBeDisabled();
    expect(screen.getByLabelText("Joriy parol")).toBeDisabled();
    expect(JSON.parse(fetchMock.mock.calls[0]![1]!.body as string)).toEqual({ currentPassword: "Current-password!", newPassword: valid });
    complete({ ok: true, status: 204 } as Response);
    await screen.findByRole("heading", { name: "Kirish" }); expect(signedOut).toHaveBeenCalledOnce();
  });
  it("retains inputs and enables retry after a server error", async () => {
    setup("change", () => response({ error: { message: "Joriy parol noto‘g‘ri." } }, 400));
    await fillPasswords(true); await userEvent.click(screen.getByRole("button", { name: "Parolni yangilash" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Joriy parol noto‘g‘ri.");
    expect(screen.getByLabelText("Yangi parol", { exact: true })).toHaveValue(valid);
    expect(screen.getByRole("button", { name: "Parolni yangilash" })).toBeEnabled();
  });
  it("signs out locally for expired sessions", async () => {
    const { signedOut } = setup("change", () => response({ error: { message: "Hisobingizga kiring." } }, 401));
    await fillPasswords(true); await userEvent.click(screen.getByRole("button", { name: "Parolni yangilash" }));
    await screen.findByRole("heading", { name: "Kirish" }); expect(signedOut).toHaveBeenCalledOnce();
  });
  it("disables public recovery when provider is unavailable", async () => {
    setup("forgot", () => response({ enabled: false }));
    expect(await screen.findByRole("alert")).toHaveTextContent("hozircha mavjud emas");
    expect(screen.getByRole("button", { name: "Tiklash havolasini so‘rash" })).toBeDisabled();
  });
  it("validates email and displays only the generic request acknowledgement", async () => {
    const message = "Agar hisobingiz tiklash uchun mos bo‘lsa, emailingizga yo‘riqnoma yuboriladi.";
    const { fetchMock } = setup("forgot", url => response(url.endsWith("password-recovery") ? { enabled: true } : { message }, url.endsWith("forgot-password") ? 202 : 200));
    const submit = await screen.findByRole("button", { name: "Tiklash havolasini so‘rash" });
    await waitFor(() => expect(submit).toBeEnabled()); await userEvent.click(submit);
    expect(screen.getByText("To‘g‘ri email manzilini kiriting.")).toBeVisible();
    await userEvent.type(screen.getByLabelText("Email manzili"), "test@example.test"); await userEvent.click(submit);
    expect(await screen.findByRole("status")).toHaveTextContent(message);
    expect(fetchMock.mock.calls.at(-1)![0]).toBe("/api/auth/forgot-password");
  });
  it("removes fragment token immediately, sends it only in reset body and redirects to login", async () => {
    const token = "a".repeat(64); window.history.replaceState(null, "", `/reset-password#token=${token}`);
    const { fetchMock, signedOut } = setup("reset", url => url.endsWith("password-recovery") ? response({ enabled: true }) : response({}, 204));
    expect(window.location.hash).toBe("");
    await waitFor(() => expect(screen.getByLabelText("Yangi parol", { exact: true })).toBeEnabled());
    await fillPasswords(); await userEvent.click(screen.getByRole("button", { name: "Parolni yangilash" }));
    await screen.findByRole("heading", { name: "Kirish" });
    expect(JSON.parse(fetchMock.mock.calls.at(-1)![1]!.body as string)).toEqual({ token, newPassword: valid });
    expect(signedOut).toHaveBeenCalledOnce();
    expect(document.body.textContent).not.toContain(token);
  });
  it("rejects missing tokens and offers a fresh request", async () => {
    setup("reset");
    expect(await screen.findByRole("alert")).toHaveTextContent("Tiklash havolasi yaroqsiz");
    expect(screen.getByRole("button", { name: "Parolni yangilash" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Yangi havola so‘rang." })).toHaveAttribute("href", "/forgot-password");
  });
});
