import { PDFParse } from "pdf-parse";
import { describe, expect, it } from "vitest";
import { renderNutritionPlanPdf } from "@/lib/nutrition/pdf";
import type { NutritionPlanFull } from "@/lib/nutrition/types";
import { makeDoubleAlternativePlan, makeFiveComponentAlternativePlan } from "./fixtures/nutrition-double-alternative";
import { makeCardPlan } from "./fixtures/nutrition-card-plan";

const normalizeText = (text: string) => text.replace(/\s+/g, " ").trim();

async function renderedDocument(plan: NutritionPlanFull, includeMacros = true) {
  const data = await renderNutritionPlanPdf(plan, { includeMacros });
  expect(data.subarray(0, 5).toString()).toBe("%PDF-");
  const parser = new PDFParse({ data });
  try {
    const parsed = await parser.getText();
    const info = await parser.getInfo({ parsePageInfo: true });
    return {
      text: normalizeText(parsed.text),
      pages: parsed.pages.map((page) => normalizeText(page.text)),
      dimensions: info.pages,
    };
  } finally {
    await parser.destroy();
  }
}

describe("food cards in the generated PDF", () => {
  it("renders the reference and joint alternative with individual quantities and combined macros", async () => {
    const { pages } = await renderedDocument(makeDoubleAlternativePlan());
    const page = pages.find((candidate) => candidate.includes("OPCION 1"))!;
    expect(page).toContain("Arroz blanco 100 g");
    expect(page).toContain("Alternativas JUNTOS - 2 ALIMENTOS");
    expect(page).toContain("Arroz blanco 50 g Lentejas 25 g");
    expect(page).toContain("100 kcal P 5 g C 20 g G 0 g");
    expect(page).not.toMatch(/CANTIDAD|ALIMENTO BASE/);
  }, 30_000);

  it.each([1, 2, 3, 4, 5])("renders all %i canonical components and sums their nutrients", async (count) => {
    const plan = makeFiveComponentAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.additionalComponents = alternative.additionalComponents!.slice(0, count - 1);
    const { pages } = await renderedDocument(plan);
    const page = pages.find((candidate) => candidate.includes("Alternativas"))!;
    expect(page).toBeDefined();
    expect(page).toContain("Arroz blanco 50 g");
    for (const component of alternative.additionalComponents) expect(page).toContain(`${component.foodName} 25 g`);
    expect(page).toContain(`${count * 50} kcal`);
    if (count === 1) expect(page).not.toContain("JUNTOS");
    else expect(page).toContain(`JUNTOS - ${count} ALIMENTOS`);
  }, 30_000);

  it("retains joint foods and fractional units when macros are hidden", async () => {
    const plan = makeFiveComponentAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    Object.assign(alternative.additionalComponents![0], {
      foodName: "Aguacate", quantityG: 0.5, quantityUnit: "piece", unitWeightG: 200,
    });
    Object.assign(alternative.additionalComponents![1], {
      foodName: "Fruta", quantityG: 1.25, quantityUnit: "serving", unitWeightG: 150,
    });
    const { text } = await renderedDocument(plan, false);
    expect(text).toContain("JUNTOS - 5 ALIMENTOS");
    expect(text).toContain("Arroz blanco 50 g Aguacate 0,5 ud Fruta 1,25 rac.");
    expect(text).not.toMatch(/kcal|SODIO|ENERGIA TOTAL|\bFibra\b|\bAgua\b|Na 0 mg/i);
  }, 30_000);

  it("reads legacy secondComponent alternatives when the canonical array is absent", async () => {
    const plan = makeDoubleAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.secondComponent = alternative.additionalComponents![0];
    delete alternative.additionalComponents;
    const { text } = await renderedDocument(plan);
    expect(text).toContain("JUNTOS - 2 ALIMENTOS");
    expect(text).toContain("Arroz blanco 50 g Lentejas 25 g");
    expect(text).toContain("100 kcal P 5 g C 20 g G 0 g");
  }, 30_000);

  it.each([false, true])("gives canonical arrays priority over the legacy alias, including empty arrays (%s)", async (empty) => {
    const plan = makeDoubleAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.secondComponent = { ...alternative.additionalComponents![0], foodName: "Alias antiguo ignorado" };
    if (empty) alternative.additionalComponents = [];
    const { text } = await renderedDocument(plan);
    expect(text).not.toContain("Alias antiguo ignorado");
    expect(text).toContain("Alternativas");
    if (empty) {
      expect(text).not.toContain("JUNTOS");
      expect(text).not.toContain("Lentejas");
    } else {
      expect(text).toContain("JUNTOS - 2 ALIMENTOS");
      expect(text).toContain("100 kcal P 5 g C 20 g G 0 g");
    }
  }, 30_000);

  it("uses custom display text instead of catalog names for every food", async () => {
    const plan = makeDoubleAlternativePlan();
    const entry = plan.meals[0].entries[0];
    entry.customText = "Cereal cocido de referencia";
    entry.alternatives[0].customText = "Cereal integral preparado";
    entry.alternatives[0].additionalComponents![0].customText = "Legumbres cocidas y escurridas";
    const { text } = await renderedDocument(plan, false);
    expect(text).toContain("Cereal cocido de referencia 100 g");
    expect(text).toContain("Cereal integral preparado 50 g Legumbres cocidas y escurridas 25 g");
    expect(text).not.toMatch(/Arroz blanco|Lentejas/);
  }, 30_000);

  it("normalizes invalid legacy quantities and missing display text without exposing invalid values", async () => {
    const plan = makeDoubleAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.secondComponent = alternative.additionalComponents![0];
    delete alternative.additionalComponents;
    Object.assign(alternative.secondComponent, {
      quantityG: Number.NaN, quantityUnit: "unknown", unitWeightG: Number.NaN, customText: null,
    });
    const { text } = await renderedDocument(plan);
    expect(text).toContain("Arroz blanco 50 g Lentejas 1 g");
    expect(text).not.toMatch(/NaN|undefined|null/);
  }, 30_000);

  it.each([true, false])("retains all long alternatives together on the meal page (macros %s)", async (includeMacros) => {
    const plan = makeFiveComponentAlternativePlan();
    const meal = plan.meals[0];
    meal.name = "Comida extensa";
    const entry = meal.entries[0];
    entry.customText = "Cereal de referencia preparado";
    const template = entry.alternatives[0];
    const markers: string[] = [];
    entry.alternatives = Array.from({ length: 8 }, (_, index) => {
      const names = Array.from({ length: 5 }, (_, componentIndex) => {
        const marker = `Componente-${index + 1}-${componentIndex + 1}`;
        markers.push(marker);
        return `${marker} preparado con una descripcion suficientemente extensa para envolver el nombre sin perder alimentos ni cantidades`;
      });
      return {
        ...template, id: `alternative-${index}`, position: index + 1, foodName: names[0],
        additionalComponents: template.additionalComponents!.map((component, componentIndex) => ({
          ...component, foodName: names[componentIndex + 1],
        })),
      };
    });
    const { text, pages } = await renderedDocument(plan, includeMacros);
    const menuPages = pages.filter((page) => page.includes("OPCION 1"));
    expect(menuPages).toHaveLength(1);
    expect(menuPages[0]).toContain("COMIDA EXTENSA");
    expect(menuPages[0]).toContain("Cereal de referencia preparado 100 g");
    expect(menuPages[0].match(/JUNTOS - 5 ALIMENTOS/g)).toHaveLength(8);
    for (const marker of markers) expect(menuPages[0].split(marker)).toHaveLength(2);
    expect(text).not.toContain("CONTINUACION");
    if (!includeMacros) expect(text).not.toMatch(/kcal|SODIO|ENERGIA TOTAL/i);
  }, 30_000);

  it("keeps alternatives with the correct reference and option on the same page", async () => {
    const plan = makeDoubleAlternativePlan();
    const template = plan.meals[0].entries[0];
    plan.meals[0].entries = Array.from({ length: 6 }, (_, index) => ({
      ...template, id: `reference-${index}`, position: index + 1, mealOption: index < 3 ? 1 : 2,
      foodName: `Referencia ${index + 1}`,
      alternatives: [{
        ...template.alternatives[0], id: `alternative-${index}`, entryId: `reference-${index}`,
        foodName: `Sustituto ${index + 1}`,
        additionalComponents: [{ ...template.alternatives[0].additionalComponents![0], foodName: `Acompanamiento ${index + 1}` }],
      }],
    }));
    const { pages } = await renderedDocument(plan, false);
    const mealPages = pages.filter((page) => page.includes("OPCION 1"));
    expect(mealPages).toHaveLength(1);
    const options = mealPages[0].split(/OPCION \d+/).slice(1);
    for (let index = 1; index <= 6; index += 1) {
      const option = options[index <= 3 ? 0 : 1];
      expect(option).toContain(`Referencia ${index} 100 g`);
      expect(option).toContain(`Sustituto ${index} 50 g Acompanamiento ${index} 25 g`);
    }
  }, 30_000);

  it.each([true, false])("fits three complete options on one standard meal page (macros %s)", async (includeMacros) => {
    const { pages, dimensions } = await renderedDocument(makeCardPlan(), includeMacros);
    const mealPages = pages.filter((page) => /OPCION \d+/.test(page));
    expect(mealPages).toHaveLength(2);
    const breakfast = mealPages.find((page) => page.includes("DESAYUNO"))!;
    expect(breakfast).toContain("OPCION 1");
    expect(breakfast).toContain("OPCION 2");
    expect(breakfast).toContain("OPCION 3");
    for (const food of ["Crema de arroz", "Proteina en polvo isolada", "Bebida de arroz y avellanas", "Kiwi crudo", "Crema de cacahuete", "Corn flakes", "Copos de avena", "Harina de avena", "Leche desnatada", "Chocolate negro 85%"]) {
      expect(breakfast.split(food)).toHaveLength(4);
    }
    expect(breakfast.match(/Alternativas/g)).toHaveLength(9);
    expect(breakfast).not.toContain("CENA");
    const size = dimensions[pages.indexOf(breakfast)];
    // A3 is the largest standard sheet used before extending exceptional meals.
    expect(size.width).toBeLessThanOrEqual(1190.56);
    expect(size.height).toBeLessThanOrEqual(841.90);
    const overview = pages.find((page) => page.replace(/\s/g, "").includes("VISTAGENERAL"))!;
    expect(overview.replace(/\s/g, "")).toContain("MENUOPCIONESALIMENTOS");
    expect(overview.replace(/\s/g, "")).not.toMatch(/ESTADO|INCLUIDO|OPCIONAL/);
    expect(overview).toContain("Desayuno 3 15");
  }, 30_000);

  it("gives an empty meal its own page and retains its notes", async () => {
    const plan = makeDoubleAlternativePlan();
    plan.meals[0].entries = [];
    plan.meals[0].notes = "Seleccionar los alimentos en la proxima revision.";
    const { pages } = await renderedDocument(plan, false);
    const mealPages = pages.filter((page) => page.includes("OPCION 1"));
    expect(mealPages).toHaveLength(1);
    expect(mealPages[0]).toContain("Sin alimentos pautados.");
    expect(mealPages[0]).toContain(plan.meals[0].notes);
  }, 30_000);
});
