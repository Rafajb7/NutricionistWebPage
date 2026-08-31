import { describe, expect, it } from "vitest";
import { renderFinanceInvoicePdf } from "@/lib/finance/invoice-pdf";
import {
  addMonths,
  calculateFinanceInvoiceTotals,
  buildFinanceDashboard,
  buildFinancePaymentsForContract,
  getComputedPaymentStatus,
  getContractDates,
  parseCurrencyToCents,
  splitAmountCents
} from "@/lib/finance/calculations";
import { DEFAULT_FINANCE_INVOICE_SETTINGS } from "@/lib/finance/types";
import type { CreateFinanceContractInput, FinanceContract, FinanceInvoice } from "@/lib/finance/types";

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

  it("calculates invoice totals with VAT, discounts and optional IRPF", () => {
    const totals = calculateFinanceInvoiceTotals(
      [
        {
          id: "line-1",
          description: "Plan nutricional mensual",
          quantity: 2,
          unitPriceCents: 10000,
          discountPercent: 10,
          vatRate: 21
        }
      ],
      15
    );

    expect(totals.subtotalCents).toBe(20000);
    expect(totals.discountCents).toBe(2000);
    expect(totals.taxableBaseCents).toBe(18000);
    expect(totals.vatCents).toBe(3780);
    expect(totals.irpfCents).toBe(2700);
    expect(totals.totalCents).toBe(19080);
  });

  it("renders a finance invoice PDF buffer", async () => {
    const lineItems = [
      {
        id: "line-1",
        description: "Plan nutricional mensual",
        quantity: 1,
        unitPriceCents: 10000,
        discountPercent: 0,
        vatRate: 21
      }
    ];
    const invoice: FinanceInvoice = {
      id: "invoice-1",
      invoiceNumber: "F-2026-0001",
      series: "F-2026",
      sequenceNumber: 1,
      issueDate: "2026-08-28",
      operationDate: "2026-08-28",
      dueDate: "2026-09-05",
      client: {
        name: "Cliente Demo",
        taxId: "11111111H",
        address: "Avenida Cliente 2",
        postalCode: "28001",
        city: "Madrid",
        province: "Madrid",
        country: "Espana",
        email: "cliente@example.com"
      },
      issuer: {
        ...DEFAULT_FINANCE_INVOICE_SETTINGS,
        businessName: "Nutricionista Demo",
        taxId: "00000000T",
        address: "Calle Demo 1",
        postalCode: "28001",
        city: "Madrid",
        province: "Madrid",
        email: "demo@example.com"
      },
      lineItems,
      irpfRate: 0,
      totals: calculateFinanceInvoiceTotals(lineItems, 0),
      currency: "EUR",
      paymentMethod: "Transferencia bancaria",
      notes: "",
      status: "issued",
      createdAt: "",
      updatedAt: ""
    };

    const pdf = await renderFinanceInvoicePdf(invoice);

    expect(pdf.slice(0, 4).toString()).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
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
