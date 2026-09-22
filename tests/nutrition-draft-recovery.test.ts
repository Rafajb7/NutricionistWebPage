import { describe, expect, it } from "vitest";
import {
  listNutritionDraftRecoveries,
  readNutritionDraftRecovery,
  removeNutritionDraftRecovery,
  writeNutritionDraftRecovery,
} from "@/lib/nutrition/draft-recovery";
import type { NutritionDraftStorage } from "@/lib/nutrition/draft-recovery";
import type { NutritionPlanFoodAlternative, NutritionPlanFull } from "@/lib/nutrition/types";

class MemoryStorage implements NutritionDraftStorage {
  readonly values = new Map<string, string>();
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function makePlan(): NutritionPlanFull {
  const alternative: NutritionPlanFoodAlternative = {
    id: "alternative", entryId: "entry", foodId: "alternative-food", foodName: "Aguacate",
    quantityG: 0.5, quantityUnit: "piece", unitWeightG: 200,
    proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15,
    fiberPer100g: 7, sodiumPer100g: 1, waterPer100g: 60,
    position: 1, customText: "Medio aguacate", createdAt: "", updatedAt: "",
  };
  return {
    id: "plan", athleteUsername: "athlete", athleteName: "Atleta", name: "",
    status: "review", targetProteinG: 100, targetCarbsG: 180, targetFatG: 60,
    targetCaloriesKcal: 1660, notes: "Pendiente de revisar", supplementation: "",
    recommendations: "", createdAt: "", updatedAt: "", publishedAt: "",
    publishedFileId: "", versionNumber: 1, versions: [],
    meals: [{
      id: "meal", planId: "plan", name: "", position: 1, notes: "", included: true,
      createdAt: "", updatedAt: "", entries: [{
        ...alternative, id: "entry", planId: "plan", mealId: "meal", foodId: "reference",
        foodName: "Alimento de referencia", quantityG: 0, quantityUnit: "g",
        mealOption: 1, alternatives: [alternative],
      }],
    }],
  };
}

function storeDraft(storage: NutritionDraftStorage, sessionId = "editor-one", plan = makePlan()) {
  const result = writeNutritionDraftRecovery(storage, "nutritionist", sessionId, plan, "2026-09-22T10:00:00.000Z");
  if (!result.ok) throw new Error(`Unexpected write failure: ${result.reason}`);
  return result.draft;
}

describe("nutrition draft recovery", () => {
  it("recovers the complete plan, including unfinished fields and fractional alternatives", () => {
    const storage = new MemoryStorage();
    const plan = makePlan();
    storeDraft(storage, "editor-one", plan);
    expect(readNutritionDraftRecovery(storage, "nutritionist", "plan", "editor-one")?.plan).toEqual(plan);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts[0].plan).toEqual(plan);
  });

  it("isolates administrators, plans and tabs, even for prototype-like identifiers", () => {
    const storage = new MemoryStorage();
    storeDraft(storage);
    storeDraft(storage, "editor-two", { ...makePlan(), notes: "Otra pestaña" });
    storeDraft(storage, "editor-one", { ...makePlan(), id: "another-plan" });
    const other = writeNutritionDraftRecovery(storage, "__proto__", "constructor", {
      ...makePlan(), id: "toString", notes: "Otro administrador",
    });
    expect(other.ok).toBe(true);
    expect(storage.length).toBe(4);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toHaveLength(3);
    expect(listNutritionDraftRecoveries(storage, "__proto__").drafts).toHaveLength(1);
    expect(listNutritionDraftRecoveries(storage, "nutritionist:another").drafts).toHaveLength(0);
    expect(readNutritionDraftRecovery(storage, "__proto__", "toString", "constructor")?.plan.notes)
      .toBe("Otro administrador");
  });

  it("orders the most recent recoverable work first", () => {
    const storage = new MemoryStorage();
    storeDraft(storage);
    writeNutritionDraftRecovery(storage, "nutritionist", "later", makePlan(), "2026-09-22T11:00:00.000Z");
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts.map((draft) => draft.sessionId))
      .toEqual(["later", "editor-one"]);
  });

  it("does not delete a newer edit when an earlier remote save finishes", () => {
    const storage = new MemoryStorage();
    const saved = storeDraft(storage);
    const newer = storeDraft(storage, "editor-one", { ...makePlan(), notes: "Edición durante el guardado" });
    expect(removeNutritionDraftRecovery(storage, saved)).toBe(false);
    expect(readNutritionDraftRecovery(storage, "nutritionist", "plan", "editor-one")).toEqual(newer);
    expect(removeNutritionDraftRecovery(storage, newer)).toBe(true);
    expect(storage.length).toBe(0);
  });

  it("returns detached snapshots for safe deletion even if the caller mutates its plan", () => {
    const storage = new MemoryStorage();
    const plan = makePlan();
    const draft = storeDraft(storage, "editor-one", plan);
    plan.notes = "Edited after write";
    expect(draft.plan.notes).toBe("Pendiente de revisar");
    expect(removeNutritionDraftRecovery(storage, draft)).toBe(true);
  });

  it("consumes a recovered record while protecting the active editor copy", () => {
    const storage = new MemoryStorage();
    const abandoned = storeDraft(storage);
    const active = storeDraft(storage, "restored-editor", abandoned.plan);
    expect(removeNutritionDraftRecovery(storage, abandoned)).toBe(true);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([active]);
    expect(removeNutritionDraftRecovery(storage, active)).toBe(true);
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toHaveLength(0);
  });

  it.each([
    "{broken", "null", "[]",
    JSON.stringify({ version: 1, adminUsername: "nutritionist", plan: null }),
  ])("ignores corrupt records without throwing (%s)", (value) => {
    const storage = new MemoryStorage();
    storeDraft(storage);
    storage.setItem(storage.key(0)!, value);
    expect(listNutritionDraftRecoveries(storage, "nutritionist")).toEqual({ available: true, drafts: [] });
    expect(readNutritionDraftRecovery(storage, "nutritionist", "plan", "editor-one")).toBeNull();
  });

  it.each(["meals", "entries", "alternatives", "versions", "numeric-values", "quantity-unit"])(
    "rejects malformed %s before they can crash the editor", (invalidField) => {
      const storage = new MemoryStorage();
      const draft = storeDraft(storage);
      const value = JSON.parse(JSON.stringify(draft));
      if (invalidField === "meals") value.plan.meals = [null];
      if (invalidField === "entries") value.plan.meals[0].entries = "bad";
      if (invalidField === "alternatives") value.plan.meals[0].entries[0].alternatives = [null];
      if (invalidField === "versions") value.plan.versions = [false];
      if (invalidField === "numeric-values") value.plan.targetProteinG = "oops";
      if (invalidField === "quantity-unit") value.plan.meals[0].entries[0].quantityUnit = {};
      storage.setItem(storage.key(0)!, JSON.stringify(value));
      expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
    },
  );

  it("ignores records whose owner or session does not match their storage key", () => {
    const storage = new MemoryStorage();
    const draft = storeDraft(storage);
    const key = storage.key(0)!;
    storage.setItem(key, JSON.stringify({ ...draft, adminUsername: "different-admin" }));
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
    expect(readNutritionDraftRecovery(storage, "nutritionist", "plan", "editor-one")).toBeNull();
    storage.setItem(key, JSON.stringify({ ...draft, sessionId: "different-session" }));
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([]);
    expect(readNutritionDraftRecovery(storage, "nutritionist", "plan", "editor-one")).toBeNull();
  });

  it("reports unavailable browser storage without losing control of the editor", () => {
    const storage = new MemoryStorage();
    const draft = storeDraft(storage);
    const inaccessible: NutritionDraftStorage = {
      get length(): number { throw new Error("Blocked storage"); },
      key() { throw new Error("Blocked storage"); },
      getItem() { throw new Error("Blocked storage"); },
      setItem() { throw new Error("Blocked storage"); },
      removeItem() { throw new Error("Blocked storage"); },
    };
    for (const target of [null, inaccessible]) {
      expect(writeNutritionDraftRecovery(target, "nutritionist", "editor", makePlan()))
        .toEqual({ ok: false, reason: "unavailable" });
      expect(listNutritionDraftRecoveries(target, "nutritionist"))
        .toEqual({ available: false, drafts: [] });
      expect(readNutritionDraftRecovery(target, "nutritionist", "plan", "editor-one")).toBeNull();
      expect(removeNutritionDraftRecovery(target, draft)).toBe(false);
    }
  });

  it("reports storage quota failures and preserves existing work", () => {
    const storage = new MemoryStorage();
    const existing = storeDraft(storage);
    storage.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
    expect(writeNutritionDraftRecovery(storage, "nutritionist", "editor-one", {
      ...makePlan(), notes: "Latest edit",
    })).toEqual({ ok: false, reason: "full" });
    expect(listNutritionDraftRecoveries(storage, "nutritionist").drafts).toEqual([existing]);
  });

  it("bounds stored records without evicting unsaved work or preventing updates", () => {
    const storage = new MemoryStorage();
    for (let index = 0; index < 40; index += 1) storeDraft(storage, `editor-${index}`);
    expect(writeNutritionDraftRecovery(storage, "nutritionist", "editor-overflow", makePlan()))
      .toEqual({ ok: false, reason: "full" });
    expect(writeNutritionDraftRecovery(storage, "nutritionist", "editor-0", {
      ...makePlan(), notes: "Still protected",
    }).ok).toBe(true);
    expect(storage.length).toBe(40);
    expect(writeNutritionDraftRecovery(storage, "nutritionist", "editor-0", {
      ...makePlan(), notes: "a".repeat(1024 * 1024),
    })).toEqual({ ok: false, reason: "full" });
    expect(readNutritionDraftRecovery(storage, "nutritionist", "plan", "editor-0")?.plan.notes)
      .toBe("Still protected");
  });
});
