import { calculateFinanceInvoiceTotals } from "@/lib/finance/calculations";
import { DEFAULT_FINANCE_INVOICE_SETTINGS } from "@/lib/finance/types";
import type {
  CreateFinanceContractInput,
  FinanceContract,
  FinanceExpense,
  FinanceInvoice,
  FinancePayment
} from "@/lib/finance/types";

export const contractInput: CreateFinanceContractInput = {
  athleteUsername: "ana",
  athleteName: "Ana",
  planKey: "annual",
  planLabel: "Anual",
  durationMonths: 12,
  startDate: "2026-01-01",
  firstPaymentDate: "2026-02-01",
  totalAmountCents: 120000,
  reservationAmountCents: 20000,
  currency: "EUR",
  financed: true,
  paymentCount: 5,
  paymentAmountCents: null,
  paymentIntervalMonths: 1,
  paymentMethod: "cash"
};
export const contract: FinanceContract = {
  ...contractInput,
  id: "contract-id",
  paymentAmountCents: 20000,
  endDate: "2026-12-31",
  renewalDueDate: "2027-01-01",
  status: "active",
  previousContractId: "",
  idempotencyKey: "",
  notes: "",
  createdAt: "created",
  updatedAt: "updated"
};
export const expense: FinanceExpense = {
  id: "expense-id",
  date: "2026-03-31",
  category: "Local",
  description: "Alquiler",
  amountCents: 12100,
  currency: "EUR",
  vatRate: 21,
  vatDeductible: true,
  notes: "Nota",
  createdAt: "created",
  updatedAt: "updated"
};
export const payment: FinancePayment = {
  id: "payment-id",
  contractId: "contract-id",
  athleteUsername: "ana",
  athleteName: "Ana",
  planLabel: "Anual",
  dueDate: "2025-12-31",
  paidAt: "2026-01-01",
  expectedAmountCents: 30000,
  paidAmountCents: 19000,
  status: "paid",
  paymentMethod: "cash",
  sequenceIndex: 1,
  sequenceCount: 5,
  notes: "",
  createdAt: "",
  updatedAt: ""
};
const lineItems = [
  {
    id: "line-id",
    description: "Servicio",
    quantity: 1,
    unitPriceCents: 100000,
    discountPercent: 0,
    vatRate: 21
  }
];
export const invoice: FinanceInvoice = {
  id: "invoice-id",
  invoiceNumber: "F-1",
  series: "F",
  sequenceNumber: 1,
  issueDate: "2026-04-01",
  operationDate: "2026-03-31",
  dueDate: "",
  client: {
    name: "Ana",
    taxId: "test",
    address: "test",
    postalCode: "",
    city: "",
    province: "",
    country: "",
    email: ""
  },
  issuer: DEFAULT_FINANCE_INVOICE_SETTINGS,
  lineItems,
  irpfRate: 15,
  totals: calculateFinanceInvoiceTotals(lineItems, 15),
  currency: "EUR",
  paymentMethod: "Efectivo",
  notes: "",
  status: "issued",
  createdAt: "",
  updatedAt: ""
};
