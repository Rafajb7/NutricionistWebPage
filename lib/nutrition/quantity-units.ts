import type {
  NutritionFood,
  NutritionFoodReferenceUnit,
  NutritionPlanFoodAlternative,
  NutritionPlanFoodEntry,
  NutritionQuantityUnit
} from "@/lib/nutrition/types";

type FoodLike = Pick<NutritionFood, "id" | "name" | "category"> &
  Partial<Pick<NutritionFood, "referenceUnit" | "unitWeightG">>;

type QuantityLike = Pick<NutritionPlanFoodEntry | NutritionPlanFoodAlternative, "quantityG"> & {
  quantityUnit?: NutritionQuantityUnit;
  unitWeightG?: number;
};

export const GENERIC_FRUIT_SERVING_FOOD_ID = "default-racion-fruta";
export const GENERIC_VEGETABLE_SERVING_FOOD_ID = "default-racion-verdura";
export const FRUIT_SERVING_WEIGHT_G = 150;
export const VEGETABLE_SERVING_WEIGHT_G = 150;
export const DEFAULT_FRUIT_PIECE_WEIGHT_G = 150;
export const DEFAULT_UNIT_WEIGHT_G = 100;
export const DEFAULT_UNIT_VOLUME_ML = 250;

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

const FOOD_UNIT_WEIGHTS: Array<{ patterns: string[]; weightG: number }> = [
  { patterns: ["clara de huevo"], weightG: 33 },
  { patterns: ["huevo"], weightG: 50 },
  { patterns: ["tortitas de arroz", "tortita de arroz"], weightG: 9 },
  { patterns: ["tortilla de maiz"], weightG: 24 },
  { patterns: ["bagel"], weightG: 100 },
  { patterns: ["english muffin"], weightG: 57 },
  { patterns: ["pan pita"], weightG: 60 },
  { patterns: ["baguette"], weightG: 60 },
  { patterns: ["pan"], weightG: 35 },
  { patterns: ["jamon", "lonchas", "bacon"], weightG: 25 },
  { patterns: ["proteina", "whey", "aislado", "gelatina"], weightG: 30 },
  { patterns: ["leche", "bebida"], weightG: 250 },
  { patterns: ["yogur", "queso fresco batido", "cottage", "ricotta"], weightG: 125 },
  { patterns: ["queso"], weightG: 30 },
  { patterns: ["aceite", "miel", "mantequilla", "crema de cacahuete", "tahini"], weightG: 15 },
  { patterns: ["datiles", "datil"], weightG: 24 },
  { patterns: ["pasas"], weightG: 30 },
  { patterns: ["arroz seco", "pasta seca", "quinoa seca", "cuscus seco"], weightG: 60 },
  { patterns: ["avena seca", "crema de arroz", "farina", "semola", "harina"], weightG: 50 },
  { patterns: ["arroz", "pasta", "quinoa", "cuscus", "patata", "boniato"], weightG: 150 },
  { patterns: ["lentejas", "garbanzos", "alubias", "guisantes", "soja"], weightG: 150 },
  { patterns: ["almendras", "nueces", "pistachos", "anacardos", "cacahuetes", "avellanas", "pecanas", "semillas", "pipas"], weightG: 30 },
  { patterns: ["pollo", "pavo", "ternera", "cerdo", "cordero", "conejo"], weightG: 150 },
  { patterns: ["salmon", "atun", "bacalao", "tilapia", "gambas", "sardinas", "caballa", "lubina", "calamar", "trucha", "halibut", "anchoas", "cangrejo", "pulpo"], weightG: 150 }
];

const VOLUME_REFERENCE_PATTERNS = [
  "agua",
  "bebida",
  "caldo",
  "claras de huevo pasteurizadas",
  "gazpacho",
  "jugo",
  "leche",
  "refresco",
  "salmorejo",
  "salsa liquida",
  "vinagre",
  "zumo"
];

const CATEGORY_UNIT_WEIGHTS: Array<{ patterns: string[]; weightG: number }> = [
  { patterns: ["proteinas animales", "pescados", "mariscos"], weightG: 150 },
  { patterns: ["huevos", "lacteos", "mercadona"], weightG: 125 },
  { patterns: ["hidratos secos"], weightG: 60 },
  { patterns: ["hidratos cocidos", "legumbres", "proteinas vegetales", "verduras"], weightG: 150 },
  { patterns: ["hidratos elaborados"], weightG: 40 },
  { patterns: ["frutos secos", "semillas"], weightG: 30 },
  { patterns: ["grasas", "extras"], weightG: 15 },
  { patterns: ["suplementos"], weightG: 30 }
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

export function inferFoodReferenceUnit(food: Pick<FoodLike, "name" | "category">): NutritionFoodReferenceUnit {
  const name = normalizeText(food.name);
  const category = normalizeText(food.category);
  const shouldUseVolume = VOLUME_REFERENCE_PATTERNS.some(
    (pattern) => name.includes(normalizeText(pattern)) || category.includes(normalizeText(pattern))
  );
  return shouldUseVolume ? "100ml" : "100g";
}

export function normalizeFoodReferenceUnit(
  value: unknown,
  food: Pick<FoodLike, "id" | "name" | "category">
): NutritionFoodReferenceUnit {
  const normalized = normalizeText(String(value ?? ""));
  if (
    normalized === "100ml" ||
    normalized === "100 ml" ||
    normalized === "ml" ||
    normalized === "volumen" ||
    normalized === "volume"
  ) {
    return "100ml";
  }

  const inferred = inferFoodReferenceUnit(food);
  const isSeedFood = food.id.startsWith("default-") || food.id.startsWith("mercadona-");
  if ((normalized === "" || normalized === "100g" || normalized === "100 g") && isSeedFood) {
    return inferred;
  }

  return "100g";
}

export function getFoodBaseQuantityUnit(food: FoodLike): Extract<NutritionQuantityUnit, "g" | "ml"> {
  return (food.referenceUnit ?? inferFoodReferenceUnit(food)) === "100ml" ? "ml" : "g";
}

export function getFoodReferenceUnitLabel(food: FoodLike): string {
  return getFoodBaseQuantityUnit(food) === "ml" ? "100 ml" : "100 g";
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

export function getEstimatedUnitWeightGForFood(food: FoodLike): number {
  if (isFinitePositive(food.unitWeightG)) return Math.round(food.unitWeightG);

  if (isGenericFruitServingFood(food)) return FRUIT_SERVING_WEIGHT_G;
  if (isGenericVegetableServingFood(food)) return VEGETABLE_SERVING_WEIGHT_G;
  if (isFruitFood(food)) return getFruitPieceWeightG(food);

  const name = normalizeText(food.name);
  const nameMatch = FOOD_UNIT_WEIGHTS.find((item) =>
    item.patterns.some((pattern) => name.includes(normalizeText(pattern)))
  );
  if (nameMatch) return nameMatch.weightG;

  const category = normalizeText(food.category);
  const categoryMatch = CATEGORY_UNIT_WEIGHTS.find((item) =>
    item.patterns.some((pattern) => category.includes(normalizeText(pattern)))
  );
  return categoryMatch?.weightG ?? DEFAULT_UNIT_WEIGHT_G;
}

export function getDefaultUnitWeightGForFood(food: FoodLike, unit: NutritionQuantityUnit): number {
  if (unit === "g" || unit === "ml") return 1;
  if (unit === "piece") return getEstimatedUnitWeightGForFood(food);
  if (unit === "serving" && isGenericFruitServingFood(food)) return FRUIT_SERVING_WEIGHT_G;
  if (unit === "serving" && isGenericVegetableServingFood(food)) return VEGETABLE_SERVING_WEIGHT_G;
  return 1;
}

export function getDefaultQuantityUnitForFood(food: FoodLike): NutritionQuantityUnit {
  return isGenericServingFood(food) ? "serving" : getFoodBaseQuantityUnit(food);
}

export function getAllowedQuantityUnitsForFood(food: FoodLike): NutritionQuantityUnit[] {
  const units: NutritionQuantityUnit[] = [getFoodBaseQuantityUnit(food), "piece"];
  if (isGenericServingFood(food)) units.push("serving");
  return units;
}

export function normalizeQuantityUnitForFood(
  food: FoodLike,
  requestedUnit: NutritionQuantityUnit | undefined
): NutritionQuantityUnit {
  const baseUnit = getFoodBaseQuantityUnit(food);
  const unit =
    requestedUnit === "g" ||
    requestedUnit === "ml" ||
    requestedUnit === "piece" ||
    requestedUnit === "serving"
      ? requestedUnit
      : baseUnit;
  return getAllowedQuantityUnitsForFood(food).includes(unit) ? unit : baseUnit;
}

export function getEffectiveQuantityG(item: QuantityLike): number {
  const quantity = Number.isFinite(item.quantityG) ? Math.max(0, item.quantityG) : 0;
  const unit = item.quantityUnit ?? "g";
  if (unit === "g" || unit === "ml") return quantity;

  const fallbackUnitWeight = unit === "serving" ? FRUIT_SERVING_WEIGHT_G : DEFAULT_UNIT_WEIGHT_G;
  const unitWeight = isFinitePositive(item.unitWeightG) ? item.unitWeightG : fallbackUnitWeight;
  return quantity * unitWeight;
}

