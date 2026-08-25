import type {
  NutritionAthleteRestriction,
  NutritionAthleteRestrictionKey,
  NutritionAthleteRestrictionType,
  NutritionFood,
  NutritionFoodRestrictionTag
} from "@/lib/nutrition/types";

export type RestrictionOption = {
  key: NutritionAthleteRestrictionKey;
  label: string;
  tags: NutritionFoodRestrictionTag[];
};

export const FOOD_RESTRICTION_TAG_OPTIONS: Array<{
  key: NutritionFoodRestrictionTag;
  label: string;
  group: "allergen" | "animal";
}> = [
  { key: "gluten", label: "Gluten", group: "allergen" },
  { key: "lactose", label: "Lactosa", group: "allergen" },
  { key: "milk", label: "Leche/lacteos", group: "allergen" },
  { key: "egg", label: "Huevo", group: "allergen" },
  { key: "fish", label: "Pescado", group: "allergen" },
  { key: "crustacean", label: "Crustaceos", group: "allergen" },
  { key: "mollusc", label: "Moluscos", group: "allergen" },
  { key: "peanut", label: "Cacahuete", group: "allergen" },
  { key: "tree_nut", label: "Frutos secos", group: "allergen" },
  { key: "soy", label: "Soja", group: "allergen" },
  { key: "sesame", label: "Sesamo", group: "allergen" },
  { key: "celery", label: "Apio", group: "allergen" },
  { key: "mustard", label: "Mostaza", group: "allergen" },
  { key: "sulphites", label: "Sulfitos", group: "allergen" },
  { key: "lupin", label: "Altramuz", group: "allergen" },
  { key: "fructose", label: "Fructosa alta", group: "allergen" },
  { key: "animal_meat", label: "Carne", group: "animal" },
  { key: "animal_poultry", label: "Ave", group: "animal" },
  { key: "animal_pork", label: "Cerdo", group: "animal" },
  { key: "animal_fish", label: "Origen pescado", group: "animal" },
  { key: "animal_seafood", label: "Origen marisco", group: "animal" },
  { key: "animal_egg", label: "Origen huevo", group: "animal" },
  { key: "animal_dairy", label: "Origen lacteo", group: "animal" },
  { key: "animal_honey", label: "Miel", group: "animal" }
];

export const ALLERGY_RESTRICTION_OPTIONS: RestrictionOption[] = [
  { key: "gluten", label: "Cereales con gluten", tags: ["gluten"] },
  { key: "milk", label: "Leche/lacteos", tags: ["milk", "lactose", "animal_dairy"] },
  { key: "egg", label: "Huevo", tags: ["egg", "animal_egg"] },
  { key: "fish", label: "Pescado", tags: ["fish", "animal_fish"] },
  { key: "crustacean", label: "Crustaceos", tags: ["crustacean", "animal_seafood"] },
  { key: "mollusc", label: "Moluscos", tags: ["mollusc", "animal_seafood"] },
  { key: "peanut", label: "Cacahuete", tags: ["peanut"] },
  { key: "tree_nut", label: "Frutos secos", tags: ["tree_nut"] },
  { key: "soy", label: "Soja", tags: ["soy"] },
  { key: "sesame", label: "Sesamo", tags: ["sesame"] },
  { key: "celery", label: "Apio", tags: ["celery"] },
  { key: "mustard", label: "Mostaza", tags: ["mustard"] },
  { key: "sulphites", label: "Sulfitos", tags: ["sulphites"] },
  { key: "lupin", label: "Altramuz/lupino", tags: ["lupin"] }
];

export const INTOLERANCE_RESTRICTION_OPTIONS: RestrictionOption[] = [
  { key: "lactose", label: "Lactosa", tags: ["lactose", "milk", "animal_dairy"] },
  { key: "gluten", label: "Gluten/celiaquia", tags: ["gluten"] },
  { key: "fructose", label: "Fructosa alta", tags: ["fructose"] },
  { key: "soy", label: "Soja", tags: ["soy"] },
  { key: "egg", label: "Huevo", tags: ["egg", "animal_egg"] },
  { key: "tree_nut", label: "Frutos secos", tags: ["tree_nut"] },
  { key: "peanut", label: "Cacahuete", tags: ["peanut"] }
];

export const DIET_RESTRICTION_OPTIONS: RestrictionOption[] = [
  {
    key: "diet_vegan",
    label: "Vegana",
    tags: [
      "animal_meat",
      "animal_poultry",
      "animal_pork",
      "animal_fish",
      "animal_seafood",
      "animal_egg",
      "animal_dairy",
      "animal_honey"
    ]
  },
  {
    key: "diet_vegetarian",
    label: "Vegetariana",
    tags: ["animal_meat", "animal_poultry", "animal_pork", "animal_fish", "animal_seafood"]
  },
  { key: "diet_no_pork", label: "Sin cerdo", tags: ["animal_pork"] }
];

const VALID_FOOD_TAGS = new Set(FOOD_RESTRICTION_TAG_OPTIONS.map((option) => option.key));

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

function hasAny(value: string, terms: string[]): boolean {
  return terms.some((term) => value.includes(term));
}

function addTag(tags: Set<NutritionFoodRestrictionTag>, condition: boolean, tag: NutritionFoodRestrictionTag) {
  if (condition) tags.add(tag);
}

export function parseRestrictionTags(value: unknown): NutritionFoodRestrictionTag[] {
  const raw = Array.isArray(value) ? value.join(",") : String(value ?? "");
  const tags = raw
    .split(/[,\n;|]+/)
    .map((item) => item.trim() as NutritionFoodRestrictionTag)
    .filter((item) => VALID_FOOD_TAGS.has(item));
  return Array.from(new Set(tags)).sort();
}

export function serializeRestrictionTags(tags: NutritionFoodRestrictionTag[] = []): string {
  const parsed = parseRestrictionTags(tags);
  return parsed.length ? parsed.join(",") : "none";
}

export function inferRestrictionTagsForFood(
  food: Pick<NutritionFood, "name" | "category"> & { restrictionTags?: NutritionFoodRestrictionTag[] }
): NutritionFoodRestrictionTag[] {
  const explicit = parseRestrictionTags(food.restrictionTags ?? []);
  const text = normalizeText(`${food.name} ${food.category}`);
  const name = normalizeText(food.name);
  const category = normalizeText(food.category);
  const tags = new Set<NutritionFoodRestrictionTag>(explicit);
  const isCoconutMilk = name.includes("leche de coco");
  const isRiceCake = name.includes("tortitas de arroz");
  const isCornTortilla = name.includes("tortilla de maiz");
  const isTurkeyHam = name.includes("jamon de pavo");

  addTag(tags, hasAny(text, ["trigo", "avena", "cebada", "centeno", "espelta", "kamut", "cuscus"]), "gluten");
  addTag(tags, hasAny(text, ["pasta", "pan", "baguette", "pita"]) && !isRiceCake && !isCornTortilla, "gluten");

  const dairyTerms = [
    "lacteo",
    "lacteos",
    "leche",
    "yogur",
    "queso",
    "ricotta",
    "mozzarella",
    "cheddar",
    "feta",
    "parmesano",
    "cottage",
    "whey",
    "caseina"
  ];
  const isDairy = hasAny(text, dairyTerms) && !isCoconutMilk;
  addTag(tags, isDairy, "milk");
  addTag(tags, isDairy, "lactose");
  addTag(tags, isDairy, "animal_dairy");

  const isEgg = hasAny(text, ["huevo", "huevos", "clara", "claras", "albumina"]);
  addTag(tags, isEgg, "egg");
  addTag(tags, isEgg, "animal_egg");

  const isCrustacean = hasAny(text, ["gamba", "gambas", "langostino", "langostinos", "camaron", "cangrejo", "bogavante", "langosta"]);
  const isMollusc = hasAny(text, ["calamar", "sepia", "pulpo", "mejillon", "almeja", "ostra", "ostras", "vieira"]);
  const isFish = category.includes("pescados") || hasAny(text, ["salmon", "atun", "bacalao", "tilapia", "sardina", "caballa", "lubina", "merluza"]);
  addTag(tags, isCrustacean, "crustacean");
  addTag(tags, isMollusc, "mollusc");
  addTag(tags, isFish && !isCrustacean && !isMollusc, "fish");
  addTag(tags, isFish && !isCrustacean && !isMollusc, "animal_fish");
  addTag(tags, isCrustacean || isMollusc, "animal_seafood");

  addTag(tags, hasAny(text, ["cacahuete", "cacahuetes"]), "peanut");
  addTag(tags, hasAny(text, ["almendra", "almendras", "avellana", "avellanas", "nuez", "nueces", "pistacho", "pistachos", "anacardo", "macadamia", "pecana"]), "tree_nut");
  addTag(tags, hasAny(text, ["soja", "tofu", "edamame", "tempeh"]), "soy");
  addTag(tags, hasAny(text, ["sesamo", "tahini", "hummus"]), "sesame");
  addTag(tags, hasAny(text, ["apio"]), "celery");
  addTag(tags, hasAny(text, ["mostaza"]), "mustard");
  addTag(tags, hasAny(text, ["sulfito", "sulfitos"]), "sulphites");
  addTag(tags, hasAny(text, ["altramuz", "altramuces", "lupino", "lupin"]), "lupin");

  const isFruitOrHoney = category.includes("frutas") || hasAny(text, ["miel"]);
  addTag(tags, isFruitOrHoney, "fructose");
  addTag(tags, hasAny(text, ["miel"]), "animal_honey");

  const isPoultry = hasAny(text, ["pollo", "pavo"]);
  const isPork = !isTurkeyHam && hasAny(text, ["cerdo", "jamon", "lomo", "solomillo"]);
  const isMeat = category.includes("proteinas animales") || hasAny(text, ["ternera", "vacuno", "buey"]);
  addTag(tags, isMeat || isPoultry || isPork, "animal_meat");
  addTag(tags, isPoultry, "animal_poultry");
  addTag(tags, isPork, "animal_pork");

  return Array.from(tags).sort();
}

export function getRestrictionLabel(
  type: NutritionAthleteRestrictionType,
  key: NutritionAthleteRestrictionKey,
  fallback = ""
): string {
  if (type === "allergy") {
    return ALLERGY_RESTRICTION_OPTIONS.find((option) => option.key === key)?.label ?? fallback;
  }
  if (type === "intolerance") {
    return INTOLERANCE_RESTRICTION_OPTIONS.find((option) => option.key === key)?.label ?? fallback;
  }
  if (type === "diet") {
    return DIET_RESTRICTION_OPTIONS.find((option) => option.key === key)?.label ?? fallback;
  }
  return fallback;
}

export function getRestrictionConflict(
  food: Pick<NutritionFood, "id" | "restrictionTags">,
  restrictions: NutritionAthleteRestriction[]
): NutritionAthleteRestriction | null {
  const tags = new Set(parseRestrictionTags(food.restrictionTags));
  for (const restriction of restrictions) {
    if (restriction.type === "dislike" && restriction.foodId === food.id) return restriction;
    if (restriction.type === "allergy") {
      const option = ALLERGY_RESTRICTION_OPTIONS.find((item) => item.key === restriction.key);
      if (option?.tags.some((tag) => tags.has(tag))) return restriction;
    }
    if (restriction.type === "intolerance") {
      const option = INTOLERANCE_RESTRICTION_OPTIONS.find((item) => item.key === restriction.key);
      if (option?.tags.some((tag) => tags.has(tag))) return restriction;
    }
    if (restriction.type === "diet") {
      const option = DIET_RESTRICTION_OPTIONS.find((item) => item.key === restriction.key);
      if (option?.tags.some((tag) => tags.has(tag))) return restriction;
    }
  }
  return null;
}

export function isFoodCompatibleWithRestrictions(
  food: Pick<NutritionFood, "id" | "restrictionTags">,
  restrictions: NutritionAthleteRestriction[]
): boolean {
  return !getRestrictionConflict(food, restrictions);
}
