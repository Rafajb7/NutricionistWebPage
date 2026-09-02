import { z } from "zod";
import { NextResponse } from "next/server";
import { deleteMemoryCache } from "@/lib/cache/memory-cache";
import { requireAdminSession } from "@/lib/auth/require-session";
import { upsertNutritionPlanPdfForUser } from "@/lib/google/drive";
import {
  buildNutritionPlanPdfFileName,
  getNutritionPlanById,
  listNutritionChangeRequests,
  listNutritionManagementData,
  markNutritionPlanPublished,
  resolveNutritionChangeRequest,
  saveNutritionPlan
} from "@/lib/google/nutrition-management";
import { logError, logInfo } from "@/lib/logger";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import { getNutritionPdfSupportingData } from "@/lib/nutrition/pdf-supporting-data";
import {
  getDefaultQuantityUnitForFood,
  getDefaultUnitWeightGForFood
} from "@/lib/nutrition/quantity-units";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";
import type {
  NutritionChangeRequest,
  NutritionFood,
  NutritionPlanFull
} from "@/lib/nutrition/types";

type RouteContext = {
  params: Promise<{
    requestId: string;
  }>;
};

export const runtime = "nodejs";
export const maxDuration = 60;

const resolveSchema = z.object({
  status: z.enum(["approved", "denied"]),
  adminNotes: z.string().max(1000).optional(),
  plan: nutritionPlanSaveSchema.optional()
});

function isValidId(value: string): boolean {
  return /^[A-Za-z0-9_-]{8,}$/.test(value);
}

function normalizeQuantity(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(10000, Math.max(1, Math.round(value)));
}

function applyChangeRequestToPlan(
  plan: NutritionPlanFull,
  request: NutritionChangeRequest,
  requestedFood: NutritionFood
): NutritionPlanFull {
  const now = new Date().toISOString();
  const quantityUnit = getDefaultQuantityUnitForFood(requestedFood);
  const unitWeightG = getDefaultUnitWeightGForFood(requestedFood, quantityUnit);
  const quantityG =
    quantityUnit === "g"
      ? normalizeQuantity(request.requestedQuantityG)
      : normalizeQuantity(request.requestedQuantityG / unitWeightG);

  return {
    ...plan,
    status: "review",
    meals: plan.meals.map((meal) => ({
      ...meal,
      entries: meal.entries.map((entry) => {
        if (meal.id !== request.mealId || entry.id !== request.entryId) return entry;
        return {
          ...entry,
          foodId: requestedFood.id,
          foodName: requestedFood.name,
          quantityG,
          quantityUnit,
          unitWeightG,
          proteinPer100g: requestedFood.proteinPer100g,
          carbsPer100g: requestedFood.carbsPer100g,
          fatPer100g: requestedFood.fatPer100g,
          sodiumPer100g: requestedFood.sodiumPer100g,
          waterPer100g: requestedFood.waterPer100g,
          updatedAt: now
        };
      })
    }))
  };
}

async function publishPlanPdf(plan: NutritionPlanFull) {
  const { comparisonPlans, roadmapSteps } = await getNutritionPdfSupportingData(plan, {
    planId: plan.id,
    action: "change-request-publish"
  });
  const pdf = await renderNutritionPlanPdf(plan, { comparisonPlans, roadmapSteps });
  const fileName = buildNutritionPlanPdfFileName(plan);
  const uploaded = await upsertNutritionPlanPdfForUser({
    username: plan.athleteUsername,
    originalFileName: fileName,
    mimeType: "application/pdf",
    buffer: pdf,
    existingFileId: plan.publishedFileId || null
  });

  const published = await markNutritionPlanPublished({
    planId: plan.id,
    driveFileId: uploaded.id,
    fileName: uploaded.name,
    snapshot: plan
  });
  if (!published) throw new Error("Published nutrition plan was not found after uploading PDF.");
  deleteMemoryCache(`nutrition-plans:${plan.athleteUsername.toLowerCase()}`);
  return { published, file: uploaded };
}

export async function PATCH(req: Request, context: RouteContext) {
  const auth = await requireAdminSession();
  if (!auth.session) return auth.response;

  const { requestId } = await context.params;
  if (!isValidId(requestId)) {
    return NextResponse.json({ error: "Invalid request id." }, { status: 400 });
  }

  try {
    const parsed = resolveSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid payload." }, { status: 400 });
    }

    const currentRequest = (await listNutritionChangeRequests({ force: true })).find(
      (item) => item.id === requestId
    );
    if (!currentRequest) {
      return NextResponse.json({ error: "Change request not found." }, { status: 404 });
    }
    if (currentRequest.status !== "pending") {
      return NextResponse.json({ error: "Change request already resolved." }, { status: 409 });
    }

    if (parsed.data.status === "denied") {
      const request = await resolveNutritionChangeRequest({
        requestId,
        status: "denied",
        adminNotes: parsed.data.adminNotes,
        resolvedBy: auth.session.username
      });
      return NextResponse.json({ ok: true, request });
    }

    let planToSave = parsed.data.plan ? (parsed.data.plan as NutritionPlanFull) : null;
    if (planToSave && planToSave.id !== currentRequest.planId) {
      return NextResponse.json({ error: "Plan does not match request." }, { status: 400 });
    }

    if (!planToSave && currentRequest.requestType !== "food_swap") {
      return NextResponse.json(
        { error: "Open the plan, apply the requested adjustments and publish again." },
        { status: 400 }
      );
    }

    if (!planToSave) {
      const [plan, nutrition] = await Promise.all([
        getNutritionPlanById(currentRequest.planId),
        listNutritionManagementData()
      ]);
      const requestedFood = nutrition.foods.find((food) => food.id === currentRequest.requestedFoodId);
      if (!plan || !requestedFood) {
        return NextResponse.json({ error: "Plan or requested food not found." }, { status: 404 });
      }
      planToSave = applyChangeRequestToPlan(plan, currentRequest, requestedFood);
    }

    const saved = await saveNutritionPlan(planToSave);
    if (!saved) return NextResponse.json({ error: "Plan not found." }, { status: 404 });
    const { published, file } = await publishPlanPdf(saved);
    const request = await resolveNutritionChangeRequest({
      requestId,
      status: "approved",
      adminNotes: parsed.data.adminNotes,
      resolvedBy: auth.session.username
    });

    logInfo("Nutrition change request approved and published", {
      username: auth.session.username,
      requestId,
      planId: published.id,
      fileId: file.id
    });

    return NextResponse.json({ ok: true, request, plan: published, file });
  } catch (error) {
    logError("Failed to resolve nutrition change request", {
      username: auth.session.username,
      requestId,
      error
    });
    return NextResponse.json({ error: "Could not resolve change request." }, { status: 500 });
  }
}
