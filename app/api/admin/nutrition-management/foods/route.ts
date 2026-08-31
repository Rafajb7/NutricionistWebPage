import { z } from "zod";
import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/require-session";
import {
  createNutritionFood,
  deactivateNutritionFood,
  listNutritionManagementData,
  updateNutritionFood
} from "@/lib/google/nutrition-management";
import {
  nutritionFoodInputSchema,
  nutritionFoodUpdateSchema
} from "@/lib/nutrition/validation";
import { logError, logInfo } from "@/lib/logger";

const deleteFoodSchema = z.object({
  id: z.string().min(8).max(120)
});

export async function GET() {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const data = await listNutritionManagementData();
    return NextResponse.json({ foods: data.foods });
  } catch (error) {
    logError("Failed to load nutrition foods", { username: auth.session.username, error });
    return NextResponse.json({ error: "Could not load foods." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = nutritionFoodInputSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const food = await createNutritionFood(parsed.data);
    logInfo("Nutrition food created", {
      username: auth.session.username,
      foodId: food.id,
      foodName: food.name
    });

    return NextResponse.json({ ok: true, food });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create food.";
    const status = message.includes("already exists") ? 409 : 500;
    logError("Failed to create nutrition food", { username: auth.session.username, error });
    return NextResponse.json({ error: message }, { status });
  }
}

export async function PATCH(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = nutritionFoodUpdateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const food = await updateNutritionFood(parsed.data);
    if (!food) return NextResponse.json({ error: "Food not found." }, { status: 404 });

    logInfo("Nutrition food updated", {
      username: auth.session.username,
      foodId: food.id
    });
    return NextResponse.json({ ok: true, food });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update food.";
    const status = message.includes("already exists") ? 409 : 500;
    logError("Failed to update nutrition food", { username: auth.session.username, error });
    return NextResponse.json({ error: message }, { status });
  }
}

export async function DELETE(req: Request) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  try {
    const parsed = deleteFoodSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const food = await deactivateNutritionFood(parsed.data.id);
    if (!food) return NextResponse.json({ error: "Food not found." }, { status: 404 });

    logInfo("Nutrition food deactivated", {
      username: auth.session.username,
      foodId: food.id
    });
    return NextResponse.json({ ok: true, food });
  } catch (error) {
    logError("Failed to deactivate nutrition food", { username: auth.session.username, error });
    return NextResponse.json({ error: "Could not deactivate food." }, { status: 500 });
  }
}
