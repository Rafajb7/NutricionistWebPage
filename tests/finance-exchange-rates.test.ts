import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_EXCHANGE_RATES, convertToEuroCents, expenseEuroCents, expenseEuroConversion } from "@/lib/finance/exchange-rates";
import { parseExchangeRates } from "@/lib/finance/exchange-rates-server";
import { FINANCE_CURRENCY_CODES } from "@/lib/finance/currencies";
import type { FinanceExpense } from "@/lib/finance/types";

const expense: FinanceExpense = { id: "1", date: "2026-10-08", category: "General", description: "Invoice", amountCents: 10000, currency: "USD", notes: "", createdAt: "", updatedAt: "" };
const now = Date.parse("2026-10-08T12:00:00Z");
const payload = { result: "success", base_code: "EUR", time_last_update_unix: now / 1000, rates: Object.fromEntries(FINANCE_CURRENCY_CODES.map(code => [code, code === "EUR" ? 1 : 2])) };

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("finance exchange rates", () => {
  it("contains all 50 positive conversions with a dated source", () => {
    expect(Object.keys(DEFAULT_EXCHANGE_RATES.rates)).toHaveLength(50);
    expect(DEFAULT_EXCHANGE_RATES.date).toBe("2026-10-08");
    FINANCE_CURRENCY_CODES.forEach(code => expect(DEFAULT_EXCHANGE_RATES.rates[code]).toBeGreaterThan(0));
    expect(DEFAULT_EXCHANGE_RATES.rates.EUR).toBe(1);
  });
  it("inverts EUR-based quotes, rounds once to cents and leaves euros unchanged", () => {
    const exchange = parseExchangeRates(payload, now);
    expect(exchange.rates.USD).toBe(0.5);
    expect(convertToEuroCents(10001, "USD", exchange)).toBe(5001);
    expect(convertToEuroCents(10001, "EUR", exchange)).toBe(10001);
    expect(() => convertToEuroCents(100, "XYZ", exchange)).toThrow();
  });
  it("freezes the original conversion instead of revaluing saved expenses", () => {
    const conversion = expenseEuroConversion(10000, "USD", parseExchangeRates(payload, now));
    expect(conversion).toEqual({ euroAmountCents: 5000, exchangeRateToEur: 0.5, exchangeRateDate: "2026-10-08" });
    expect(expenseEuroCents({ ...expense, ...conversion })).toBe(5000);
    expect(expenseEuroCents({ ...expense, euroAmountCents: 0 })).toBe(0);
    expect(expenseEuroCents(expense)).toBe(Math.round(10000 * DEFAULT_EXCHANGE_RATES.rates.USD));
  });
  it("rejects incomplete, nonpositive, wrong-base, stale and future provider responses", () => {
    expect(() => parseExchangeRates({ ...payload, rates: { EUR: 1 } }, now)).toThrow();
    expect(() => parseExchangeRates({ ...payload, rates: { ...payload.rates, USD: 0 } }, now)).toThrow();
    expect(() => parseExchangeRates({ ...payload, base_code: "USD" }, now)).toThrow();
    expect(() => parseExchangeRates(payload, now + 4 * 86400_000)).toThrow();
    expect(() => parseExchangeRates(payload, now - 86400_000)).toThrow();
  });
  it("shares and caches the live request", async () => {
    vi.resetModules();
    vi.useFakeTimers(); vi.setSystemTime(now);
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => payload });
    vi.stubGlobal("fetch", fetcher);
    const { getFinanceExchangeRates } = await import("@/lib/finance/exchange-rates-server");
    const values = await Promise.all([getFinanceExchangeRates(), getFinanceExchangeRates()]);
    expect(values[0].rates.USD).toBe(0.5);
    expect(values[1]).toEqual(values[0]);
    await getFinanceExchangeRates();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("keeps the dated fallback when the provider is unavailable", async () => {
    vi.resetModules();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Offline")));
    const { getFinanceExchangeRates } = await import("@/lib/finance/exchange-rates-server");
    expect(await getFinanceExchangeRates()).toEqual(DEFAULT_EXCHANGE_RATES);
  });
});
