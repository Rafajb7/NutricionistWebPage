import * as React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractiveNutritionShell } from "@/components/nutrition/interactive-nutrition-shell";
import { makeDoubleAlternativePlan } from "./fixtures/nutrition-double-alternative";

vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("@/components/ui/motion-page", () => ({ MotionPage: "div" }));
vi.mock("framer-motion", () => ({ motion: { button: "button", div: "div", section: "section" } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function visibleText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : visibleText(child)).join("");
}

describe("athlete double alternatives", () => {
  let renderer: ReactTestRenderer | undefined;

  beforeEach(() => vi.stubGlobal("React", React));
  afterEach(() => {
    act(() => renderer?.unmount());
    renderer = undefined;
    vi.unstubAllGlobals();
  });

  async function openPlan(plan = makeDoubleAlternativePlan()) {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      plans: [plan],
      foods: [{ id: "lentils-food", name: "Lentejas", category: "Legumbres", active: true, restrictionTags: [] }],
      restrictions: [{
        id: "restriction", type: "dislike", key: "food_dislike", foodId: "lentils-food",
        athleteUsername: "athlete", label: "No me gustan las lentejas", notes: "",
      }],
    })));
    await act(async () => {
      renderer = create(React.createElement(InteractiveNutritionShell, {
        user: { username: "athlete", name: "Atleta" },
      }));
    });
  }

  it("groups both quantities, sums calories and checks the second food restrictions", async () => {
    const plan = makeDoubleAlternativePlan();
    plan.meals[0].entries[0].alternatives[0].secondComponent!.customText = "Lentejas cocidas y escurridas";
    await openPlan(plan);
    const jointLabel = renderer!.root.findAllByType("p")
      .find((node) => visibleText(node) === "Alternativa conjunta: toma ambos alimentos")!;
    const jointCard = jointLabel.parent!.parent!;
    const text = visibleText(jointCard);
    expect(text).toContain("Arroz blanco (50 g)");
    expect(text).toContain("+ Lentejas (25 g)");
    expect(text).toContain("Lentejas cocidas y escurridas");
    expect(text).toContain("No me gustan las lentejas");
    expect(text).toContain("Total: 100 kcal");
  });

  it("keeps the quantity and calories for existing single alternatives", async () => {
    const plan = makeDoubleAlternativePlan();
    delete plan.meals[0].entries[0].alternatives[0].secondComponent;
    await openPlan(plan);
    const text = visibleText(renderer!.root);
    expect(text).toContain("50 g | 50 kcal");
    expect(text).not.toContain("Alternativa conjunta");
  });
});
