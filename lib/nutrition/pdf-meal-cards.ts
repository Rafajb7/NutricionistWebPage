import { calculateAlternativeTotals, getAlternativeComponents } from "@/lib/nutrition/alternatives";
import { calculateEntryTotals } from "@/lib/nutrition/calculations";
import { formatFoodQuantity } from "@/lib/nutrition/quantity-units";
import type { NutritionPlanFoodAlternativeComponent, NutritionPlanFoodEntry, NutritionPlanFull, NutritionTotals } from "@/lib/nutrition/types";

type Meal = NutritionPlanFull["meals"][number];
type Style = { font: number; pad: number; gap: number };
type Lines = { text: string[]; height: number; size: number };
type FoodRow = { name: Lines; quantity: string; badgeWidth: number; height: number };
type Card = { rows: FoodRow[]; totals: NutritionTotals; combined: boolean; height: number };
type FoodBlock = { base: Card; alternatives: Card[]; height: number };
type PositionedFood = { block: FoodBlock; x: number; y: number; width: number };
type OptionBlock = { number: number; x: number; y: number; width: number; height: number; foods: PositionedFood[] };

const colors = { text: "#FFFFFF", muted: "#ACB3BD", accent: "#FFC515", border: "#343941", panel: "#1B1E24" };
const number = (value: number, decimals = 1) => new Intl.NumberFormat("es-ES", { maximumFractionDigits: decimals }).format(value);

function wrap(doc: PDFKit.PDFDocument, value: string, width: number, size: number, bold = false): Lines {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  const text: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (doc.widthOfString(line ? `${line} ${word}` : word) <= width) {
        line = line ? `${line} ${word}` : word;
      } else {
        if (line) text.push(line);
        line = "";
        for (const character of word) {
          if (line && doc.widthOfString(line + character) > width) { text.push(line); line = ""; }
          line += character;
        }
      }
    }
    text.push(line);
  }
  return { text, height: text.length * size * 1.2, size };
}

function paintLines(doc: PDFKit.PDFDocument, lines: Lines, x: number, y: number, color = colors.text, bold = false) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(lines.size).fillColor(color);
  lines.text.forEach((line, index) => doc.text(line, x, y + index * lines.size * 1.2, { lineBreak: false }));
}

function quantity(food: NutritionPlanFoodAlternativeComponent) {
  const unit = food.quantityUnit === "piece" ? "ud" : food.quantityUnit === "serving" ? "rac." : food.quantityUnit;
  return `${formatFoodQuantity(food.quantityG, food.quantityUnit)} ${unit}`;
}

function measureCard(doc: PDFKit.PDFDocument, foods: NutritionPlanFoodAlternativeComponent[], totals: NutritionTotals,
  width: number, style: Style, macros: boolean): Card {
  const rows = foods.map((food): FoodRow => {
    const value = quantity(food);
    doc.font("Helvetica-Bold").fontSize(style.font - 1);
    const badgeWidth = Math.max(35, doc.widthOfString(value) + 12);
    const name = wrap(doc, food.customText.trim() || food.foodName, width - style.pad * 2 - badgeWidth - 8, style.font, true);
    return { name, quantity: value, badgeWidth, height: Math.max(name.height + 2, style.font + 6) };
  });
  return {
    rows, totals, combined: foods.length > 1,
    height: style.pad * 2 + rows.reduce((height, row) => height + row.height, 0)
      + (rows.length - 1) * 5 + (foods.length > 1 ? 12 : 0) + (macros ? 23 : 0),
  };
}

function measureFood(doc: PDFKit.PDFDocument, entry: NutritionPlanFoodEntry, width: number, style: Style, macros: boolean): FoodBlock {
  const base = measureCard(doc, [entry], calculateEntryTotals(entry), width, style, macros);
  const alternatives = [...(entry.alternatives ?? [])].sort((a, b) => a.position - b.position)
    .map((alternative) => measureCard(doc, getAlternativeComponents(alternative), calculateAlternativeTotals(alternative), width - 22, style, macros));
  return { base, alternatives, height: base.height + (alternatives.length
    ? 21 + alternatives.reduce((height, card) => height + card.height + 4, 0) : 0) };
}

function drawMacros(doc: PDFKit.PDFDocument, totals: NutritionTotals, x: number, y: number, width: number) {
  const chips = [
    { text: `${number(totals.caloriesKcal, 0)} kcal`, color: "#C9A7FF", bg: "#332443" },
    { text: `P ${number(totals.proteinG)} g`, color: "#FFD15A", bg: "#3C321B" },
    { text: `C ${number(totals.carbsG)} g`, color: "#70D7FF", bg: "#193544" },
    { text: `G ${number(totals.fatG)} g`, color: "#FF997F", bg: "#42281F" },
  ];
  const chipWidth = (width - 9) / 4;
  chips.forEach((chip, index) => {
    const left = x + index * (chipWidth + 3);
    doc.roundedRect(left, y, chipWidth, 12, 3).fill(chip.bg);
    doc.font("Helvetica-Bold").fontSize(7);
    const size = Math.min(7, 7 * (chipWidth - 6) / Math.max(1, doc.widthOfString(chip.text)));
    doc.fontSize(size).fillColor(chip.color).text(chip.text, left, y + 2.2, { width: chipWidth, align: "center", lineBreak: false });
  });
  const details = `Fibra ${number(totals.fiberG)} g  /  Agua ${number(totals.waterG)} g  /  Na ${number(totals.sodiumMg, 0)} mg`;
  doc.font("Helvetica").fontSize(6);
  const detailSize = Math.min(6, 6 * width / Math.max(1, doc.widthOfString(details)));
  doc.fontSize(detailSize).fillColor(colors.muted).text(details, x, y + 15, { width, lineBreak: false });
}

function drawCard(doc: PDFKit.PDFDocument, card: Card, x: number, y: number, width: number, style: Style, macros: boolean, alternative = false) {
  doc.lineWidth(0.6).roundedRect(x, y, width, card.height, 5).fillAndStroke(alternative ? "#171B20" : colors.panel, colors.border);
  let cursor = y + style.pad;
  if (card.combined) {
    doc.font("Helvetica-Bold").fontSize(6.5).fillColor(colors.accent)
      .text(`JUNTOS - ${card.rows.length} ALIMENTOS`, x + style.pad, cursor, { lineBreak: false });
    cursor += 12;
  }
  card.rows.forEach((row, index) => {
    if (index) cursor += 5;
    paintLines(doc, row.name, x + style.pad, cursor + 2, colors.text, true);
    const badgeX = x + width - style.pad - row.badgeWidth;
    doc.roundedRect(badgeX, cursor, row.badgeWidth, style.font + 6, 3).fill(alternative ? "#32404C" : "#F9C636");
    doc.font("Helvetica-Bold").fontSize(style.font - 1).fillColor(alternative ? "#DBE8F5" : "#151515")
      .text(row.quantity, badgeX, cursor + 3.5, { width: row.badgeWidth, align: "center", lineBreak: false });
    cursor += row.height;
  });
  if (macros) drawMacros(doc, card.totals, x + style.pad, y + card.height - style.pad - 21, width - style.pad * 2);
}

function drawFood(doc: PDFKit.PDFDocument, food: PositionedFood, originX: number, originY: number, style: Style, macros: boolean) {
  const x = originX + food.x;
  const y = originY + food.y;
  const { block, width } = food;
  drawCard(doc, block.base, x, y, width, style, macros);
  if (!block.alternatives.length) return;
  const top = y + block.base.height + 4;
  const groupHeight = block.height - block.base.height - 4;
  doc.roundedRect(x, top, width, groupHeight, 5).fillAndStroke("#101317", "#353B44");
  doc.font("Helvetica-Bold").fontSize(7).fillColor(colors.accent)
    .text("Alternativas", x + 10, top + 5, { lineBreak: false });
  let cursor = top + 17;
  const branchX = x + 7;
  block.alternatives.forEach((card, index) => {
    const arrowY = cursor + 12;
    doc.moveTo(branchX, index ? cursor - 4 : top + 14).lineTo(branchX, arrowY).lineTo(x + 17, arrowY)
      .strokeColor("#9BA7B4").lineWidth(0.7).stroke();
    doc.moveTo(x + 14, arrowY - 2.5).lineTo(x + 17, arrowY).lineTo(x + 14, arrowY + 2.5).stroke();
    drawCard(doc, card, x + 18, cursor, width - 22, style, macros, true);
    cursor += card.height + 4;
  });
}

function measureOptions(doc: PDFKit.PDFDocument, meal: Meal, width: number, style: Style, macros: boolean) {
  const numbers = [...new Set([1, ...meal.entries.map((entry) => entry.mealOption || 1)])].sort((a, b) => a - b);
  const columns = Math.min(3, numbers.length);
  const optionWidth = (width - (columns - 1) * 14) / columns;
  const options: OptionBlock[] = [];
  let rowY = 0;
  let rowHeight = 0;
  numbers.forEach((optionNumber, index) => {
    if (index && index % columns === 0) { rowY += rowHeight + 16; rowHeight = 0; }
    const entries = meal.entries.filter((entry) => (entry.mealOption || 1) === optionNumber).sort((a, b) => a.position - b.position);
    // A sole option uses a card grid, rather than stretching its foods into rows.
    const foodColumns = numbers.length === 1 ? Math.min(3, Math.max(1, entries.length)) : 1;
    const cardWidth = (optionWidth - 12 - (foodColumns - 1) * style.gap) / foodColumns;
    const heights = Array.from({ length: foodColumns }, () => 30);
    const foods = entries.map((entry): PositionedFood => {
      const column = heights.indexOf(Math.min(...heights));
      const block = measureFood(doc, entry, cardWidth, style, macros);
      const food = { block, x: 6 + column * (cardWidth + style.gap), y: heights[column], width: cardWidth };
      heights[column] += block.height + style.gap;
      return food;
    });
    const height = entries.length ? Math.max(...heights) + 3 : 51;
    options.push({ number: optionNumber, x: index % columns * (optionWidth + 14), y: rowY, width: optionWidth, height, foods });
    rowHeight = Math.max(rowHeight, height);
  });
  return { options, height: rowY + rowHeight };
}

/** Keep each meal together, trying landscape A4 and A3 before extending the
 * canvas for unusually dense meals. Font sizes never depend on total content. */
export function drawMealCardsPage(doc: PDFKit.PDFDocument, meal: Meal, planLabel: string, includeMacros: boolean) {
  const profiles: Style[] = [{ font: 10, pad: 8, gap: 8 }, { font: 9, pad: 4, gap: 4 }, { font: 8.5, pad: 4, gap: 4 }];
  const margins = { top: 96, left: 44, right: 44, bottom: 48 };
  const measure = (pageWidth: number, style: Style) => {
    const width = pageWidth - 88;
    const title = wrap(doc, meal.name.toLocaleUpperCase("es"), width, 21, true);
    const notes = meal.notes.trim() ? wrap(doc, meal.notes.trim(), width, 8.5) : null;
    const top = 114 + title.height + 20 + (notes ? notes.height + 7 : 0);
    const layout = measureOptions(doc, meal, width, style, includeMacros);
    return { layout, top, title, notes, style, requiredHeight: top + layout.height + margins.bottom + 34 };
  };
  let pageWidth = 841.89;
  let pageHeight = 595.28;
  let measured = measure(pageWidth, profiles[0]);
  for (const style of profiles) {
    measured = measure(pageWidth, style);
    if (measured.requiredHeight <= pageHeight) break;
  }
  if (measured.requiredHeight > pageHeight) {
    pageWidth = 1190.55;
    pageHeight = 841.89;
    for (const style of profiles) {
      measured = measure(pageWidth, style);
      if (measured.requiredHeight <= pageHeight) break;
    }
    if (measured.requiredHeight > pageHeight) {
      measured = measure(pageWidth, profiles[0]);
      pageHeight = Math.ceil(measured.requiredHeight);
    }
  }
  doc.addPage({ size: [pageWidth, pageHeight], layout: "portrait", margins });
  const left = 44;
  const width = pageWidth - left * 2;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(colors.accent)
    .text(planLabel, left, 96, { width, lineBreak: false });
  paintLines(doc, measured.title, left, 114, colors.text, true);
  const descriptionY = 114 + measured.title.height + 4;
  doc.font("Helvetica").fontSize(7.5).fillColor(colors.muted)
    .text(`Elige una opcion completa. Cada alternativa sustituye solo al alimento al que esta unida.${meal.included ? "" : " Comida opcional."}`,
      left, descriptionY, { width, lineBreak: false });
  if (measured.notes) paintLines(doc, measured.notes, left, descriptionY + 14, colors.muted);
  for (const option of measured.layout.options) {
    const x = left + option.x;
    const y = measured.top + option.y;
    doc.roundedRect(x, y, option.width, option.height, 7).fillAndStroke("#0D1014", "#29303A");
    doc.roundedRect(x + 6, y + 5, 68, 18, 4).fill("#F9C636");
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#121212")
      .text(`OPCION ${option.number}`, x + 6, y + 10, { width: 68, align: "center", lineBreak: false });
    doc.font("Helvetica").fontSize(7).fillColor(colors.muted)
      .text(`${option.foods.length} alimentos`, x + 82, y + 11, { lineBreak: false });
    option.foods.forEach((food) => drawFood(doc, food, x, y, measured.style, includeMacros));
    if (!option.foods.length) doc.font("Helvetica").fontSize(8).fillColor(colors.muted)
      .text("Sin alimentos pautados.", x + 10, y + 32, { lineBreak: false });
  }
}
