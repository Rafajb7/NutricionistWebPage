import type {
  NutritionFood,
  NutritionPlanFoodAlternative,
  NutritionPlanFoodEntry,
  NutritionQuantityUnit
} from "@/lib/nutrition/types";

type FoodLike = Pick<NutritionFood, "id" | "name" | "category">;

type QuantityLike = Pick<NutritionPlanFoodEntry | NutritionPlanFoodAlternative, "quantityG"> & {
  quantityUnit?: NutritionQuantityUnit;
  unitWeightG?: number;
};

export const GENERIC_FRUIT_SERVING_FOOD_ID = "default-racion-fruta";
export const GENERIC_VEGETABLE_SERVING_FOOD_ID = "default-racion-verdura";
export const FRUIT_SERVING_WEIGHT_G = 150;
export const VEGETABLE_SERVING_WEIGHT_G = 150;
export const DEFAULT_FRUIT_PIECE_WEIGHT_G = 150;

const FRUIT_PIECE_WEIGHTS: Array<{ patterns: string[]; weightG: number }> = [
  { patterns: ["platano", "banana"], weightG: 118 },
  { patterns: ["manzana"], weightG: 182 },
  { patterns: ["naranja"], weightG: 131 },
  { patterns: ["pera"], weightG: 178 },
  { patterns: ["melocoton", "nectarina"], weightG: 150 },
  { patterns: ["kiwi"], weightG: 69 },
  { patterns: ["mango"], weightG: 200 },
  { patterns: ["uva"], weightG: 5 },
  { patterns: ["arandano"], weightG: 1 },
  { patterns: ["fresa"], weightG: 18 },
  { patterns: ["frambuesa"], weightG: 4 },
  { patterns: ["mora"], weightG: 7 },
  { patterns: ["cereza"], weightG: 8 },
  { patterns: ["ciruela"], weightG: 66 },
  { patterns: ["albaricoque"], weightG: 35 },
  { patterns: ["higo"], weightG: 50 },
  { patterns: ["pomelo"], weightG: 230 },
  { patterns: ["limon", "lima"], weightG: 67 },
  { patterns: ["papaya"], weightG: 300 },
  { patterns: ["granada"], weightG: 282 },
  { patterns: ["aguacate"], weightG: 201 }
];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function isGenericFruitServingFood(food: FoodLike): boolean {
  const name = normalizeText(food.name);
  return food.id === GENERIC_FRUIT_SERVING_FOOD_ID || name === "racion de fruta";
}

export function isGenericVegetableServingFood(food: FoodLike): boolean {
  const name = normalizeText(food.name);
  return food.id === GENERIC_VEGETABLE_SERVING_FOOD_ID || name === "racion de verdura";
}

export function isGenericServingFood(food: FoodLike): boolean {
  return isGenericFruitServingFood(food) || isGenericVegetableServingFood(food);
}

export function isFruitFood(food: FoodLike): boolean {
  return normalizeText(food.category).includes("frutas") || normalizeText(food.name).includes("fruta");
}

export function isVegetableFood(food: FoodLike): boolean {
  return normalizeText(food.category).includes("verduras") || normalizeText(food.name).includes("verdura");
}

export function getFruitPieceWeightG(food: FoodLike): number {
  const name = normalizeText(food.name);
  const match = FRUIT_PIECE_WEIGHTS.find((item) =>
    item.patterns.some((pattern) => name.includes(pattern))
  );
  return match?.weightG ?? DEFAULT_FRUIT_PIECE_WEIGHT_G;
}

export function getDefaultUnitWeightGForFood(food: FoodLike, unit: NutritionQuantityUnit): number {
  if (unit === "piece" && isFruitFood(food) && !isGenericServingFood(food)) {
    return getFruitPieceWeightG(food);
  }
  if (unit === "serving" && isGenericFruitServingFood(food)) return FRUIT_SERVING_WEIGHT_G;
  if (unit === "serving" && isGenericVegetableServingFood(food)) return VEGETABLE_SERVING_WEIGHT_G;
  return 1;
}

export function getDefaultQuantityUnitForFood(food: FoodLike): NutritionQuantityUnit {
  return isGenericServingFood(food) ? "serving" : "g";
}

export function getAllowedQuantityUnitsForFood(food: FoodLike): NutritionQuantityUnit[] {
  const units: NutritionQuantityUnit[] = ["g"];
  if (isFruitFood(food) && !isGenericServingFood(food)) units.push("piece");
  if (isGenericServingFood(food)) units.push("serving");
  return units;
}

export function normalizeQuantityUnitForFood(
  food: FoodLike,
  requestedUnit: NutritionQuantityUnit | undefined
): NutritionQuantityUnit {
  const unit = requestedUnit === "piece" || requestedUnit === "serving" ? requestedUnit : "g";
  return getAllowedQuantityUnitsForFood(food).includes(unit) ? unit : "g";
}

export function getEffectiveQuantityG(item: QuantityLike): number {
  const quantity = Number.isFinite(item.quantityG) ? Math.max(0, item.quantityG) : 0;
  const unit = item.quantityUnit ?? "g";
  if (unit === "g") return quantity;

  const fallbackUnitWeight = unit === "serving" ? FRUIT_SERVING_WEIGHT_G : DEFAULT_FRUIT_PIECE_WEIGHT_G;
  const unitWeight = isFinitePositive(item.unitWeightG) ? item.unitWeightG : fallbackUnitWeight;
  return quantity * unitWeight;
}

