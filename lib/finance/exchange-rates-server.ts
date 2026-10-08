import { FINANCE_CURRENCY_CODES } from "./currencies";
import { DEFAULT_EXCHANGE_RATES, type FinanceExchangeRates } from "./exchange-rates";

const ENDPOINT = "https://open.er-api.com/v6/latest/EUR";
let cached: { until: number; value: FinanceExchangeRates } | undefined;
let pending: Promise<FinanceExchangeRates> | undefined;

export function parseExchangeRates(payload: unknown, now = Date.now()): FinanceExchangeRates {
  const data = payload as { result?: string; base_code?: string; time_last_update_unix?: number; rates?: Record<string, number> };
  const timestamp = Number(data?.time_last_update_unix) * 1000;
  if (data?.result !== "success" || data.base_code !== "EUR" || !Number.isFinite(timestamp) || timestamp > now + 60_000 || now - timestamp > 3 * 86400_000 || data.rates?.EUR !== 1) {
    throw new Error("La fuente no ha devuelto cotizaciones vigentes.");
  }
  const rates: Record<string, number> = {};
  for (const code of FINANCE_CURRENCY_CODES) {
    const unitsPerEuro = data.rates?.[code];
    if (typeof unitsPerEuro !== "number" || !Number.isFinite(unitsPerEuro) || unitsPerEuro <= 0) throw new Error(`Falta la cotización de ${code}.`);
    rates[code] = 1 / unitsPerEuro;
  }
  return { date: new Date(timestamp).toISOString().slice(0, 10), source: DEFAULT_EXCHANGE_RATES.source, rates };
}

export async function getFinanceExchangeRates(): Promise<FinanceExchangeRates> {
  if (cached && cached.until > Date.now()) return cached.value;
  if (pending) return pending;
  pending = (async () => {
    try {
      const response = await fetch(ENDPOINT, { next: { revalidate: 3600 }, signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error("No se pudo consultar el cambio.");
      const value = parseExchangeRates(await response.json());
      cached = { value, until: Date.now() + 3600_000 };
      return value;
    } catch {
      // Always expose the actual date of this fallback in the form and saved record.
      const value = cached?.value ?? DEFAULT_EXCHANGE_RATES;
      cached = { value, until: Date.now() + 5 * 60_000 };
      return value;
    } finally {
      pending = undefined;
    }
  })();
  return pending;
}
