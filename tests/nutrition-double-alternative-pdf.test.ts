import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import type { NutritionPlanFull } from "@/lib/nutrition/types";
import { makeDoubleAlternativePlan } from "./fixtures/nutrition-double-alternative";

async function renderedText(plan: NutritionPlanFull, includeMacros = true) {
  const data = await renderNutritionPlanPdf(plan, { includeMacros });
  expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  const parser = new PDFParse({ data });
  try {
    return (await parser.getText()).text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

describe("double alternatives in the generated PDF", () => {
  it("renders one joint alternative with each quantity and the sum of both foods", async () => {
    const text = await renderedText(makeDoubleAlternativePlan());
    expect(text.match(/Alternativa conjunta/g)).toHaveLength(1);
    expect(text).toContain("Alternativa conjunta - 50 g de Arroz blanco + 25 g de Lentejas - 100 5 20 0 0 0 mg");
  });

  it("retains the joint foods and fractional units without exposing macros", async () => {
    const plan = makeDoubleAlternativePlan();
    Object.assign(plan.meals[0].entries[0].alternatives[0].secondComponent!, {
      foodName: "Aguacate", quantityG: 0.5, quantityUnit: "piece", unitWeightG: 200,
    });
    const text = await renderedText(plan, false);
    expect(text).toContain("Alternativa conjunta - 50 g de Arroz blanco + 0,5 unidades de Aguacate");
    expect(text).not.toMatch(/KCAL|SODIO|ENERGIA TOTAL/);
  });

  it("keeps the existing single alternative presentation", async () => {
    const plan = makeDoubleAlternativePlan();
    delete plan.meals[0].entries[0].alternatives[0].secondComponent;
    const text = await renderedText(plan);
    expect(text).toContain("Alternativa - Arroz blanco 50 g 50 0 12,5 0 0 0 mg");
    expect(text).not.toContain("Alternativa conjunta");
  });

  it("normalizes legacy second component quantities and missing notes for rendering", async () => {
    const plan = makeDoubleAlternativePlan();
    Object.assign(plan.meals[0].entries[0].alternatives[0].secondComponent!, {
      quantityG: Number.NaN, quantityUnit: "unknown", unitWeightG: Number.NaN,
      customText: null,
    });
    const text = await renderedText(plan);
    expect(text).toContain("50 g de Arroz blanco + 1 g de Lentejas");
    expect(text).not.toMatch(/NaN|undefined|null/);
  });
});
