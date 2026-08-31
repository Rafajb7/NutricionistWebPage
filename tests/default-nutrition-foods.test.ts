import { describe, expect, it } from "vitest";
import { DEFAULT_NUTRITION_FOODS } from "@/lib/nutrition/default-foods";

function normalizeFoodName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .trim()
    .toLowerCase();
}

describe("DEFAULT_NUTRITION_FOODS", () => {
  it("contains a broad default food catalog without duplicates", () => {
    expect(DEFAULT_NUTRITION_FOODS.length).toBeGreaterThanOrEqual(190);

    const ids = new Set(DEFAULT_NUTRITION_FOODS.map((food) => food.id));
    const names = new Set(DEFAULT_NUTRITION_FOODS.map((food) => normalizeFoodName(food.name)));

    expect(ids.size).toBe(DEFAULT_NUTRITION_FOODS.length);
    expect(names.size).toBe(DEFAULT_NUTRITION_FOODS.length);
  });

  it("keeps default nutrient values inside accepted spreadsheet ranges", () => {
    for (const food of DEFAULT_NUTRITION_FOODS) {
      expect(food.name.trim()).not.toBe("");
      expect(food.category.trim()).not.toBe("");
      expect(food.proteinPer100g).toBeGreaterThanOrEqual(0);
      expect(food.proteinPer100g).toBeLessThanOrEqual(200);
      expect(food.carbsPer100g).toBeGreaterThanOrEqual(0);
      expect(food.carbsPer100g).toBeLessThanOrEqual(200);
      expect(food.fatPer100g).toBeGreaterThanOrEqual(0);
      expect(food.fatPer100g).toBeLessThanOrEqual(200);
      expect(food.sodiumPer100g).toBeGreaterThanOrEqual(0);
      expect(food.sodiumPer100g).toBeLessThanOrEqual(100000);
      expect(food.waterPer100g).toBeGreaterThanOrEqual(0);
      expect(food.waterPer100g).toBeLessThanOrEqual(100);
    }
  });
});
