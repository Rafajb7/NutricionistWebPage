import { randomBytes } from "node:crypto";
import type { sheets_v4 } from "googleapis";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  batchGet: vi.fn(),
  headerWrite: vi.fn(),
  append: vi.fn(),
  write: vi.fn()
}));

vi.mock("googleapis", () => ({ google: { sheets: () => ({ spreadsheets: {
  get: mocks.get,
  batchUpdate: mocks.write,
  values: { batchGet: mocks.batchGet, batchUpdate: mocks.headerWrite, append: mocks.append }
} }) } }));
vi.mock("@/lib/google/auth", () => ({ getGoogleAuth: () => ({}) }));
vi.mock("@/lib/env", () => ({ getEnv: () => ({
  GOOGLE_NUTRITION_MANAGEMENT_SPREADSHEET_ID: "nutrition-test-spreadsheet"
}) }));

const titles = ["Foods", "Plans", "Meals", "PlanFoods", "PlanVersions", "AthleteRestrictions",
  "AthletePrivateNotes", "AthleteRoadmapSteps", "MealCompletions", "ChangeRequests"];
type SheetRows = Record<string, Array<Array<string | number>>>;
type WriteRequest = { requestBody: sheets_v4.Schema$BatchUpdateSpreadsheetRequest };
let rows: SheetRows;

function planInput() {
  return nutritionPlanSaveSchema.parse({
    id: "plan-test", athleteUsername: "athlete", athleteName: "Athlete", name: "Edited plan",
    status: "review", targetProteinG: 100, targetCarbsG: 150, targetFatG: 60,
    meals: [{
      id: "meal-keep", name: "Lunch", entries: [{
        id: "entry-new", foodName: "Avocado", quantityG: 0.5, quantityUnit: "piece", unitWeightG: 200,
        proteinPer100g: 2, carbsPer100g: 10, fatPer100g: 15, sodiumPer100g: 0, waterPer100g: 0
      }]
    }, { id: "meal-new", name: "Dinner", entries: [] }]
  });
}

function doubleAlternativePlan() {
  const plan = planInput();
  plan.meals[0].entries[0].alternatives = [{
    ...plan.meals[0].entries[0], id: "alternative-double", entryId: "entry-new",
    foodId: "rice", foodName: "Arroz blanco", quantityG: 100, quantityUnit: "g", unitWeightG: 1,
    proteinPer100g: 3, carbsPer100g: 28, fatPer100g: 0,
    secondComponent: {
      foodId: "legumes", foodName: "Lentejas", quantityG: 0.75, quantityUnit: "piece", unitWeightG: 150,
      proteinPer100g: 9, carbsPer100g: 20, fatPer100g: 0.4, fiberPer100g: 8,
      sodiumPer100g: 2, waterPer100g: 70, customText: "Cocidas"
    }
  }];
  return nutritionPlanSaveSchema.parse(plan);
}

function applyWrite(request: WriteRequest) {
  const next = structuredClone(rows);
  for (const change of request.requestBody.requests ?? []) {
    const update = change.updateCells;
    const append = change.appendCells;
    const sheetId = update?.range?.sheetId ?? append?.sheetId;
    if (sheetId === null || sheetId === undefined) throw new Error("Missing sheet id");
    const title = titles[sheetId];
    const decode = (row: sheets_v4.Schema$RowData) => (row.values ?? []).map((cell) =>
      cell.userEnteredValue?.numberValue ?? cell.userEnteredValue?.stringValue ?? ""
    );
    if (update?.range) {
      next[title][(update.range.startRowIndex ?? 1) - 1] = update.rows?.[0] ? decode(update.rows[0]) : [];
    } else if (append) {
      next[title].push(...(append.rows ?? []).map(decode));
    }
  }
  rows = next;
  return { data: {} };
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  rows = Object.fromEntries(titles.map((title) => [title, []]));
  rows.Plans = [["plan-test", "athlete", "Athlete", "Original", "review", 0, 0, 0, "", "created", "previous", "", "", 0, "", "", 0]];
  rows.Meals = [
    ["meal-keep", "plan-test", "Original lunch", 1, "", "TRUE", "created", "previous"],
    ["meal-remove", "plan-test", "Removed meal", 2, "", "TRUE", "created", "previous"],
    ["meal-other", "other-plan", "Do not change", 1, "", "TRUE", "created", "previous"]
  ];
  rows.PlanFoods = [["entry-remove", "plan-test", "meal-remove", "", "Old food", 100]];
  mocks.get.mockResolvedValue({ data: { sheets: titles.map((title, sheetId) => ({ properties: { title, sheetId } })) } });
  mocks.batchGet.mockImplementation(async ({ ranges }: { ranges: string[] }) => ({ data: {
    valueRanges: ranges.map((range) => ({
      values: range.includes("!A1:") ? [] : structuredClone(rows[range.split("'")[1]])
    }))
  } }));
  mocks.headerWrite.mockResolvedValue({ data: {} });
  mocks.append.mockImplementation(async ({ range, requestBody }: {
    range: string; requestBody: { values: Array<Array<string | number>> }
  }) => {
    rows[range.split("'")[1]].push(...structuredClone(requestBody.values));
    return { data: {} };
  });
  mocks.write.mockImplementation(async (request: WriteRequest) => applyWrite(request));
});

afterEach(() => { vi.useRealTimers(); });

describe("nutrition plan persistence", () => {
  it("round-trips both alternative components through Sheets and normalizes each quantity", async () => {
    const { saveNutritionPlan, getNutritionPlanById } = await import("@/lib/google/nutrition-management");
    const plan = doubleAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.secondComponent!.foodName = "  Lentejas  ";
    alternative.secondComponent!.customText = "  Cocidas  ";
    const saved = await saveNutritionPlan(plan);
    const savedAlternative = saved!.meals[0].entries[0].alternatives[0];
    expect(savedAlternative.secondComponent).toEqual({
      ...alternative.secondComponent, foodName: "Lentejas", customText: "Cocidas"
    });
    const encoded = rows.PlanFoods.find((row) => row[0] === "entry-new")![15] as string;
    expect(JSON.parse(encoded)[0].secondComponent).toEqual(savedAlternative.secondComponent);
    const reloaded = await getNutritionPlanById("plan-test");
    expect(reloaded?.meals[0].entries[0].alternatives).toEqual(saved!.meals[0].entries[0].alternatives);
  });

  it("keeps both components when duplicating a saved plan and assigns fresh alternative identities", async () => {
    const { saveNutritionPlan, duplicateNutritionPlan, getNutritionPlanById } = await import("@/lib/google/nutrition-management");
    const original = await saveNutritionPlan(doubleAlternativePlan());
    const copy = await duplicateNutritionPlan("plan-test");
    const originalAlternative = original!.meals[0].entries[0].alternatives[0];
    const copiedEntry = copy!.meals[0].entries[0];
    expect(copiedEntry.alternatives[0].id).not.toBe(originalAlternative.id);
    expect(copiedEntry.alternatives[0].entryId).toBe(copiedEntry.id);
    expect(copiedEntry.alternatives[0].secondComponent).toEqual(originalAlternative.secondComponent);
    expect(copiedEntry.alternatives[0].secondComponent).not.toBe(originalAlternative.secondComponent);
    expect((await getNutritionPlanById(copy!.id))?.meals[0].entries[0].alternatives)
      .toEqual(copiedEntry.alternatives);
  });

  it("compresses large sets of double alternatives to stay below the Sheets cell limit", async () => {
    const { saveNutritionPlan, getNutritionPlanById } = await import("@/lib/google/nutrition-management");
    const plan = doubleAlternativePlan();
    const base = plan.meals[0].entries[0].alternatives[0];
    plan.meals[0].entries[0].alternatives = Array.from({ length: 20 }, (_, index) => ({
      ...base, id: `alternative-${index}`, position: index + 1,
      // Valid JSON strings may expand considerably when escaped for a Sheets cell.
      customText: "\u0001".repeat(240),
      secondComponent: { ...base.secondComponent!, customText: "\u0002".repeat(240) }
    }));
    expect(nutritionPlanSaveSchema.safeParse(plan).success).toBe(true);
    const saved = await saveNutritionPlan(plan);
    const encoded = rows.PlanFoods.find((row) => row[0] === "entry-new")![15] as string;
    expect(encoded.startsWith("gzip:v1:")).toBe(true);
    expect(encoded.length).toBeLessThan(50_000);
    expect((await getNutritionPlanById("plan-test"))?.meals).toEqual(saved!.meals);
  });

  it("saves summary, meals, foods and removals together without moving other plans' rows", async () => {
    const { saveNutritionPlan, getNutritionPlanById } = await import("@/lib/google/nutrition-management");
    const otherMeal = structuredClone(rows.Meals[2]);
    expect((await getNutritionPlanById("plan-test"))?.name).toBe("Original");
    const saved = await saveNutritionPlan(planInput());

    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls[0][1]).toEqual({ retry: false });
    expect(rows.Plans[0][3]).toBe("Edited plan");
    expect(rows.Meals[1]).toEqual([]);
    expect(rows.Meals[2]).toEqual(otherMeal);
    expect(rows.PlanFoods[0]).toEqual([]);
    expect(rows.PlanFoods.filter((row) => row[0] === "entry-new")).toHaveLength(1);
    expect(saved?.meals[0].entries[0].quantityG).toBe(0.5);
    expect(saved?.meals.map((meal) => meal.id)).toEqual(["meal-keep", "meal-new"]);
    const reloaded = await getNutritionPlanById("plan-test");
    expect(reloaded?.name).toBe("Edited plan");
    expect(reloaded?.meals).toEqual(saved?.meals);
  });

  it("does not update only the plan header when Google rejects the transaction", async () => {
    const { saveNutritionPlan } = await import("@/lib/google/nutrition-management");
    const before = structuredClone(rows);
    mocks.write.mockRejectedValueOnce({ response: { status: 403 }, message: "Forbidden" });
    await expect(saveNutritionPlan(planInput())).rejects.toMatchObject({ response: { status: 403 } });
    expect(rows).toEqual(before);
    expect(mocks.write).toHaveBeenCalledTimes(1);
  });

  it("reconciles an already-committed timeout without duplicating appended meals or foods", async () => {
    vi.useFakeTimers();
    const { saveNutritionPlan } = await import("@/lib/google/nutrition-management");
    mocks.write.mockImplementationOnce(async (request: WriteRequest) => {
      applyWrite(request);
      throw { response: { status: 503 } };
    });
    const saving = saveNutritionPlan(planInput());
    await vi.runAllTimersAsync();
    await expect(saving).resolves.not.toBeNull();
    expect(mocks.write).toHaveBeenCalledTimes(2);
    expect(rows.Meals.filter((row) => row[0] === "meal-new")).toHaveLength(1);
    expect(rows.PlanFoods.filter((row) => row[0] === "entry-new")).toHaveLength(1);
    expect(mocks.write.mock.calls[1][0].requestBody.requests.every((request: sheets_v4.Schema$Request) => !request.appendCells)).toBe(true);
  });

  it("atomically publishes the plan and its snapshot while keeping earlier versions", async () => {
    const { markNutritionPlanPublished, getNutritionPlanById, getPublishedNutritionPlanSnapshot } = await import("@/lib/google/nutrition-management");
    rows.PlanVersions = [["old-version", "plan-test", "athlete", 0, "old-date", "old-file", "old.pdf", JSON.stringify(planInput())]];
    const oldVersion = structuredClone(rows.PlanVersions[0]);
    const published = await markNutritionPlanPublished({
      planId: "plan-test", driveFileId: "new-file", fileName: "new.pdf", snapshot: planInput()
    });
    expect(mocks.write).toHaveBeenCalledTimes(1);
    expect(rows.PlanVersions[0]).toEqual(oldVersion);
    expect(rows.PlanVersions).toHaveLength(2);
    expect(rows.Plans[0][4]).toBe("published");
    expect(published?.versions).toHaveLength(2);
    expect(published?.publishedFileId).toBe("new-file");
    expect(await getNutritionPlanById("plan-test")).toEqual(published);
    expect((await getPublishedNutritionPlanSnapshot("plan-test"))?.meals).toEqual(planInput().meals);
  });

  it("keeps the previous publication intact when its snapshot transaction fails", async () => {
    const { markNutritionPlanPublished } = await import("@/lib/google/nutrition-management");
    const before = structuredClone(rows);
    mocks.write.mockRejectedValueOnce({ response: { status: 400 } });
    await expect(markNutritionPlanPublished({
      planId: "plan-test", driveFileId: "new-file", fileName: "new.pdf", snapshot: planInput()
    })).rejects.toMatchObject({ response: { status: 400 } });
    expect(rows).toEqual(before);
  });

  it("does not duplicate a published version when Google commits then times out", async () => {
    vi.useFakeTimers();
    const { markNutritionPlanPublished } = await import("@/lib/google/nutrition-management");
    mocks.write.mockImplementationOnce(async (request: WriteRequest) => {
      applyWrite(request);
      throw { response: { status: 504 } };
    });
    const publishing = markNutritionPlanPublished({
      planId: "plan-test", driveFileId: "new-file", fileName: "new.pdf", snapshot: planInput()
    });
    await vi.runAllTimersAsync();
    await expect(publishing).resolves.not.toBeNull();
    expect(rows.PlanVersions).toHaveLength(1);
    expect(rows.Plans[0][13]).toBe(1);
    expect(mocks.write).toHaveBeenCalledTimes(2);
  });
});

describe("published plan snapshots", () => {
  it.each([false, true])("reads %s-compressed snapshots, including legacy plain JSON", async (large) => {
    const { serializeNutritionPlanSnapshot, getPublishedNutritionPlanSnapshot } = await import("@/lib/google/nutrition-management");
    const plan = doubleAlternativePlan();
    if (large) plan.meals = Array.from({ length: 20 }, (_, index) => ({
      ...plan.meals[0], id: `meal-${index}`,
      entries: Array.from({ length: 10 }, (_, entryIndex) => ({
        ...plan.meals[0].entries[0], id: `entry-${index}-${entryIndex}`, mealId: `meal-${index}`
      }))
    }));
    if (large) expect(JSON.stringify(plan).length).toBeGreaterThan(50_000);
    const encoded = serializeNutritionPlanSnapshot(plan);
    expect(encoded.startsWith("gzip:v1:")).toBe(large);
    expect(encoded.length).toBeLessThan(50_000);
    rows.PlanVersions = [["new-version", "plan-test", "athlete", 1, "published", "pdf-file", "plan.pdf", encoded]];
    const restored = await getPublishedNutritionPlanSnapshot("plan-test");
    expect(restored?.meals).toEqual(plan.meals);
    expect(restored?.publishedFileId).toBe("pdf-file");
  });

  it("reports snapshots that still exceed the Sheets cell limit after compression", async () => {
    const { serializeNutritionPlanSnapshot, NutritionPlanSnapshotTooLargeError } = await import("@/lib/google/nutrition-management");
    const plan = { ...planInput(), notes: randomBytes(100_000).toString("base64") };
    expect(() => serializeNutritionPlanSnapshot(plan)).toThrow(NutritionPlanSnapshotTooLargeError);
  });
});
