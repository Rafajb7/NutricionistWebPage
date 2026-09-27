import { describe, expect, it } from "vitest";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";

function input(componentFields: Record<string, unknown> = {}) {
  const component = {
    foodId: "rice", foodName: "Arroz blanco", quantityG: 100, quantityUnit: "g", unitWeightG: 1,
    proteinPer100g: 3, carbsPer100g: 28, fatPer100g: 0, fiberPer100g: 1,
    sodiumPer100g: 1, waterPer100g: 70, customText: "Cocido"
  };
  return {
    id: "plan-test", athleteUsername: "athlete", athleteName: "Athlete", name: "Plan",
    status: "review", targetProteinG: 100, targetCarbsG: 150, targetFatG: 50,
    meals: [{ name: "Lunch", entries: [{
      ...component, alternatives: [{ ...component, ...componentFields }]
    }] }]
  };
}

const legumes = {
  foodId: "legumes", foodName: "Lentejas", quantityG: "0,75", quantityUnit: "piece", unitWeightG: 150,
  proteinPer100g: 9, carbsPer100g: 20, fatPer100g: 0.4, fiberPer100g: 8,
  sodiumPer100g: 2, waterPer100g: 70, customText: "Cocidas"
};

describe("alternative component input validation", () => {
  it.each([1, 2, 3, 4, 5])("preserves %i foods and normalizes their fractional quantities", (componentCount) => {
    const additionalComponents = Array.from({ length: componentCount - 1 }, (_, index) => ({
      ...legumes, foodId: `food-${index}`
    }));
    const alternative = nutritionPlanSaveSchema.parse(input({ additionalComponents })).meals[0].entries[0].alternatives[0];
    expect(alternative.foodName).toBe("Arroz blanco");
    expect(alternative.additionalComponents).toEqual(additionalComponents.map((component) => ({ ...component, quantityG: 0.75 })));
    expect(alternative).not.toHaveProperty("secondComponent");
  });

  it("retains compatibility with single-food alternatives", () => {
    const alternative = nutritionPlanSaveSchema.parse(input()).meals[0].entries[0].alternatives[0];
    expect(alternative.additionalComponents).toBeUndefined();
    expect(alternative.quantityG).toBe(100);
  });

  it("normalizes legacy double alternatives into the canonical array", () => {
    const alternative = nutritionPlanSaveSchema.parse(input({ secondComponent: legumes })).meals[0].entries[0].alternatives[0];
    expect(alternative.additionalComponents).toEqual([{ ...legumes, quantityG: 0.75 }]);
    expect(alternative).not.toHaveProperty("secondComponent");
  });

  it.each([{ additionalComponents: [] }, { additionalComponents: [legumes] }])(
    "gives the canonical array precedence over even malformed legacy values (%j)", ({ additionalComponents }) => {
    const alternative = nutritionPlanSaveSchema.parse(input({ additionalComponents, secondComponent: "obsolete" }))
      .meals[0].entries[0].alternatives[0];
    expect(alternative.additionalComponents).toEqual(additionalComponents.map((component) => ({ ...component, quantityG: 0.75 })));
    expect(alternative).not.toHaveProperty("secondComponent");
    }
  );

  it("rounds gram quantities inside each additional component to whole grams", () => {
    const alternative = nutritionPlanSaveSchema.parse(input({ additionalComponents: [{ ...legumes, quantityUnit: "g", quantityG: "165,2" }] }))
      .meals[0].entries[0].alternatives[0];
    expect(alternative.additionalComponents?.[0].quantityG).toBe(165);
  });

  it.each([
    { ...legumes, quantityG: 0 }, { ...legumes, quantityG: 10001 },
    { ...legumes, foodName: "" }, { ...legumes, quantityUnit: "unknown" },
    { ...legumes, proteinPer100g: -1 }, { ...legumes, secondComponent: legumes },
    { ...legumes, additionalComponents: [legumes] }
  ])("rejects invalid or recursively nested components (%j)", (component) => {
    const result = nutritionPlanSaveSchema.safeParse(input({ additionalComponents: [component] }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toContain("additionalComponents");
    expect(nutritionPlanSaveSchema.safeParse(input({ secondComponent: component })).success).toBe(false);
  });

  it("rejects a sixth food instead of silently truncating it", () => {
    const result = nutritionPlanSaveSchema.safeParse(input({ additionalComponents: Array.from({ length: 5 }, () => legumes) }));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]).toMatchObject({ code: "too_big", maximum: 4 });
  });
});
