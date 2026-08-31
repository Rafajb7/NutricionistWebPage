import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  createNutritionChangeRequest,
  getPublishedNutritionPlanSnapshot,
  listNutritionChangeRequests,
  listNutritionManagementData,
} from "@/lib/google/nutrition-management";
import { calculateEntryTotals } from "@/lib/nutrition/calculations";
import { getEffectiveQuantityG } from "@/lib/nutrition/quantity-units";
import { getRestrictionConflict } from "@/lib/nutrition/restrictions";
import { logError, logInfo } from "@/lib/logger";
import type { NutritionChangeRequestType } from "@/lib/nutrition/types";

const requestSchema = z.object({
  requestType: z
    .enum([
      "food_swap",
      "calorie_increase",
      "calorie_decrease",
      "meal_add",
      "meal_remove",
      "meal_redistribution"
    ])
    .optional()
    .default("food_swap"),
  planId: z.string().min(8).max(120),
  mealId: z.string().max(120).optional().default(""),
  entryId: z.string().max(120).optional().default(""),
  requestedFoodId: z.string().max(120).optional().default(""),
  athleteNotes: z.string().max(1000).optional()
});

const GENERAL_REQUEST_LABELS = {
  calorie_increase: "Aumentar ingesta calorica",
  calorie_decrease: "Reducir ingesta calorica",
  meal_add: "Anadir comida/menu",
  meal_remove: "Eliminar comida/menu",
  meal_redistribution: "Redistribuir comida"
} satisfies Record<Exclude<NutritionChangeRequestType, "food_swap">, string>;

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function clampQuantityG(value: number): number {
  if (!Number.isFinite(value)) return 100;
  return Math.min(10000, Math.max(1, Math.round(value)));
}

function getEquivalentQuantityG(input: {
  originalCaloriesKcal: number;
  proteinPer100g: number;
  carbsPer100g: number;
  fatPer100g: number;
}): number {
  const kcalPer100g =
    input.proteinPer100g * 4 + input.carbsPer100g * 4 + input.fatPer100g * 9;
  if (!Number.isFinite(kcalPer100g) || kcalPer100g <= 0) return 100;
  return clampQuantityG((input.originalCaloriesKcal / kcalPer100g) * 100);
}

export async function GET() {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const username = normalizeUsername(auth.session.username);
  try {
    const requests = await listNutritionChangeRequests({ athleteUsername: username });
    return NextResponse.json({ requests });
  } catch (error) {
    logError("Failed to list athlete nutrition change requests", { username, error });
    return NextResponse.json({ error: "Could not load change requests." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const username = normalizeUsername(auth.session.username);

  try {
    const parsed = requestSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const publishedPlan = await getPublishedNutritionPlanSnapshot(parsed.data.planId);
    const plan =
      publishedPlan?.athleteUsername === username && publishedPlan.status === "published"
        ? publishedPlan
        : null;
    if (!plan) {
      return NextResponse.json({ error: "Published plan not found." }, { status: 404 });
    }

    if (parsed.data.requestType !== "food_swap") {
      const meal = parsed.data.mealId
        ? plan.meals.find((item) => item.id === parsed.data.mealId)
        : null;
      if (
        (parsed.data.requestType === "meal_remove" ||
          parsed.data.requestType === "meal_redistribution") &&
        parsed.data.mealId &&
        !meal
      ) {
        return NextResponse.json({ error: "Meal not found." }, { status: 404 });
      }

      const requestSummary = GENERAL_REQUEST_LABELS[parsed.data.requestType];
      const changeRequest = await createNutritionChangeRequest({
        requestType: parsed.data.requestType,
        athleteUsername: username,
        athleteName: auth.session.name,
        planId: plan.id,
        planName: plan.name,
        mealId: meal?.id ?? "",
        mealName: meal?.name ?? "",
        requestSummary,
        athleteNotes: parsed.data.athleteNotes
      });

      logInfo("General nutrition change request created", {
        username,
        requestId: changeRequest.id,
        planId: plan.id,
        requestType: changeRequest.requestType
      });

      return NextResponse.json({ ok: true, request: changeRequest });
    }

    const meal = plan.meals.find((item) => item.id === parsed.data.mealId);
    const entry = meal?.entries.find((item) => item.id === parsed.data.entryId);
    if (!meal || !entry) {
      return NextResponse.json({ error: "Plan food not found." }, { status: 404 });
    }
    if (!parsed.data.requestedFoodId) {
      return NextResponse.json({ error: "Requested food not found." }, { status: 400 });
    }

    const nutrition = await listNutritionManagementData();
    const requestedFood = nutrition.foods.find(
      (food) => food.id === parsed.data.requestedFoodId && food.active
    );
    if (!requestedFood) {
      return NextResponse.json({ error: "Requested food not found." }, { status: 404 });
    }

    const restrictions = nutrition.restrictions.filter(
      (restriction) => restriction.athleteUsername === username
    );
    const conflict = getRestrictionConflict(requestedFood, restrictions);
    if (conflict) {
      return NextResponse.json(
        { error: `Ese alimento no es compatible: ${conflict.label}.` },
        { status: 409 }
      );
    }

    const originalCaloriesKcal = calculateEntryTotals(entry).caloriesKcal;
    const requestedQuantityG = getEquivalentQuantityG({
      originalCaloriesKcal,
      proteinPer100g: requestedFood.proteinPer100g,
      carbsPer100g: requestedFood.carbsPer100g,
      fatPer100g: requestedFood.fatPer100g
    });

    const changeRequest = await createNutritionChangeRequest({
      requestType: "food_swap",
      athleteUsername: username,
      athleteName: auth.session.name,
      planId: plan.id,
      planName: plan.name,
      mealId: meal.id,
      mealName: meal.name,
      entryId: entry.id,
      originalFoodId: entry.foodId,
      originalFoodName: entry.foodName,
      originalQuantityG: getEffectiveQuantityG(entry),
      requestedFoodId: requestedFood.id,
      requestedFoodName: requestedFood.name,
      requestedQuantityG,
      requestSummary: `Cambio de ${entry.foodName} por ${requestedFood.name}`,
      athleteNotes: parsed.data.athleteNotes
    });

    logInfo("Nutrition change request created", {
      username,
      requestId: changeRequest.id,
      planId: plan.id,
      entryId: entry.id
    });

    return NextResponse.json({ ok: true, request: changeRequest });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create change request.";
    logError("Failed to create nutrition change request", { username, error });
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
