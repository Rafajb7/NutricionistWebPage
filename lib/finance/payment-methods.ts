import type { FinancePaymentMethod } from "./types";

export const FINANCE_PAYMENT_METHODS = [
  { value: "cash", label: "Efectivo" },
  { value: "bank_transfer", label: "Transferencia" }
] as const;

export function parseFinancePaymentMethod(value: unknown): FinancePaymentMethod | undefined {
  const key = String(value ?? "")
    .trim()
    .toLowerCase();
  if (key === "cash" || key === "efectivo") return "cash";
  if (["bank_transfer", "transferencia", "transferencia bancaria"].includes(key))
    return "bank_transfer";
  return undefined;
}

export function financePaymentMethodLabel(value: FinancePaymentMethod | undefined): string {
  return (
    FINANCE_PAYMENT_METHODS.find((method) => method.value === value)?.label ?? "Sin especificar"
  );
}
