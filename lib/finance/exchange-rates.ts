import snapshot from "./exchange-rates-snapshot.json";
import type { FinanceExpense } from "./types";

export type FinanceExchangeRates = {
  date: string;
  source: string;
  /** Euros per one unit of original currency. */
  rates: Record<string, number>;
};

export const DEFAULT_EXCHANGE_RATES: FinanceExchangeRates = snapshot;

export function convertToEuroCents(amountCents: number, currency: string, exchange = DEFAULT_EXCHANGE_RATES): number {
  const rate = currency === "EUR" ? 1 : exchange.rates[currency];
  if (!Number.isFinite(rate) || rate <= 0) throw new Error(`No hay cambio disponible para ${currency}.`);
  const result = Math.round(amountCents * rate);
  if (!Number.isSafeInteger(result)) throw new Error("Importe fuera de rango.");
  return result;
}

export function expenseEuroCents(expense: FinanceExpense): number {
  if (expense.currency === "EUR") return expense.amountCents;
  if (expense.euroAmountCents !== undefined) return expense.euroAmountCents;
  if (expense.exchangeRateToEur && expense.exchangeRateToEur > 0) return Math.round(expense.amountCents * expense.exchangeRateToEur);
  // Legacy rows have no saved rate. Use the dated initial list, not a moving daily rate.
  return convertToEuroCents(expense.amountCents, expense.currency);
}

export function expenseEuroConversion(amountCents: number, currency: string, exchange = DEFAULT_EXCHANGE_RATES) {
  return {
    euroAmountCents: convertToEuroCents(amountCents, currency, exchange),
    exchangeRateToEur: currency === "EUR" ? 1 : exchange.rates[currency],
    exchangeRateDate: currency === "EUR" ? "" : exchange.date
  };
}
