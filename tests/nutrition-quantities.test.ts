import { describe, expect, it } from "vitest";
import {
  balanceAlternative,
  calculateAlternativeTotals,
  getAlternativeComponents,
  getEquivalentFoodQuantity,
  updateEntryAlternatives,
} from "@/lib/nutrition/alternatives";
import { calculateEntryTotals } from "@/lib/nutrition/calculations";
import { formatFoodQuantity, getEffectiveQuantityG, normalizeFoodQuantity } from "@/lib/nutrition/quantity-units";
import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";
import type {
  NutritionPlanFoodAlternative,
  NutritionPlanFoodAlternativeComponent,
  NutritionPlanFoodEntry,
} from "@/lib/nutrition/types";

const alternative: NutritionPlanFoodAlternative = {
  id: "alternative", entryId: "entry", foodId: "alternative-food", foodName: "Alternativa",
  quantityG: 200, quantityUnit: "g", unitWeightG: 1,
  proteinPer100g: 10, carbsPer100g: 0, fatPer100g: 0,
  fiberPer100g: 0, sodiumPer100g: 0, waterPer100g: 0,
  position: 1, customText: "Nota conservada", createdAt: "", updatedAt: "",
};
const entry: NutritionPlanFoodEntry = {
  ...alternative, id: "entry", planId: "plan-test", mealId: "meal", foodId: "reference",
  foodName: "Referencia", quantityG: 100, proteinPer100g: 20,
  mealOption: 1, alternatives: [alternative],
};
const secondComponent: NutritionPlanFoodAlternativeComponent = {
  foodId: "second-food", foodName: "Segundo alimento", quantityG: 100,
  quantityUnit: "g", unitWeightG: 1,
  proteinPer100g: 20, carbsPer100g: 0, fatPer100g: 0,
  fiberPer100g: 0, sodiumPer100g: 0, waterPer100g: 0,
  customText: "Nota del segundo alimento",
};

function planInput(food: unknown) {
  return {
    id: "plan-test", athleteUsername: "test", athleteName: "Test", name: "Test",
    status: "review", targetProteinG: 0, targetCarbsG: 0, targetFatG: 0,
    meals: [{ id: "meal", name: "Comida", entries: [food] }],
  };
}

describe("nutrition quantities and alternatives", () => {
  it.each([
    ["g", 178, 180],
    ["g", 174.8, 175],
    ["g", 167, 165],
    ["ml", 178, 180],
    ["g", 2, 5],
    ["piece", 0.1, 0.25],
    ["piece", 0.3, 0.25],
    ["piece", 0.48, 0.5],
    ["piece", 0.74, 0.75],
    ["piece", 0.9, 1],
    ["piece", 1.3, 1.25],
    ["serving", 1.62, 1.5],
  ] as const)("rounds generated %s alternatives from %s to %s", (quantityUnit, equivalent, expected) => {
    const unitWeightG = quantityUnit === "piece" || quantityUnit === "serving" ? 100 : 1;
    const reference = { ...entry, quantityG: equivalent * unitWeightG, proteinPer100g: 10 };
    expect(getEquivalentFoodQuantity(reference, { ...alternative, quantityUnit, unitWeightG })).toBe(expected);
  });

  it("applies practical rounding again when the reference quantity changes", () => {
    const previous = { ...entry, alternatives: [alternative, {
      ...alternative, id: "unit-alternative", quantityUnit: "piece" as const,
      quantityG: 1, unitWeightG: 200,
    }] };
    const updated = updateEntryAlternatives(previous, { ...previous, quantityG: 83 });
    expect(updated.alternatives.map((item) => item.quantityG)).toEqual([165, 0.75]);
    expect(updated.quantityG).toBe(83);
  });

  it.each([150, 50, 100])("matches alternative calories after changing reference to %s grams", (quantityG) => {
    const updated = updateEntryAlternatives(entry, { ...entry, quantityG });
    expect(updated.alternatives[0].quantityG).toBe(quantityG * 2);
    expect(calculateEntryTotals(updated.alternatives[0]).caloriesKcal)
      .toBe(calculateEntryTotals(updated).caloriesKcal);
    expect(updated.alternatives[0].customText).toBe(alternative.customText);
    expect(entry.alternatives[0].quantityG).toBe(200);
  });

  it("recalculates every alternative in its own unit, including fractions", () => {
    const previous = { ...entry, alternatives: [alternative, {
      ...alternative, id: "unit-alternative", quantityUnit: "piece" as const,
      quantityG: 1, unitWeightG: 200,
    }] };
    const updated = updateEntryAlternatives(previous, { ...previous, quantityG: 25 });
    expect(updated.alternatives.map((item) => item.quantityG)).toEqual([50, 0.25]);
  });

  it("recalculates when reference units or unit weight change", () => {
    const updated = updateEntryAlternatives(entry, {
      ...entry, quantityG: 0.5, quantityUnit: "piece", unitWeightG: 100,
    });
    expect(updated.alternatives[0].quantityG).toBe(100);
    const changedWeight = updateEntryAlternatives(updated, { ...updated, unitWeightG: 200 });
    expect(changedWeight.alternatives[0].quantityG).toBe(200);
  });

  it("preserves manual alternatives when only notes change", () => {
    const next = { ...entry, customText: "Nueva nota", alternatives: [{ ...alternative, quantityG: 173 }] };
    expect(updateEntryAlternatives(entry, next)).toBe(next);
  });

  it("does not accumulate rounding errors across repeated edits", () => {
    const original = { ...entry, alternatives: [{ ...alternative, proteinPer100g: 13 }] };
    let current = original;
    for (const quantityG of [77, 301, 23, 100]) {
      current = updateEntryAlternatives(current, { ...current, quantityG });
    }
    expect(current.alternatives[0].quantityG).toBe(getEquivalentFoodQuantity(original, original.alternatives[0]));
  });

  it("handles zero-calorie foods and quantity bounds", () => {
    expect(getEquivalentFoodQuantity(entry, { ...alternative, proteinPer100g: 0 })).toBe(100);
    expect(getEquivalentFoodQuantity({ ...entry, quantityG: 10000 }, { ...alternative, proteinPer100g: 0.001 })).toBe(10000);
  });

  it("keeps half an avocado and calculates its effective weight and nutrients", () => {
    const avocado = { ...entry, quantityG: 0.5, quantityUnit: "piece" as const,
      unitWeightG: 200, proteinPer100g: 2, carbsPer100g: 9, fatPer100g: 15 };
    expect(normalizeFoodQuantity(avocado.quantityG, avocado.quantityUnit)).toBe(0.5);
    expect(getEffectiveQuantityG(avocado)).toBe(100);
    expect(calculateEntryTotals(avocado)).toMatchObject({ proteinG: 2, carbsG: 9, fatG: 15 });
    expect(formatFoodQuantity(0.5, "piece")).toBe("0,5");
    expect(formatFoodQuantity(1.25, "serving")).toBe("1,25");
    expect(normalizeFoodQuantity(100.7, "g")).toBe(101);
    expect(normalizeFoodQuantity(100.7, "ml")).toBe(101);
  });

  it("preserves decimal entries and alternatives through save validation and JSON reload", () => {
    const parsed = nutritionPlanSaveSchema.parse(planInput({
      ...entry, quantityG: "0,5", quantityUnit: "piece", unitWeightG: 200,
      alternatives: [{ ...alternative, quantityG: "1.25", quantityUnit: "serving", unitWeightG: 150 }],
    }));
    const reloaded = nutritionPlanSaveSchema.parse(JSON.parse(JSON.stringify(parsed)));
    expect(reloaded.meals[0].entries[0].quantityG).toBe(0.5);
    expect(reloaded.meals[0].entries[0].alternatives[0].quantityG).toBe(1.25);
  });

  it.each([0, -0.5, 10001, "invalid"])("rejects invalid quantity %s", (quantityG) => {
    expect(nutritionPlanSaveSchema.safeParse(planInput({ ...entry, quantityG, quantityUnit: "piece" })).success).toBe(false);
  });
});

describe("two-food nutrition alternatives", () => {
  it("balances rice plus legumes to half the reference calories per component", () => {
    const rice = { ...entry, foodId: "rice", foodName: "Arroz blanco", quantityG: 200,
      proteinPer100g: 0, carbsPer100g: 30 };
    const riceAndLegumes = { ...alternative, foodId: rice.foodId, foodName: rice.foodName,
      proteinPer100g: rice.proteinPer100g, carbsPer100g: rice.carbsPer100g,
      secondComponent: { ...secondComponent, foodId: "legumes", foodName: "Legumbres",
        proteinPer100g: 5, carbsPer100g: 15 } };

    const balanced = balanceAlternative(rice, riceAndLegumes);

    expect(balanced.quantityG).toBe(100);
    expect(balanced.secondComponent?.quantityG).toBe(150);
    expect(getAlternativeComponents(balanced).map((food) => calculateEntryTotals(food).caloriesKcal))
      .toEqual([120, 120]);
    expect(calculateAlternativeTotals(balanced)).toMatchObject({
      caloriesKcal: 240, proteinG: 7.5, carbsG: 52.5, fatG: 0,
    });
    expect(balanced.customText).toBe(alternative.customText);
    expect(balanced.secondComponent?.customText).toBe(secondComponent.customText);
    expect(riceAndLegumes.quantityG).toBe(200);
    expect(riceAndLegumes.secondComponent.quantityG).toBe(100);
  });

  it("calculates calorie shares before practical rounding to avoid rounding twice", () => {
    const reference = { ...entry, quantityG: 163 };
    const food = { ...alternative, proteinPer100g: 20 };
    expect(getEquivalentFoodQuantity(reference, food)).toBe(165);
    expect(getEquivalentFoodQuantity(reference, food, 0.5)).toBe(80);

    const balanced = balanceAlternative(reference, { ...food, secondComponent });
    expect(balanced.quantityG).toBe(80);
    expect(balanced.secondComponent?.quantityG).toBe(80);
  });

  it("recalculates all simple and double alternatives when the reference changes", () => {
    const previous = { ...entry, alternatives: [alternative,
      { ...alternative, id: "double", secondComponent },
      { ...alternative, id: "mixed-double", quantityUnit: "ml" as const,
        secondComponent: { ...secondComponent, quantityUnit: "piece" as const, unitWeightG: 100 } },
    ] };

    const updated = updateEntryAlternatives(previous, { ...previous, quantityG: 83 });

    expect(updated.alternatives.map((food) => getAlternativeComponents(food).map((part) => part.quantityG)))
      .toEqual([[165], [85, 40], [85, 0.5]]);
    expect(updated.quantityG).toBe(83);
    expect(previous.alternatives[1].secondComponent?.quantityG).toBe(100);
  });

  it.each(["piece", "serving"] as const)("balances %s components in quarter units", (quantityUnit) => {
    const balanced = balanceAlternative({ ...entry, quantityG: 150 }, {
      ...alternative,
      secondComponent: { ...secondComponent, quantityUnit, unitWeightG: 100 },
    });
    expect(balanced.quantityG).toBe(150);
    expect(balanced.secondComponent?.quantityG).toBe(0.75);
    expect(getAlternativeComponents(balanced).map((food) => calculateEntryTotals(food).caloriesKcal))
      .toEqual([60, 60]);
  });

  it("rebalances both components when the reference unit weight changes", () => {
    const previous = { ...entry, quantityG: 0.5, quantityUnit: "piece" as const, unitWeightG: 100,
      alternatives: [{ ...alternative, secondComponent }] };
    const updated = updateEntryAlternatives(previous, { ...previous, unitWeightG: 200 });
    expect(updated.alternatives[0].quantityG).toBe(100);
    expect(updated.alternatives[0].secondComponent?.quantityG).toBe(50);
    expect(calculateAlternativeTotals(updated.alternatives[0]).caloriesKcal)
      .toBe(calculateEntryTotals(updated).caloriesKcal);
  });

  it("restores the remaining component to the full calorie target after removing the second", () => {
    const balanced = balanceAlternative(entry, { ...alternative, secondComponent });
    expect(balanced.quantityG).toBe(100);
    const simple = balanceAlternative(entry, { ...balanced, secondComponent: undefined });
    expect(simple.quantityG).toBe(200);
    expect(getAlternativeComponents(simple)).toHaveLength(1);
    expect(calculateAlternativeTotals(simple)).toEqual(calculateEntryTotals(entry));
  });

  it("preserves manual amounts in both components when only notes change", () => {
    const previous = { ...entry, alternatives: [{ ...alternative, quantityG: 173,
      secondComponent: { ...secondComponent, quantityG: 61 } }] };
    const next = { ...previous, customText: "Nueva nota" };
    expect(updateEntryAlternatives(previous, next)).toBe(next);
    expect(next.alternatives[0].quantityG).toBe(173);
    expect(next.alternatives[0].secondComponent.quantityG).toBe(61);
  });

  it("keeps both calorie shares stable across repeated reference edits", () => {
    const original = { ...entry, alternatives: [{ ...alternative, proteinPer100g: 13,
      secondComponent: { ...secondComponent, proteinPer100g: 17 } }] };
    let current: NutritionPlanFoodEntry = original;
    for (const quantityG of [77, 301, 23, 100]) {
      current = updateEntryAlternatives(current, { ...current, quantityG });
    }
    expect(current.alternatives[0]).toEqual(balanceAlternative(original, original.alternatives[0]));
  });

  it("retains practical minimums and half-weight fallback for zero-calorie components", () => {
    const balanced = balanceAlternative({ ...entry, quantityG: 3 }, {
      ...alternative, secondComponent: { ...secondComponent, quantityUnit: "piece", unitWeightG: 100 },
    });
    expect(balanced.quantityG).toBe(5);
    expect(balanced.secondComponent?.quantityG).toBe(0.25);
    expect(getEquivalentFoodQuantity(entry, { ...alternative, proteinPer100g: 0 }, 0.5)).toBe(50);
  });

  it("keeps existing single-food alternative totals and calorie matching unchanged", () => {
    expect(getAlternativeComponents(alternative)).toEqual([alternative]);
    expect(calculateAlternativeTotals(alternative)).toEqual(calculateEntryTotals(alternative));
    expect(balanceAlternative(entry, alternative)).toEqual(alternative);
    expect(balanceAlternative(entry, alternative)).not.toHaveProperty("secondComponent");
  });
});
