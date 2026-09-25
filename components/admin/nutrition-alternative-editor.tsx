"use client";

import { useState } from "react";
import { Plus, ThumbsDown, ThumbsUp, Trash2, X } from "lucide-react";
import { NutritionQuantityInput } from "@/components/admin/nutrition-quantity-input";
import { calculateAlternativeTotals, getAlternativeComponents } from "@/lib/nutrition/alternatives";
import { calculateEntryTotals } from "@/lib/nutrition/calculations";
import {
  getAllowedQuantityUnitsForFood,
  getDefaultUnitWeightGForFood,
  getEffectiveQuantityG,
  normalizeFoodQuantity,
  normalizeQuantityUnitForFood,
} from "@/lib/nutrition/quantity-units";
import { getRestrictionConflict, getRestrictionLabel } from "@/lib/nutrition/restrictions";
import type {
  NutritionAthleteRestriction,
  NutritionFood,
  NutritionPlanFoodAlternative,
  NutritionPlanFoodAlternativeComponent,
  NutritionQuantityUnit,
} from "@/lib/nutrition/types";

const unitLabels: Record<NutritionQuantityUnit, string> = {
  g: "g", ml: "ml", piece: "unidades", serving: "raciones",
};
const number = (value: number, decimals = 1) => new Intl.NumberFormat("es-ES", {
  maximumFractionDigits: decimals,
}).format(value);

function FoodCompatibility({ food, restrictions }: {
  food: NutritionFood;
  restrictions: NutritionAthleteRestriction[];
}) {
  const conflict = getRestrictionConflict(food, restrictions);
  const label = conflict
    ? getRestrictionLabel(conflict.type, conflict.key, conflict.label)
    : "Compatible";
  return (
    <span title={label} aria-label={label}
      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${conflict
        ? "border-red-300/40 bg-red-500/10 text-red-100"
        : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"}`}>
      {conflict ? <ThumbsDown className="h-3.5 w-3.5" /> : <ThumbsUp className="h-3.5 w-3.5" />}
    </span>
  );
}

export function NutritionAlternativeEditor(props: {
  alternative: NutritionPlanFoodAlternative;
  foods: NutritionFood[];
  restrictions: NutritionAthleteRestriction[];
  disabled: boolean;
  onUpdate: (updater: (current: NutritionPlanFoodAlternative) => NutritionPlanFoodAlternative) => void;
  onSetSecondFood: (food: NutritionFood | null) => void;
  onRemove: () => void;
}) {
  const [search, setSearch] = useState<string | null>(null);
  const { alternative } = props;
  const components = getAlternativeComponents(alternative);
  const totals = calculateAlternativeTotals(alternative);
  const query = search?.trim().toLocaleLowerCase("es") ?? "";
  const results = query ? props.foods.filter((food) => food.active && food.id !== alternative.foodId
    && (food.name.toLocaleLowerCase("es").includes(query) || food.category.toLocaleLowerCase("es").includes(query)))
    .slice(0, 20) : [];
  const fieldClass = "w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60";

  function updateComponent(index: number, patch: Partial<NutritionPlanFoodAlternativeComponent>) {
    props.onUpdate((current) => index === 0
      ? { ...current, ...patch }
      : current.secondComponent
        ? { ...current, secondComponent: { ...current.secondComponent, ...patch } }
        : current);
  }

  return (
    <div aria-label={`Alternativa ${components.map((item) => item.foodName).join(" + ")}`}
      className="rounded-lg border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
            {alternative.secondComponent ? "Alternativa doble" : "Alternativa"}
          </p>
          {alternative.secondComponent ? <p className="mt-1 text-xs text-brand-muted">
            Ambos alimentos forman una única alternativa.
          </p> : null}
        </div>
        <button type="button" onClick={props.onRemove} disabled={props.disabled}
          aria-label={`Eliminar alternativa ${alternative.foodName}`} title="Eliminar alternativa"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 hover:bg-red-500/20 disabled:opacity-40">
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-2 space-y-3">
        {components.map((component, index) => {
          const catalogFood = props.foods.find((food) => food.id === component.foodId);
          const food = catalogFood ?? {
            id: component.foodId, name: component.foodName, category: "",
            referenceUnit: component.quantityUnit === "ml" ? "100ml" as const : "100g" as const,
            unitWeightG: component.unitWeightG,
          };
          const quantityUnit = normalizeQuantityUnitForFood(food, component.quantityUnit);
          return (
            <div key={index} className={index ? "border-t border-white/10 pt-3" : ""}>
              <div className="flex flex-wrap items-center gap-2">
                {index ? <Plus className="h-4 w-4 text-brand-accent" aria-label="junto con" /> : null}
                {catalogFood ? <FoodCompatibility food={catalogFood} restrictions={props.restrictions} /> : null}
                <p className="min-w-0 flex-1 break-words text-sm font-semibold text-brand-text">{component.foodName}</p>
                <span className="text-xs text-brand-muted">{number(calculateEntryTotals(component).caloriesKcal, 0)} kcal</span>
                {index === 1 ? <button type="button" disabled={props.disabled}
                  onClick={() => props.onSetSecondFood(null)} aria-label="Quitar segundo alimento"
                  className="rounded-lg border border-white/15 p-1.5 text-brand-muted hover:bg-white/10 disabled:opacity-40">
                  <X className="h-3.5 w-3.5" />
                </button> : null}
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 sm:max-w-sm">
                <label className="text-xs text-brand-muted">Cantidad de {component.foodName}
                  <NutritionQuantityInput
                    key={`${component.foodId}:${quantityUnit}:${Boolean(alternative.secondComponent)}`}
                    value={component.quantityG} unit={quantityUnit}
                    onChange={(value) => updateComponent(index, { quantityG: value })}
                    disabled={props.disabled} className={fieldClass} />
                </label>
                <label className="text-xs text-brand-muted">Unidad
                  <select value={quantityUnit} disabled={props.disabled} className={fieldClass}
                    onChange={(event) => {
                      const unit = normalizeQuantityUnitForFood(food, event.target.value as NutritionQuantityUnit);
                      const unitWeightG = getDefaultUnitWeightGForFood(food, unit);
                      updateComponent(index, {
                        quantityUnit: unit, unitWeightG,
                        quantityG: normalizeFoodQuantity(getEffectiveQuantityG(component) / unitWeightG, unit),
                      });
                    }}>
                    {getAllowedQuantityUnitsForFood(food).map((unit) => <option key={unit} value={unit}>{unitLabels[unit]}</option>)}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>
      <div aria-label="Totales de la alternativa" className="mt-3 flex flex-wrap gap-2 text-xs">
        {[
          `${number(totals.caloriesKcal, 0)} kcal`, `P ${number(totals.proteinG)}`,
          `C ${number(totals.carbsG)}`, `G ${number(totals.fatG)}`, `Fibra ${number(totals.fiberG)} g`,
          `Sodio ${number(totals.sodiumMg, 0)} mg`, `Agua ${number(totals.waterG)} g`,
        ].map((label, index) => <span key={index} className="rounded-md bg-black/20 px-2 py-1 text-brand-text">{label}</span>)}
      </div>
      {!alternative.secondComponent ? (
        <div className="mt-3">
          {search === null ? (
            <button type="button" disabled={props.disabled} onClick={() => setSearch("")}
              className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/35 px-2 py-1.5 text-xs text-brand-text hover:bg-brand-accent/10 disabled:opacity-40">
              <Plus className="h-3.5 w-3.5" /> Añadir segundo alimento
            </button>
          ) : (
            <div className="space-y-2 rounded-lg border border-brand-accent/25 bg-brand-accent/5 p-2">
              <p className="text-xs text-brand-muted">Se asignará el 50 % de las kcal de referencia a cada alimento, con el redondeo habitual.</p>
              <div className="flex gap-2">
                <input autoFocus value={search} onChange={(event) => setSearch(event.target.value)}
                  placeholder="Buscar segundo alimento" aria-label="Buscar segundo alimento"
                  disabled={props.disabled} className={fieldClass} />
                <button type="button" onClick={() => setSearch(null)} aria-label="Cerrar buscador del segundo alimento"
                  className="rounded-lg border border-white/15 px-2 text-brand-muted"><X className="h-4 w-4" /></button>
              </div>
              {query ? <div className="max-h-52 overflow-y-auto">
                {results.length ? results.map((food) => (
                  <button key={food.id} type="button" disabled={props.disabled}
                    onClick={() => { props.onSetSecondFood(food); setSearch(null); }}
                    className="flex w-full items-center gap-2 rounded-lg p-2 text-left text-sm text-brand-text hover:bg-white/10 disabled:opacity-40">
                    <FoodCompatibility food={food} restrictions={props.restrictions} />
                    <span>{food.name}</span>
                  </button>
                )) : <p className="p-2 text-xs text-brand-muted">No hay alimentos que coincidan.</p>}
              </div> : null}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
