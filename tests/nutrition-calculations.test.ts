import { describe, expect, it } from "vitest";
import {
  calculateEntryTotals,
  calculateMacroPercent,
  calculateMealTotals,
  getMacroRemaining
} from "@/lib/nutrition/calculations";

describe("nutrition calculations", () => {
  it("scales nutrients from 100 g reference values", () => {
    const totals = calculateEntryTotals({
      quantityG: 150,
      proteinPer100g: 20,
      carbsPer100g: 50,
      fatPer100g: 10,
      sodiumPer100g: 100,
      waterPer100g: 30
    });

    expect(totals.proteinG).toBe(30);
    expect(totals.carbsG).toBe(75);
    expect(totals.fatG).toBe(15);
    expect(totals.sodiumMg).toBe(150);
    expect(totals.waterG).toBe(45);
    expect(totals.caloriesKcal).toBe(555);
  });

  it("aggregates meal totals and reports progress", () => {
    const totals = calculateMealTotals([
      {
        id: "a",
        planId: "p",
        mealId: "m",
        foodId: "f",
        foodName: "Arroz",
        quantityG: 100,
        proteinPer100g: 8,
        carbsPer100g: 70,
        fatPer100g: 1,
        sodiumPer100g: 5,
        waterPer100g: 12,
        position: 1,
        customText: "",
        alternatives: [],
        createdAt: "",
        updatedAt: ""
      },
      {
        id: "b",
        planId: "p",
        mealId: "m",
        foodId: "f2",
        foodName: "Huevos",
        quantityG: 200,
        proteinPer100g: 13,
        carbsPer100g: 1,
        fatPer100g: 11,
        sodiumPer100g: 140,
        waterPer100g: 75,
        position: 2,
        customText: "",
        alternatives: [],
        createdAt: "",
        updatedAt: ""
      }
    ]);

    expect(totals.proteinG).toBe(34);
    expect(totals.carbsG).toBe(72);
    expect(totals.fatG).toBe(23);
    expect(calculateMacroPercent(81, 100)).toBe(81);
    expect(getMacroRemaining(86, 80)).toBe(-6);
  });
});
