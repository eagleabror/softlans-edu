import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { EnrollmentBilling, TuitionCalculation } from "./TuitionPreview";
import { api } from "./api";
import type { BillingCalculation } from "@softlans/contracts";
vi.mock("./api", () => ({ api: vi.fn() }));
const calculation: BillingCalculation = {
  policyVersion: "lesson-tashkent-v1",
  policy: "first_partial_month",
  timezone: "Asia/Tashkent",
  month: "2026-11",
  monthlyFee: 300000,
  totalLessons: 13,
  eligibleLessons: 7,
  calculatedAmount: 161538,
  prorationAmount: 138462,
  approximateLessonPrice: 300000 / 13,
  enrolledAt: "2026-11-16T04:00:00Z",
  dueDate: "2026-11-16T04:00:00Z",
  lessons: [],
};
beforeEach(() => vi.resetAllMocks());
it("shows all six Uzbek billing values before confirming enrollment", async () => {
  vi.mocked(api).mockResolvedValue({
    calculation,
    previewKey: "quote",
    automatic: true,
    existingCharge: false,
  });
  const onEnroll = vi.fn().mockResolvedValue(undefined);
  render(
    <EnrollmentBilling
      groupId="g"
      studentId="s"
      disabled={false}
      onEnroll={onEnroll}
    />,
  );
  for (const label of [
    "Oylik narx",
    "Jami darslar",
    "Qolgan darslar",
    "Bir darsning taxminiy narxi",
    "Yakuniy to‘lov",
    "To‘lov muddati",
  ])
    expect(await screen.findByText(label)).toBeInTheDocument();
  expect(screen.getByText(/161.*538 UZS/)).toBeInTheDocument();
  expect(screen.getByRole("checkbox")).toBeRequired();
  await userEvent.click(screen.getByRole("button", { name: "Qo‘shish" }));
  expect(onEnroll).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("checkbox"));
  await userEvent.click(screen.getByRole("button", { name: "Qo‘shish" }));
  expect(onEnroll).toHaveBeenCalledWith("quote");
});
it("blocks saving after preview failure and supports retry", async () => {
  vi.mocked(api)
    .mockRejectedValueOnce(new Error("Hisoblash xatosi"))
    .mockResolvedValue({ calculation, previewKey: "new", automatic: true });
  render(
    <EnrollmentBilling
      groupId="g"
      studentId="s"
      disabled={false}
      onEnroll={vi.fn()}
    />,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Hisoblash xatosi",
  );
  expect(screen.getByRole("button", { name: "Qo‘shish" })).toBeDisabled();
  await userEvent.click(
    screen.getByRole("button", { name: "Hisobni yangilash" }),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Qo‘shish" })).toBeEnabled(),
  );
});
it("explains existing charges without presenting a new payable quote", async () => {
  vi.mocked(api).mockResolvedValue({
    calculation,
    previewKey: "quote",
    automatic: true,
    existingCharge: true,
  });
  render(
    <EnrollmentBilling
      groupId="g"
      studentId="s"
      disabled={false}
      onEnroll={vi.fn()}
    />,
  );
  expect(
    await screen.findByText(/Bu oy uchun hisob mavjud/),
  ).toBeInTheDocument();
  expect(screen.queryByText("Yakuniy to‘lov")).not.toBeInTheDocument();
  expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
});
it("documents zero-lesson months and full-month policy", () => {
  render(
    <TuitionCalculation
      calculation={{
        ...calculation,
        totalLessons: 0,
        eligibleLessons: 0,
        calculatedAmount: 0,
        approximateLessonPrice: 0,
        policy: "full_month",
      }}
    />,
  );
  expect(screen.getByText(/rejalashtirilgan darslar yo‘q/)).toBeInTheDocument();
  expect(screen.getByText(/To‘liq oylik narx siyosati/)).toBeInTheDocument();
});
