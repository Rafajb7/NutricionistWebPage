import { isIsoDate } from "./calculations";
import { convertToEuroCents, expenseEuroCents } from "./exchange-rates";
import { expenseVatCents } from "./reporting";
import type {
  FinanceContract,
  FinanceExpense,
  FinanceInvoice,
  FinancePayment,
  FinancePaymentMethod
} from "./types";

type Data = {
  invoices: FinanceInvoice[];
  expenses: FinanceExpense[];
  contracts: FinanceContract[];
  payments: FinancePayment[];
};
export type QuarterlyCollection = {
  id: string;
  date: string;
  athleteName: string;
  planLabel: string;
  amountCents: number;
  method: FinancePaymentMethod | undefined;
  contractAmountCents: number | null;
};

function dateMonth(date: string, year: number): number | null {
  return isIsoDate(date) && Number(date.slice(0, 4)) === year ? Number(date.slice(5, 7)) - 1 : null;
}

export function financeReportYears(data: Data, currentYear = new Date().getFullYear()): number[] {
  const dates = [
    ...data.invoices.flatMap((invoice) => [invoice.operationDate || invoice.issueDate]),
    ...data.expenses.map((expense) => expense.date),
    ...data.payments.map((payment) => payment.paidAt)
  ];
  return [
    ...new Set([currentYear, ...dates.filter(isIsoDate).map((date) => Number(date.slice(0, 4)))])
  ].sort((a, b) => b - a);
}

export function buildQuarterlyFinanceReport(data: Data, year: number) {
  const quarters = Array.from({ length: 4 }, (_, index) => ({
    quarter: index + 1,
    invoiceCount: 0,
    expenseCount: 0,
    incomeBaseCents: 0,
    incomeGrossCents: 0,
    outputVatCents: 0,
    expenseBaseCents: 0,
    expenseGrossCents: 0,
    inputVatCents: 0,
    deductibleExpenseGrossCents: 0,
    deductibleExpenseBaseCents: 0,
    deductibleVatCents: 0,
    balanceCents: 0,
    cashCents: 0,
    transferCents: 0,
    unspecifiedMethodCents: 0,
    collectedCents: 0,
    collections: [] as QuarterlyCollection[],
    months: Array.from({ length: 3 }, (_, offset) => ({
      month: `${year}-${String(index * 3 + offset + 1).padStart(2, "0")}`,
      incomeGrossCents: 0,
      expenseGrossCents: 0
    }))
  }));
  for (const invoice of data.invoices) {
    if (invoice.status !== "issued") continue;
    const month = dateMonth(invoice.operationDate || invoice.issueDate, year);
    if (month === null) continue;
    const quarter = quarters[Math.floor(month / 3)];
    const base = convertToEuroCents(invoice.totals.taxableBaseCents, invoice.currency);
    const vat = convertToEuroCents(invoice.totals.vatCents, invoice.currency);
    // Gross turnover is base + VAT, before any IRPF withholding; never add collections here.
    quarter.invoiceCount++;
    quarter.incomeBaseCents += base;
    quarter.outputVatCents += vat;
    quarter.incomeGrossCents += base + vat;
    quarter.months[month % 3].incomeGrossCents += base + vat;
  }
  for (const expense of data.expenses) {
    const month = dateMonth(expense.date, year);
    if (month === null) continue;
    const quarter = quarters[Math.floor(month / 3)];
    const gross = expenseEuroCents(expense);
    const vat = expenseVatCents(expense);
    quarter.expenseCount++;
    quarter.expenseGrossCents += gross;
    quarter.expenseBaseCents += gross - vat;
    quarter.inputVatCents += vat;
    quarter.months[month % 3].expenseGrossCents += gross;
    if (expense.vatDeductible) {
      quarter.deductibleExpenseGrossCents += gross;
      quarter.deductibleExpenseBaseCents += gross - vat;
      quarter.deductibleVatCents += vat;
    }
  }
  const contracts = new Map(data.contracts.map((contract) => [contract.id, contract]));
  for (const payment of data.payments) {
    if (payment.status !== "paid") continue;
    const month = dateMonth(payment.paidAt, year);
    // A missing actual collection date cannot be attributed to a fiscal quarter.
    if (month === null) continue;
    const contract = contracts.get(payment.contractId);
    const currency = contract?.currency ?? "EUR";
    const amount = convertToEuroCents(payment.paidAmountCents, currency);
    const quarter = quarters[Math.floor(month / 3)];
    const method = payment.paymentMethod;
    quarter.collectedCents += amount;
    if (method === "cash") quarter.cashCents += amount;
    else if (method === "bank_transfer") quarter.transferCents += amount;
    else quarter.unspecifiedMethodCents += amount;
    quarter.collections.push({
      id: payment.id,
      date: payment.paidAt,
      athleteName: payment.athleteName || payment.athleteUsername,
      planLabel: payment.planLabel,
      amountCents: amount,
      method,
      contractAmountCents: contract ? convertToEuroCents(contract.totalAmountCents, currency) : null
    });
  }
  return quarters.map((quarter) => ({
    ...quarter,
    balanceCents: quarter.outputVatCents - quarter.deductibleVatCents,
    collections: quarter.collections.sort((a, b) => a.date.localeCompare(b.date))
  }));
}

export type QuarterlyFinanceReport = ReturnType<typeof buildQuarterlyFinanceReport>[number];
