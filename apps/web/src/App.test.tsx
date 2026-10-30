import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { App } from "./App";
const session = {
  user: {
    id: "123",
    name: "Aziz Karimov",
    email: "aziz@example.test",
    role: "business_owner",
  },
  tenant: { id: "456", name: "Kelajak Academy" },
};
function response(data: unknown, status = 200) {
  return Promise.resolve({
    ok: status < 400,
    status,
    json: async () => data,
  } as Response);
}
function renderApp(path = "/login") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}
afterEach(() => vi.unstubAllGlobals());
describe("Uzbek authentication and role-aware navigation", () => {
  it("shows the Uzbek login and toggles password visibility accessibly", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => response({}, 401)),
    );
    renderApp();
    const input = await screen.findByLabelText("Parol");
    expect(input).toHaveAttribute("type", "password");
    await userEvent.click(
      screen.getByRole("button", { name: "Parolni ko‘rsatish" }),
    );
    expect(input).toHaveAttribute("type", "text");
    expect(
      screen.getByRole("button", { name: "Hisobga kirish" }),
    ).toBeVisible();
  });
  it("submits registration without a client-supplied tenant ID or role", async () => {
    const fetchMock = vi.fn((url: string) =>
      url.endsWith("/register")
        ? response({ error: { message: "Sinov javobi" } }, 409)
        : response({}, 401),
    );
    vi.stubGlobal("fetch", fetchMock);
    renderApp("/register");
    await userEvent.type(
      await screen.findByLabelText("O‘quv markazi nomi"),
      "Kelajak",
    );
    await userEvent.type(
      screen.getByLabelText("Ism va familiya"),
      "Aziz Karimov",
    );
    await userEvent.type(
      screen.getByLabelText("Email manzili"),
      "aziz@example.test",
    );
    await userEvent.type(screen.getByLabelText("Parol"), "long-test-password");
    await userEvent.click(
      screen.getByRole("button", { name: "Markaz hisobini yaratish" }),
    );
    expect(await screen.findByRole("alert")).toHaveTextContent("Sinov javobi");
    const options = (
      fetchMock.mock.calls.find((c) =>
        c[0].endsWith("/register"),
      ) as unknown as [string, RequestInit]
    )[1];
    expect(JSON.parse(options.body as string)).toEqual({
      centerName: "Kelajak",
      name: "Aziz Karimov",
      email: "aziz@example.test",
      password: "long-test-password",
    });
    expect(options.credentials).toBe("include");
  });
  it("shows owner navigation and database-backed dashboard counts", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        response(
          url.endsWith("/me")
            ? session
            : {
                scope: "tenant",
                students: { total: 17, active: 11, paused: 4, recent: 6 },
                teamCount: 3,
                teacherCount: 1,
                adminCount: 1,
                joinedAt: new Date().toISOString(),
              },
        ),
      ),
    );
    renderApp("/");
    expect(
      await screen.findByRole("heading", { name: "Xush kelibsiz, Aziz!" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Jamoa" })).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Moliyaviy hisobotlar" }),
    ).toBeVisible();
    await waitFor(() => expect(screen.getByText("3")).toBeVisible());
    expect(screen.getByRole("link", { name: "O‘quvchilar" })).toBeVisible();
    for (const count of ["17", "11", "4", "6"])
      expect(screen.getByText(count)).toBeVisible();
  });
  it("hides team navigation and team counts from teachers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) =>
        response(
          url.endsWith("/me")
            ? { ...session, user: { ...session.user, role: "teacher" } }
            : {
                scope: "tenant",
                teamCount: null,
                teacherCount: null,
                adminCount: null,
                joinedAt: new Date().toISOString(),
              },
        ),
      ),
    );
    renderApp("/");
    await screen.findByRole("heading", { name: "Xush kelibsiz, Aziz!" });
    expect(
      screen.queryByRole("link", { name: "Jamoa" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "O‘quvchilar" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: "Moliyaviy hisobotlar" }),
    ).not.toBeInTheDocument();
    expect(
      await screen.findByText("Jamoa ma’lumotlari rahbariyat uchun"),
    ).toBeVisible();
  });
  it("shows a recoverable error when session loading has a network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));
    renderApp();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Serverga ulanib bo‘lmadi",
    );
    expect(screen.getByRole("button", { name: "Qayta urinish" })).toBeVisible();
  });
});
