import { z } from "zod";
import { NextRequest, NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/require-session";
import {
  listInteractiveNutritionDataForAthlete,
  listNutritionPlansForAthlete,
  upsertNutritionMealCompletion
} from "@/lib/google/nutrition-management";
import { logError, logInfo } from "@/lib/logger";

const DATE_ONLY_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const completionSchema = z.object({
  date: z.string().regex(DATE_ONLY_REGEX),
  planId: z.string().min(8).max(120),
  mealId: z.string().min(8).max(120),
  completed: z.boolean()
});

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function toLocalDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export async function GET(req: NextRequest) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const username = normalizeUsername(auth.session.username);
  const requestedDate = req.nextUrl.searchParams.get("date") ?? "";
  const date = DATE_ONLY_REGEX.test(requestedDate) ? requestedDate : toLocalDateOnly(new Date());

  try {
    const nutrition = await listInteractiveNutritionDataForAthlete(username, { date });

    const publishedPlans = nutrition.plans.filter(
      (plan) => plan.status === "published" || Boolean(plan.publishedFileId)
    );

    return NextResponse.json({
      date,
      plans: publishedPlans,
      restrictions: nutrition.restrictions,
      foods: nutrition.foods.filter((food) => food.active),
      completions: nutrition.completions,
      changeRequests: nutrition.changeRequests
    });
  } catch (error) {
    logError("Failed to load interactive nutrition plan", { username, error });
    return NextResponse.json({ error: "Could not load nutrition plan." }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireSession();
  if (!auth.session) return auth.response;

  const username = normalizeUsername(auth.session.username);

  try {
    const parsed = completionSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const plans = await listNutritionPlansForAthlete(username);
    const plan = plans.find(
      (item) =>
        item.id === parsed.data.planId &&
        (item.status === "published" || Boolean(item.publishedFileId))
    );
    const meal = plan?.meals.find((item) => item.id === parsed.data.mealId);
    if (!plan || !meal) {
      return NextResponse.json({ error: "Plan or meal not found." }, { status: 404 });
    }

    const completion = await upsertNutritionMealCompletion({
      athleteUsername: username,
      date: parsed.data.date,
      planId: parsed.data.planId,
      mealId: parsed.data.mealId,
      completed: parsed.data.completed
    });

    logInfo("Interactive nutrition meal completion saved", {
      username,
      date: parsed.data.date,
      planId: parsed.data.planId,
      mealId: parsed.data.mealId,
      completed: parsed.data.completed
    });

    return NextResponse.json({ ok: true, completion });
  } catch (error) {
    logError("Failed to save interactive nutrition meal completion", { username, error });
    return NextResponse.json({ error: "Could not save meal completion." }, { status: 500 });
  }
}
