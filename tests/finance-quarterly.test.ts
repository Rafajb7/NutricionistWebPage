import { describe, expect, it } from "vitest";
import { buildQuarterlyFinanceReport, financeReportYears } from "@/lib/finance/quarterly-report";
import { buildFinancePaymentsForContract } from "@/lib/finance/calculations";
import {
  financeContractRequestSchema,
  financeContractOnUserCreateSchema,
  financePaymentUpdateRequestSchema
} from "@/lib/finance/validation";
import { parseFinancePaymentMethod } from "@/lib/finance/payment-methods";
import { contract, contractInput, expense, invoice, payment } from "./fixtures/finance";

const empty = { invoices: [], expenses: [], contracts: [], payments: [] };
describe("quarterly tax and collections", () => {
  it("uses operation date and gross before IRPF, never adding contract collections to invoices", () => {
    const [first, second] = buildQuarterlyFinanceReport(
      {
        invoices: [invoice, { ...invoice, status: "cancelled" }],
        expenses: [expense],
        contracts: [contract],
        payments: [payment]
      },
      2026
    );
    expect(first).toMatchObject({
      incomeBaseCents: 100000,
      incomeGrossCents: 121000,
      outputVatCents: 21000,
      expenseBaseCents: 10000,
      expenseGrossCents: 12100,
      inputVatCents: 2100,
      deductibleVatCents: 2100,
      balanceCents: 18900,
      cashCents: 19000
    });
    expect(first.months.map((month) => month.incomeGrossCents)).toEqual([0, 0, 121000]);
    expect(second.incomeGrossCents).toBe(0);
  });
  it("keeps all expenses in performance but only eligible VAT in the tax balance, using recorded FX", () => {
    const [quarter] = buildQuarterlyFinanceReport(
      {
        ...empty,
        expenses: [
          expense,
          { ...expense, vatDeductible: false },
          { ...expense, currency: "USD", euroAmountCents: 9680, exchangeRateToEur: 0.8 }
        ]
      },
      2026
    );
    expect(quarter).toMatchObject({
      expenseGrossCents: 33880,
      expenseBaseCents: 28000,
      inputVatCents: 5880,
      deductibleExpenseGrossCents: 21780,
      deductibleExpenseBaseCents: 18000,
      deductibleVatCents: 3780,
      balanceCents: -3780
    });
  });
  it("includes zero-VAT invoices without imposing the current default VAT rate", () => {
    const [quarter] = buildQuarterlyFinanceReport(
      {
        ...empty,
        invoices: [
          {
            ...invoice,
            totals: { ...invoice.totals, taxableBaseCents: 10000, vatCents: 0, totalCents: 10000 }
          }
        ]
      },
      2026
    );
    expect(quarter).toMatchObject({ incomeGrossCents: 10000, outputVatCents: 0, balanceCents: 0 });
  });
  it("assigns every boundary to the calendar quarter and excludes other years and invalid dates", () => {
    const dates = [
      "2026-01-01",
      "2026-03-31",
      "2026-04-01",
      "2026-06-30",
      "2026-07-01",
      "2026-09-30",
      "2026-10-01",
      "2026-12-31",
      "2025-12-31",
      "2027-01-01",
      "2026-02-30"
    ];
    expect(
      buildQuarterlyFinanceReport(
        { ...empty, expenses: dates.map((date) => ({ ...expense, date })) },
        2026
      ).map((item) => item.expenseCount)
    ).toEqual([2, 2, 2, 2]);
  });
  it("reports only actual paid amounts and dates, keeping unknown methods separate from cash", () => {
    const payments = [
      payment,
      { ...payment, id: "transfer", paymentMethod: "bank_transfer" as const },
      { ...payment, id: "old", paymentMethod: undefined },
      { ...payment, status: "pending" as const },
      { ...payment, status: "cancelled" as const },
      { ...payment, paidAt: "" },
      { ...payment, paidAt: "2025-12-31" },
      { ...payment, id: "zero", paidAmountCents: 0 }
    ];
    const [quarter] = buildQuarterlyFinanceReport(
      { ...empty, payments, contracts: [contract] },
      2026
    );
    expect(quarter).toMatchObject({
      cashCents: 19000,
      transferCents: 19000,
      unspecifiedMethodCents: 19000,
      collectedCents: 57000
    });
    expect(quarter.collections.find((item) => item.id === "old")?.method).toBeUndefined();
    expect(quarter.collections[0].contractAmountCents).toBe(120000);
  });
  it("includes years from operation dates and actual receipts, even when invoice issue dates differ", () => {
    expect(
      financeReportYears(
        {
          ...empty,
          invoices: [{ ...invoice, operationDate: "2022-12-31" }],
          payments: [{ ...payment, paidAt: "2023-01-01" }],
          expenses: [{ ...expense, date: "2024-12-31" }]
        },
        2026
      )
    ).toEqual([2026, 2024, 2023, 2022]);
  });
  it("returns all four empty quarters with their three months", () => {
    const result = buildQuarterlyFinanceReport(empty, 2026);
    expect(result).toHaveLength(4);
    expect(
      result.every(
        (item) => item.months.length === 3 && item.balanceCents === 0 && item.cashCents === 0
      )
    ).toBe(true);
  });
});

describe("contract payment method", () => {
  const payload = {
    athleteUsername: "ana",
    planKey: "annual",
    startDate: "2026-01-01",
    firstPaymentDate: "2026-02-01",
    totalAmount: "1200",
    paymentMethod: "cash"
  };
  it("requires cash or transfer in both contract creation flows", () => {
    for (const schema of [financeContractRequestSchema, financeContractOnUserCreateSchema]) {
      expect(schema.safeParse(payload).success).toBe(true);
      expect(schema.safeParse({ ...payload, paymentMethod: "bank_transfer" }).success).toBe(true);
      for (const paymentMethod of [undefined, "", "card"])
        expect(schema.safeParse({ ...payload, paymentMethod }).success).toBe(false);
    }
    expect(financePaymentUpdateRequestSchema.safeParse({ status: "paid" }).success).toBe(false);
    expect(
      financePaymentUpdateRequestSchema.safeParse({ status: "paid", paymentMethod: "cash" }).success
    ).toBe(true);
  });
  it("copies the chosen method into reservations and installments while preserving the total", () => {
    const payments = buildFinancePaymentsForContract(contractInput, "contract", "now", () => "id");
    expect(payments).toHaveLength(6);
    expect(payments.every((item) => item.paymentMethod === "cash")).toBe(true);
    expect(payments[0]).toMatchObject({ status: "paid", paidAmountCents: 20000 });
    expect(payments.reduce((sum, item) => sum + item.expectedAmountCents, 0)).toBe(120000);
  });
  it("leaves missing and unrecognised legacy values unspecified", () => {
    expect(parseFinancePaymentMethod("")).toBeUndefined();
    expect(parseFinancePaymentMethod("tarjeta")).toBeUndefined();
    expect(parseFinancePaymentMethod(" Efectivo ")).toBe("cash");
    expect(parseFinancePaymentMethod("Transferencia bancaria")).toBe("bank_transfer");
  });
});
