import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";
import { describe, expect, it } from "vitest";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import type { AthleteRoadmapStep } from "@/lib/nutrition/types";
import { makeCardPlan } from "./fixtures/nutrition-card-plan";
import { makeDoubleAlternativePlan } from "./fixtures/nutrition-double-alternative";

async function inspect(data: Buffer) {
  const document = await getDocument({ data: new Uint8Array(data), useSystemFonts: true }).promise;
  try {
    const pages = [];
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const text = await page.getTextContent();
      const items = text.items.filter((item) => "str" in item);
      pages.push({ text: items.map((item) => item.str).join(" ").replace(/\s+/g, " "),
        width: page.view[2], height: page.view[3], annotations: await page.getAnnotations(), items });
    }
    const destinations = new Map<string, number>();
    for (const [name, destination] of Object.entries(await document.getDestinations())) {
      destinations.set(name, await document.getPageIndex(destination[0]) + 1);
    }
    return { pages, destinations };
  } finally { await document.destroy(); }
}

describe("nutrition PDF index and reference layout", () => {
  it.each([true, false])("links the index to real section pages and back (macros %s)", async (includeMacros) => {
    const { pages, destinations } = await inspect(await renderNutritionPlanPdf(makeCardPlan(), { includeMacros }));
    expect(destinations.get("nutrition-contents")).toBe(2);
    const index = pages[1];
    expect(index.text).toContain("INDICE");
    expect(index.text).toContain("DESAYUNO");
    expect(index.text).toContain("CENA");
    expect(index.text).toContain("SUPLEMENTACION");
    expect(index.text.includes("MACROS POR COMIDA")).toBe(includeMacros);
    const links = index.annotations.filter((annotation) => annotation.subtype === "Link");
    expect(links).toHaveLength(includeMacros ? 8 : 6);
    for (const link of links) {
      expect(destinations.has(link.dest)).toBe(true);
      const firstPage = destinations.get(link.dest)!;
      expect(firstPage).toBeGreaterThan(2);
      expect(index.text).toContain(`P. ${firstPage}`);
      expect(pages[firstPage - 1].annotations.some((annotation) => annotation.dest === "nutrition-contents")).toBe(true);
    }
    const breakfastStart = destinations.get("nutrition-section-1")!;
    expect(pages[breakfastStart - 1].text).toContain("DESAYUNO");
    const breakfastPages = pages.map((page, i) => ({ ...page, number: i + 1 }))
      .filter((page) => page.text.includes("DESAYUNO") && page.text.includes("OPCION 1"));
    const breakfastEnd = breakfastPages[breakfastPages.length - 1].number;
    expect(index.text).toContain(breakfastStart === breakfastEnd ? `P. ${breakfastStart}` : `P. ${breakfastStart}-${breakfastEnd}`);
    for (const page of pages) {
      expect(page.width).toBe(960);
      expect(page.height).toBe(540);
    }
  }, 30_000);

  it("extends the index and keeps duplicate meal names in different plans linked correctly", async () => {
    const plan = makeDoubleAlternativePlan();
    plan.name = "Plan principal";
    const template = plan.meals[0];
    plan.meals = Array.from({ length: 12 }, (_, index) => ({ ...structuredClone(template), id: `meal-${index}`,
      name: `Comida numero ${index + 1}`, position: index + 1 }));
    const comparison = structuredClone(plan);
    comparison.id = "second-plan";
    comparison.name = "Plan comparado";
    comparison.meals = [comparison.meals[0]];
    const { pages, destinations } = await inspect(await renderNutritionPlanPdf(plan, { includeMacros: false, comparisonPlans: [comparison] }));
    const indexPages = pages.filter((page) => page.text.includes("Pulsa un bloque"));
    expect(indexPages).toHaveLength(2);
    const links = indexPages.flatMap((page) => page.annotations.filter((annotation) => annotation.subtype === "Link"));
    expect(links).toHaveLength(18);
    expect(new Set(links.map((link) => link.dest)).size).toBe(18);
    const firstMeal = pages[destinations.get("nutrition-section-1")! - 1];
    const comparedMeal = pages[destinations.get("nutrition-section-14")! - 1];
    expect(firstMeal.text).toContain("PLAN 1 / PLAN PRINCIPAL");
    expect(comparedMeal.text).toContain("PLAN 2 / PLAN COMPARADO");
    expect(firstMeal.text).toContain("COMIDA NUMERO 1");
    expect(comparedMeal.text).toContain("COMIDA NUMERO 1");
    for (const link of links) expect(destinations.get(link.dest)).toBeGreaterThan(3);
  }, 30_000);

  it("keeps long notes and recommendations in full, with correct index ranges", async () => {
    const plan = makeDoubleAlternativePlan();
    const noteLines = Array.from({ length: 48 }, (_, i) => `Nota-${i + 1} del nutricionista para esta comida.`);
    const recommendationLines = Array.from({ length: 47 }, (_, i) => `Pauta-${i + 1} personalizada del plan.`);
    plan.meals[0].notes = noteLines.join("\n");
    plan.recommendations = recommendationLines.join("\n");
    const { pages, destinations } = await inspect(await renderNutritionPlanPdf(plan, { includeMacros: false }));
    const fullText = pages.map((page) => page.text).join(" ");
    for (const line of [...noteLines, ...recommendationLines]) expect(fullText.split(line)).toHaveLength(2);
    const mealStart = destinations.get("nutrition-section-1")!;
    expect(pages[mealStart - 1].text).toContain("OBSERVACIONES DE LA COMIDA");
    const mealEnd = destinations.get("nutrition-section-2")! - 1;
    expect(pages[1].text).toContain(`P. ${mealStart}-${mealEnd}`);
    expect(pages[mealEnd - 1].text).toContain("100 g de Arroz blanco");
    for (const page of pages) for (const item of page.items) {
      if (/Nota-\d|Pauta-\d/.test(item.str)) {
        expect(item.transform[5]).toBeGreaterThan(65);
        expect(item.transform[4] + item.width).toBeLessThan(928);
      }
    }
  }, 30_000);

  it("places four brief options in a 2 x 2 grid without mixing their foods", async () => {
    const plan = makeDoubleAlternativePlan();
    const template = plan.meals[0].entries[0];
    plan.meals[0].entries = [1, 2, 3, 4].map((option) => ({ ...template,
      id: `food-${option}`, foodName: `Alimento-${option}`, mealOption: option, alternatives: [] }));
    const { pages } = await inspect(await renderNutritionPlanPdf(plan, { includeMacros: false }));
    const menuPages = pages.filter((page) => page.text.includes("OPCION 1"));
    expect(menuPages).toHaveLength(1);
    for (const option of [1, 2, 3, 4]) expect(menuPages[0].text).toContain(`100 g de Alimento-${option}`);
    const headings = [1, 2, 3, 4].map((option) => menuPages[0].items.find((item) => item.str === `OPCION ${option}`)!);
    expect(headings[0].transform[5]).toBe(headings[1].transform[5]);
    expect(headings[2].transform[5]).toBe(headings[3].transform[5]);
    expect(headings[0].transform[5]).toBeGreaterThan(headings[2].transform[5]);
    expect(headings[0].transform[4]).toBe(headings[2].transform[4]);
  }, 30_000);

  it("preserves roadmap dates, statuses and long descriptions across indexed pages", async () => {
    const plan = makeDoubleAlternativePlan();
    const markers = Array.from({ length: 35 }, (_, index) => `Paso-${index + 1} de la descripcion de la etapa actual.`);
    const roadmapSteps: AthleteRoadmapStep[] = Array.from({ length: 4 }, (_, index) => ({
      id: `step-${index}`, athleteUsername: plan.athleteUsername, title: `Etapa ${index + 1}`,
      status: index === 0 ? "current" : "pending", description: index === 0 ? markers.join("\n") : "Descripcion de ejemplo.",
      startDate: "2026-10-01", endDate: "2026-10-31", position: index + 1, createdAt: "", updatedAt: "",
    }));
    const { pages, destinations } = await inspect(await renderNutritionPlanPdf(plan, { includeMacros: false, roadmapSteps }));
    const start = destinations.get("nutrition-section-5")!;
    expect(pages[1].text).toContain(`P. ${start}-${pages.length}`);
    const roadmap = pages.slice(start - 1).map((page) => page.text).join(" ");
    expect(roadmap).toContain("HOJA DE RUTA");
    expect(roadmap).toContain("ACTUAL");
    expect(roadmap).toContain("PENDIENTE");
    expect(roadmap).toContain("01/10/2026 - 31/10/2026");
    for (const marker of markers) expect(roadmap.split(marker)).toHaveLength(2);
    for (const index of [1, 2, 3, 4]) expect(roadmap).toContain(`ETAPA ${index}`);
  }, 30_000);
});
