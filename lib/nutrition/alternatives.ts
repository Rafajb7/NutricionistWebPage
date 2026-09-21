import { ATWATER_KCAL_PER_GRAM } from "@/lib/nutrition/calculations";
import type { NutritionPlanFoodAlternative, NutritionPlanFoodEntry } from "@/lib/nutrition/types";
import { allowsFractionalQuantity, getEffectiveQuantityG, normalizeFoodQuantity } from "@/lib/nutrition/quantity-units";

type EquivalentFood = Pick<NutritionPlanFoodEntry,
  "proteinPer100g" | "carbsPer100g" | "fatPer100g" | "quantityUnit" | "unitWeightG"
>;

// Use unrounded calories so repeated edits do not accumulate rounding errors.
export function getEquivalentFoodQuantity(
  reference: EquivalentFood & { quantityG: number },
  alternative: EquivalentFood,
): number {
  const caloriesPer100g = (food: EquivalentFood) =>
    food.proteinPer100g * ATWATER_KCAL_PER_GRAM.protein +
    food.carbsPer100g * ATWATER_KCAL_PER_GRAM.carbs +
    food.fatPer100g * ATWATER_KCAL_PER_GRAM.fat;
  const referenceG = getEffectiveQuantityG(reference);
  const referenceCalories = referenceG * caloriesPer100g(reference) / 100;
  const alternativeCalories = caloriesPer100g(alternative);
  const equivalentG = referenceCalories > 0 && alternativeCalories > 0
    ? referenceCalories / alternativeCalories * 100
    : referenceG;
  const gramsPerUnit = getEffectiveQuantityG({ ...alternative, quantityG: 1 });
  const step = allowsFractionalQuantity(alternative.quantityUnit) ? 0.25 : 10;
  // Round the exact equivalent once, keeping at least one practical portion.
  const quantity = Math.max(step, Math.round(equivalentG / gramsPerUnit / step) * step);
  return normalizeFoodQuantity(quantity, alternative.quantityUnit);
}

export function updateEntryAlternatives(
  previous: NutritionPlanFoodEntry,
  next: NutritionPlanFoodEntry,
): NutritionPlanFoodEntry {
  if (previous.quantityG === next.quantityG && previous.quantityUnit === next.quantityUnit &&
      previous.unitWeightG === next.unitWeightG) return next;
  return {
    ...next,
    alternatives: (next.alternatives ?? []).map((alternative): NutritionPlanFoodAlternative => ({
      ...alternative,
      quantityG: getEquivalentFoodQuantity(next, alternative),
    })),
  };
}
