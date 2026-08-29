import type {
  NutritionPlanFoodEntry,
  NutritionPlanFull,
  NutritionTotals
} from "@/lib/nutrition/types";
import { getEffectiveQuantityG } from "@/lib/nutrition/quantity-units";

export const EMPTY_NUTRITION_TOTALS: NutritionTotals = {
  proteinG: 0,
  carbsG: 0,
  fatG: 0,
  sodiumMg: 0,
  waterG: 0,
  caloriesKcal: 0
};

export const ATWATER_KCAL_PER_GRAM = {
  protein: 4,
  carbs: 4,
  fat: 9
} as const;

export function roundNutritionValue(value: number, decimals = 1): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

export function calculateEntryTotals(entry: Pick<
  NutritionPlanFoodEntry,
  | "quantityG"
  | "proteinPer100g"
  | "carbsPer100g"
  | "fatPer100g"
  | "sodiumPer100g"
  | "waterPer100g"
> & {
  quantityUnit?: NutritionPlanFoodEntry["quantityUnit"];
  unitWeightG?: number;
}): NutritionTotals {
  const ratio = getEffectiveQuantityG(entry) / 100;
  const proteinG = entry.proteinPer100g * ratio;
  const carbsG = entry.carbsPer100g * ratio;
  const fatG = entry.fatPer100g * ratio;
  const sodiumMg = entry.sodiumPer100g * ratio;
  const waterG = entry.waterPer100g * ratio;

  return {
    proteinG: roundNutritionValue(proteinG),
    carbsG: roundNutritionValue(carbsG),
    fatG: roundNutritionValue(fatG),
    sodiumMg: roundNutritionValue(sodiumMg, 0),
    waterG: roundNutritionValue(waterG),
    caloriesKcal: roundNutritionValue(
      proteinG * ATWATER_KCAL_PER_GRAM.protein +
        carbsG * ATWATER_KCAL_PER_GRAM.carbs +
        fatG * ATWATER_KCAL_PER_GRAM.fat,
      0
    )
  };
}

export function addNutritionTotals(items: NutritionTotals[]): NutritionTotals {
  return items.reduce<NutritionTotals>(
    (acc, item) => ({
      proteinG: roundNutritionValue(acc.proteinG + item.proteinG),
      carbsG: roundNutritionValue(acc.carbsG + item.carbsG),
      fatG: roundNutritionValue(acc.fatG + item.fatG),
      sodiumMg: roundNutritionValue(acc.sodiumMg + item.sodiumMg, 0),
      waterG: roundNutritionValue(acc.waterG + item.waterG),
      caloriesKcal: roundNutritionValue(acc.caloriesKcal + item.caloriesKcal, 0)
    }),
    { ...EMPTY_NUTRITION_TOTALS }
  );
}

export function calculateMealTotals(entries: NutritionPlanFoodEntry[]): NutritionTotals {
  const safeEntries = Array.isArray(entries) ? entries : [];
  return addNutritionTotals(
    safeEntries
      .filter((entry) => !entry.mealOption || entry.mealOption === 1)
      .map(calculateEntryTotals)
  );
}

export function calculateMealOptionTotals(
  entries: NutritionPlanFoodEntry[],
  optionNumber: number
): NutritionTotals {
  const safeEntries = Array.isArray(entries) ? entries : [];
  const targetOption = Math.max(1, Math.round(optionNumber));
  return addNutritionTotals(
    safeEntries
      .filter((entry) => (entry.mealOption || 1) === targetOption)
      .map(calculateEntryTotals)
  );
}

export function calculatePlanTotals(plan: NutritionPlanFull): NutritionTotals {
  const meals = Array.isArray(plan.meals) ? plan.meals : [];
  const mealTotals = meals
    .filter((meal) => meal.included)
    .map((meal) => calculateMealTotals(meal.entries));
  return addNutritionTotals(mealTotals);
}

export function calculateMacroPercent(current: number, target: number): number {
  if (!Number.isFinite(target) || target <= 0) return 0;
  return roundNutritionValue((Math.max(0, current) / target) * 100, 0);
}

export function getMacroRemaining(current: number, target: number): number {
  return roundNutritionValue(target - current);
}
