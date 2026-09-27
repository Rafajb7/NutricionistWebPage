import { calculateAlternativeTotals, getAlternativeComponents } from "@/lib/nutrition/alternatives";
import { calculateEntryTotals } from "@/lib/nutrition/calculations";
import { MENU_PAGE, paintPdfLines, wrapPdfText } from "@/lib/nutrition/pdf-layout";
import { formatFoodQuantity } from "@/lib/nutrition/quantity-units";
import type { NutritionPlanFoodAlternativeComponent, NutritionPlanFoodEntry, NutritionPlanFull, NutritionTotals } from "@/lib/nutrition/types";

type Meal = NutritionPlanFull["meals"][number];
type TextItem = { kind: "text"; text: string; bullet: boolean; height: number; food: number };
type MacroItem = { kind: "macros"; label: string; totals: NutritionTotals; height: number; food: number };
type Item = TextItem | MacroItem;
type Fragment = { items: Item[]; height: number; continuedFood?: number };
type Option = { number: number; groups: Item[][]; fragments: Fragment[] };
const accent = "#FFD21C";
const bodySize = 10.5;
const lineHeight = 14.7;
const number = (value: number, decimals = 1) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: decimals }).format(value);

function describeFood(food: NutritionPlanFoodAlternativeComponent) {
  const unit = food.quantityUnit === "piece" ? (food.quantityG === 1 ? "unidad" : "unidades")
    : food.quantityUnit === "serving" ? (food.quantityG === 1 ? "racion" : "raciones") : food.quantityUnit;
  return `${formatFoodQuantity(food.quantityG, food.quantityUnit)} ${unit} de ${food.customText.trim() || food.foodName}`;
}

function foodGroup(doc: PDFKit.PDFDocument, entry: NutritionPlanFoodEntry, width: number, food: number, macros: boolean): Item[] {
  const alternatives = [...entry.alternatives].sort((a, b) => a.position - b.position);
  const descriptions = [describeFood(entry), ...alternatives.map((alternative) => {
    const components = getAlternativeComponents(alternative);
    const description = components.map(describeFood).join(" + ");
    return components.length > 1 ? `(${description})` : description;
  })];
  const items: Item[] = wrapPdfText(doc, descriptions.join(" / "), width, bodySize).map((text, index) => ({
    kind: "text", text, bullet: index === 0, height: lineHeight, food,
  }));
  if (macros) {
    items.push({ kind: "macros", label: "Base", totals: calculateEntryTotals(entry), height: 27, food });
    alternatives.forEach((alternative, index) => items.push({ kind: "macros", label: `Alt. ${index + 1}`,
      totals: calculateAlternativeTotals(alternative), height: 27, food }));
  }
  items[items.length - 1].height += 10;
  return items;
}

/** Keep foods together when possible; exceptionally long descriptions can flow
 * across pages at a fixed, readable font size without dropping lines or macros. */
function paginate(groups: Item[][], capacity: number): Fragment[] {
  const pages: Fragment[] = [];
  let page: Fragment = { items: [], height: 0 };
  const flush = () => { if (page.items.length) pages.push(page); page = { items: [], height: 0 }; };
  for (const group of groups) {
    const height = group.reduce((sum, item) => sum + item.height, 0);
    if (height <= capacity && page.height + height > capacity) flush();
    for (const item of group) {
      if (page.height + item.height > capacity) {
        flush();
        if (item !== group[0]) { page.continuedFood = item.food; page.height = 17; }
      }
      page.items.push(item);
      page.height += item.height;
    }
  }
  flush();
  return pages.length ? pages : [{ items: [], height: 28 }];
}

function drawMacroItem(doc: PDFKit.PDFDocument, item: MacroItem, x: number, y: number, width: number) {
  doc.font("Helvetica-Bold").fontSize(6.6).fillColor("#B3B3AF").text(item.label, x, y + 3, { lineBreak: false });
  const chips = [
    { text: `${number(item.totals.caloriesKcal, 0)} kcal`, color: "#C9A7FF", bg: "#332443" },
    { text: `P ${number(item.totals.proteinG)} g`, color: "#FFD15A", bg: "#3C321B" },
    { text: `C ${number(item.totals.carbsG)} g`, color: "#70D7FF", bg: "#193544" },
    { text: `G ${number(item.totals.fatG)} g`, color: "#FF997F", bg: "#42281F" },
  ];
  const chipWidth = (Math.min(width, 360) - 34 - 9) / 4;
  chips.forEach((chip, index) => {
    const left = x + 34 + index * (chipWidth + 3);
    doc.roundedRect(left, y, chipWidth, 12, 2).fill(chip.bg);
    doc.font("Helvetica-Bold").fontSize(6.7);
    const fontSize = Math.min(6.7, 6.7 * (chipWidth - 4) / Math.max(1, doc.widthOfString(chip.text)));
    doc.fontSize(fontSize).fillColor(chip.color).text(chip.text, left, y + 2.6, { width: chipWidth, align: "center", lineBreak: false });
  });
  const details = `Fibra ${number(item.totals.fiberG)} g / Agua ${number(item.totals.waterG)} g / Na ${number(item.totals.sodiumMg, 0)} mg`;
  doc.font("Helvetica").fontSize(6.2).fillColor("#93938F").text(details, x + 34, y + 15, { lineBreak: false });
}

function drawOption(doc: PDFKit.PDFDocument, option: Option, fragment: Fragment, x: number, y: number, width: number,
  panelHeight: number, continuation: boolean) {
  doc.rect(x, y, width, panelHeight).fill("#121212");
  doc.rect(x, y, 2, panelHeight).fill(accent);
  doc.font("Helvetica-Bold").fontSize(23).fillColor("#37321B")
    .text(String(option.number).padStart(2, "0"), x + 12, y + 10, { lineBreak: false });
  doc.fontSize(13).fillColor(accent).text(`OPCION ${option.number}`, x + 51, y + 13, { lineBreak: false });
  if (continuation) doc.fontSize(6.5).fillColor("#A6A69F").text("CONTINUACION", x + 51, y + 28, { lineBreak: false });
  let cursor = y + 44;
  if (fragment.continuedFood) {
    doc.font("Helvetica-Bold").fontSize(7).fillColor(accent)
      .text(`Alimento ${fragment.continuedFood} - continuacion`, x + 24, cursor, { lineBreak: false });
    cursor += 17;
  }
  if (!fragment.items.length) paintPdfLines(doc, ["Sin alimentos pautados."], x + 24, cursor, bodySize, "#A6A69F");
  for (const item of fragment.items) {
    if (item.kind === "text") {
      if (item.bullet) doc.rect(x + 14, cursor + 4, 4, 4).fill(accent);
      paintPdfLines(doc, [item.text], x + 24, cursor, bodySize, "#D8D8D3");
    } else drawMacroItem(doc, item, x + 24, cursor + 2, width - 38);
    cursor += item.height;
  }
}

export function drawMealMenus(doc: PDFKit.PDFDocument, meal: Meal, planLabel: string, includeMacros: boolean) {
  const width = 892;
  const title = wrapPdfText(doc, meal.name.toLocaleUpperCase("es"), width - 118, 30, true);
  const titleBottom = 32 + title.length * 36;
  const notes = meal.notes.trim() ? wrapPdfText(doc, meal.notes.trim(), width - 28, 9.5) : [];
  const inlineNotes = notes.length <= 5 ? notes : [];
  const top = titleBottom + 62 + (inlineNotes.length ? inlineNotes.length * 13.3 + 18 : 0);
  const available = 468 - top;
  const optionNumbers = [...new Set([1, ...meal.entries.map((entry) => entry.mealOption || 1)])].sort((a, b) => a - b);
  const columns = optionNumbers.length === 4 ? 2 : Math.min(3, optionNumbers.length);
  const optionWidth = (width - (columns - 1) * 12) / columns;
  const options: Option[] = optionNumbers.map((optionNumber) => {
    const entries = meal.entries.filter((entry) => (entry.mealOption || 1) === optionNumber).sort((a, b) => a.position - b.position);
    const groups = entries.map((entry, index) => foodGroup(doc, entry, optionWidth - 38, index + 1, includeMacros));
    return { number: optionNumber, groups, fragments: paginate(groups, available - 54) };
  });
  // Four short options use the reference document's 2 x 2 arrangement.
  const fourInOne = options.length === 4 && options.every((option) => option.fragments.length === 1)
    && Math.max(...options.slice(0, 2).map((option) => option.fragments[0].height))
      + Math.max(...options.slice(2).map((option) => option.fragments[0].height)) + 120 <= available;
  const sheets: { options: Option[]; part: number; grid?: boolean }[] = [];
  if (fourInOne) sheets.push({ options, part: 0, grid: true });
  else for (let offset = 0; offset < options.length; offset += columns) {
    const batch = options.slice(offset, offset + columns);
    const parts = Math.max(...batch.map((option) => option.fragments.length));
    for (let part = 0; part < parts; part++) sheets.push({ options: batch.filter((option) => option.fragments[part]), part });
  }
  const noteCapacity = Math.max(1, Math.floor((440 - titleBottom - 50) / 13.3));
  const notePages = notes.length > 5 ? Math.ceil(notes.length / noteCapacity) : 0;
  const totalPages = notePages + sheets.length;
  const addPage = (page: number, notePage = false) => {
    doc.addPage(MENU_PAGE);
    paintPdfLines(doc, title, 34, 32, 30, "#FFFFFF", true, 36);
    paintPdfLines(doc, [planLabel], 34, titleBottom + 8, 8, accent, true);
    doc.font("Helvetica-Bold").fontSize(7).fillColor("#9B9B94")
      .text(`${page + 1} / ${totalPages}${meal.included ? "" : " - OPCIONAL"}`, 752, titleBottom + 8, { width: 174, align: "right", lineBreak: false });
    if (!notePage) {
      paintPdfLines(doc, ["Elige una opcion completa. / = alternativas al mismo alimento. + = alimentos que se toman juntos."], 34, titleBottom + 26, 8, "#ACACA4");
      if (includeMacros) paintPdfLines(doc, ["Macros: Base = primer alimento; Alt. 1, 2... = alternativas en orden. En combinaciones, se muestra el total conjunto."], 34, titleBottom + 39, 7, "#92928C");
      if (inlineNotes.length) {
        doc.rect(34, titleBottom + 54, width, inlineNotes.length * 13.3 + 12).fill("#141411");
        doc.rect(34, titleBottom + 54, 2, inlineNotes.length * 13.3 + 12).fill(accent);
        paintPdfLines(doc, inlineNotes, 48, titleBottom + 60, 9.5, "#D0D0C9");
      }
    }
  };
  for (let page = 0; page < notePages; page++) {
    addPage(page, true);
    paintPdfLines(doc, ["OBSERVACIONES DE LA COMIDA"], 34, titleBottom + 35, 11, accent, true);
    paintPdfLines(doc, notes.slice(page * noteCapacity, (page + 1) * noteCapacity), 34, titleBottom + 60, 9.5, "#D8D8D3");
  }
  sheets.forEach((sheet, sheetIndex) => {
    addPage(notePages + sheetIndex);
    let rowY = top;
    let rowHeight = 0;
    sheet.options.forEach((option, index) => {
      if (sheet.grid && index === 2) { rowY += rowHeight + 12; rowHeight = 0; }
      const fragment = option.fragments[sheet.part];
      const height = Math.max(82, fragment.height + 54);
      rowHeight = Math.max(rowHeight, height);
      drawOption(doc, option, fragment, 34 + (index % columns) * (optionWidth + 12), rowY, optionWidth, height, sheet.part > 0);
    });
  });
}
