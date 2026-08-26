import { describe, expect, it } from "vitest";
import {
  addMonths,
  buildFinanceDashboard,
  buildFinancePaymentsForContract,
  getComputedPaymentStatus,
  getContractDates,
  parseCurrencyToCents,
  splitAmountCents
} from "@/lib/finance/calculations";
import type { CreateFinanceContractInput, FinanceContract } from "@/lib/finance/types";

function baseContractInput(overrides: Partial<CreateFinanceContractInput> = {}): CreateFinanceContractInput {
  return {
    athleteUsername: "juan",
    athleteName: "Juan Perez",
    planKey: "annual",
    planLabel: "Anual",
    durationMonths: 12,
    startDate: "2026-09-01",
    firstPaymentDate: "2026-09-01",
    totalAmountCents: 120000,
    currency: "EUR",
    financed: true,
    paymentCount: 12,
    paymentAmountCents: null,
    paymentIntervalMonths: 1,
    notes: "",
    ...overrides
  };
}

describe("finance calculations", () => {
  it("parses euro-like inputs into integer cents", () => {
    expect(parseCurrencyToCents("1.200,50")).toBe(120050);
    expect(parseCurrencyToCents("1200.50")).toBe(120050);
    expect(parseCurrencyToCents("1.200")).toBe(120000);
    expect(parseCurrencyToCents("540")).toBe(54000);
  });

  it("adds months with end-of-month clamping", () => {
    expect(addMonths("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMonths("2028-01-31", 1)).toBe("2028-02-29");
    expect(getContractDates("2026-06-01", 3)).toEqual({
      endDate: "2026-08-31",
      renewalDueDate: "2026-09-01"
    });
  });

  it("splits cents without losing precision", () => {
    expect(splitAmountCents(10000, 3)).toEqual([3334, 3333, 3333]);
  });

  it("generates financed payment schedules as persisted payment rows", () => {
    const payments = buildFinancePaymentsForContract(
      baseContractInput({ paymentCount: 3, paymentAmountCents: 40000, paymentIntervalMonths: 3 }),
      "contract-1",
      "2026-08-25T00:00:00.000Z",
      () => `pay-${Math.random()}`
    );

    expect(payments).toHaveLength(3);
    expect(payments.map((payment) => payment.dueDate)).toEqual([
      "2026-09-01",
      "2026-12-01",
      "2027-03-01"
    ]);
    expect(payments.map((payment) => payment.expectedAmountCents)).toEqual([
      40000,
      40000,
      40000
    ]);
  });

  it("detects overdue payments dynamically", () => {
    expect(
      getComputedPaymentStatus(
        {
          status: "pending",
          dueDate: "2026-08-24"
        },
        "2026-08-25"
      )
    ).toBe("overdue");
  });

  it("builds dashboard totals and renewal alerts", () => {
    const contract: FinanceContract = {
      id: "contract-1",
      athleteUsername: "juan",
      athleteName: "Juan Perez",
      planKey: "monthly",
      planLabel: "Mensual",
      durationMonths: 1,
      startDate: "2026-08-01",
      endDate: "2026-08-31",
      renewalDueDate: "2026-09-01",
      totalAmountCents: 22000,
      currency: "EUR",
      financed: false,
      paymentCount: 1,
      paymentAmountCents: 22000,
      paymentIntervalMonths: 1,
      status: "active",
      previousContractId: "",
      idempotencyKey: "",
      notes: "",
      createdAt: "",
      updatedAt: ""
    };

    const dashboard = buildFinanceDashboard({
      contracts: [contract],
      payments: [
        {
          id: "payment-1",
          contractId: "contract-1",
          athleteUsername: "juan",
          athleteName: "Juan Perez",
          planLabel: "Mensual",
          dueDate: "2026-08-20",
          expectedAmountCents: 22000,
          status: "paid",
          paidAt: "2026-08-20",
          paidAmountCents: 22000,
          sequenceIndex: 1,
          sequenceCount: 1,
          notes: "",
          createdAt: "",
          updatedAt: ""
        }
      ],
      today: "2026-08-25"
    });

    expect(dashboard.paidThisMonthCents).toBe(22000);
    expect(dashboard.expectedThisMonthCents).toBe(22000);
    expect(dashboard.renewalAlerts).toHaveLength(1);
    expect(dashboard.renewalAlerts[0].status).toBe("upcoming");
  });
});
