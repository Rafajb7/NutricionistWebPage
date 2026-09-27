import { describe, expect, it } from "vitest";
import {
  balanceAlternative,
  calculateAlternativeTotals,
  getAlternativeComponents,
  getEquivalentFoodQuantity,
  MAX_ALTERNATIVE_COMPONENTS,
  updateEntryAlternatives,
  withAlternativeComponents,
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
    expect(balanced.additionalComponents?.[0].quantityG).toBe(150);
    expect(getAlternativeComponents(balanced).map((food) => calculateEntryTotals(food).caloriesKcal))
      .toEqual([120, 120]);
    expect(calculateAlternativeTotals(balanced)).toMatchObject({
      caloriesKcal: 240, proteinG: 7.5, carbsG: 52.5, fatG: 0,
    });
    expect(balanced.customText).toBe(alternative.customText);
    expect(balanced.additionalComponents?.[0].customText).toBe(secondComponent.customText);
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
    expect(balanced.additionalComponents?.[0].quantityG).toBe(80);
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
    expect(balanced.additionalComponents?.[0].quantityG).toBe(0.75);
    expect(getAlternativeComponents(balanced).map((food) => calculateEntryTotals(food).caloriesKcal))
      .toEqual([60, 60]);
  });

  it("rebalances both components when the reference unit weight changes", () => {
    const previous = { ...entry, quantityG: 0.5, quantityUnit: "piece" as const, unitWeightG: 100,
      alternatives: [{ ...alternative, secondComponent }] };
    const updated = updateEntryAlternatives(previous, { ...previous, unitWeightG: 200 });
    expect(updated.alternatives[0].quantityG).toBe(100);
    expect(updated.alternatives[0].additionalComponents?.[0].quantityG).toBe(50);
    expect(calculateAlternativeTotals(updated.alternatives[0]).caloriesKcal)
      .toBe(calculateEntryTotals(updated).caloriesKcal);
  });

  it("restores the remaining component to the full calorie target after removing the second", () => {
    const balanced = balanceAlternative(entry, { ...alternative, secondComponent });
    expect(balanced.quantityG).toBe(100);
    const simple = balanceAlternative(entry, withAlternativeComponents(balanced, [balanced]));
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
    expect(balanced.additionalComponents?.[0].quantityG).toBe(0.25);
    expect(getEquivalentFoodQuantity(entry, { ...alternative, proteinPer100g: 0 }, 0.5)).toBe(50);
  });

  it("keeps existing single-food alternative totals and calorie matching unchanged", () => {
    expect(getAlternativeComponents(alternative)).toEqual([alternative]);
    expect(calculateAlternativeTotals(alternative)).toEqual(calculateEntryTotals(alternative));
    expect(balanceAlternative(entry, alternative)).toEqual({ ...alternative, additionalComponents: [] });
    expect(balanceAlternative(entry, alternative)).not.toHaveProperty("secondComponent");
  });
});

describe("alternatives with up to five foods", () => {
  const densities = [10, 20, 40, 8, 16];
  const components = densities.map((proteinPer100g, index): NutritionPlanFoodAlternativeComponent => ({
    ...secondComponent,
    foodId: `component-${index + 1}`,
    foodName: `Alimento ${index + 1}`,
    proteinPer100g,
  }));

  it.each([
    [3, [2000, 1000, 500]],
    [4, [1500, 750, 375, 1875]],
    [5, [1200, 600, 300, 1500, 750]],
  ] as const)("shares the reference calories evenly across %s different foods", (count, expectedQuantities) => {
    const candidate = withAlternativeComponents(alternative, components.slice(0, count));
    const reference = { ...entry, quantityG: 3000 };
    const balanced = balanceAlternative(reference, candidate);
    const foods = getAlternativeComponents(balanced);

    expect(foods.map((food) => food.quantityG)).toEqual(expectedQuantities);
    expect(foods.map((food) => calculateEntryTotals(food).caloriesKcal))
      .toEqual(Array(count).fill(2400 / count));
    expect(calculateAlternativeTotals(balanced).caloriesKcal).toBe(2400);
    expect(balanced).not.toHaveProperty("secondComponent");
    expect(candidate.additionalComponents?.map((food) => food.quantityG))
      .toEqual(Array(count - 1).fill(100));
  });

  it("uses an exact one-third share instead of a rounded percentage", () => {
    const candidate = withAlternativeComponents(alternative, [components[0], components[0], components[0]]);
    const balanced = balanceAlternative({ ...entry, quantityG: 3000 }, candidate);
    expect(getAlternativeComponents(balanced).map((food) => food.quantityG)).toEqual([2000, 2000, 2000]);
    expect(calculateAlternativeTotals(balanced).caloriesKcal).toBe(2400);
  });

  it.each([
    [3, [55, 30, 0.25]],
    [4, [40, 20, 0.25, 0.5]],
    [5, [35, 15, 0.25, 0.25, 15]],
  ] as const)("recalculates %s mixed-unit foods with the usual rounding", (count, expectedQuantities) => {
    const mixedComponents: NutritionPlanFoodAlternativeComponent[] = [
      components[0],
      { ...secondComponent, quantityUnit: "ml" },
      { ...secondComponent, quantityUnit: "piece", unitWeightG: 100 },
      { ...secondComponent, quantityUnit: "serving", unitWeightG: 50 },
      secondComponent,
    ];
    const previous = { ...entry,
      alternatives: [withAlternativeComponents(alternative, mixedComponents.slice(0, count))] };
    const updated = updateEntryAlternatives(previous, { ...previous, quantityG: 83 });
    expect(getAlternativeComponents(updated.alternatives[0]).map((food) => food.quantityG))
      .toEqual(expectedQuantities);
  });

  it("preserves alternative metadata when promoting a different food to the first component", () => {
    const legacy = { ...alternative, secondComponent, position: 4, createdAt: "created", updatedAt: "updated" };
    const otherAlternative = { ...alternative, ...components[1], id: "other-alternative", position: 99 };
    const canonical = withAlternativeComponents(legacy, [otherAlternative, legacy, components[2]]);

    expect(canonical).toMatchObject({
      id: alternative.id, entryId: alternative.entryId, position: 4,
      createdAt: "created", updatedAt: "updated", foodId: components[1].foodId,
      customText: components[1].customText,
    });
    expect(canonical).not.toHaveProperty("secondComponent");
    expect(canonical.additionalComponents?.[0]).not.toHaveProperty("secondComponent");
    expect(canonical.additionalComponents?.[0]).not.toHaveProperty("additionalComponents");
    expect(canonical.additionalComponents?.[0]).not.toHaveProperty("id");
    expect(legacy.secondComponent).toBe(secondComponent);
  });

  it("rebalances all remaining foods after removing a middle component", () => {
    const five = balanceAlternative({ ...entry, quantityG: 3000 },
      withAlternativeComponents(alternative, components));
    const remaining = getAlternativeComponents(five).filter((_, index) => index !== 2);
    const four = balanceAlternative({ ...entry, quantityG: 3000 }, withAlternativeComponents(five, remaining));

    expect(getAlternativeComponents(four).map((food) => food.foodId))
      .toEqual(["component-1", "component-2", "component-4", "component-5"]);
    expect(getAlternativeComponents(four).map((food) => food.quantityG))
      .toEqual([1500, 750, 1875, 940]);
    expect(getAlternativeComponents(four).map((food) => calculateEntryTotals(food).caloriesKcal))
      .toEqual([600, 600, 600, 602]);
    expect(getAlternativeComponents(five)).toHaveLength(5);
  });

  it("preserves identity and restores a single food after removing every other component", () => {
    const many = withAlternativeComponents(alternative, components);
    const last = balanceAlternative(entry, withAlternativeComponents(many, [components[4]]));
    expect(last.foodId).toBe("component-5");
    expect(last.id).toBe(alternative.id);
    expect(last.additionalComponents).toEqual([]);
    expect(last.quantityG).toBe(125);
    expect(calculateAlternativeTotals(last).caloriesKcal).toBe(80);
  });

  it("reads old single and double alternatives and canonicalizes them when balanced", () => {
    const legacy = { ...alternative, secondComponent };
    expect(getAlternativeComponents(legacy)).toEqual([legacy, secondComponent]);
    const balanced = balanceAlternative(entry, legacy);
    expect(balanced.quantityG).toBe(100);
    expect(balanced.additionalComponents).toEqual([{ ...secondComponent, quantityG: 50 }]);
    expect(balanced).not.toHaveProperty("secondComponent");
    expect(balanceAlternative(entry, alternative).additionalComponents).toEqual([]);
  });

  it("gives canonical components precedence over the legacy alias without counting it twice", () => {
    const canonical = { ...withAlternativeComponents(alternative, components.slice(0, 3)), secondComponent };
    expect(getAlternativeComponents(canonical)).toHaveLength(3);
    expect(getAlternativeComponents(canonical).map((food) => food.foodId))
      .toEqual(["component-1", "component-2", "component-3"]);
    const balanced = balanceAlternative(entry, canonical);
    expect(balanced.additionalComponents).toHaveLength(2);
    expect(balanced).not.toHaveProperty("secondComponent");
  });

  it("treats an explicit empty component list as a single food despite a legacy alias", () => {
    const canonical = { ...alternative, additionalComponents: [], secondComponent };
    expect(getAlternativeComponents(canonical)).toEqual([canonical]);
    expect(calculateAlternativeTotals(canonical)).toEqual(calculateEntryTotals(alternative));
    const balanced = balanceAlternative(entry, canonical);
    expect(balanced.quantityG).toBe(200);
    expect(balanced.additionalComponents).toEqual([]);
    expect(balanced).not.toHaveProperty("secondComponent");
  });

  it("rejects empty or oversized alternatives without silently dropping any food", () => {
    expect(MAX_ALTERNATIVE_COMPONENTS).toBe(5);
    expect(() => withAlternativeComponents(alternative, [])).toThrow(RangeError);
    expect(() => withAlternativeComponents(alternative, [...components, secondComponent])).toThrow(RangeError);
    expect(() => balanceAlternative(entry, { ...alternative, additionalComponents: components })).toThrow(RangeError);
    expect(getAlternativeComponents(withAlternativeComponents(alternative, [components[0]]))).toHaveLength(1);
    expect(getAlternativeComponents(withAlternativeComponents(alternative, components))).toHaveLength(5);
  });
});
