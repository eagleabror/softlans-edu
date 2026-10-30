import { afterEach, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { StudentImport } from "./StudentImport";
const preview = {
  id: "abc",
  revision: 0,
  headers: ["Ism", "Familiya"],
  sheets: ["Sheet"],
  mapping: { firstName: 0, lastName: 1 },
  totalRows: 1,
  validRows: 1,
  invalidRows: 0,
  duplicateRows: 0,
  rows: [
    {
      row: 2,
      data: { firstName: "Ali", lastName: "Valiyev" },
      errors: [],
      duplicate: false,
    },
  ],
};
const response = (data: unknown, status = 200) =>
  Promise.resolve({
    ok: status < 400,
    status,
    json: async () => data,
  } as Response);
function setup(fail = false) {
  const fetcher = vi.fn((url: string, opts?: RequestInit) => {
    if (url.includes("/preview")) return response(preview);
    if (url.includes("/mapping")) return response({ ...preview, revision: 1 });
    if (url.includes("/commit"))
      return fail
        ? response({ error: { message: "Qayta urinib ko‘ring." } }, 503)
        : response({
            import: {
              id: "abc",
              status: "completed",
              totalRows: 1,
              importedRows: 1,
              skippedRows: 0,
              failedRows: 0,
            },
          });
    return response({ imports: [], total: 0 });
  });
  vi.stubGlobal("fetch", fetcher);
  render(
    <MemoryRouter>
      <StudentImport />
    </MemoryRouter>,
  );
  return fetcher;
}
async function upload() {
  await userEvent.upload(
    screen.getByLabelText("Import fayli"),
    new File(["Ism,Familiya\nAli,Valiyev"], "test.csv", { type: "text/csv" }),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "Faylni tekshirish" }),
  );
  await screen.findByText("3. Import preview");
}
afterEach(() => vi.unstubAllGlobals());
it("requires review confirmation and explicit duplicate consent", async () => {
  const fetcher = setup();
  await upload();
  const commit = screen.getByRole("button", { name: "Importni tasdiqlash" });
  expect(commit).toBeDisabled();
  await userEvent.selectOptions(
    screen.getByLabelText("Dublikatlar uchun"),
    "add",
  );
  await userEvent.click(screen.getByLabelText(/Previewni tekshirdim/));
  expect(commit).toBeDisabled();
  await userEvent.click(screen.getByLabelText(/Ehtimoliy dublikatlar ham/));
  await userEvent.click(commit);
  expect(await screen.findByText("Natija: Yakunlandi")).toBeVisible();
  const call = fetcher.mock.calls.find((c) => c[0].includes("/commit"));
  expect(JSON.parse(String(call?.[1]?.body))).toMatchObject({
    duplicates: "add",
    confirmDuplicates: true,
  });
});
it("invalidates preview on mapping edits and requires refreshed mapping", async () => {
  setup();
  await upload();
  await userEvent.selectOptions(screen.getByLabelText("Ism *"), "1");
  expect(
    screen.getByRole("button", { name: "Importni tasdiqlash" }),
  ).toBeDisabled();
  expect(screen.getByText(/Tanlov o‘zgardi/)).toBeVisible();
  await userEvent.click(
    screen.getByRole("button", {
      name: "Moslashtirish va previewni yangilash",
    }),
  );
  await waitFor(() =>
    expect(screen.queryByText(/Tanlov o‘zgardi/)).not.toBeInTheDocument(),
  );
});
it("keeps the same idempotency key on a recoverable commit error", async () => {
  const fetcher = setup(true);
  await upload();
  await userEvent.click(screen.getByLabelText(/Previewni tekshirdim/));
  await userEvent.click(
    screen.getByRole("button", { name: "Importni tasdiqlash" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("Qayta urinib");
  await userEvent.click(
    screen.getByRole("button", { name: "Importni tasdiqlash" }),
  );
  await waitFor(() =>
    expect(
      fetcher.mock.calls.filter((c) => c[0].includes("/commit")),
    ).toHaveLength(2),
  );
  const keys = fetcher.mock.calls
    .filter((c) => c[0].includes("/commit"))
    .map((c) => JSON.parse(String(c[1]?.body)).idempotencyKey);
  expect(keys[0]).toBe(keys[1]);
});
it("rejects an oversized upload before sending private file data", async () => {
  const fetcher = setup();
  const file = new File(["x"], "test.csv", { type: "text/csv" });
  Object.defineProperty(file, "size", { value: 6 * 1024 * 1024 });
  await userEvent.upload(screen.getByLabelText("Import fayli"), file);
  await userEvent.click(
    screen.getByRole("button", { name: "Faylni tekshirish" }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent("5 MB");
  expect(fetcher.mock.calls.some((c) => c[0].includes("/preview"))).toBe(false);
});
