import { describe, expect, it } from "vitest";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";

function input(secondComponent?: unknown) {
  const component = {
    foodId: "rice", foodName: "Arroz blanco", quantityG: 100, quantityUnit: "g", unitWeightG: 1,
    proteinPer100g: 3, carbsPer100g: 28, fatPer100g: 0, fiberPer100g: 1,
    sodiumPer100g: 1, waterPer100g: 70, customText: "Cocido"
  };
  return {
    id: "plan-test", athleteUsername: "athlete", athleteName: "Athlete", name: "Plan",
    status: "review", targetProteinG: 100, targetCarbsG: 150, targetFatG: 50,
    meals: [{ name: "Lunch", entries: [{
      ...component, alternatives: [{ ...component, ...(secondComponent === undefined ? {} : { secondComponent }) }]
    }] }]
  };
}

const legumes = {
  foodId: "legumes", foodName: "Lentejas", quantityG: "0,75", quantityUnit: "serving", unitWeightG: 150,
  proteinPer100g: 9, carbsPer100g: 20, fatPer100g: 0.4, fiberPer100g: 8,
  sodiumPer100g: 2, waterPer100g: 70, customText: "Cocidas"
};

describe("double alternative input validation", () => {
  it("preserves both food definitions and normalizes fractional component quantities", () => {
    const alternative = nutritionPlanSaveSchema.parse(input(legumes)).meals[0].entries[0].alternatives[0];
    expect(alternative.foodName).toBe("Arroz blanco");
    expect(alternative.secondComponent).toEqual({ ...legumes, quantityG: 0.75 });
  });

  it("retains compatibility with single-food alternatives", () => {
    const alternative = nutritionPlanSaveSchema.parse(input()).meals[0].entries[0].alternatives[0];
    expect(alternative.secondComponent).toBeUndefined();
    expect(alternative.quantityG).toBe(100);
  });

  it("rounds gram quantities inside the second component to whole grams", () => {
    const alternative = nutritionPlanSaveSchema.parse(input({ ...legumes, quantityUnit: "g", quantityG: "165,2" }))
      .meals[0].entries[0].alternatives[0];
    expect(alternative.secondComponent?.quantityG).toBe(165);
  });

  it.each([
    { ...legumes, quantityG: 0 }, { ...legumes, quantityG: 10001 },
    { ...legumes, foodName: "" }, { ...legumes, quantityUnit: "unknown" },
    { ...legumes, proteinPer100g: -1 }, { ...legumes, secondComponent: legumes }
  ])("rejects an invalid or recursive second component (%j)", (component) => {
    const result = nutritionPlanSaveSchema.safeParse(input(component));
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toContain("secondComponent");
  });
});
