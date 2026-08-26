import { z } from "zod";
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  createNutritionChangeRequest,
  listNutritionChangeRequests,
  listNutritionManagementData,
  listNutritionPlansForAthlete
} from "@/lib/google/nutrition-management";
import { calculateEntryTotals } from "@/lib/nutrition/calculations";
import { getRestrictionConflict } from "@/lib/nutrition/restrictions";
import { logError, logInfo } from "@/lib/logger";

const requestSchema = z.object({
  planId: z.string().min(8).max(120),
  mealId: z.string().min(8).max(120),
  entryId: z.string().min(8).max(120),
  requestedFoodId: z.string().min(2).max(120),
  athleteNotes: z.string().max(1000).optional()
});

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

    const [plans, nutrition] = await Promise.all([
      listNutritionPlansForAthlete(username),
      listNutritionManagementData()
    ]);
    const plan = plans.find(
      (item) =>
        item.id === parsed.data.planId &&
        (item.status === "published" || Boolean(item.publishedFileId))
    );
    const meal = plan?.meals.find((item) => item.id === parsed.data.mealId);
    const entry = meal?.entries.find((item) => item.id === parsed.data.entryId);
    if (!plan || !meal || !entry) {
      return NextResponse.json({ error: "Plan food not found." }, { status: 404 });
    }

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
      athleteUsername: username,
      athleteName: auth.session.name,
      planId: plan.id,
      planName: plan.name,
      mealId: meal.id,
      mealName: meal.name,
      entryId: entry.id,
      originalFoodId: entry.foodId,
      originalFoodName: entry.foodName,
      originalQuantityG: entry.quantityG,
      requestedFoodId: requestedFood.id,
      requestedFoodName: requestedFood.name,
      requestedQuantityG,
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
