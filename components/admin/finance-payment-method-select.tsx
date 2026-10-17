"use client";

import type { FinancePaymentMethod } from "@/lib/finance/types";
import { FINANCE_PAYMENT_METHODS } from "@/lib/finance/payment-methods";

export function FinancePaymentMethodSelect({
  value,
  onChange,
  disabled = false,
  required = true
}: {
  value: FinancePaymentMethod | "";
  onChange: (value: FinancePaymentMethod | "") => void;
  disabled?: boolean;
  required?: boolean;
}) {
  return (
    <label className="block text-sm text-brand-muted">
      Forma de Pago
      <select
        required={required}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value as FinancePaymentMethod | "")}
        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
      >
        <option value="">Selecciona una forma de pago</option>
        {FINANCE_PAYMENT_METHODS.map((method) => (
          <option key={method.value} value={method.value}>
            {method.label}
          </option>
        ))}
      </select>
    </label>
  );
}
