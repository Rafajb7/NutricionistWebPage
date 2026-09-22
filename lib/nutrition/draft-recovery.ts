import type { NutritionPlanFull } from "@/lib/nutrition/types";

export type NutritionDraftStorage = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

export type NutritionDraftRecovery = {
  version: 1;
  adminUsername: string;
  sessionId: string;
  savedAt: string;
  plan: NutritionPlanFull;
};

export type NutritionDraftWriteResult =
  | { ok: true; draft: NutritionDraftRecovery }
  | { ok: false; reason: "unavailable" | "full" | "invalid" };

const STORAGE_PREFIX = "nutrition-draft-recovery:v1:";
const MAX_DRAFT_CHARACTERS = 1024 * 1024;
const MAX_DRAFTS_PER_ADMIN = 40;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasStrings(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "string");
}

function hasNumbers(value: Record<string, unknown>, keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === "number" && Number.isFinite(value[key]));
}

function isIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= 512;
}

function isFood(value: unknown): value is Record<string, unknown> {
  return isRecord(value)
    && hasStrings(value, ["id", "foodId", "foodName", "customText", "createdAt", "updatedAt"])
    && hasNumbers(value, [
      "quantityG", "unitWeightG", "proteinPer100g", "carbsPer100g", "fatPer100g",
      "fiberPer100g", "sodiumPer100g", "waterPer100g", "position",
    ])
    && typeof value.quantityUnit === "string"
    && ["g", "ml", "piece", "serving"].includes(value.quantityUnit);
}

// Drafts can contain empty names and zero quantities while a user is editing.
// Validate their structure, without applying the stricter remote-save schema.
export function isNutritionDraftPlan(value: unknown): value is NutritionPlanFull {
  return isRecord(value)
    && isIdentifier(value.id)
    && hasStrings(value, [
      "athleteUsername", "athleteName", "name", "notes", "supplementation",
      "recommendations", "createdAt", "updatedAt", "publishedAt", "publishedFileId",
    ])
    && (value.status === "review" || value.status === "published")
    && hasNumbers(value, [
      "targetProteinG", "targetCarbsG", "targetFatG", "targetCaloriesKcal", "versionNumber",
    ])
    && Array.isArray(value.meals)
    && value.meals.every((meal) => isRecord(meal)
      && hasStrings(meal, ["id", "planId", "name", "notes", "createdAt", "updatedAt"])
      && hasNumbers(meal, ["position"])
      && typeof meal.included === "boolean"
      && Array.isArray(meal.entries)
      && meal.entries.every((entry) => isFood(entry)
        && hasStrings(entry, ["planId", "mealId"])
        && hasNumbers(entry, ["mealOption"])
        && Array.isArray(entry.alternatives)
        && entry.alternatives.every((alternative) => isFood(alternative)
          && typeof alternative.entryId === "string")))
    && Array.isArray(value.versions)
    && value.versions.every((version) => isRecord(version)
      && hasStrings(version, ["id", "planId", "athleteUsername", "publishedAt", "driveFileId", "fileName"])
      && hasNumbers(version, ["versionNumber"]));
}

function ownerPrefix(adminUsername: string): string {
  return `${STORAGE_PREFIX}${encodeURIComponent(adminUsername)}:`;
}

function storageKey(adminUsername: string, planId: string, sessionId: string): string {
  return `${ownerPrefix(adminUsername)}${encodeURIComponent(planId)}:${encodeURIComponent(sessionId)}`;
}

function parseDraft(raw: string | null): NutritionDraftRecovery | null {
  if (!raw || raw.length > MAX_DRAFT_CHARACTERS) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value.version !== 1
      || !isIdentifier(value.adminUsername) || !isIdentifier(value.sessionId)
      || typeof value.savedAt !== "string" || !Number.isFinite(Date.parse(value.savedAt))
      || !isNutritionDraftPlan(value.plan)) return null;
    return value as NutritionDraftRecovery;
  } catch {
    return null;
  }
}

export function getBrowserNutritionDraftStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function listNutritionDraftRecoveries(
  storage: NutritionDraftStorage | null,
  adminUsername: string,
): { available: boolean; drafts: NutritionDraftRecovery[] } {
  if (!storage) return { available: false, drafts: [] };
  if (!isIdentifier(adminUsername)) return { available: true, drafts: [] };
  try {
    const prefix = ownerPrefix(adminUsername);
    const drafts: NutritionDraftRecovery[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (!key?.startsWith(prefix)) continue;
      const draft = parseDraft(storage.getItem(key));
      if (draft && draft.adminUsername === adminUsername
        && key === storageKey(adminUsername, draft.plan.id, draft.sessionId)) drafts.push(draft);
    }
    drafts.sort((left, right) => Date.parse(right.savedAt) - Date.parse(left.savedAt));
    return { available: true, drafts };
  } catch {
    return { available: false, drafts: [] };
  }
}

export function readNutritionDraftRecovery(
  storage: NutritionDraftStorage | null,
  adminUsername: string,
  planId: string,
  sessionId: string,
): NutritionDraftRecovery | null {
  if (!storage || ![adminUsername, planId, sessionId].every(isIdentifier)) return null;
  try {
    const draft = parseDraft(storage.getItem(storageKey(adminUsername, planId, sessionId)));
    return draft?.adminUsername === adminUsername && draft.plan.id === planId && draft.sessionId === sessionId
      ? draft : null;
  } catch {
    return null;
  }
}

export function writeNutritionDraftRecovery(
  storage: NutritionDraftStorage | null,
  adminUsername: string,
  sessionId: string,
  plan: NutritionPlanFull,
  savedAt = new Date().toISOString(),
): NutritionDraftWriteResult {
  if (!storage) return { ok: false, reason: "unavailable" };
  if (!isIdentifier(adminUsername) || !isIdentifier(sessionId) || !isNutritionDraftPlan(plan)
    || !Number.isFinite(Date.parse(savedAt))) return { ok: false, reason: "invalid" };
  try {
    const draft: NutritionDraftRecovery = { version: 1, adminUsername, sessionId, savedAt, plan };
    const serialized = JSON.stringify(draft);
    if (serialized.length > MAX_DRAFT_CHARACTERS) return { ok: false, reason: "full" };
    const key = storageKey(adminUsername, plan.id, sessionId);
    if (storage.getItem(key) === null) {
      let count = 0;
      const prefix = ownerPrefix(adminUsername);
      for (let index = 0; index < storage.length; index += 1) {
        if (storage.key(index)?.startsWith(prefix)) count += 1;
      }
      // Do not evict another unsaved plan to make room for this one.
      if (count >= MAX_DRAFTS_PER_ADMIN) return { ok: false, reason: "full" };
    }
    storage.setItem(key, serialized);
    // Return a detached snapshot so subsequent editor mutations cannot change
    // the expected value used by conditional removal after a remote save.
    return { ok: true, draft: JSON.parse(serialized) as NutritionDraftRecovery };
  } catch (error) {
    const full = isRecord(error) && (error.name === "QuotaExceededError"
      || error.name === "NS_ERROR_DOM_QUOTA_REACHED" || error.code === 22 || error.code === 1014);
    return { ok: false, reason: full ? "full" : "unavailable" };
  }
}

export function removeNutritionDraftRecovery(
  storage: NutritionDraftStorage | null,
  expectedDraft: NutritionDraftRecovery,
): boolean {
  if (!storage) return false;
  try {
    const key = storageKey(expectedDraft.adminUsername, expectedDraft.plan.id, expectedDraft.sessionId);
    const currentDraft = parseDraft(storage.getItem(key));
    if (!currentDraft || JSON.stringify(currentDraft) !== JSON.stringify(expectedDraft)) return false;
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
