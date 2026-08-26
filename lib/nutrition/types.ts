export type NutritionPlanStatus = "draft" | "review" | "published";

export type NutritionMacroKey = "protein" | "carbs" | "fat";

export type NutritionFoodRestrictionTag =
  | "gluten"
  | "lactose"
  | "milk"
  | "egg"
  | "fish"
  | "crustacean"
  | "mollusc"
  | "peanut"
  | "tree_nut"
  | "soy"
  | "sesame"
  | "celery"
  | "mustard"
  | "sulphites"
  | "lupin"
  | "fructose"
  | "animal_meat"
  | "animal_poultry"
  | "animal_pork"
  | "animal_fish"
  | "animal_seafood"
  | "animal_egg"
  | "animal_dairy"
  | "animal_honey";

export type NutritionAthleteRestrictionType = "allergy" | "intolerance" | "dislike" | "diet";

export type NutritionAthleteRestrictionKey =
  | NutritionFoodRestrictionTag
  | "diet_vegan"
  | "diet_vegetarian"
  | "diet_no_pork"
  | "food_dislike";

export type NutritionFood = {
  id: string;
  name: string;
  category: string;
  referenceUnit: "100g";
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sodiumPer100g: number;
  waterPer100g: number;
  restrictionTags: NutritionFoodRestrictionTag[];
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NutritionAthleteRestriction = {
  id: string;
  athleteUsername: string;
  type: NutritionAthleteRestrictionType;
  key: NutritionAthleteRestrictionKey;
  foodId: string;
  label: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type NutritionPlanSummary = {
  id: string;
  athleteUsername: string;
  athleteName: string;
  name: string;
  status: NutritionPlanStatus;
  targetProteinG: number;
  targetCarbsG: number;
  targetFatG: number;
  notes: string;
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
  publishedFileId: string;
  versionNumber: number;
};

export type NutritionPlanMeal = {
  id: string;
  planId: string;
  name: string;
  position: number;
  notes: string;
  included: boolean;
  createdAt: string;
  updatedAt: string;
};

export type NutritionPlanFoodAlternative = {
  id: string;
  entryId: string;
  foodId: string;
  foodName: string;
  quantityG: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sodiumPer100g: number;
  waterPer100g: number;
  position: number;
  customText: string;
  createdAt: string;
  updatedAt: string;
};

export type NutritionPlanFoodEntry = {
  id: string;
  planId: string;
  mealId: string;
  foodId: string;
  foodName: string;
  quantityG: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
  sodiumPer100g: number;
  waterPer100g: number;
  position: number;
  customText: string;
  alternatives: NutritionPlanFoodAlternative[];
  createdAt: string;
  updatedAt: string;
};

export type NutritionPlanVersion = {
  id: string;
  planId: string;
  athleteUsername: string;
  versionNumber: number;
  publishedAt: string;
  driveFileId: string;
  fileName: string;
};

export type AthletePrivateNote = {
  athleteUsername: string;
  notes: string;
  updatedAt: string;
};

export type NutritionMealCompletion = {
  id: string;
  athleteUsername: string;
  date: string;
  planId: string;
  mealId: string;
  completed: boolean;
  updatedAt: string;
};

export type NutritionChangeRequestStatus = "pending" | "approved" | "denied";

export type NutritionChangeRequest = {
  id: string;
  athleteUsername: string;
  athleteName: string;
  planId: string;
  planName: string;
  mealId: string;
  mealName: string;
  entryId: string;
  originalFoodId: string;
  originalFoodName: string;
  originalQuantityG: number;
  requestedFoodId: string;
  requestedFoodName: string;
  requestedQuantityG: number;
  status: NutritionChangeRequestStatus;
  athleteNotes: string;
  adminNotes: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string;
  resolvedBy: string;
};

export type NutritionPlanFull = NutritionPlanSummary & {
  meals: Array<
    NutritionPlanMeal & {
      entries: NutritionPlanFoodEntry[];
    }
  >;
  versions: NutritionPlanVersion[];
};

export type NutritionTotals = {
  proteinG: number;
  carbsG: number;
  fatG: number;
  sodiumMg: number;
  waterG: number;
  caloriesKcal: number;
};
