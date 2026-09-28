import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDoubleAlternativePlan } from "./fixtures/nutrition-double-alternative";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  publishedPlan: vi.fn(),
  managementData: vi.fn()
}));

vi.mock("@/lib/auth/require-session", () => ({
  requireSession: async () => ({ session: { username: "athlete", name: "Atleta" } })
}));
vi.mock("@/lib/google/nutrition-management", () => ({
  createNutritionChangeRequest: mocks.create,
  getPublishedNutritionPlanSnapshot: mocks.publishedPlan,
  listNutritionChangeRequests: vi.fn(),
  listNutritionManagementData: mocks.managementData
}));
vi.mock("@/lib/logger", () => ({ logError: vi.fn(), logInfo: vi.fn() }));

import { POST } from "@/app/api/nutrition-change-requests/route";

function request(athleteNotes?: string) {
  return new Request("http://localhost/api/nutrition-change-requests", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requestType: "food_add", planId: "plan-double", athleteNotes })
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.publishedPlan.mockResolvedValue(makeDoubleAlternativePlan());
  mocks.create.mockImplementation(async (input) => ({ ...input, id: "request-food-add", status: "pending" }));
});

describe("requests to incorporate a food", () => {
  it.each([
    "Me gustaría incorporar yogur de la marca Ejemplo.",
    "Me gustaría incorporar aguacate."
  ])("sends the food description to the nutritionist, with an optional brand: %s", async (athleteNotes) => {
    const response = await POST(request(athleteNotes));

    expect(response.status).toBe(200);
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({
      requestType: "food_add",
      athleteUsername: "athlete",
      planId: "plan-double",
      requestSummary: "Incorporar alimento",
      athleteNotes
    }));
    expect(await response.json()).toMatchObject({
      ok: true,
      request: { requestType: "food_add", status: "pending", athleteNotes }
    });
    expect(mocks.managementData).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "   "])("rejects a missing food description: %s", async (athleteNotes) => {
    const response = await POST(request(athleteNotes));

    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("Describe el alimento");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("only accepts requests for the athlete's own published plan", async () => {
    mocks.publishedPlan.mockResolvedValue({ ...makeDoubleAlternativePlan(), athleteUsername: "other-athlete" });

    const response = await POST(request("Quiero incorporar aguacate."));

    expect(response.status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
});
