import { describe, expect, it } from "vitest";
import { buildAnnualCashReport, buildQuarterlyVatReport, cashCollected, expenseVatCents } from "@/lib/finance/reporting";
import { buildFinanceDashboard, calculateFinanceInvoiceTotals } from "@/lib/finance/calculations";
import { FINANCE_CURRENCY_CODES } from "@/lib/finance/currencies";
import { financeExpenseRequestSchema, financeContractRequestSchema } from "@/lib/finance/validation";
import { buildCreateFinanceContractInput } from "@/lib/finance/contract-input";
import { DEFAULT_FINANCE_INVOICE_SETTINGS, DEFAULT_FINANCE_PLAN_OPTIONS } from "@/lib/finance/types";
import type { FinanceExpense, FinanceInvoice, FinancePayment } from "@/lib/finance/types";

const expense: FinanceExpense = { id: "expense-1", date: "2026-03-31", category: "General", description: "Factura", amountCents: 12100, currency: "EUR", vatRate: 21, vatDeductible: true, notes: "", createdAt: "", updatedAt: "" };
const foreignExpense: FinanceExpense = { ...expense, currency: "USD", euroAmountCents: 9680, exchangeRateToEur: 0.8, exchangeRateDate: "2026-03-31" };
const lineItems = [{ id: "line", description: "Servicio", quantity: 1, unitPriceCents: 100000, discountPercent: 0, vatRate: 21 }];
const invoice: FinanceInvoice = {
  id: "invoice-1", invoiceNumber: "F-1", series: "F", sequenceNumber: 1,
  issueDate: "2026-03-31", operationDate: "2026-03-31", dueDate: "",
  client: { name: "Cliente", taxId: "ID", address: "Direccion", postalCode: "", city: "", province: "", country: "", email: "" },
  issuer: DEFAULT_FINANCE_INVOICE_SETTINGS, lineItems, irpfRate: 15,
  totals: calculateFinanceInvoiceTotals(lineItems, 15), currency: "EUR", paymentMethod: "", notes: "", status: "issued", createdAt: "", updatedAt: ""
};
const payment: FinancePayment = { id: "p", contractId: "c", athleteName: "Cliente", athleteUsername: "cliente", planLabel: "Plan", dueDate: "2025-12-01", expectedAmountCents: 20000, status: "paid", paidAt: "2026-01-01", paidAmountCents: 19000, sequenceCount: 1, sequenceIndex: 1, notes: "", createdAt: "", updatedAt: "" };

describe("finance reporting", () => {
  it("reports annual cash in euros with converted foreign expenses", () => {
    const report = buildAnnualCashReport([payment, { ...payment, paidAt: "2025-12-31" }, { ...payment, status: "pending" }, { ...payment, status: "cancelled" }], [], [expense, foreignExpense, { ...expense, date: "2025-12-31" }], 2026);
    expect(report).toEqual({ grossCents: 19000, netCents: -2780 });
    expect(buildAnnualCashReport([], [], [expense], 2026).netCents).toBe(-12100);
  });
  it("groups VAT by quarter using operation date, only deducting eligible expenses", () => {
    const report = buildQuarterlyVatReport([invoice, { ...invoice, operationDate: "2026-04-01" }, { ...invoice, status: "cancelled" }], [expense, { ...expense, vatDeductible: false }, foreignExpense, { ...expense, date: "2025-03-31" }], 2026);
    expect(report[0]).toEqual({ quarter: 1, outputVatCents: 21000, deductibleVatCents: 3780, balanceCents: 17220 });
    expect(report[1].outputVatCents).toBe(21000);
    expect(buildQuarterlyVatReport([], [expense], 2026)[0].balanceCents).toBe(-2100);
    expect(expenseVatCents({ ...expense, vatRate: 0 })).toBe(0);
    expect(expenseVatCents({ ...expense, vatRate: undefined })).toBe(0);
  });
  it("adds foreign expenses to the dashboard only after conversion to euros", () => {
    const dashboard = buildFinanceDashboard({ contracts: [], payments: [], expenses: [expense, foreignExpense], today: "2026-03-31" });
    expect(dashboard.expensesThisMonthCents).toBe(21780);
    expect(dashboard.netThisMonthCents).toBe(-21780);
    expect(dashboard.monthlySeries.at(-1)?.expenseCents).toBe(21780);
  });
  it("counts actual collections by paid date through today", () => {
    expect(cashCollected([payment, { ...payment, status: "cancelled" }, { ...payment, paidAt: "2026-11-01" }], "2026-01-01", "2026-10-08")).toBe(19000);
  });
  it("validates 50 unique currencies and manual VAT data", () => {
    expect(new Set(FINANCE_CURRENCY_CODES).size).toBe(50);
    const input = { date: "2026-10-01", category: "General", description: "Factura", amount: "121", currency: "EUR", vatRate: 21, vatDeductible: true };
    expect(financeExpenseRequestSchema.safeParse(input).success).toBe(true);
    expect(financeExpenseRequestSchema.safeParse({ ...input, vatRate: 101 }).success).toBe(false);
    expect(financeExpenseRequestSchema.safeParse({ ...input, currency: "XYZ" }).success).toBe(false);
  });
  it("recalculates installments server-side and rejects oversized reservations", () => {
    const payload = financeContractRequestSchema.parse({ athleteUsername: "cliente", planKey: "annual", startDate: "2026-09-01", firstPaymentDate: "2026-10-01", totalAmount: "1200", reservationAmount: "200", financed: true, paymentCount: 5, paymentAmount: "999" });
    const input = { payload, athlete: { username: "cliente", name: "Cliente" }, planOptions: DEFAULT_FINANCE_PLAN_OPTIONS };
    expect(buildCreateFinanceContractInput(input)).toMatchObject({ paymentAmountCents: 20000, reservationAmountCents: 20000 });
    expect(() => buildCreateFinanceContractInput({ ...input, payload: { ...payload, reservationAmount: "1201" } })).toThrow();
    expect(financeContractRequestSchema.safeParse({ ...payload, reservationAmount: "1201" }).success).toBe(false);
  });
});
