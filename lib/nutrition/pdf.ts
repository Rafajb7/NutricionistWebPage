import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import {
  ATWATER_KCAL_PER_GRAM,
  calculateEntryTotals,
  calculateMealOptionTotals,
  calculateMealTotals,
  calculatePlanTotals,
  roundNutritionValue
} from "@/lib/nutrition/calculations";
import type {
  AthleteRoadmapStep,
  NutritionPlanFoodAlternative,
  NutritionPlanFoodEntry,
  NutritionPlanFull,
  NutritionQuantityUnit,
  NutritionTotals
} from "@/lib/nutrition/types";

type PdfTableColumn = {
  label: string;
  width: number;
  align?: "left" | "right" | "center";
};

type NutritionPlanPdfOptions = {
  comparisonPlans?: NutritionPlanFull[];
  includeMacros?: boolean;
  roadmapSteps?: AthleteRoadmapStep[];
};

type MacroChartKey = "proteinG" | "carbsG" | "fatG";

const COLORS = {
  bg: "#070707",
  panel: "#121212",
  panelAlt: "#181818",
  line: "#2A2A2A",
  yellow: "#FFC515",
  yellowDark: "#D99B00",
  white: "#FFFFFF",
  muted: "#A7A7A7",
  dim: "#555555",
  red: "#FF5A4F"
};

const MACRO_CHART_ITEMS: Array<{
  key: MacroChartKey;
  label: string;
  shortLabel: string;
  color: string;
}> = [
  { key: "proteinG", label: "Proteinas", shortLabel: "P", color: COLORS.yellow },
  { key: "carbsG", label: "Hidratos", shortLabel: "C", color: "#45C8FF" },
  { key: "fatG", label: "Grasas", shortLabel: "G", color: "#FF6B4A" }
];

let cachedLogoBuffer: Buffer | null | undefined;

function getLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer !== undefined) return cachedLogoBuffer;
  const pdfLogoPath = path.join(process.cwd(), "public", "logo-pdf.png");
  if (fs.existsSync(pdfLogoPath)) {
    cachedLogoBuffer = fs.readFileSync(pdfLogoPath);
    return cachedLogoBuffer;
  }
  const transparentLogoPath = path.join(process.cwd(), "public", "logo-bueno.png");
  if (fs.existsSync(transparentLogoPath)) {
    cachedLogoBuffer = fs.readFileSync(transparentLogoPath);
    return cachedLogoBuffer;
  }
  const fallbackLogoPath = path.join(process.cwd(), "public", "logoV1.png");
  cachedLogoBuffer = fs.existsSync(fallbackLogoPath) ? fs.readFileSync(fallbackLogoPath) : null;
  return cachedLogoBuffer;
}

function formatNumber(value: number, decimals = 1): string {
  const rounded = roundNutritionValue(value, decimals);
  return new Intl.NumberFormat("es-ES", {
    useGrouping: false,
    minimumFractionDigits: rounded % 1 === 0 ? 0 : decimals,
    maximumFractionDigits: decimals
  }).format(rounded);
}

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || "-";
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function uppercase(value: string): string {
  return value.trim().toLocaleUpperCase("es-ES");
}

function shortLabel(value: string, maxLength: number): string {
  const clean = value.trim();
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 1)).trim()}...`;
}

function getPlanLabel(plan: NutritionPlanFull): string {
  return plan.name.trim() || "Plan nutricional";
}

function getVisibleMeals(plan: NutritionPlanFull): NutritionPlanFull["meals"] {
  return [...plan.meals].sort((a, b) => a.position - b.position);
}

function normalizePdfQuantityG(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(10000, Math.max(1, Math.round(value)));
}

function normalizePdfQuantityUnit(value: unknown): NutritionQuantityUnit {
  if (value === "piece" || value === "serving") return value;
  return "g";
}

function normalizePdfUnitWeightG(value: unknown, unit: NutritionQuantityUnit): number {
  if (unit === "g") return 1;
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 150;
  return Math.min(10000, Math.max(1, Math.round(parsed)));
}

function normalizePdfMealOption(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(20, Math.max(1, Math.round(parsed)));
}

function normalizePdfPlanQuantities(plan: NutritionPlanFull): NutritionPlanFull {
  const meals = Array.isArray(plan.meals) ? plan.meals : [];

  return {
    ...plan,
    athleteUsername: plan.athleteUsername ?? "",
    athleteName: plan.athleteName ?? "",
    name: plan.name ?? "Plan nutricional",
    notes: plan.notes ?? "",
    supplementation: plan.supplementation ?? "",
    recommendations: plan.recommendations ?? "",
    targetProteinG: Number.isFinite(plan.targetProteinG) ? Math.max(0, Math.round(plan.targetProteinG)) : 0,
    targetCarbsG: Number.isFinite(plan.targetCarbsG) ? Math.max(0, Math.round(plan.targetCarbsG)) : 0,
    targetFatG: Number.isFinite(plan.targetFatG) ? Math.max(0, Math.round(plan.targetFatG)) : 0,
    meals: meals.map((meal) => ({
      ...meal,
      notes: meal.notes ?? "",
      included: meal.included !== false,
      entries: (Array.isArray(meal.entries) ? meal.entries : [])
        .map((entry) => {
          const quantityUnit = normalizePdfQuantityUnit(entry.quantityUnit);
          return {
            ...entry,
            foodName: entry.foodName ?? "",
            customText: entry.customText ?? "",
            quantityG: normalizePdfQuantityG(entry.quantityG),
            quantityUnit,
            unitWeightG: normalizePdfUnitWeightG(entry.unitWeightG, quantityUnit),
            mealOption: normalizePdfMealOption(entry.mealOption),
            alternatives: (Array.isArray(entry.alternatives) ? entry.alternatives : []).map((alternative) => {
              const alternativeQuantityUnit = normalizePdfQuantityUnit(alternative.quantityUnit);
              return {
                ...alternative,
                foodName: alternative.foodName ?? "",
                customText: alternative.customText ?? "",
                quantityG: normalizePdfQuantityG(alternative.quantityG),
                quantityUnit: alternativeQuantityUnit,
                unitWeightG: normalizePdfUnitWeightG(alternative.unitWeightG, alternativeQuantityUnit)
              };
            })
          };
        })
        .sort((a, b) => {
          const optionDiff = normalizePdfMealOption(a.mealOption) - normalizePdfMealOption(b.mealOption);
          if (optionDiff !== 0) return optionDiff;
          return a.position - b.position;
        })
    }))
  };
}

function getQuantityUnitLabel(unit: NutritionQuantityUnit, value: number): string {
  if (unit === "piece") return value === 1 ? "pieza" : "piezas";
  if (unit === "serving") return value === 1 ? "racion" : "raciones";
  return "g";
}

function formatQuantity(
  item: Pick<NutritionPlanFoodEntry | NutritionPlanFoodAlternative, "quantityG" | "quantityUnit">
): string {
  const quantity = normalizePdfQuantityG(item.quantityG);
  return `${formatNumber(quantity, 0)} ${getQuantityUnitLabel(normalizePdfQuantityUnit(item.quantityUnit), quantity)}`;
}

function getNiceAxisMax(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function getMacroValue(totals: NutritionTotals, key: MacroChartKey): number {
  return totals[key];
}

function getMacroEnergyBreakdown(totals: NutritionTotals) {
  const items = [
    {
      ...MACRO_CHART_ITEMS[0],
      grams: totals.proteinG,
      kcal: totals.proteinG * ATWATER_KCAL_PER_GRAM.protein
    },
    {
      ...MACRO_CHART_ITEMS[1],
      grams: totals.carbsG,
      kcal: totals.carbsG * ATWATER_KCAL_PER_GRAM.carbs
    },
    {
      ...MACRO_CHART_ITEMS[2],
      grams: totals.fatG,
      kcal: totals.fatG * ATWATER_KCAL_PER_GRAM.fat
    }
  ];
  const totalKcal = items.reduce((sum, item) => sum + item.kcal, 0);
  return items.map((item) => ({
    ...item,
    percent: totalKcal > 0 ? (item.kcal / totalKcal) * 100 : 0
  }));
}

function getComparisonPlans(
  currentPlan: NutritionPlanFull,
  comparisonPlans: NutritionPlanFull[] | undefined
): NutritionPlanFull[] {
  const seen = new Set<string>();
  const normalizedAthlete = currentPlan.athleteUsername.trim().toLowerCase();
  const result: NutritionPlanFull[] = [];

  result.push(currentPlan);
  seen.add(currentPlan.id);

  for (const candidate of comparisonPlans ?? []) {
    if (seen.has(candidate.id)) continue;
    if (candidate.athleteUsername.trim().toLowerCase() !== normalizedAthlete) continue;
    seen.add(candidate.id);
    result.push(candidate);
  }

  return result;
}

function fitFontSize(
  doc: PDFKit.PDFDocument,
  text: string,
  fontName: string,
  maxWidth: number,
  startSize: number,
  minSize: number,
  characterSpacing = 0
): number {
  let size = startSize;
  while (size > minSize) {
    doc.font(fontName).fontSize(size);
    if (doc.widthOfString(text, { characterSpacing }) <= maxWidth) return size;
    size -= 0.5;
  }
  return minSize;
}

function drawPageBackground(doc: PDFKit.PDFDocument) {
  doc.save();
  doc.rect(0, 0, doc.page.width, doc.page.height).fill(COLORS.bg);
  doc.rect(0, 0, doc.page.width, 6).fill(COLORS.yellow);

  doc.strokeColor("#111111").lineWidth(0.6);
  for (let x = -120; x < doc.page.width + 160; x += 64) {
    doc
      .moveTo(x, doc.page.height)
      .lineTo(x + 260, 0)
      .stroke();
  }

  const logo = getLogoBuffer();
  if (logo) {
    try {
      doc.opacity(0.07).image(logo, doc.page.width - 230, doc.page.height - 230, {
        width: 190
      });
      doc.opacity(1);
    } catch {
      doc.opacity(1);
    }
  }
  doc.restore();
}

function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  const logo = getLogoBuffer();
  doc.save();
  if (logo) {
    try {
      doc.image(logo, x, y, {
        fit: [size, size],
        align: "center",
        valign: "center"
      });
    } catch {
      doc.circle(x + size / 2, y + size / 2, size / 2 - 4).strokeColor(COLORS.yellow).lineWidth(1.3).stroke();
    }
  }
  doc.restore();
}

function drawHeader(doc: PDFKit.PDFDocument, plan: NutritionPlanFull) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const top = 22;
  const title = "PLAN NUTRICIONAL";
  const titleWidth = right - left - 88;
  const titleSize = fitFontSize(doc, title, "Helvetica-Bold", titleWidth, 22, 13, 0.6);

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("MANOLO HMB NUTRICION", left, top, {
      characterSpacing: 1.8
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(titleSize)
    .text(title, left, top + 18, {
      width: titleWidth,
      height: 28,
      characterSpacing: 0.6,
      lineBreak: false
    });

  drawLogo(doc, right - 46, top - 2, 42);
  doc
    .moveTo(left, top + 58)
    .lineTo(right, top + 58)
    .strokeColor(COLORS.yellow)
    .lineWidth(1.2)
    .stroke();
}

function drawFooter(
  doc: PDFKit.PDFDocument,
  pageNumber: number,
  pageCount: number,
  plan: NutritionPlanFull
) {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.page.height - doc.page.margins.bottom - 10;

  doc
    .moveTo(left, y - 12)
    .lineTo(right, y - 12)
    .strokeColor("#1D1D1D")
    .lineWidth(0.7)
    .stroke();
  doc
    .fillColor(COLORS.dim)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(
      `${uppercase(plan.athleteName || plan.athleteUsername)} - PLAN NUTRICIONAL - ${formatDate(plan.updatedAt)}`,
      left,
      y,
      { width: 420, characterSpacing: 1.1, lineBreak: false }
    );
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(
      `${String(pageNumber).padStart(2, "0")} / ${String(pageCount).padStart(2, "0")}`,
      right - 58,
      y,
      {
        width: 58,
        align: "right",
        lineBreak: false
      }
    );
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  const bottomLimit = doc.page.height - doc.page.margins.bottom - 20;
  if (doc.y + neededHeight <= bottomLimit) return;
  doc.addPage();
  doc.y = 96;
}

function drawYellowTag(
  doc: PDFKit.PDFDocument,
  text: string,
  x: number,
  y: number,
  width: number
) {
  const label = uppercase(text);
  const fontSize = fitFontSize(doc, label, "Helvetica-Bold", width - 24, 10, 7.2, 1.1);
  doc.save();
  doc.rect(x, y, width, 23).fill(COLORS.yellow);
  doc
    .fillColor("#050505")
    .font("Helvetica-Bold")
    .fontSize(fontSize)
    .text(label, x + 12, y + 7, {
      width: width - 24,
      characterSpacing: 1.1,
      lineBreak: false
    });
  doc.restore();
}

function drawMetricCard(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  sublabel: string,
  x: number,
  y: number,
  width: number
) {
  const valueSize = fitFontSize(doc, value, "Helvetica-Bold", width - 24, 20, 10);
  doc.save();
  doc.rect(x, y, width, 62).fill(COLORS.panel);
  doc.rect(x, y, 4, 62).fill(COLORS.yellow);
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(uppercase(label), x + 14, y + 10, { width: width - 24, characterSpacing: 1.5 });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(valueSize)
    .text(value, x + 14, y + 25, { width: width - 24, lineBreak: false });
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(7)
    .text(sublabel, x + 14, y + 49, { width: width - 24 });
  doc.restore();
}

function drawCoverDetail(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  x: number,
  y: number,
  width: number
) {
  doc.save();
  doc.rect(x, y, width, 56).fill(COLORS.panel);
  doc.rect(x, y, 4, 56).fill(COLORS.yellow);
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(uppercase(label), x + 14, y + 12, {
      width: width - 28,
      characterSpacing: 1.4
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(value, x + 14, y + 29, {
      width: width - 28,
      lineBreak: false
    });
  doc.restore();
}

function drawCover(doc: PDFKit.PDFDocument, plan: NutritionPlanFull, generatedAt: string) {
  drawPageBackground(doc);
  const pageWidth = doc.page.width;
  const contentLeft = 74;
  const contentWidth = pageWidth - contentLeft * 2;
  const logoSize = 176;
  const logoX = (pageWidth - logoSize) / 2;

  drawLogo(doc, logoX, 42, logoSize);
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("MANOLO HMB NUTRICION", contentLeft, 236, {
      width: contentWidth,
      align: "center",
      characterSpacing: 2.6
    });

  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(58)
    .text("PLAN NUTRICIONAL", contentLeft, 262, {
      width: contentWidth,
      align: "center",
      lineBreak: false
    });

  const detailY = 372;
  const detailGap = 14;
  const detailWidth = (contentWidth - detailGap) / 2;
  drawCoverDetail(
    doc,
    "Atleta",
    uppercase(plan.athleteName || plan.athleteUsername),
    contentLeft,
    detailY,
    detailWidth
  );
  drawCoverDetail(
    doc,
    "Fecha",
    formatDate(generatedAt),
    contentLeft + detailWidth + detailGap,
    detailY,
    detailWidth
  );
}

function drawPlanSectionCover(
  doc: PDFKit.PDFDocument,
  plan: NutritionPlanFull,
  generatedAt: string,
  index: number,
  count: number,
  includeMacros: boolean
) {
  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const title = uppercase(getPlanLabel(plan));
  const titleSize = fitFontSize(doc, title, "Helvetica-Bold", pageWidth, 48, 22, 0.4);
  const visibleMeals = getVisibleMeals(plan);
  const tagWidth = 164;

  doc.y = 132;
  drawYellowTag(doc, `Plan ${index + 1} de ${count}`, left, doc.y, tagWidth);
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(titleSize)
    .text(title, left, doc.y + 42, {
      width: pageWidth,
      characterSpacing: 0.4
    });

  const detailY = doc.y + 34;
  const gap = 12;
  if (includeMacros) {
    const totals = calculatePlanTotals(plan);
    const detailWidth = (pageWidth - gap * 3) / 4;
    drawMetricCard(doc, "Kcal", formatNumber(totals.caloriesKcal, 0), "Energia total", left, detailY, detailWidth);
    drawMetricCard(doc, "Menus", String(visibleMeals.length), "Comidas definidas", left + detailWidth + gap, detailY, detailWidth);
    drawMetricCard(doc, "Atleta", uppercase(plan.athleteName || plan.athleteUsername), "Nombre del atleta", left + (detailWidth + gap) * 2, detailY, detailWidth);
    drawMetricCard(doc, "Fecha", formatDate(generatedAt), "Fecha del PDF", left + (detailWidth + gap) * 3, detailY, detailWidth);
  } else {
    const detailWidth = (pageWidth - gap * 2) / 3;
    drawMetricCard(doc, "Menus", String(visibleMeals.length), "Comidas definidas", left, detailY, detailWidth);
    drawMetricCard(doc, "Atleta", uppercase(plan.athleteName || plan.athleteUsername), "Nombre del atleta", left + detailWidth + gap, detailY, detailWidth);
    drawMetricCard(doc, "Fecha", formatDate(generatedAt), "Fecha del PDF", left + (detailWidth + gap) * 2, detailY, detailWidth);
  }
}

function drawOverviewMealTable(
  doc: PDFKit.PDFDocument,
  meals: NutritionPlanFull["meals"],
  x: number,
  y: number,
  tableWidth: number,
  includeMacros: boolean
): number {
  const columns: PdfTableColumn[] = includeMacros
    ? [
        { label: "MENU", width: 230 },
        { label: "ESTADO", width: 108 },
        { label: "OPCIONES", width: 62, align: "right" },
        { label: "KCAL", width: 64, align: "right" },
        { label: "P", width: 54, align: "right" },
        { label: "C", width: 54, align: "right" },
        { label: "G", width: 54, align: "right" }
      ]
    : [
        { label: "MENU", width: 350 },
        { label: "ESTADO", width: 150 },
        { label: "OPCIONES", width: 80, align: "right" },
        { label: "ALIMENTOS", width: 80, align: "right" }
      ];
  const effectiveWidth = columns.reduce((sum, column) => sum + column.width, 0);
  const offsetX = x + Math.max(0, (tableWidth - effectiveWidth) / 2);

  drawTableHeader(doc, columns, offsetX, y);
  let cursorY = y + 22;

  if (!meals.length) {
    doc.rect(offsetX, cursorY, effectiveWidth, 28).fill(COLORS.panel);
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(8)
      .text("Sin menus definidos.", offsetX + 10, cursorY + 10, { width: effectiveWidth - 20 });
    return cursorY + 42;
  }

  meals.forEach((meal, index) => {
    const totals = calculateMealTotals(meal.entries);
    const optionGroups = getPdfMealOptionGroups(meal);
    const values = includeMacros
      ? [
          meal.name,
          meal.included ? "Suma al total" : "No suma",
          String(optionGroups.length),
          formatNumber(totals.caloriesKcal, 0),
          formatNumber(totals.proteinG),
          formatNumber(totals.carbsG),
          formatNumber(totals.fatG)
        ]
      : [
          meal.name,
          meal.included ? "Incluida" : "No incluida",
          String(optionGroups.length),
          String(meal.entries.length)
        ];
    cursorY += drawTableRow(
      doc,
      columns,
      values,
      offsetX,
      cursorY,
      index % 2 === 1
    );
  });

  return cursorY + 18;
}

function drawOverviewPage(
  doc: PDFKit.PDFDocument,
  plan: NutritionPlanFull,
  totals: NutritionTotals,
  generatedAt: string,
  includeMacros: boolean
) {
  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const visibleMeals = [...plan.meals].sort((a, b) => a.position - b.position);
  const title = uppercase(plan.name);
  const titleSize = fitFontSize(doc, title, "Helvetica-Bold", pageWidth, 34, 18, 0.4);

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("VISTA GENERAL", left, doc.y, {
      width: pageWidth,
      characterSpacing: 2.2
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(titleSize)
    .text(title, left, doc.y + 11, {
      width: pageWidth,
      characterSpacing: 0.4
    });

  const infoY = doc.y + 18;
  const gap = 12;
  const infoWidth = (pageWidth - gap * 2) / 3;
  drawMetricCard(doc, "Atleta", uppercase(plan.athleteName || plan.athleteUsername), "Nombre del atleta", left, infoY, infoWidth);
  drawMetricCard(doc, "Fecha", formatDate(generatedAt), "Fecha de generacion", left + infoWidth + gap, infoY, infoWidth);
  drawMetricCard(doc, "Menus", String(visibleMeals.length), "Menus definidos en el plan", left + (infoWidth + gap) * 2, infoY, infoWidth);

  doc.y = infoY + 86;
  if (includeMacros) {
    drawTargets(doc, plan, totals);
  }

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("MENUS DEFINIDOS", left, doc.y + 4, {
      width: pageWidth,
      characterSpacing: 2
    });
  doc.y = drawOverviewMealTable(doc, visibleMeals, left, doc.y + 22, pageWidth, includeMacros);
}

function drawChartLegend(
  doc: PDFKit.PDFDocument,
  items: Array<{ label: string; color: string }>,
  x: number,
  y: number
) {
  let cursorX = x;
  items.forEach((item) => {
    doc.rect(cursorX, y + 2, 9, 9).fill(item.color);
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(uppercase(item.label), cursorX + 14, y, {
        width: 82,
        characterSpacing: 0.6,
        lineBreak: false
      });
    cursorX += 98;
  });
}

function drawEmptyChartPanel(
  doc: PDFKit.PDFDocument,
  message: string,
  x: number,
  y: number,
  width: number,
  height: number
) {
  doc.rect(x, y, width, height).fill(COLORS.panel);
  doc.rect(x, y, 5, height).fill(COLORS.yellow);
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(10)
    .text(message, x + 22, y + height / 2 - 8, {
      width: width - 44,
      align: "center"
    });
}

function drawMealMacroBarChart(doc: PDFKit.PDFDocument, plan: NutritionPlanFull) {
  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const meals = getVisibleMeals(plan);
  const mealData = meals.map((meal) => ({
    meal,
    totals: calculateMealTotals(meal.entries)
  }));
  const maxMacro = Math.max(
    0,
    ...mealData.flatMap((item) => MACRO_CHART_ITEMS.map((macro) => getMacroValue(item.totals, macro.key)))
  );
  const axisMax = getNiceAxisMax(maxMacro);
  const panelX = left;
  const panelY = 168;
  const panelWidth = pageWidth;
  const panelHeight = 290;
  const plotX = panelX + 46;
  const plotY = panelY + 38;
  const plotWidth = panelWidth - 72;
  const plotHeight = 184;
  const baseline = plotY + plotHeight;

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("GRAFICA POR COMIDA", left, doc.y, {
      width: pageWidth,
      characterSpacing: 2.2
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(34)
    .text("EVOLUCION DE MACROS", left, doc.y + 11, { width: pageWidth });
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text(uppercase(shortLabel(getPlanLabel(plan), 64)), left, doc.y + 3, {
      width: pageWidth,
      characterSpacing: 1.2
    });

  if (!mealData.length) {
    drawEmptyChartPanel(doc, "No hay comidas definidas para representar.", panelX, panelY, panelWidth, panelHeight);
    return;
  }

  doc.rect(panelX, panelY, panelWidth, panelHeight).fill(COLORS.panel);
  doc.rect(panelX, panelY, 5, panelHeight).fill(COLORS.yellow);
  drawChartLegend(
    doc,
    MACRO_CHART_ITEMS.map((item) => ({ label: item.label, color: item.color })),
    panelX + panelWidth - 318,
    panelY + 16
  );

  for (let tick = 0; tick <= 4; tick += 1) {
    const value = (axisMax / 4) * tick;
    const y = baseline - (value / axisMax) * plotHeight;
    doc
      .moveTo(plotX, y)
      .lineTo(plotX + plotWidth, y)
      .strokeColor(tick === 0 ? COLORS.dim : COLORS.line)
      .lineWidth(tick === 0 ? 1 : 0.45)
      .stroke();
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7)
      .text(formatNumber(value, 0), panelX + 10, y - 4, {
        width: 28,
        align: "right"
      });
  }

  doc
    .strokeColor(COLORS.dim)
    .lineWidth(0.7)
    .moveTo(plotX, plotY)
    .lineTo(plotX, baseline)
    .lineTo(plotX + plotWidth, baseline)
    .stroke();

  const groupWidth = plotWidth / Math.max(1, mealData.length);
  const barGap = 2;
  const barWidth = Math.min(15, Math.max(4.5, (groupWidth - 12) / MACRO_CHART_ITEMS.length));
  const groupBarsWidth = barWidth * MACRO_CHART_ITEMS.length + barGap * (MACRO_CHART_ITEMS.length - 1);

  mealData.forEach((item, mealIndex) => {
    const groupLeft = plotX + mealIndex * groupWidth;
    const firstBarX = groupLeft + Math.max(2, (groupWidth - groupBarsWidth) / 2);

    MACRO_CHART_ITEMS.forEach((macro, macroIndex) => {
      const value = getMacroValue(item.totals, macro.key);
      const height = Math.max(1, (value / axisMax) * plotHeight);
      const x = firstBarX + macroIndex * (barWidth + barGap);
      const y = baseline - height;
      doc.rect(x, y, barWidth, height).fill(macro.color);
    });

    doc
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .fontSize(mealData.length > 8 ? 5.8 : 6.8)
      .text(shortLabel(item.meal.name, mealData.length > 8 ? 12 : 18), groupLeft + 2, baseline + 10, {
        width: Math.max(28, groupWidth - 4),
        height: 26,
        align: "center"
      });
  });

  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(7)
    .text("Valores en gramos por comida", panelX + 16, panelY + panelHeight - 22, {
      width: panelWidth - 32,
      align: "right"
    });
}

function drawMealMacroChartsPage(doc: PDFKit.PDFDocument, plan: NutritionPlanFull) {
  drawMealMacroBarChart(doc, plan);
}

function drawPieSector(
  doc: PDFKit.PDFDocument,
  centerX: number,
  centerY: number,
  radius: number,
  startAngle: number,
  endAngle: number,
  color: string
) {
  const steps = Math.max(8, Math.ceil(Math.abs(endAngle - startAngle) / 8));
  doc.save();
  doc.moveTo(centerX, centerY);
  for (let step = 0; step <= steps; step += 1) {
    const angle = (startAngle + ((endAngle - startAngle) * step) / steps) * (Math.PI / 180);
    doc.lineTo(centerX + Math.cos(angle) * radius, centerY + Math.sin(angle) * radius);
  }
  doc.closePath().fill(color);
  doc.restore();
}

function drawMacroPie(
  doc: PDFKit.PDFDocument,
  plan: NutritionPlanFull | null,
  x: number,
  y: number,
  width: number,
  height: number
) {
  doc.rect(x, y, width, height).fill(COLORS.panel);
  doc.rect(x, y, 5, height).fill(COLORS.yellow);

  if (!plan) {
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(10)
      .text("No hay segundo plan para comparar.", x + 20, y + height / 2 - 8, {
        width: width - 40,
        align: "center"
      });
    return;
  }

  const totals = calculatePlanTotals(plan);
  const breakdown = getMacroEnergyBreakdown(totals);
  const totalKcal = breakdown.reduce((sum, item) => sum + item.kcal, 0);
  const title = uppercase(shortLabel(getPlanLabel(plan), 30));
  const titleSize = fitFontSize(doc, title, "Helvetica-Bold", width - 34, 13, 8, 0.5);

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(titleSize)
    .text(title, x + 18, y + 16, {
      width: width - 34,
      characterSpacing: 0.5,
      lineBreak: false
    });

  const centerX = x + 86;
  const centerY = y + 98;
  const radius = 55;

  if (totalKcal <= 0) {
    doc.circle(centerX, centerY, radius).strokeColor(COLORS.dim).lineWidth(1).stroke();
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(8)
      .text("Sin datos", centerX - 34, centerY - 5, { width: 68, align: "center" });
  } else {
    let cursorAngle = -90;
    breakdown.forEach((item) => {
      const nextAngle = cursorAngle + (item.kcal / totalKcal) * 360;
      drawPieSector(doc, centerX, centerY, radius, cursorAngle, nextAngle, item.color);
      cursorAngle = nextAngle;
    });
    doc.circle(centerX, centerY, radius).strokeColor("#050505").lineWidth(1.4).stroke();
  }

  const legendX = x + 166;
  let legendY = y + 58;
  breakdown.forEach((item) => {
    doc.rect(legendX, legendY + 2, 10, 10).fill(item.color);
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${item.shortLabel} ${formatNumber(item.percent, 0)}%`, legendX + 16, legendY, {
        width: 64,
        lineBreak: false
      });
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(7)
      .text(`${formatNumber(item.grams)} g`, legendX + 82, legendY + 1, {
        width: 54,
        lineBreak: false
      });
    legendY += 26;
  });

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(10)
    .text(`${formatNumber(totals.caloriesKcal, 0)} KCAL`, legendX, y + height - 34, {
      width: width - 178,
      align: "left",
      lineBreak: false
    });
}

function drawKcalComparison(
  doc: PDFKit.PDFDocument,
  plans: NutritionPlanFull[],
  x: number,
  y: number,
  width: number,
  height: number
) {
  const rows = plans.slice(0, 6).map((plan) => ({
    plan,
    totals: calculatePlanTotals(plan)
  }));
  const maxKcal = Math.max(1, ...rows.map((row) => row.totals.caloriesKcal));
  const labelWidth = 184;
  const valueWidth = 64;
  const barX = x + labelWidth;
  const barWidth = width - labelWidth - valueWidth - 28;

  doc.rect(x, y, width, height).fill(COLORS.panel);
  doc.rect(x, y, 5, height).fill(COLORS.yellow);
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("COMPARACION DE KCAL", x + 18, y + 16, {
      width: width - 36,
      characterSpacing: 1.5
    });

  if (!rows.length) {
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(9)
      .text("No hay planes para comparar.", x + 18, y + 64, {
        width: width - 36,
        align: "center"
      });
    return;
  }

  rows.forEach((row, index) => {
    const rowY = y + 42 + index * 22;
    const barFill = Math.max(2, (row.totals.caloriesKcal / maxKcal) * barWidth);
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(7.5)
      .text(uppercase(shortLabel(getPlanLabel(row.plan), 28)), x + 18, rowY + 2, {
        width: labelWidth - 28,
        lineBreak: false
      });
    doc.rect(barX, rowY, barWidth, 11).fill("#2A2A2A");
    doc.rect(barX, rowY, barFill, 11).fill(row.plan.id === plans[0]?.id ? COLORS.yellow : "#45C8FF");
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(formatNumber(row.totals.caloriesKcal, 0), barX + barWidth + 10, rowY + 1, {
        width: valueWidth,
        align: "right",
        lineBreak: false
      });
  });

  if (plans.length > rows.length) {
    doc
      .fillColor(COLORS.dim)
      .font("Helvetica")
      .fontSize(7)
      .text(`+${plans.length - rows.length} planes mas`, x + 18, y + height - 20, {
        width: width - 36,
        align: "right"
      });
  }
}

function drawPlanComparisonChartsPage(
  doc: PDFKit.PDFDocument,
  plan: NutritionPlanFull,
  comparisonPlans: NutritionPlanFull[]
) {
  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const plans = getComparisonPlans(plan, comparisonPlans);
  const firstOtherPlan = plans.find((item) => item.id !== plan.id) ?? null;
  const panelGap = 14;
  const panelWidth = (pageWidth - panelGap) / 2;

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("COMPARATIVA ENTRE PLANES", left, doc.y, {
      width: pageWidth,
      characterSpacing: 2.2
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(32)
    .text("DISTRIBUCION MACRO Y KCAL", left, doc.y + 11, { width: pageWidth });

  drawMacroPie(doc, plan, left, 168, panelWidth, 168);
  drawMacroPie(doc, firstOtherPlan, left + panelWidth + panelGap, 168, panelWidth, 168);
  drawKcalComparison(doc, plans, left, 352, pageWidth, 124);
}

function drawTotalsBox(
  doc: PDFKit.PDFDocument,
  label: string,
  current: number,
  target: number,
  unit: string,
  x: number,
  y: number,
  width: number
) {
  const percent = target > 0 ? Math.round((current / target) * 100) : 0;
  const diff = target - current;
  const isOver = diff < 0;
  const barWidth = width - 24;
  const barFill = target > 0 ? Math.min(Math.abs(percent), 120) / 120 : 0;

  doc.save();
  doc.rect(x, y, width, 70).fill(COLORS.panel);
  doc.rect(x, y, 4, 70).fill(isOver ? COLORS.red : COLORS.yellow);
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(uppercase(label), x + 12, y + 10, { width: width - 24, characterSpacing: 1.2 });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(15)
    .text(`${formatNumber(current)} / ${formatNumber(target)} ${unit}`, x + 12, y + 26, {
      width: width - 24
    });
  doc
    .fillColor(isOver ? COLORS.red : COLORS.muted)
    .font("Helvetica")
    .fontSize(8)
    .text(
      isOver
        ? `+${formatNumber(Math.abs(diff))} ${unit} sobre objetivo`
        : `Faltan ${formatNumber(Math.max(diff, 0))} ${unit} - ${percent}%`,
      x + 12,
      y + 47,
      { width: width - 24 }
    );
  doc.rect(x + 12, y + 61, barWidth, 3).fill("#2B2B2B");
  doc.rect(x + 12, y + 61, Math.max(3, barWidth * barFill), 3).fill(isOver ? COLORS.red : COLORS.yellow);
  doc.restore();
}

function drawTargets(doc: PDFKit.PDFDocument, plan: NutritionPlanFull, totals: NutritionTotals) {
  const left = doc.page.margins.left;
  const gap = 12;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const width = (pageWidth - gap * 3) / 4;
  const y = doc.y;

  drawMetricCard(doc, "Kcal", `${formatNumber(totals.caloriesKcal, 0)}`, "Energia total del plan", left, y, width);
  drawTotalsBox(doc, "Proteinas", totals.proteinG, plan.targetProteinG, "g", left + width + gap, y, width);
  drawTotalsBox(doc, "Carbohidratos", totals.carbsG, plan.targetCarbsG, "g", left + (width + gap) * 2, y, width);
  drawTotalsBox(doc, "Grasas", totals.fatG, plan.targetFatG, "g", left + (width + gap) * 3, y, width);
  doc.y = y + 88;
}

function drawTableHeader(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  x: number,
  y: number
) {
  let cursor = x;
  doc.rect(x, y, columns.reduce((sum, col) => sum + col.width, 0), 22).fill(COLORS.yellow);
  doc.fillColor("#050505").font("Helvetica-Bold").fontSize(7.2);
  for (const col of columns) {
    doc.text(col.label, cursor + 5, y + 7, {
      width: col.width - 10,
      align: col.align ?? "left",
      characterSpacing: 0.8
    });
    cursor += col.width;
  }
}

function drawTableRow(
  doc: PDFKit.PDFDocument,
  columns: PdfTableColumn[],
  values: string[],
  x: number,
  y: number,
  shaded: boolean
): number {
  const heights = values.map((value, index) =>
    doc.heightOfString(value, {
      width: columns[index].width - 10,
      align: columns[index].align ?? "left"
    })
  );
  const rowHeight = Math.max(22, Math.max(...heights) + 11);
  const totalWidth = columns.reduce((sum, col) => sum + col.width, 0);

  doc.rect(x, y, totalWidth, rowHeight).fill(shaded ? COLORS.panelAlt : COLORS.panel);
  doc.rect(x, y, 2, rowHeight).fill(COLORS.yellow);
  doc
    .moveTo(x, y + rowHeight)
    .lineTo(x + totalWidth, y + rowHeight)
    .strokeColor(COLORS.line)
    .lineWidth(0.5)
    .stroke();

  let cursor = x;
  doc.fillColor(COLORS.white).font("Helvetica").fontSize(7.7);
  values.forEach((value, index) => {
    doc.text(value, cursor + 5, y + 7, {
      width: columns[index].width - 10,
      align: columns[index].align ?? "left"
    });
    cursor += columns[index].width;
  });

  return rowHeight;
}

function getPdfMealOptionNumber(entry: Pick<NutritionPlanFoodEntry, "mealOption">): number {
  return normalizePdfMealOption(entry.mealOption);
}

function getPdfMealOptionGroups(meal: NutritionPlanFull["meals"][number]): Array<{
  optionNumber: number;
  entries: NutritionPlanFoodEntry[];
}> {
  const entries = Array.isArray(meal.entries) ? meal.entries : [];
  const optionNumbers = new Set<number>([1]);
  entries.forEach((entry) => optionNumbers.add(getPdfMealOptionNumber(entry)));

  return Array.from(optionNumbers)
    .sort((a, b) => a - b)
    .map((optionNumber) => ({
      optionNumber,
      entries: entries
        .filter((entry) => getPdfMealOptionNumber(entry) === optionNumber)
        .sort((a, b) => a.position - b.position)
    }));
}

function isOverReference(value: number, reference: number): boolean {
  return value > reference && value - reference > 0.05;
}

function drawOptionMetric(
  doc: PDFKit.PDFDocument,
  label: string,
  value: string,
  alert: boolean,
  x: number,
  y: number,
  width: number
) {
  doc.rect(x, y, width, 22).fill(alert ? "#2A0F0E" : COLORS.panelAlt);
  doc.rect(x, y, 2.5, 22).fill(alert ? COLORS.red : COLORS.yellow);
  doc
    .fillColor(alert ? COLORS.red : COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(7.2)
    .text(`${label} ${value}`, x + 7, y + 7, {
      width: width - 12,
      align: "right",
      lineBreak: false
    });
}

function drawMealOptionSummary(
  doc: PDFKit.PDFDocument,
  optionNumber: number,
  entriesCount: number,
  totals: NutritionTotals,
  referenceTotals: NutritionTotals,
  includeMacros: boolean,
  x: number,
  width: number
) {
  ensureSpace(doc, includeMacros ? 34 : 26);
  const y = doc.y;
  const isReference = optionNumber === 1;

  doc
    .fillColor(isReference ? "#050505" : COLORS.yellow)
    .rect(x, y, 88, 22)
    .fill(isReference ? COLORS.yellow : COLORS.panelAlt);
  doc
    .fillColor(isReference ? "#050505" : COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(7.4)
    .text(`OPCION ${optionNumber}`, x + 10, y + 7, {
      width: 68,
      characterSpacing: 0.9,
      lineBreak: false
    });
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .fontSize(7)
    .text(`${entriesCount} alimentos`, x + 100, y + 7, {
      width: includeMacros ? 126 : width - 110,
      lineBreak: false
    });

  if (includeMacros) {
    const metricGap = 6;
    const metricWidth = 78;
    const startX = x + width - metricWidth * 4 - metricGap * 3;
    drawOptionMetric(
      doc,
      "KCAL",
      formatNumber(totals.caloriesKcal, 0),
      !isReference && isOverReference(totals.caloriesKcal, referenceTotals.caloriesKcal),
      startX,
      y,
      metricWidth
    );
    drawOptionMetric(
      doc,
      "P",
      `${formatNumber(totals.proteinG)} g`,
      !isReference && isOverReference(totals.proteinG, referenceTotals.proteinG),
      startX + metricWidth + metricGap,
      y,
      metricWidth
    );
    drawOptionMetric(
      doc,
      "C",
      `${formatNumber(totals.carbsG)} g`,
      !isReference && isOverReference(totals.carbsG, referenceTotals.carbsG),
      startX + (metricWidth + metricGap) * 2,
      y,
      metricWidth
    );
    drawOptionMetric(
      doc,
      "G",
      `${formatNumber(totals.fatG)} g`,
      !isReference && isOverReference(totals.fatG, referenceTotals.fatG),
      startX + (metricWidth + metricGap) * 3,
      y,
      metricWidth
    );
  }

  doc.y = y + 30;
}

function drawMealEntryRows(
  doc: PDFKit.PDFDocument,
  entries: NutritionPlanFoodEntry[],
  columns: PdfTableColumn[],
  x: number,
  includeMacros: boolean
) {
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);

  drawTableHeader(doc, columns, x, doc.y);
  doc.y += 22;

  if (!entries.length) {
    ensureSpace(doc, 30);
    const y = doc.y;
    doc.rect(x, y, tableWidth, 26).fill(COLORS.panel);
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica")
      .fontSize(8)
      .text("Sin alimentos pautados.", x + 10, y + 9, { width: tableWidth - 20 });
    doc.y = y + 36;
    return;
  }

  entries.forEach((entry, index) => {
    const entryTotals = calculateEntryTotals(entry);
    const label = entry.customText.trim() || entry.foodName;
    const values = includeMacros
      ? [
          label,
          formatQuantity(entry),
          formatNumber(entryTotals.caloriesKcal, 0),
          formatNumber(entryTotals.proteinG),
          formatNumber(entryTotals.carbsG),
          formatNumber(entryTotals.fatG),
          formatNumber(entryTotals.waterG),
          `${formatNumber(entryTotals.sodiumMg, 0)} mg`
        ]
      : [label, formatQuantity(entry)];
    const estimatedHeight = Math.max(
      22,
      Math.max(
        ...values.map((value, valueIndex) =>
          doc.heightOfString(value, {
            width: columns[valueIndex].width - 10,
            align: columns[valueIndex].align ?? "left"
          })
        )
      ) + 11
    );

    ensureSpace(doc, estimatedHeight + 4);
    doc.y += drawTableRow(doc, columns, values, x, doc.y, index % 2 === 1);

    [...(entry.alternatives ?? [])]
      .sort((a, b) => a.position - b.position)
      .forEach((alternative) => {
        const alternativeTotals = calculateEntryTotals(alternative);
        const alternativeLabel = alternative.customText.trim() || alternative.foodName;
        const alternativeValues = includeMacros
          ? [
              `Alternativa - ${alternativeLabel}`,
              formatQuantity(alternative),
              formatNumber(alternativeTotals.caloriesKcal, 0),
              formatNumber(alternativeTotals.proteinG),
              formatNumber(alternativeTotals.carbsG),
              formatNumber(alternativeTotals.fatG),
              formatNumber(alternativeTotals.waterG),
              `${formatNumber(alternativeTotals.sodiumMg, 0)} mg`
            ]
          : [`Alternativa - ${alternativeLabel}`, formatQuantity(alternative)];
        const alternativeEstimatedHeight = Math.max(
          22,
          Math.max(
            ...alternativeValues.map((value, valueIndex) =>
              doc.heightOfString(value, {
                width: columns[valueIndex].width - 10,
                align: columns[valueIndex].align ?? "left"
              })
            )
          ) + 11
        );

        ensureSpace(doc, alternativeEstimatedHeight + 4);
        doc.y += drawTableRow(doc, columns, alternativeValues, x, doc.y, true);
      });
  });
}

function drawMeal(
  doc: PDFKit.PDFDocument,
  meal: NutritionPlanFull["meals"][number],
  includeMacros: boolean
) {
  ensureSpace(doc, 112);

  const left = doc.page.margins.left;
  const tableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const totals = calculateMealTotals(meal.entries);
  const titleY = doc.y;
  const statusWidth = 170;
  const maxTagWidth = tableWidth - statusWidth - 18;
  doc.font("Helvetica-Bold").fontSize(10);
  const tagWidth = Math.min(
    maxTagWidth,
    Math.max(150, doc.widthOfString(uppercase(meal.name), { characterSpacing: 1.1 }) + 34)
  );

  drawYellowTag(doc, meal.name, left, titleY, tagWidth);
  if (includeMacros) {
    doc
      .fillColor(meal.included ? COLORS.muted : COLORS.red)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(meal.included ? "SUMA AL TOTAL DIARIO" : "NO SUMA AL TOTAL DIARIO", left + tableWidth - statusWidth, titleY + 7, {
        width: statusWidth,
        align: "right",
        characterSpacing: 1
      });
  }

  doc.y = titleY + 34;
  if (includeMacros) {
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(
        `KCAL ${formatNumber(totals.caloriesKcal, 0)}  |  P ${formatNumber(totals.proteinG)} g  |  C ${formatNumber(totals.carbsG)} g  |  G ${formatNumber(totals.fatG)} g  |  AGUA ${formatNumber(totals.waterG)} g  |  SODIO ${formatNumber(totals.sodiumMg, 0)} mg`,
        left,
        doc.y,
        { width: tableWidth, characterSpacing: 0.5 }
      );
  }

  if (meal.notes.trim()) {
    doc.moveDown(0.25);
    doc.fillColor(COLORS.muted).font("Helvetica").fontSize(8).text(meal.notes, { width: tableWidth });
  }

  doc.moveDown(0.65);

  const columns: PdfTableColumn[] = includeMacros
    ? [
        { label: "ALIMENTO", width: 360 },
        { label: "CANTIDAD", width: 74, align: "right" },
        { label: "KCAL", width: 52, align: "right" },
        { label: "P", width: 48, align: "right" },
        { label: "C", width: 48, align: "right" },
        { label: "G", width: 48, align: "right" },
        { label: "AGUA", width: 60, align: "right" },
        { label: "SODIO", width: 64, align: "right" }
      ]
    : [
        { label: "ALIMENTO", width: 590 },
        { label: "CANTIDAD", width: 164, align: "right" }
      ];

  const optionGroups = getPdfMealOptionGroups(meal);
  const referenceTotals = calculateMealOptionTotals(meal.entries, 1);
  optionGroups.forEach(({ optionNumber, entries }) => {
    const optionTotals = calculateMealOptionTotals(meal.entries, optionNumber);
    drawMealOptionSummary(
      doc,
      optionNumber,
      entries.length,
      optionTotals,
      referenceTotals,
      includeMacros,
      left,
      tableWidth
    );
    drawMealEntryRows(doc, entries, columns, left, includeMacros);
    doc.moveDown(0.45);
  });

  doc.y += 16;
}

function drawPlanMenusPage(
  doc: PDFKit.PDFDocument,
  plan: NutritionPlanFull,
  index: number,
  includeMacros: boolean
) {
  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const title = `MENUS - PLAN ${index + 1}`;
  const subtitle = uppercase(shortLabel(getPlanLabel(plan), 64));
  const titleSize = fitFontSize(doc, title, "Helvetica-Bold", pageWidth, 34, 20, 0.3);
  const subtitleSize = fitFontSize(doc, subtitle, "Helvetica-Bold", pageWidth, 13, 8, 0.6);
  const visibleMeals = getVisibleMeals(plan);

  doc.y = 96;
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("MENUS PAUTADOS", left, doc.y, {
      width: pageWidth,
      characterSpacing: 2.2
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(titleSize)
    .text(title, left, doc.y + 11, {
      width: pageWidth,
      characterSpacing: 0.3
    });
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .fontSize(subtitleSize)
    .text(subtitle, left, doc.y + 2, {
      width: pageWidth,
      characterSpacing: 0.6
    });
  doc.y += 20;

  for (const meal of visibleMeals) {
    drawMeal(doc, meal, includeMacros);
  }
}

function drawRoadmapPage(doc: PDFKit.PDFDocument, steps: AthleteRoadmapStep[]) {
  doc.addPage();
  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const sortedSteps = [...steps].sort((a, b) => a.position - b.position).slice(0, 10);

  doc.y = 104;
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("HOJA DE RUTA DEL PROCESO", left, doc.y, {
      width: pageWidth,
      characterSpacing: 2.2
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(44)
    .text("ROADMAP", left, doc.y + 12, { width: pageWidth });
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(9)
    .text("Etapas completadas, etapa actual y siguientes pasos del proceso nutricional.", left, doc.y + 2, {
      width: pageWidth
    });

  if (!sortedSteps.length) {
    drawEmptyChartPanel(doc, "No hay etapas definidas.", left, 230, pageWidth, 170);
    return;
  }

  const hasDates = sortedSteps.some((step) => step.startDate || step.endDate);
  const cardGap = 10;
  const columns = sortedSteps.length <= 5 ? sortedSteps.length : 5;
  const cardWidth = (pageWidth - cardGap * (columns - 1)) / columns;
  const cardHeight = hasDates ? 138 : 120;
  const startY = 220;

  sortedSteps.forEach((step, index) => {
    const row = Math.floor(index / columns);
    const column = index % columns;
    const x = left + column * (cardWidth + cardGap);
    const y = startY + row * (cardHeight + 22);
    const color =
      step.status === "completed" ? "#34D399" : step.status === "current" ? COLORS.yellow : COLORS.dim;
    const panelColor = step.status === "current" ? "#1F1A0A" : COLORS.panel;
    const statusLabel =
      step.status === "completed" ? "COMPLETADA" : step.status === "current" ? "ACTUAL" : "PENDIENTE";

    if (index > 0 && column > 0) {
      doc
        .moveTo(x - cardGap, y + 22)
        .lineTo(x, y + 22)
        .strokeColor(COLORS.line)
        .lineWidth(1)
        .stroke();
    }

    doc.rect(x, y, cardWidth, cardHeight).fill(panelColor);
    doc.rect(x, y, 5, cardHeight).fill(color);
    doc.circle(x + 22, y + 22, 8).fill(color);
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(`${String(index + 1).padStart(2, "0")}. ${uppercase(shortLabel(step.title, 28))}`, x + 38, y + 13, {
        width: cardWidth - 50,
        height: 26,
        characterSpacing: 0.7
      });
    doc
      .fillColor(color)
      .font("Helvetica-Bold")
      .fontSize(7)
      .text(statusLabel, x + 18, y + 48, {
        width: cardWidth - 36,
        characterSpacing: 1.2
      });

    if (hasDates) {
      const dateLabel =
        step.startDate && step.endDate
          ? `${formatDate(step.startDate)} - ${formatDate(step.endDate)}`
          : step.startDate
            ? `Desde ${formatDate(step.startDate)}`
            : step.endDate
              ? `Hasta ${formatDate(step.endDate)}`
              : "Sin fecha cerrada";
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica-Bold")
        .fontSize(7)
        .text(dateLabel, x + 18, y + 66, {
          width: cardWidth - 36,
          height: 16
        });
    }

    if (step.description.trim()) {
      doc
        .fillColor(COLORS.muted)
        .font("Helvetica")
        .fontSize(8)
        .text(step.description, x + 18, y + (hasDates ? 86 : 68), {
          width: cardWidth - 36,
          height: cardHeight - (hasDates ? 96 : 78),
          lineGap: 2
        });
    }
  });
}

function drawGuidancePage(doc: PDFKit.PDFDocument, plan: NutritionPlanFull) {
  doc.addPage();
  const left = doc.page.margins.left;
  const pageWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = 120;
  const guidanceItems = [
    {
      title: "Observaciones",
      eyebrow: "APORTE EXPLICATIVO DEL NUTRICIONISTA",
      text: plan.notes.trim() || "Sin observaciones adicionales."
    },
    {
      title: "Suplementacion",
      eyebrow: "APOYO COMPLEMENTARIO",
      text: plan.supplementation.trim() || "Sin suplementacion pautada."
    },
    {
      title: "Recomendaciones",
      eyebrow: "PAUTAS GENERALES",
      text: plan.recommendations.trim() || "Sin recomendaciones adicionales."
    }
  ];

  doc.y = y;
  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(9)
    .text("OBSERVACIONES GLOBALES DEL PLAN", left, doc.y, {
      width: pageWidth,
      characterSpacing: 2.2
    });
  doc
    .fillColor(COLORS.white)
    .font("Helvetica-Bold")
    .fontSize(44)
    .text("GUIA DEL NUTRICIONISTA", left, doc.y + 12, { width: pageWidth });

  doc.y += 28;
  guidanceItems.forEach((item, index) => {
    const textHeight = doc.heightOfString(item.text, {
      width: pageWidth - 44,
      lineGap: 3
    });
    const panelHeight = Math.max(82, Math.min(132, textHeight + 52));
    ensureSpace(doc, panelHeight + 12);
    const panelY = doc.y;

    doc.rect(left, panelY, pageWidth, panelHeight).fill(index % 2 === 1 ? COLORS.panelAlt : COLORS.panel);
    doc.rect(left, panelY, 5, panelHeight).fill(COLORS.yellow);
    doc
      .fillColor(COLORS.yellow)
      .font("Helvetica-Bold")
      .fontSize(8)
      .text(item.eyebrow, left + 22, panelY + 14, {
        width: pageWidth - 44,
        characterSpacing: 1.2
      });
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(14)
      .text(uppercase(item.title), left + 22, panelY + 28, {
        width: pageWidth - 44,
        height: 18
      });
    doc
      .fillColor(COLORS.white)
      .font("Helvetica")
      .fontSize(10)
      .text(item.text, left + 22, panelY + 52, {
        width: pageWidth - 44,
        height: panelHeight - 60,
        lineGap: 3
      });
    doc.y = panelY + panelHeight + 12;
  });

  doc
    .fillColor(COLORS.yellow)
    .font("Helvetica-Bold")
    .fontSize(16)
    .text("CADA PAUTA EXISTE PARA LLEGAR EN TU MEJOR ESTADO POSIBLE.", left, doc.page.height - 76, {
      width: pageWidth,
      align: "center",
      characterSpacing: 1.3
    });
}

export async function renderNutritionPlanPdf(
  plan: NutritionPlanFull,
  options: NutritionPlanPdfOptions = {}
): Promise<Buffer> {
  const primaryPlan = normalizePdfPlanQuantities(plan);
  const normalizedComparisonPlans = (options.comparisonPlans ?? []).map(normalizePdfPlanQuantities);
  const includeMacros = options.includeMacros !== false;
  const roadmapSteps = [...(options.roadmapSteps ?? [])].sort((a, b) => a.position - b.position);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      layout: "landscape",
      margins: { top: 96, left: 44, right: 44, bottom: 48 },
      bufferPages: true,
      info: {
        Title: `${primaryPlan.athleteName || primaryPlan.athleteUsername} - Plan nutricional`,
        Author: "Manolo HMB Nutricion"
      }
    });
    const chunks: Buffer[] = [];

    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("pageAdded", () => {
      drawPageBackground(doc);
      drawHeader(doc, primaryPlan);
      doc.y = 96;
    });

    const generatedAt = new Date().toISOString();
    const documentPlans = getComparisonPlans(primaryPlan, normalizedComparisonPlans);
    drawCover(doc, primaryPlan, generatedAt);
    if (roadmapSteps.length) {
      drawRoadmapPage(doc, roadmapSteps);
    }

    documentPlans.forEach((documentPlan) => {
      doc.addPage();
      doc.y = 96;
      drawOverviewPage(doc, documentPlan, calculatePlanTotals(documentPlan), generatedAt, includeMacros);
    });

    documentPlans.forEach((documentPlan, index) => {
      doc.addPage();
      drawPlanSectionCover(doc, documentPlan, generatedAt, index, documentPlans.length, includeMacros);

      if (includeMacros) {
        doc.addPage();
        doc.y = 96;
        drawMealMacroChartsPage(doc, documentPlan);
      }

      doc.addPage();
      drawPlanMenusPage(doc, documentPlan, index, includeMacros);
    });

    drawGuidancePage(doc, primaryPlan);

    if (includeMacros) {
      doc.addPage();
      doc.y = 96;
      drawPlanComparisonChartsPage(doc, primaryPlan, documentPlans);
    }

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      if (index > range.start) {
        drawFooter(doc, index + 1, range.count, primaryPlan);
      }
    }

    doc.end();
  });
}
