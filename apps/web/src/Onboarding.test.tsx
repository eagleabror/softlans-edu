import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Onboarding, SetupChecklist, type SetupView } from "./Onboarding";
const data: SetupView = {
  state: {
    tenantId: "tenant",
    status: "in_progress",
    currentStep: "group",
    completedSteps: [],
    revision: 2,
    dismissedAt: null,
  },
  center: { name: "Kelajak", phone: "", address: "" },
  counts: { teachers: 0, groups: 0, students: 0 },
  facts: {
    center: true,
    teacher: false,
    group: false,
    students: false,
    telegram: false,
  },
  subscription: { planName: "Standard", remainingDays: 9, status: "trialing" },
};
const response = (value: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: async () => value,
  } as Response);
function mock(value = data) {
  return vi.stubGlobal(
    "fetch",
    vi.fn((url: string) =>
      response(url.includes("teachers") ? { teachers: [] } : value),
    ),
  );
}
function show(path = "/onboarding") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Onboarding />
    </MemoryRouter>,
  );
}
afterEach(() => vi.unstubAllGlobals());
it("resumes persisted step, exposes progress and missing teacher recovery", async () => {
  mock();
  show();
  expect(
    await screen.findByRole("heading", { name: "Birinchi guruh" }),
  ).toHaveFocus();
  expect(
    screen.getByRole("progressbar", { name: "Bosqichlar" }),
  ).toHaveAttribute("value", "3");
  expect(screen.getByText(/Avval o‘qituvchi qo‘shing/)).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Guruh yaratish" }),
  ).not.toBeInTheDocument();
  await userEvent.click(
    screen.getByRole("button", { name: "O‘qituvchi qo‘shishga o‘tish" }),
  );
  expect(
    await screen.findByRole("heading", { name: "O‘qituvchi qo‘shish" }),
  ).toBeVisible();
});
it("shows real summary, plan and trial without invented records", async () => {
  mock();
  show("/onboarding?step=completion");
  expect(await screen.findByText("Standard")).toBeVisible();
  expect(screen.getByText("9 kun qoldi")).toBeVisible();
  expect(
    screen.getByRole("button", { name: "O‘quv markazini boshqarishga o‘tish" }),
  ).toBeEnabled();
});
it("has labeled center fields and preserves values after save error", async () => {
  mock();
  show("/onboarding?step=center");
  const name = await screen.findByLabelText("O‘quv markazi nomi");
  await userEvent.clear(name);
  await userEvent.type(name, "Yangi nom");
  vi.stubGlobal(
    "fetch",
    vi.fn(() => response({ error: { message: "Saqlanmadi" } }, 500)),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Saqlash va davom etish" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Saqlanmadi");
  expect(name).toHaveValue("Yangi nom");
});
it("dismisses checklist only after persisted success and links unfinished tasks", async () => {
  mock();
  render(
    <MemoryRouter>
      <SetupChecklist />
    </MemoryRouter>,
  );
  expect(await screen.findByText("1 / 5 vazifa bajarilgan")).toBeVisible();
  expect(screen.getByRole("link", { name: "Birinchi guruh" })).toHaveAttribute(
    "href",
    "/onboarding?step=group",
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Ro‘yxatni yashirish" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("region", { name: "Markazni sozlash" }),
    ).not.toBeInTheDocument(),
  );
});
it.each([
  null,
  { ...data.state!, status: "completed" },
  { ...data.state!, dismissedAt: "2026-11-05" },
])(
  "hides checklist for legacy, completed and dismissed state",
  async (state) => {
    mock({ ...data, state });
    const { container } = render(
      <MemoryRouter>
        <SetupChecklist />
      </MemoryRouter>,
    );
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  },
);
it("recovers from loading error", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => response({ error: { message: "Ulanish xatosi" } }, 503)),
  );
  show();
  expect(await screen.findByRole("alert")).toHaveTextContent("Ulanish xatosi");
  mock();
  await userEvent.click(screen.getByRole("button", { name: "Qayta urinish" }));
  expect(
    await screen.findByRole("heading", { name: "Birinchi guruh" }),
  ).toBeVisible();
});
