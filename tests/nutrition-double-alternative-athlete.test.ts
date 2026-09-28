import * as React from "react";
import { act, create, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InteractiveNutritionShell } from "@/components/nutrition/interactive-nutrition-shell";
import { makeDoubleAlternativePlan, makeFiveComponentAlternativePlan } from "./fixtures/nutrition-double-alternative";

vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn() }) }));
vi.mock("next/link", () => ({ default: "a" }));
vi.mock("@/components/brand-logo", () => ({ BrandLogo: () => null }));
vi.mock("@/components/ui/motion-page", () => ({ MotionPage: "div" }));
vi.mock("framer-motion", () => ({ motion: { button: "button", div: "div", section: "section" } }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

function visibleText(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === "string" ? child : visibleText(child)).join("");
}

describe("athlete interactive nutrition", () => {
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

  it("lets the athlete describe a food and its preferred brand before requesting its addition", async () => {
    await openPlan();
    const root = renderer!.root;
    const option = root.findAllByType("option").find((node) => visibleText(node) === "Incorporar alimento")!;
    act(() => option.parent!.props.onChange({ target: { value: option.props.value } }));
    const description = root.findByType("textarea");
    const athleteNotes = "Quiero incorporar yogur de la marca Ejemplo.";
    act(() => description.props.onChange({ target: { value: athleteNotes } }));

    expect(visibleText(root)).toContain("Si quieres una marca concreta, indícala en la descripción.");
    vi.mocked(fetch).mockResolvedValueOnce(Response.json({ request: {
      id: "food-add-request", requestType: "food_add", planId: "plan-double",
      requestSummary: "Incorporar alimento", athleteNotes, status: "pending"
    } }));
    await act(async () => {
      root.findAllByType("button").find((node) => visibleText(node) === "Enviar solicitud")!.props.onClick();
    });

    const [, init] = vi.mocked(fetch).mock.calls.find(([, options]) => options?.method === "POST")!;
    expect(JSON.parse(init!.body as string)).toMatchObject({
      requestType: "food_add", planId: "plan-double", athleteNotes
    });
    expect(visibleText(root)).toContain("pendiente: Incorporar alimento");
    expect(root.findByType("textarea").props.value).toBe("");
  });

  it("groups both quantities without macros and checks the second food restrictions", async () => {
    const plan = makeDoubleAlternativePlan();
    plan.meals[0].entries[0].alternatives[0].additionalComponents![0].customText = "Lentejas cocidas y escurridas";
    await openPlan(plan);
    const jointLabel = renderer!.root.findAllByType("p")
      .find((node) => visibleText(node) === "Alternativa conjunta: toma los 2 alimentos")!;
    const jointCard = jointLabel.parent!.parent!;
    const text = visibleText(jointCard);
    expect(text).toContain("Arroz blanco (50 g)");
    expect(text).toContain("+ Lentejas (25 g)");
    expect(text).toContain("Lentejas cocidas y escurridas");
    expect(text).toContain("No me gustan las lentejas");
    expect(visibleText(renderer!.root)).not.toMatch(/kcal|Proteinas|Carbos|Grasas|\| [PCG] /i);
  });

  it("keeps only the quantity for existing single alternatives", async () => {
    const plan = makeDoubleAlternativePlan();
    plan.meals[0].entries[0].alternatives[0].additionalComponents = [];
    await openPlan(plan);
    const text = visibleText(renderer!.root);
    expect(text).toContain("50 g");
    expect(text).not.toMatch(/kcal|Proteinas|Carbos|Grasas|\| [PCG] /i);
    expect(text).not.toContain("Alternativa conjunta");
  });

  it("shows all five components and their quantities without calories", async () => {
    await openPlan(makeFiveComponentAlternativePlan());
    const jointLabel = renderer!.root.findAllByType("p")
      .find((node) => visibleText(node) === "Alternativa conjunta: toma los 5 alimentos")!;
    const text = visibleText(jointLabel.parent!.parent!);
    expect(text).toContain("Arroz blanco (50 g)");
    for (const name of ["Lentejas", "Garbanzos", "Alubias", "Guisantes"]) {
      expect(text).toContain(`+ ${name} (25 g)`);
    }
    expect(text).not.toContain("kcal");
  });
});
