import { addNutritionTotals, ATWATER_KCAL_PER_GRAM, calculateEntryTotals } from "@/lib/nutrition/calculations";
import type {
  NutritionPlanFoodAlternative,
  NutritionPlanFoodAlternativeComponent,
  NutritionPlanFoodEntry,
  NutritionTotals,
} from "@/lib/nutrition/types";
import { allowsFractionalQuantity, getEffectiveQuantityG, normalizeFoodQuantity } from "@/lib/nutrition/quantity-units";

type EquivalentFood = Pick<NutritionPlanFoodEntry,
  "proteinPer100g" | "carbsPer100g" | "fatPer100g" | "quantityUnit" | "unitWeightG"
>;

// Use unrounded calories so repeated edits do not accumulate rounding errors.
export function getEquivalentFoodQuantity(
  reference: EquivalentFood & { quantityG: number },
  alternative: EquivalentFood,
  calorieShare = 1,
): number {
  const caloriesPer100g = (food: EquivalentFood) =>
    food.proteinPer100g * ATWATER_KCAL_PER_GRAM.protein +
    food.carbsPer100g * ATWATER_KCAL_PER_GRAM.carbs +
    food.fatPer100g * ATWATER_KCAL_PER_GRAM.fat;
  const referenceG = getEffectiveQuantityG(reference);
  const referenceCalories = referenceG * caloriesPer100g(reference) / 100 * calorieShare;
  const alternativeCalories = caloriesPer100g(alternative);
  const equivalentG = referenceCalories > 0 && alternativeCalories > 0
    ? referenceCalories / alternativeCalories * 100
    : referenceG * calorieShare;
  const gramsPerUnit = getEffectiveQuantityG({ ...alternative, quantityG: 1 });
  const step = allowsFractionalQuantity(alternative.quantityUnit) ? 0.25 : 5;
  // Round the exact equivalent once, keeping at least one practical portion.
  const quantity = Math.max(step, Math.round(equivalentG / gramsPerUnit / step) * step);
  return normalizeFoodQuantity(quantity, alternative.quantityUnit);
}

export function getAlternativeComponents(
  alternative: NutritionPlanFoodAlternative,
): NutritionPlanFoodAlternativeComponent[] {
  return alternative.secondComponent ? [alternative, alternative.secondComponent] : [alternative];
}

export function calculateAlternativeTotals(alternative: NutritionPlanFoodAlternative): NutritionTotals {
  return addNutritionTotals(getAlternativeComponents(alternative).map(calculateEntryTotals));
}

export function balanceAlternative(
  reference: EquivalentFood & { quantityG: number },
  alternative: NutritionPlanFoodAlternative,
): NutritionPlanFoodAlternative {
  const calorieShare = alternative.secondComponent ? 0.5 : 1;
  return {
    ...alternative,
    quantityG: getEquivalentFoodQuantity(reference, alternative, calorieShare),
    ...(alternative.secondComponent ? {
      secondComponent: {
        ...alternative.secondComponent,
        quantityG: getEquivalentFoodQuantity(reference, alternative.secondComponent, calorieShare),
      },
    } : {}),
  };
}

export function updateEntryAlternatives(
  previous: NutritionPlanFoodEntry,
  next: NutritionPlanFoodEntry,
): NutritionPlanFoodEntry {
  if (previous.quantityG === next.quantityG && previous.quantityUnit === next.quantityUnit &&
      previous.unitWeightG === next.unitWeightG) return next;
  return {
    ...next,
    alternatives: (next.alternatives ?? []).map((alternative) => balanceAlternative(next, alternative)),
  };
}
