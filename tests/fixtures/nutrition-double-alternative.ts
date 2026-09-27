import { nutritionPlanSaveSchema } from "@/lib/nutrition/validation";
import type { NutritionPlanFull } from "@/lib/nutrition/types";

export function makeDoubleAlternativePlan(): NutritionPlanFull {
  const rice = {
    foodId: "rice-food", foodName: "Arroz blanco", quantityG: 100,
    quantityUnit: "g", unitWeightG: 1, proteinPer100g: 0, carbsPer100g: 25,
    fatPer100g: 0, fiberPer100g: 0, sodiumPer100g: 0, waterPer100g: 0,
  };
  return nutritionPlanSaveSchema.parse({
    id: "plan-double", athleteUsername: "athlete", athleteName: "Atleta de prueba",
    name: "Plan con alternativa conjunta", status: "published",
    targetProteinG: 100, targetCarbsG: 200, targetFatG: 60,
    updatedAt: "2026-09-25T10:00:00.000Z",
    meals: [{ id: "meal", name: "Comida", entries: [{
      ...rice, id: "entry", alternatives: [{
        ...rice, id: "alternative", quantityG: 50,
        additionalComponents: [{
          ...rice, foodId: "lentils-food", foodName: "Lentejas", quantityG: 25,
          proteinPer100g: 20, carbsPer100g: 30, customText: "",
        }],
      }],
    }] }],
  });
}

export function makeFiveComponentAlternativePlan(): NutritionPlanFull {
  const plan = makeDoubleAlternativePlan();
  const alternative = plan.meals[0].entries[0].alternatives[0];
  const extra = alternative.additionalComponents![0];
  alternative.additionalComponents = ["Lentejas", "Garbanzos", "Alubias", "Guisantes"].map((name, index) => ({
    ...extra, foodId: `component-${index + 2}`, foodName: name,
  }));
  return plan;
}
