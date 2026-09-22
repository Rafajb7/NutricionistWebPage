import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getPlan: vi.fn(),
  getPublishedPlan: vi.fn(),
  listPlans: vi.fn(),
  getRoadmap: vi.fn(),
  render: vi.fn(),
  upload: vi.fn(),
  serializeSnapshot: vi.fn(),
  markPublished: vi.fn()
}));

vi.mock("@/lib/auth/require-session", () => ({ requireAdminSession: mocks.auth }));
vi.mock("@/lib/google/nutrition-management", () => ({
  getNutritionPlanById: mocks.getPlan,
  getPublishedNutritionPlanSnapshot: mocks.getPublishedPlan,
  listNutritionPlansForAthlete: mocks.listPlans,
  getAthleteRoadmapSteps: mocks.getRoadmap,
  buildNutritionPlanPdfFileName: () => "plan.pdf",
  markNutritionPlanPublished: mocks.markPublished,
  serializeNutritionPlanSnapshot: mocks.serializeSnapshot,
  NutritionPlanSnapshotTooLargeError: class extends Error {}
}));
vi.mock("@/lib/google/drive", () => ({ upsertNutritionPlanPdfForUser: mocks.upload }));
vi.mock("@/lib/nutrition/pdf", () => ({ renderNutritionPlanPdf: mocks.render }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { POST as preview } from "@/app/api/admin/nutrition-management/plans/[planId]/pdf/route";
import { POST as publish } from "@/app/api/admin/nutrition-management/plans/[planId]/publish/route";
import { getNutritionPdfSupportingData } from "@/lib/nutrition/pdf-supporting-data";
import { NutritionPlanSnapshotTooLargeError } from "@/lib/google/nutrition-management";

const plan = nutritionPlanSaveSchema.parse({
  id: "plan-test", athleteUsername: "athlete", athleteName: "Atleta", name: "Borrador sin guardar",
  status: "review", targetProteinG: 100, targetCarbsG: 200, targetFatG: 60,
  meals: [{ id: "meal", name: "Desayuno", entries: [{
    foodName: "Aguacate", quantityG: 0.5, quantityUnit: "piece", unitWeightG: 200,
    proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15, sodiumPer100g: 7, waterPer100g: 73
  }] }]
});
const context = { params: Promise.resolve({ planId: plan.id }) };
const publishedPlan = { ...plan, name: "Plan publicado", status: "published" as const };

function request(body: unknown) {
  return new Request(`https://example.com/api/admin/nutrition-management/plans/${plan.id}/pdf`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ session: { username: "nutritionist", permission: "admin" }, response: null });
  mocks.getPlan.mockResolvedValue(plan);
  mocks.getPublishedPlan.mockResolvedValue(publishedPlan);
  mocks.listPlans.mockResolvedValue([]);
  mocks.getRoadmap.mockResolvedValue([]);
  mocks.render.mockResolvedValue(Buffer.from("%PDF-1.7"));
  mocks.upload.mockResolvedValue({ id: "file-id", name: "plan.pdf" });
  mocks.markPublished.mockResolvedValue(publishedPlan);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("nutrition PDF review route", () => {
  it("renders the unsaved editor contents without fetching the primary plan", async () => {
    mocks.getPlan.mockRejectedValue(new Error("Storage unavailable"));
    const response = await preview(request({ mode: "review", plan, includeMacros: false }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/pdf");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(response.headers.get("X-Nutrition-Pdf-Partial")).toBe("false");
    expect(await response.text()).toBe("%PDF-1.7");
    expect(mocks.getPlan).not.toHaveBeenCalled();
    expect(mocks.getPublishedPlan).not.toHaveBeenCalled();
    expect(mocks.render).toHaveBeenCalledWith(plan, {
      includeMacros: false, comparisonPlans: [plan], roadmapSteps: []
    });
  });

  it("downloads the draft even when optional Google reads hit the quota", async () => {
    mocks.listPlans.mockRejectedValue({ code: 429 });
    mocks.getRoadmap.mockRejectedValue({ code: 429 });
    const response = await preview(request({ plan }), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Nutrition-Pdf-Partial")).toBe("true");
    expect(mocks.getPlan).not.toHaveBeenCalled();
    expect(mocks.render).toHaveBeenCalledWith(plan, {
      includeMacros: true, comparisonPlans: [plan], roadmapSteps: []
    });
  });

  it.each([
    { ...plan, id: "other-id" },
    { ...plan, status: "published" },
    { ...plan, meals: [] },
    { ...plan, targetProteinG: -1 }
  ])("rejects invalid or mismatched submitted drafts", async (invalidPlan) => {
    const response = await preview(request({ plan: invalidPlan }), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PLAN" });
    expect(mocks.getPlan).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON without loading or rendering a plan", async () => {
    const malformed = new Request("https://example.com/pdf", { method: "POST", body: "{" });
    const response = await preview(malformed, context);
    expect(response.status).toBe(400);
    expect(mocks.getPlan).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("requires an administrator session before accepting submitted data", async () => {
    mocks.auth.mockResolvedValue({ session: null, response: new Response(null, { status: 401 }) });
    const response = await preview(request({ plan }), context);
    expect(response.status).toBe(401);
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("rejects invalid URL identifiers", async () => {
    const response = await preview(request({ plan }), { params: Promise.resolve({ planId: "../plan" }) });
    expect(response.status).toBe(400);
    expect(mocks.getPlan).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it("retains support for loading a saved review when no plan was submitted", async () => {
    const response = await preview(request({}), context);
    expect(response.status).toBe(200);
    expect(mocks.getPlan).toHaveBeenCalledWith(plan.id);
  });

  it("loads only the persisted snapshot for published mode", async () => {
    const response = await preview(request({ mode: "published" }), context);
    expect(response.status).toBe(200);
    expect(mocks.getPublishedPlan).toHaveBeenCalledWith(plan.id);
    expect(mocks.getPlan).not.toHaveBeenCalled();
    expect(mocks.render).toHaveBeenCalledWith(publishedPlan, expect.any(Object));
  });

  it("does not substitute client contents for a published plan", async () => {
    const response = await preview(request({ mode: "published", plan }), context);
    expect(response.status).toBe(400);
    expect(mocks.getPublishedPlan).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each([null, plan])("never falls back to a review when a published snapshot is absent", async (snapshot) => {
    mocks.getPublishedPlan.mockResolvedValue(snapshot);
    const response = await preview(request({ mode: "published" }), context);
    expect(response.status).toBe(404);
    expect(mocks.getPlan).not.toHaveBeenCalled();
    expect(mocks.render).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 429 }, 429, "GOOGLE_RATE_LIMIT"],
    [{ code: 503 }, 503, "GOOGLE_UNAVAILABLE"],
    [new Error("Invalid PDF font"), 500, "PDF_GENERATION_FAILED"]
  ])("distinguishes Google failures from PDF generation errors", async (error, status, code) => {
    mocks.render.mockRejectedValue(error);
    const response = await preview(request({ plan }), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });
});

describe("nutrition PDF optional data", () => {
  it("bounds stalled Google reads and preserves sections that are available", async () => {
    vi.useFakeTimers();
    mocks.listPlans.mockImplementation(() => new Promise(() => {}));
    const roadmap = [{ id: "step", title: "Objetivo" }];
    mocks.getRoadmap.mockResolvedValue(roadmap);

    const result = getNutritionPdfSupportingData(plan);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await result).toEqual({ comparisonPlans: [plan], roadmapSteps: roadmap, partial: true });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears deadlines when all Google reads finish normally", async () => {
    vi.useFakeTimers();
    mocks.listPlans.mockResolvedValue([publishedPlan]);
    expect(await getNutritionPdfSupportingData(plan)).toEqual({
      comparisonPlans: [publishedPlan], roadmapSteps: [], partial: false
    });
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("nutrition PDF publication", () => {
  it("checks snapshot size before changing any Drive file", async () => {
    mocks.serializeSnapshot.mockImplementation(() => { throw new NutritionPlanSnapshotTooLargeError(); });
    const response = await publish(request({}), context);
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({ code: "PLAN_TOO_LARGE" });
    expect(mocks.render).not.toHaveBeenCalled();
    expect(mocks.upload).not.toHaveBeenCalled();
    expect(mocks.markPublished).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: 429 }, 429, "GOOGLE_RATE_LIMIT"],
    [{ code: 503 }, 503, "GOOGLE_UNAVAILABLE"],
    [new Error("Cannot upload"), 500, "PDF_PUBLISH_FAILED"]
  ])("identifies publication failures instead of a generic PDF error", async (error, status, code) => {
    mocks.upload.mockRejectedValue(error);
    const response = await publish(request({ includeMacros: true }), context);
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
    expect(mocks.markPublished).not.toHaveBeenCalled();
  });

  it("reports unavailable optional data when publishing succeeds", async () => {
    mocks.getRoadmap.mockRejectedValue({ code: 429 });
    const response = await publish(request({}), context);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, partial: true });
  });
});
