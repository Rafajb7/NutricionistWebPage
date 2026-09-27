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

describe("reference-style menus in the generated PDF", () => {
  it("renders the reference and joint alternative with individual quantities and combined macros", async () => {
    const { pages } = await renderedDocument(makeDoubleAlternativePlan());
    const page = pages.find((candidate) => candidate.includes("OPCION 1"))!;
    expect(page).toContain("100 g de Arroz blanco");
    expect(page).toContain("/ (50 g de Arroz blanco + 25 g de Lentejas)");
    expect(page).toContain("50 g de Arroz blanco + 25 g de Lentejas");
    expect(page).toContain("100 kcal P 5 g C 20 g G 0 g");
    expect(page).not.toMatch(/CANTIDAD|ALIMENTO BASE/);
  }, 30_000);

  it.each([1, 2, 3, 4, 5])("renders all %i canonical components and sums their nutrients", async (count) => {
    const plan = makeFiveComponentAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.additionalComponents = alternative.additionalComponents!.slice(0, count - 1);
    const { pages } = await renderedDocument(plan);
    const page = pages.find((candidate) => candidate.includes("OPCION 1"))!;
    expect(page).toBeDefined();
    expect(page).toContain("50 g de Arroz blanco");
    for (const component of alternative.additionalComponents) expect(page).toContain(`25 g de ${component.foodName}`);
    expect(page).toContain(`${count * 50} kcal`);
    if (count === 1) expect(page).not.toContain("/ (");
    else expect(page).toContain("/ (50 g de Arroz blanco +");
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
    expect(text).toContain("/ (50 g de Arroz blanco +");
    expect(text).toContain("50 g de Arroz blanco + 0,5 unidades de Aguacate + 1,25 raciones de Fruta");
    expect(text).not.toMatch(/kcal|SODIO|ENERGIA TOTAL|\bFibra\b|\bAgua\b|Na 0 mg/i);
  }, 30_000);

  it("reads legacy secondComponent alternatives when the canonical array is absent", async () => {
    const plan = makeDoubleAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.secondComponent = alternative.additionalComponents![0];
    delete alternative.additionalComponents;
    const { text } = await renderedDocument(plan);
    expect(text).toContain("(50 g de Arroz blanco + 25 g de Lentejas)");
    expect(text).toContain("50 g de Arroz blanco + 25 g de Lentejas");
    expect(text).toContain("100 kcal P 5 g C 20 g G 0 g");
  }, 30_000);

  it.each([false, true])("gives canonical arrays priority over the legacy alias, including empty arrays (%s)", async (empty) => {
    const plan = makeDoubleAlternativePlan();
    const alternative = plan.meals[0].entries[0].alternatives[0];
    alternative.secondComponent = { ...alternative.additionalComponents![0], foodName: "Alias antiguo ignorado" };
    if (empty) alternative.additionalComponents = [];
    const { text } = await renderedDocument(plan);
    expect(text).not.toContain("Alias antiguo ignorado");
    expect(text).toContain("50 g de Arroz blanco");
    if (empty) {
      expect(text).not.toContain("JUNTOS");
      expect(text).not.toContain("Lentejas");
    } else {
      expect(text).toContain("(50 g de Arroz blanco + 25 g de Lentejas)");
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
    expect(text).toContain("100 g de Cereal cocido de referencia");
    expect(text).toContain("50 g de Cereal integral preparado + 25 g de Legumbres cocidas y escurridas");
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
    expect(text).toContain("50 g de Arroz blanco + 1 g de Lentejas");
    expect(text).not.toMatch(/NaN|undefined|null/);
  }, 30_000);

  it.each([true, false])("retains all long alternatives on readable continuation pages (macros %s)", async (includeMacros) => {
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
    expect(menuPages.length).toBeGreaterThan(1);
    for (const page of menuPages) {
      expect(page).toContain("COMIDA EXTENSA");
      expect(page).toContain("OPCION 1");
    }
    const menuText = menuPages.join(" ");
    expect(menuText).toContain("100 g de Cereal de referencia preparado");
    for (const marker of markers) expect(menuText.split(marker)).toHaveLength(2);
    expect(menuText).toContain("CONTINUACION");
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
      expect(option).toContain(`100 g de Referencia ${index}`);
      expect(option).toContain(`50 g de Sustituto ${index} + 25 g de Acompanamiento ${index}`);
    }
  }, 30_000);

  it.each([true, false])("keeps three options in their meal section on standard pages (macros %s)", async (includeMacros) => {
    const { pages, dimensions } = await renderedDocument(makeCardPlan(), includeMacros);
    const mealPages = pages.filter((page) => /OPCION \d+/.test(page));
    const breakfastPages = mealPages.filter((page) => page.includes("DESAYUNO"));
    expect(breakfastPages.length).toBe(includeMacros ? 2 : 1);
    const breakfast = breakfastPages.join(" ");
    for (const page of breakfastPages) {
      expect(page).toContain("OPCION 1");
      expect(page).toContain("OPCION 2");
      expect(page).toContain("OPCION 3");
      expect(page).not.toContain("CENA");
      const size = dimensions[pages.indexOf(page)];
      expect(size.width).toBe(960);
      expect(size.height).toBe(540);
    }
    for (const food of ["Crema de arroz", "Proteina en polvo isolada", "Bebida de arroz y avellanas", "Kiwi crudo", "Crema de cacahuete", "Corn flakes", "Copos de avena", "Harina de avena", "Leche desnatada", "Chocolate negro 85%"]) {
      expect(breakfast.split(food)).toHaveLength(4);
    }
    expect(breakfast).toContain("60 g de Crema de arroz / 60 g de Corn flakes");
    const overview = pages.find((page) => page.replace(/\s/g, "").includes("MENUOPCIONESALIMENTOS"))!;
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
