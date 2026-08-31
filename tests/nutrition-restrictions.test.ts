import { describe, expect, it } from "vitest";
import {
  getRestrictionConflict,
  inferRestrictionTagsForFood
} from "@/lib/nutrition/restrictions";
import type { NutritionAthleteRestriction, NutritionFood } from "@/lib/nutrition/types";

function restriction(input: Partial<NutritionAthleteRestriction>): NutritionAthleteRestriction {
  return {
    id: input.id ?? "r",
    athleteUsername: input.athleteUsername ?? "athlete",
    type: input.type ?? "intolerance",
    key: input.key ?? "lactose",
    foodId: input.foodId ?? "",
    label: input.label ?? "Lactosa",
    notes: input.notes ?? "",
    createdAt: "",
    updatedAt: ""
  };
}

function food(input: Partial<NutritionFood>): NutritionFood {
  return {
    id: input.id ?? "f",
    name: input.name ?? "Food",
    category: input.category ?? "",
    referenceUnit: "100g",
    proteinPer100g: 0,
    carbsPer100g: 0,
    fatPer100g: 0,
    sodiumPer100g: 0,
    waterPer100g: 0,
    restrictionTags: input.restrictionTags ?? [],
    active: true,
    createdAt: "",
    updatedAt: ""
  };
}

describe("nutrition restrictions", () => {
  it("infers common gluten and lactose tags from catalog names", () => {
    expect(inferRestrictionTagsForFood({ name: "Pan integral", category: "Hidratos" })).toContain("gluten");
    expect(inferRestrictionTagsForFood({ name: "Leche entera", category: "Huevos y lacteos" })).toEqual(
      expect.arrayContaining(["milk", "lactose", "animal_dairy"])
    );
    expect(inferRestrictionTagsForFood({ name: "Leche de coco", category: "Grasas" })).not.toContain("milk");
  });

  it("marks diet and dislike conflicts without adding them to nutrition totals", () => {
    const chicken = food({
      id: "chicken",
      restrictionTags: ["animal_meat", "animal_poultry"]
    });
    const rice = food({ id: "rice", restrictionTags: [] });
    const vegan = restriction({ type: "diet", key: "diet_vegan", label: "Vegana" });
    const dislikeRice = restriction({
      type: "dislike",
      key: "food_dislike",
      foodId: "rice",
      label: "Arroz"
    });

    expect(getRestrictionConflict(chicken, [vegan])?.key).toBe("diet_vegan");
    expect(getRestrictionConflict(rice, [vegan])).toBeNull();
    expect(getRestrictionConflict(rice, [dislikeRice])?.type).toBe("dislike");
  });
});
