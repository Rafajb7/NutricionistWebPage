import { z } from "zod";

const isoDateSchema = z.string().max(80).optional().default("");

const nutritionQuantityGramsSchema = z.preprocess((value) => {
  const parsed = typeof value === "string" ? Number(value.replace(",", ".")) : Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed) : value;
}, z.number().int().min(1).max(10000));

const nutritionFoodRestrictionTagSchema = z.enum([
  "gluten",
  "lactose",
  "milk",
  "egg",
  "fish",
  "crustacean",
  "mollusc",
  "peanut",
  "tree_nut",
  "soy",
  "sesame",
  "celery",
  "mustard",
  "sulphites",
  "lupin",
  "fructose",
  "animal_meat",
  "animal_poultry",
  "animal_pork",
  "animal_fish",
  "animal_seafood",
  "animal_egg",
  "animal_dairy",
  "animal_honey"
]);

const nutritionAthleteRestrictionTypeSchema = z.enum(["allergy", "intolerance", "dislike", "diet"]);

const nutritionAthleteRestrictionKeySchema = z.enum([
  "gluten",
  "lactose",
  "milk",
  "egg",
  "fish",
  "crustacean",
  "mollusc",
  "peanut",
  "tree_nut",
  "soy",
  "sesame",
  "celery",
  "mustard",
  "sulphites",
  "lupin",
  "fructose",
  "animal_meat",
  "animal_poultry",
  "animal_pork",
  "animal_fish",
  "animal_seafood",
  "animal_egg",
  "animal_dairy",
  "animal_honey",
  "diet_vegan",
  "diet_vegetarian",
  "diet_no_pork",
  "food_dislike"
]);

export const nutritionFoodInputSchema = z.object({
  name: z.string().min(1).max(160),
  category: z.string().max(120).optional().default(""),
  proteinPer100g: z.coerce.number().min(0).max(200),
  carbsPer100g: z.coerce.number().min(0).max(200),
  fatPer100g: z.coerce.number().min(0).max(200),
  sodiumPer100g: z.coerce.number().min(0).max(100000),
  waterPer100g: z.coerce.number().min(0).max(100),
  restrictionTags: z.array(nutritionFoodRestrictionTagSchema).max(40).optional().default([])
});

export const nutritionFoodUpdateSchema = nutritionFoodInputSchema
  .partial()
  .extend({
    id: z.string().min(8).max(120),
    active: z.boolean().optional()
  })
  .refine((value) => Object.keys(value).some((key) => key !== "id"), {
    message: "At least one field must be updated."
  });

export const nutritionAthleteRestrictionCreateSchema = z
  .object({
    athleteUsername: z.string().min(1).max(120),
    type: nutritionAthleteRestrictionTypeSchema,
    key: nutritionAthleteRestrictionKeySchema.optional().default("food_dislike"),
    foodId: z.string().max(120).optional().default(""),
    notes: z.string().max(300).optional().default("")
  })
  .refine((value) => value.type !== "dislike" || Boolean(value.foodId), {
    message: "Food id is required for dislikes."
  })
  .refine((value) => value.type === "dislike" || value.key !== "food_dislike", {
    message: "Restriction key is required."
  });

export const nutritionAthleteRestrictionDeleteSchema = z.object({
  id: z.string().min(1).max(120)
});

const nutritionPlanVersionSchema = z.object({
  id: z.string().min(1).max(120),
  planId: z.string().min(1).max(120),
  athleteUsername: z.string().max(120),
  versionNumber: z.coerce.number().int().min(0).max(10000),
  publishedAt: z.string().max(80),
  driveFileId: z.string().max(160),
  fileName: z.string().max(180)
});

const nutritionPlanAlternativeSchema = z.object({
  id: z.string().max(120).optional().default(""),
  entryId: z.string().max(120).optional().default(""),
  foodId: z.string().max(120).optional().default(""),
  foodName: z.string().min(1).max(160),
  quantityG: nutritionQuantityGramsSchema,
  proteinPer100g: z.coerce.number().min(0).max(200),
  carbsPer100g: z.coerce.number().min(0).max(200),
  fatPer100g: z.coerce.number().min(0).max(200),
  sodiumPer100g: z.coerce.number().min(0).max(100000),
  waterPer100g: z.coerce.number().min(0).max(100),
  position: z.coerce.number().int().min(0).max(1000).optional().default(0),
  customText: z.string().max(240).optional().default(""),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

const nutritionPlanEntrySchema = z.object({
  id: z.string().max(120).optional().default(""),
  planId: z.string().max(120).optional().default(""),
  mealId: z.string().max(120).optional().default(""),
  foodId: z.string().max(120).optional().default(""),
  foodName: z.string().min(1).max(160),
  quantityG: nutritionQuantityGramsSchema,
  proteinPer100g: z.coerce.number().min(0).max(200),
  carbsPer100g: z.coerce.number().min(0).max(200),
  fatPer100g: z.coerce.number().min(0).max(200),
  sodiumPer100g: z.coerce.number().min(0).max(100000),
  waterPer100g: z.coerce.number().min(0).max(100),
  position: z.coerce.number().int().min(0).max(1000).optional().default(0),
  customText: z.string().max(240).optional().default(""),
  alternatives: z.array(nutritionPlanAlternativeSchema).max(20).optional().default([]),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema
});

const nutritionPlanMealSchema = z.object({
  id: z.string().max(120).optional().default(""),
  planId: z.string().max(120).optional().default(""),
  name: z.string().min(1).max(120),
  position: z.coerce.number().int().min(0).max(1000).optional().default(0),
  notes: z.string().max(1000).optional().default(""),
  included: z.boolean().optional().default(true),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  entries: z.array(nutritionPlanEntrySchema).max(120).default([])
});

export const nutritionPlanSaveSchema = z.object({
  id: z.string().min(8).max(120),
  athleteUsername: z.string().min(1).max(120),
  athleteName: z.string().max(160),
  name: z.string().min(1).max(120),
  status: z.enum(["draft", "review", "published"]),
  targetProteinG: z.coerce.number().min(0).max(2000),
  targetCarbsG: z.coerce.number().min(0).max(3000),
  targetFatG: z.coerce.number().min(0).max(1000),
  notes: z.string().max(3000).optional().default(""),
  createdAt: isoDateSchema,
  updatedAt: isoDateSchema,
  publishedAt: z.string().max(80).optional().default(""),
  publishedFileId: z.string().max(160).optional().default(""),
  versionNumber: z.coerce.number().int().min(0).max(10000).optional().default(0),
  meals: z.array(nutritionPlanMealSchema).min(1).max(40),
  versions: z.array(nutritionPlanVersionSchema).optional().default([])
});
