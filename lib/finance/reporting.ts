import type { FinanceContract, FinanceExpense, FinanceInvoice, FinancePayment } from "./types";
import { convertToEuroCents, expenseEuroCents } from "./exchange-rates";

// Reports use EUR. Original invoice currency and the applied conversion remain on each expense.
export function expenseVatCents(expense: FinanceExpense): number {
  const rate = expense.vatRate ?? 0;
  const euros = expenseEuroCents(expense);
  return euros - Math.round(euros / (1 + rate / 100));
}

export function buildAnnualCashReport(payments: FinancePayment[], contracts: FinanceContract[], expenses: FinanceExpense[], year: number) {
  const currencies = new Map(contracts.map(contract => [contract.id, contract.currency]));
  const grossCents = cashCollected(payments.filter(payment => (currencies.get(payment.contractId) ?? "EUR") === "EUR"), `${year}-01-01`, `${year}-12-31`);
  const expenseCents = expenses.filter(expense => expense.date.startsWith(`${year}-`)).reduce((sum, expense) => sum + expenseEuroCents(expense), 0);
  return { grossCents, netCents: grossCents - expenseCents };
}

export function buildQuarterlyVatReport(invoices: FinanceInvoice[], expenses: FinanceExpense[], year: number) {
  const quarters = Array.from({ length: 4 }, (_, index) => ({ quarter: index + 1, outputVatCents: 0, deductibleVatCents: 0, balanceCents: 0 }));
  for (const invoice of invoices) {
    const date = invoice.operationDate || invoice.issueDate;
    if (invoice.status !== "issued" || !date.startsWith(`${year}-`)) continue;
    const quarter = quarters[Math.floor((Number(date.slice(5, 7)) - 1) / 3)];
    if (quarter) quarter.outputVatCents += convertToEuroCents(invoice.totals.vatCents, invoice.currency);
  }
  for (const expense of expenses) {
    if (!expense.vatDeductible || !expense.date.startsWith(`${year}-`)) continue;
    const quarter = quarters[Math.floor((Number(expense.date.slice(5, 7)) - 1) / 3)];
    if (quarter) quarter.deductibleVatCents += expenseVatCents(expense);
  }
  return quarters.map(quarter => ({ ...quarter, balanceCents: quarter.outputVatCents - quarter.deductibleVatCents }));
}

export function cashCollected(payments: FinancePayment[], start: string, end: string): number {
  return payments.filter(payment => payment.status === "paid" && (payment.paidAt || payment.dueDate) >= start && (payment.paidAt || payment.dueDate) <= end)
    .reduce((sum, payment) => sum + (payment.paidAmountCents || payment.expectedAmountCents), 0);
}
