import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ save: vi.fn() }));
vi.mock("@/lib/auth/require-session", () => ({
  requireAdminSession: async () => ({ session: { username: "nutritionist" } })
}));
vi.mock("@/lib/google/nutrition-management", () => ({
  saveNutritionPlan: mocks.save,
  deleteNutritionPlanById: vi.fn(),
  getNutritionPlanById: vi.fn(),
  getPublishedNutritionPlanSnapshot: vi.fn()
}));
vi.mock("@/lib/google/drive", () => ({ deleteDriveFileById: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { PUT } from "@/app/api/admin/nutrition-management/plans/[planId]/route";

const context = { params: Promise.resolve({ planId: "plan-test" }) };
const plan = {
  id: "plan-test", athleteUsername: "athlete", athleteName: "Athlete", name: "Plan",
  status: "review", targetProteinG: 100, targetCarbsG: 150, targetFatG: 50,
  meals: [{ name: "Lunch", entries: [] }]
};
function request(body: unknown = plan) {
  return new Request("http://localhost/api/admin/nutrition-management/plans/plan-test", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body)
  });
}

beforeEach(() => { vi.clearAllMocks(); });

describe("nutrition save error responses", () => {
  it.each([
    [429, "GOOGLE_RATE_LIMIT", { response: { status: 429 } }],
    [503, "GOOGLE_UNAVAILABLE", { response: { status: 503 } }],
    [500, "SAVE_FAILED", new Error("Unexpected error")]
  ])("reports %s with code %s", async (status, code, error) => {
    mocks.save.mockRejectedValueOnce(error);
    const response = await PUT(request(), context);
    expect(response.status).toBe(status);
    expect((await response.json()).code).toBe(code);
  });

  it("identifies invalid fields without attempting a write", async () => {
    const response = await PUT(request({ ...plan, name: "" }), context);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "INVALID_PLAN", fields: ["name"] });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it("reports malformed JSON as validation, rather than a Google error", async () => {
    const response = await PUT(new Request("http://localhost", { method: "PUT", body: "{" }), context);
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("INVALID_PLAN");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
