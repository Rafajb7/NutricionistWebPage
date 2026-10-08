// 50 widely used currencies, displayed by ISO code and localized name.
export const FINANCE_CURRENCY_CODES = [
  "EUR", "USD", "GBP", "JPY", "CHF", "CNY", "AUD", "CAD", "HKD", "SGD",
  "SEK", "NOK", "NZD", "KRW", "INR", "MXN", "TWD", "ZAR", "BRL", "DKK",
  "PLN", "THB", "ILS", "IDR", "CZK", "AED", "TRY", "HUF", "CLP", "SAR",
  "PHP", "MYR", "COP", "RON", "PEN", "BHD", "DZD", "ARS", "RUB", "VND",
  "EGP", "KWD", "QAR", "PKR", "BDT", "NGN", "MAD", "UAH", "ISK", "OMR"
] as const;

const names = new Intl.DisplayNames(["es"], { type: "currency" });
export const FINANCE_CURRENCIES = FINANCE_CURRENCY_CODES.map(code => ({ code, label: `${code} · ${names.of(code) ?? code}` }));
