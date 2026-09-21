"use client";

import { useState } from "react";
import type { NutritionQuantityUnit } from "@/lib/nutrition/types";
import { allowsFractionalQuantity, formatFoodQuantity, normalizeFoodQuantity } from "@/lib/nutrition/quantity-units";

export function NutritionQuantityInput(props: {
  value: number;
  unit: NutritionQuantityUnit;
  onChange: (value: number) => void;
  disabled?: boolean;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const fractional = allowsFractionalQuantity(props.unit);
  return (
    <input
      type="text"
      inputMode={fractional ? "decimal" : "numeric"}
      value={draft ?? formatFoodQuantity(props.value, props.unit)}
      onChange={(event) => {
        const raw = event.target.value;
        if (!(fractional ? /^\d*(?:[.,]\d{0,2})?$/ : /^\d*$/).test(raw)) return;
        setDraft(raw);
        // Preserve empty/partial values without changing the saved quantity.
        if (!raw || /[.,]$/.test(raw)) return;
        const value = Number(raw.replace(",", "."));
        if (Number.isFinite(value) && value > 0) props.onChange(normalizeFoodQuantity(value, props.unit));
      }}
      onBlur={() => setDraft(null)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      disabled={props.disabled}
      className={props.className}
    />
  );
}
