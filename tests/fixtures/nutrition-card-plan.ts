import { makeDoubleAlternativePlan } from "./nutrition-double-alternative";
import type { NutritionPlanFoodEntry } from "@/lib/nutrition/types";

export function makeCardPlan() {
  const plan = makeDoubleAlternativePlan();
  plan.name = "Plan de ejemplo - tarjetas por alimento";
  plan.athleteName = "Atleta de ejemplo";
  const meal = plan.meals[0];
  meal.name = "Desayuno";
  const template = meal.entries[0];
  const foods = [
    { name: "Crema de arroz", quantity: 60, protein: 7, carbs: 80, fat: 1, alternatives: ["Corn flakes", "Copos de avena", "Harina de avena"] },
    { name: "Proteina en polvo isolada", quantity: 20, protein: 85, carbs: 3, fat: 1, alternatives: [] },
    { name: "Bebida de arroz y avellanas", quantity: 300, protein: 0.5, carbs: 9, fat: 1.5, alternatives: ["Leche desnatada"] },
    { name: "Kiwi crudo", quantity: 100, protein: 1, carbs: 11, fat: 0.5, alternatives: [] },
    { name: "Crema de cacahuete", quantity: 15, protein: 26, carbs: 12, fat: 50, alternatives: ["Chocolate negro 85%"] },
  ];
  meal.entries = [1, 2, 3].flatMap((option) => foods.map((food, index): NutritionPlanFoodEntry => ({
    ...template, id: `food-${option}-${index}`, foodId: `catalog-${index}`, foodName: food.name,
    quantityG: food.quantity, mealOption: option, position: index + 1,
    proteinPer100g: food.protein, carbsPer100g: food.carbs, fatPer100g: food.fat,
    alternatives: food.alternatives.map((name, alternativeIndex) => ({
      ...template.alternatives[0], id: `alt-${option}-${index}-${alternativeIndex}`, entryId: `food-${option}-${index}`,
      foodName: name, foodId: `catalog-alt-${index}-${alternativeIndex}`, additionalComponents: [],
      quantityG: name.includes("Chocolate") ? 20 : food.quantity,
      quantityUnit: name.includes("Leche") ? "ml" : "g", position: alternativeIndex + 1,
      proteinPer100g: food.protein, carbsPer100g: food.carbs, fatPer100g: food.fat,
    })),
  })));
  plan.meals.push({ ...meal, id: "dinner", name: "Cena", position: 2, entries: meal.entries
    .filter((entry) => entry.mealOption === 1).map((entry) => ({ ...structuredClone(entry), id: `dinner-${entry.id}`, mealId: "dinner" })) });
  return plan;
}
