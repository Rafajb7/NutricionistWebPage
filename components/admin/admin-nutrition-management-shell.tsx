"use client";

import Link from "next/link";
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Copy,
  Download,
  Eye,
  FileText,
  Loader2,
  LogOut,
  Pencil,
  Plus,
  Save,
  Search,
  Shield,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Utensils,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { BrandLogo } from "@/components/brand-logo";
import { BrandButton } from "@/components/ui/brand-button";
import { MotionPage } from "@/components/ui/motion-page";
import { Skeleton } from "@/components/ui/skeleton";
import {
  calculateEntryTotals,
  calculateMacroPercent,
  calculateMealTotals,
  calculateMealOptionTotals,
  calculatePlanTotals,
  EMPTY_NUTRITION_TOTALS,
  ATWATER_KCAL_PER_GRAM,
  getMacroRemaining,
  roundNutritionValue,
} from "@/lib/nutrition/calculations";
import {
  ALLERGY_RESTRICTION_OPTIONS,
  DIET_RESTRICTION_OPTIONS,
  FOOD_RESTRICTION_TAG_OPTIONS,
  INTOLERANCE_RESTRICTION_OPTIONS,
  getRestrictionConflict,
  getRestrictionLabel,
  parseRestrictionTags,
} from "@/lib/nutrition/restrictions";
import type {
  NutritionAthleteRestriction,
  NutritionAthleteRestrictionKey,
  NutritionAthleteRestrictionType,
  NutritionChangeRequest,
  NutritionFood,
  NutritionFoodRestrictionTag,
  NutritionPlanFoodAlternative,
  NutritionPlanFoodEntry,
  NutritionPlanFull,
  NutritionPlanMeal,
  NutritionQuantityUnit,
  NutritionPlanStatus,
  NutritionPlanSummary,
  NutritionTotals,
  NutritionChangeRequestType,
} from "@/lib/nutrition/types";
import {
  getAllowedQuantityUnitsForFood,
  getDefaultQuantityUnitForFood,
  getDefaultUnitWeightGForFood,
  getEffectiveQuantityG,
  normalizeQuantityUnitForFood,
} from "@/lib/nutrition/quantity-units";

type SessionUser = {
  username: string;
  name: string;
};

type AdminNutritionManagementShellProps = {
  user: SessionUser;
};

type Athlete = {
  username: string;
  name: string;
  email: string;
};

type LoadResponse = {
  athletes?: Athlete[];
  foods?: NutritionFood[];
  plans?: NutritionPlanSummary[];
  restrictions?: NutritionAthleteRestriction[];
  changeRequests?: NutritionChangeRequest[];
  error?: string;
};

type ChangeRequestsResponse = {
  requests?: NutritionChangeRequest[];
  error?: string;
};

type PlanResponse = {
  plan?: NutritionPlanFull;
  publishedPlan?: NutritionPlanFull | null;
  error?: string;
};

type FoodFormState = {
  name: string;
  category: string;
  proteinPer100g: string;
  carbsPer100g: string;
  fatPer100g: string;
  sodiumPer100g: string;
  waterPer100g: string;
  restrictionTags: NutritionFoodRestrictionTag[];
};

type NutritionInputFieldKey = Exclude<keyof FoodFormState, "restrictionTags">;

type RestrictionFormState = {
  type: NutritionAthleteRestrictionType;
  key: NutritionAthleteRestrictionKey;
  foodId: string;
  notes: string;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

const EMPTY_FOOD_FORM: FoodFormState = {
  name: "",
  category: "",
  proteinPer100g: "",
  carbsPer100g: "",
  fatPer100g: "",
  sodiumPer100g: "",
  waterPer100g: "",
  restrictionTags: [],
};

const CHANGE_REQUEST_POLL_INTERVAL_MS = 2 * 60_000;
const CHANGE_REQUEST_FOCUS_MIN_INTERVAL_MS = 60_000;

const QUANTITY_UNIT_OPTIONS: Array<{
  value: NutritionQuantityUnit;
  label: string;
}> = [
  { value: "g", label: "g" },
  { value: "piece", label: "pieza" },
  { value: "serving", label: "racion" },
];

const CHANGE_REQUEST_TYPE_LABELS = {
  food_swap: "Sustitucion de alimento",
  calorie_increase: "Aumentar ingesta calorica",
  calorie_decrease: "Reducir ingesta calorica",
  meal_add: "Anadir comida/menu",
  meal_remove: "Eliminar comida/menu",
  meal_redistribution: "Redistribuir comida",
} satisfies Record<NutritionChangeRequestType, string>;

function createClientId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `local-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeNumberInput(value: string): number {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

function sanitizeIntegerInput(value: string): string {
  const integerPart = value.trim().split(/[.,]/)[0] ?? "";
  const digits = integerPart.replace(/\D/g, "");
  if (!digits) return "";
  return digits.replace(/^0+(?=\d)/, "") || "0";
}

function parseIntegerInput(value: string): number | null {
  const sanitized = sanitizeIntegerInput(value);
  if (!sanitized) return null;
  const parsed = Number(sanitized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function formatIntegerValue(value: number, min = 0, max = 10000): string {
  return String(clampInteger(value, min, max));
}

function normalizeQuantityG(value: number): number {
  return clampInteger(value, 1, 10000);
}

function normalizeQuantityUnit(value: unknown): NutritionQuantityUnit {
  if (value === "piece" || value === "serving") return value;
  return "g";
}

function normalizeUnitWeightG(
  value: unknown,
  unit: NutritionQuantityUnit,
): number {
  if (unit === "g") return 1;
  const parsed = typeof value === "number" ? value : Number(value);
  return clampInteger(Number.isFinite(parsed) ? parsed : 150, 1, 10000);
}

function normalizeMealOption(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return clampInteger(Number.isFinite(parsed) ? parsed : 1, 1, 20);
}

function normalizeUsername(value: string): string {
  return value.trim().replace(/^@/, "").toLowerCase();
}

function normalizePlanGrams(plan: NutritionPlanFull): NutritionPlanFull {
  const meals = Array.isArray(plan.meals) ? plan.meals : [];

  return {
    ...plan,
    supplementation: plan.supplementation ?? "",
    recommendations: plan.recommendations ?? "",
    targetProteinG: clampInteger(plan.targetProteinG, 0, 2000),
    targetCarbsG: clampInteger(plan.targetCarbsG, 0, 3000),
    targetFatG: clampInteger(plan.targetFatG, 0, 1000),
    meals: meals.map((meal) => ({
      ...meal,
      entries: (Array.isArray(meal.entries) ? meal.entries : [])
        .map((entry) => ({
          ...entry,
          quantityG: normalizeQuantityG(entry.quantityG),
          quantityUnit: normalizeQuantityUnit(entry.quantityUnit),
          unitWeightG: normalizeUnitWeightG(
            entry.unitWeightG,
            normalizeQuantityUnit(entry.quantityUnit),
          ),
          mealOption: normalizeMealOption(entry.mealOption),
          alternatives: (Array.isArray(entry.alternatives)
            ? entry.alternatives
            : []
          ).map((alternative) => ({
            ...alternative,
            quantityG: normalizeQuantityG(alternative.quantityG),
            quantityUnit: normalizeQuantityUnit(alternative.quantityUnit),
            unitWeightG: normalizeUnitWeightG(
              alternative.unitWeightG,
              normalizeQuantityUnit(alternative.quantityUnit),
            ),
          })),
        }))
        .sort((a, b) => {
          const optionDiff =
            normalizeMealOption(a.mealOption) -
            normalizeMealOption(b.mealOption);
          if (optionDiff !== 0) return optionDiff;
          return a.position - b.position;
        }),
    })),
  };
}

function formatNumber(value: number, decimals = 1): string {
  const rounded = roundNutritionValue(value, decimals);
  return new Intl.NumberFormat("es-ES", {
    useGrouping: false,
    minimumFractionDigits: rounded % 1 === 0 ? 0 : decimals,
    maximumFractionDigits: decimals,
  }).format(rounded);
}

function formatDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

function getStatusLabel(status: NutritionPlanStatus): string {
  if (status === "published") return "Publicado";
  return "Revision";
}

function getStatusClass(status: NutritionPlanStatus): string {
  if (status === "published")
    return "border-emerald-300/35 bg-emerald-500/10 text-emerald-100";
  return "border-sky-300/35 bg-sky-500/10 text-sky-100";
}

function foodToForm(food: NutritionFood): FoodFormState {
  return {
    name: food.name,
    category: food.category,
    proteinPer100g: String(food.proteinPer100g),
    carbsPer100g: String(food.carbsPer100g),
    fatPer100g: String(food.fatPer100g),
    sodiumPer100g: String(food.sodiumPer100g),
    waterPer100g: String(food.waterPer100g),
    restrictionTags: parseRestrictionTags(food.restrictionTags),
  };
}

function buildFoodPayload(form: FoodFormState) {
  return {
    name: form.name.trim(),
    category: form.category.trim(),
    proteinPer100g: normalizeNumberInput(form.proteinPer100g),
    carbsPer100g: normalizeNumberInput(form.carbsPer100g),
    fatPer100g: normalizeNumberInput(form.fatPer100g),
    sodiumPer100g: normalizeNumberInput(form.sodiumPer100g),
    waterPer100g: normalizeNumberInput(form.waterPer100g),
    restrictionTags: parseRestrictionTags(form.restrictionTags),
  };
}

function toPlanSummary(plan: NutritionPlanFull): NutritionPlanSummary {
  const { meals: _meals, versions: _versions, ...summary } = plan;
  return summary;
}

function getFoodLikeForEntry(
  item: Pick<
    NutritionPlanFoodEntry | NutritionPlanFoodAlternative,
    "foodId" | "foodName"
  >,
  foods: NutritionFood[],
): Pick<NutritionFood, "id" | "name" | "category"> {
  return (
    foods.find((food) => food.id === item.foodId) ?? {
      id: item.foodId,
      name: item.foodName,
      category: "",
    }
  );
}

function getQuantityUnitOptionsForFood(
  food: Pick<NutritionFood, "id" | "name" | "category">,
): Array<{ value: NutritionQuantityUnit; label: string }> {
  const allowed = getAllowedQuantityUnitsForFood(food);
  return QUANTITY_UNIT_OPTIONS.filter((option) =>
    allowed.includes(option.value),
  );
}

function getQuantityUnitLabel(
  unit: NutritionQuantityUnit,
  quantity: number,
): string {
  if (unit === "piece") return quantity === 1 ? "pieza" : "piezas";
  if (unit === "serving") return quantity === 1 ? "racion" : "raciones";
  return "g";
}

function formatDisplayQuantity(item: {
  quantityG: number;
  quantityUnit?: NutritionQuantityUnit;
  unitWeightG?: number;
}): string {
  const quantity = normalizeQuantityG(item.quantityG);
  const unit = normalizeQuantityUnit(item.quantityUnit);
  return `${formatNumber(quantity, 0)} ${getQuantityUnitLabel(unit, quantity)}`;
}

function getUnitAwareQuantityForFood(
  food: Pick<
    NutritionFood,
    | "id"
    | "name"
    | "category"
    | "proteinPer100g"
    | "carbsPer100g"
    | "fatPer100g"
  >,
  requestedQuantity: number,
): {
  quantityG: number;
  quantityUnit: NutritionQuantityUnit;
  unitWeightG: number;
} {
  const quantityUnit = getDefaultQuantityUnitForFood(food);
  const unitWeightG = getDefaultUnitWeightGForFood(food, quantityUnit);
  if (quantityUnit === "g") {
    return {
      quantityG: normalizeQuantityG(requestedQuantity),
      quantityUnit,
      unitWeightG,
    };
  }

  const requestedUnits =
    requestedQuantity <= 20
      ? requestedQuantity
      : requestedQuantity / unitWeightG;
  return {
    quantityG: normalizeQuantityG(requestedUnits),
    quantityUnit,
    unitWeightG,
  };
}

function convertQuantityUnitForFood(
  item: Pick<
    NutritionPlanFoodEntry | NutritionPlanFoodAlternative,
    "quantityG" | "quantityUnit" | "unitWeightG"
  >,
  food: Pick<NutritionFood, "id" | "name" | "category">,
  requestedUnit: NutritionQuantityUnit,
): {
  quantityG: number;
  quantityUnit: NutritionQuantityUnit;
  unitWeightG: number;
} {
  const currentEffectiveG = getEffectiveQuantityG(item);
  const quantityUnit = normalizeQuantityUnitForFood(food, requestedUnit);
  const unitWeightG = getDefaultUnitWeightGForFood(food, quantityUnit);
  const quantityG =
    quantityUnit === "g"
      ? normalizeQuantityG(currentEffectiveG)
      : normalizeQuantityG(currentEffectiveG / unitWeightG);

  return { quantityG, quantityUnit, unitWeightG };
}

function getMealOptionNumber(
  entry: Pick<NutritionPlanFoodEntry, "mealOption">,
): number {
  return normalizeMealOption(entry.mealOption);
}

function buildMealOptionKey(mealId: string, optionNumber: number): string {
  return `${mealId}:option:${optionNumber}`;
}

function getMealOptionGroups(meal: NutritionPlanFull["meals"][number]): Array<{
  optionNumber: number;
  entries: NutritionPlanFoodEntry[];
}> {
  const entries = Array.isArray(meal.entries) ? meal.entries : [];
  const optionNumbers = new Set<number>([1]);
  entries.forEach((entry) => optionNumbers.add(getMealOptionNumber(entry)));

  return Array.from(optionNumbers)
    .sort((a, b) => a - b)
    .map((optionNumber) => ({
      optionNumber,
      entries: entries
        .filter((entry) => getMealOptionNumber(entry) === optionNumber)
        .sort((a, b) => a.position - b.position),
    }));
}

function buildEntryFromFood(
  planId: string,
  mealId: string,
  food: NutritionFood,
  quantityG: number,
  position: number,
  mealOption: number,
): NutritionPlanFoodEntry {
  const now = new Date().toISOString();
  const quantity = getUnitAwareQuantityForFood(food, quantityG);
  return {
    id: createClientId(),
    planId,
    mealId,
    foodId: food.id,
    foodName: food.name,
    quantityG: quantity.quantityG,
    quantityUnit: quantity.quantityUnit,
    unitWeightG: quantity.unitWeightG,
    proteinPer100g: food.proteinPer100g,
    carbsPer100g: food.carbsPer100g,
    fatPer100g: food.fatPer100g,
    sodiumPer100g: food.sodiumPer100g,
    waterPer100g: food.waterPer100g,
    position,
    mealOption,
    customText: "",
    alternatives: [],
    createdAt: now,
    updatedAt: now,
  };
}

function calculateFoodCaloriesPer100g(
  food: Pick<NutritionFood, "proteinPer100g" | "carbsPer100g" | "fatPer100g">,
): number {
  return roundNutritionValue(
    food.proteinPer100g * ATWATER_KCAL_PER_GRAM.protein +
      food.carbsPer100g * ATWATER_KCAL_PER_GRAM.carbs +
      food.fatPer100g * ATWATER_KCAL_PER_GRAM.fat,
    0,
  );
}

function getRestrictionTypeLabel(
  type: NutritionAthleteRestrictionType,
): string {
  if (type === "allergy") return "Alergia";
  if (type === "intolerance") return "Intolerancia";
  if (type === "dislike") return "No le gusta";
  return "Dieta";
}

function getRestrictionTypeClass(
  type: NutritionAthleteRestrictionType,
): string {
  if (type === "allergy") return "border-red-300/40 bg-red-500/10 text-red-100";
  if (type === "intolerance")
    return "border-amber-300/40 bg-amber-500/10 text-amber-100";
  if (type === "dislike") return "border-sky-300/40 bg-sky-500/10 text-sky-100";
  return "border-emerald-300/40 bg-emerald-500/10 text-emerald-100";
}

function getRestrictionOptions(type: NutritionAthleteRestrictionType) {
  if (type === "allergy") return ALLERGY_RESTRICTION_OPTIONS;
  if (type === "intolerance") return INTOLERANCE_RESTRICTION_OPTIONS;
  if (type === "diet") return DIET_RESTRICTION_OPTIONS;
  return [];
}

function getDefaultRestrictionKey(
  type: NutritionAthleteRestrictionType,
): NutritionAthleteRestrictionKey {
  if (type === "allergy")
    return ALLERGY_RESTRICTION_OPTIONS[0]?.key ?? "gluten";
  if (type === "intolerance")
    return INTOLERANCE_RESTRICTION_OPTIONS[0]?.key ?? "lactose";
  if (type === "diet") return DIET_RESTRICTION_OPTIONS[0]?.key ?? "diet_vegan";
  return "food_dislike";
}

function getFoodTagLabel(tag: NutritionFoodRestrictionTag): string {
  return (
    FOOD_RESTRICTION_TAG_OPTIONS.find((option) => option.key === tag)?.label ??
    tag
  );
}

function formatRestrictionLabel(
  restriction: NutritionAthleteRestriction,
): string {
  if (restriction.type === "dislike") return restriction.label;
  return getRestrictionLabel(
    restriction.type,
    restriction.key,
    restriction.label,
  );
}

function formatFoodTagSummary(tags: NutritionFoodRestrictionTag[]): string {
  const labels = parseRestrictionTags(tags).map(getFoodTagLabel);
  return labels.length ? labels.join(", ") : "-";
}

function getChangeRequestTypeLabel(request: NutritionChangeRequest): string {
  return (
    CHANGE_REQUEST_TYPE_LABELS[request.requestType] ??
    CHANGE_REQUEST_TYPE_LABELS.food_swap
  );
}

function isFoodSwapRequest(request: NutritionChangeRequest): boolean {
  return request.requestType === "food_swap";
}

function getChangeRequestMainText(request: NutritionChangeRequest): string {
  if (isFoodSwapRequest(request)) {
    return request.mealName || "Sustitucion de alimento";
  }
  return request.requestSummary || getChangeRequestTypeLabel(request);
}

function getChangeRequestDetailText(request: NutritionChangeRequest): string {
  if (isFoodSwapRequest(request)) {
    return `${request.originalFoodName} (${formatNumber(request.originalQuantityG, 0)} g) -> ${
      request.requestedFoodName
    } (${formatNumber(request.requestedQuantityG, 0)} g)`;
  }
  if (request.mealName) return `Menu relacionado: ${request.mealName}`;
  return "Solicitud general sobre el plan nutricional.";
}

function buildAlternativeFromFood(
  entry: NutritionPlanFoodEntry,
  food: NutritionFood,
  position: number,
): NutritionPlanFoodAlternative {
  const now = new Date().toISOString();
  const targetCalories = calculateEntryTotals(entry).caloriesKcal;
  const foodCaloriesPer100g = calculateFoodCaloriesPer100g(food);
  const quantityUnit = getDefaultQuantityUnitForFood(food);
  const unitWeightG = getDefaultUnitWeightGForFood(food, quantityUnit);
  const caloriesPerUnit = foodCaloriesPer100g * (unitWeightG / 100);
  const quantityG =
    quantityUnit === "g"
      ? targetCalories > 0 && foodCaloriesPer100g > 0
        ? normalizeQuantityG((targetCalories / foodCaloriesPer100g) * 100)
        : normalizeQuantityG(getEffectiveQuantityG(entry))
      : targetCalories > 0 && caloriesPerUnit > 0
        ? normalizeQuantityG(targetCalories / caloriesPerUnit)
        : 1;

  return {
    id: createClientId(),
    entryId: entry.id,
    foodId: food.id,
    foodName: food.name,
    quantityG,
    quantityUnit,
    unitWeightG,
    proteinPer100g: food.proteinPer100g,
    carbsPer100g: food.carbsPer100g,
    fatPer100g: food.fatPer100g,
    sodiumPer100g: food.sodiumPer100g,
    waterPer100g: food.waterPer100g,
    position,
    customText: "",
    createdAt: now,
    updatedAt: now,
  };
}

function applyChangeRequestToPlanDraft(
  currentPlan: NutritionPlanFull,
  request: NutritionChangeRequest,
  requestedFood: NutritionFood,
): NutritionPlanFull {
  const now = new Date().toISOString();
  return normalizePlanGrams({
    ...currentPlan,
    status: "review",
    meals: currentPlan.meals.map((meal) => ({
      ...meal,
      entries: meal.entries.map((entry) => {
        if (meal.id !== request.mealId || entry.id !== request.entryId)
          return entry;
        const quantity = getUnitAwareQuantityForFood(
          requestedFood,
          request.requestedQuantityG,
        );
        return {
          ...entry,
          foodId: requestedFood.id,
          foodName: requestedFood.name,
          quantityG: quantity.quantityG,
          quantityUnit: quantity.quantityUnit,
          unitWeightG: quantity.unitWeightG,
          proteinPer100g: requestedFood.proteinPer100g,
          carbsPer100g: requestedFood.carbsPer100g,
          fatPer100g: requestedFood.fatPer100g,
          sodiumPer100g: requestedFood.sodiumPer100g,
          waterPer100g: requestedFood.waterPer100g,
          updatedAt: now,
        };
      }),
    })),
  });
}

function MacroProgress(props: {
  label: string;
  current: number;
  target: number;
  unit?: string;
}) {
  const unit = props.unit ?? "g";
  const remaining = getMacroRemaining(props.current, props.target);
  const percent = calculateMacroPercent(props.current, props.target);
  const isOver = remaining < 0;
  const width = props.target > 0 ? Math.min(100, Math.max(4, percent)) : 0;

  return (
    <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-[11px] uppercase tracking-[0.16em] text-brand-muted">
            {props.label}
          </p>
          <p className="mt-1 text-lg font-bold text-brand-text">
            {formatNumber(props.current)} / {formatNumber(props.target)} {unit}
          </p>
        </div>
        <span
          className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-semibold ${
            isOver
              ? "border-red-300/40 bg-red-500/10 text-red-100"
              : "border-brand-accent/40 bg-brand-accent/10 text-brand-text"
          }`}
        >
          {percent}%
        </span>
      </div>
      <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10">
        <div
          className={`h-full rounded-full ${isOver ? "bg-red-400" : "bg-brand-accent"}`}
          style={{ width: `${width}%` }}
        />
      </div>
      <p
        className={`mt-2 text-xs ${isOver ? "text-red-100" : "text-brand-muted"}`}
      >
        {isOver
          ? `+${formatNumber(Math.abs(remaining))} ${unit} sobre objetivo`
          : `Faltan ${formatNumber(Math.max(remaining, 0))} ${unit}`}
      </p>
    </div>
  );
}

function SmallTotal({
  label,
  value,
  unit,
  alert = false,
}: {
  label: string;
  value: number;
  unit: string;
  alert?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs ${
        alert
          ? "border-red-400/35 bg-red-500/10 text-red-100"
          : "border-white/10 bg-black/25 text-brand-muted"
      }`}
    >
      <span>{label}</span>
      <strong className={alert ? "text-red-100" : "text-brand-text"}>
        {formatNumber(value)}
      </strong>
      <span>{unit}</span>
    </span>
  );
}

function FoodRestrictionTagPicker(props: {
  value: NutritionFoodRestrictionTag[];
  onToggle: (tag: NutritionFoodRestrictionTag) => void;
}) {
  const valueSet = new Set(props.value);
  const groups = [
    { id: "allergen", label: "Alergenos e intolerancias" },
    { id: "animal", label: "Origen animal" },
  ] as const;

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-black/20 p-3">
      {groups.map((group) => (
        <div key={group.id}>
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-muted">
            {group.label}
          </p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {FOOD_RESTRICTION_TAG_OPTIONS.filter(
              (option) => option.group === group.id,
            ).map((option) => (
              <label
                key={option.key}
                className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1.5 text-xs transition ${
                  valueSet.has(option.key)
                    ? "border-brand-accent/45 bg-brand-accent/10 text-brand-text"
                    : "border-white/10 bg-white/[0.03] text-brand-muted"
                }`}
              >
                <input
                  type="checkbox"
                  checked={valueSet.has(option.key)}
                  onChange={() => props.onToggle(option.key)}
                  className="h-3.5 w-3.5 rounded border-white/20 bg-black/20 accent-brand-accent"
                />
                <span className="min-w-0 truncate">{option.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function AdminNutritionManagementShell({
  user,
}: AdminNutritionManagementShellProps) {
  const searchParams = useSearchParams();
  const initialAthleteParam = normalizeUsername(
    searchParams.get("athlete") ?? "",
  );
  const initialRequestParam = (searchParams.get("request") ?? "").trim();
  const [athletes, setAthletes] = useState<Athlete[]>([]);
  const [foods, setFoods] = useState<NutritionFood[]>([]);
  const [plans, setPlans] = useState<NutritionPlanSummary[]>([]);
  const [athleteRestrictions, setAthleteRestrictions] = useState<
    NutritionAthleteRestriction[]
  >([]);
  const [changeRequests, setChangeRequests] = useState<
    NutritionChangeRequest[]
  >([]);
  const [selectedAthlete, setSelectedAthlete] = useState("");
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [plan, setPlan] = useState<NutritionPlanFull | null>(null);
  const [reviewPlan, setReviewPlan] = useState<NutritionPlanFull | null>(null);
  const [publishedPlan, setPublishedPlan] = useState<NutritionPlanFull | null>(
    null,
  );
  const [planMode, setPlanMode] = useState<NutritionPlanStatus>("review");
  const [loading, setLoading] = useState(true);
  const [planLoading, setPlanLoading] = useState(false);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [activePanel, setActivePanel] = useState<"plans" | "foods">("plans");
  const [athleteFilter, setAthleteFilter] = useState("");
  const [planNameDraft, setPlanNameDraft] = useState("Dia de entrenamiento");
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [foodSearches, setFoodSearches] = useState<Record<string, string>>({});
  const [foodQuantities, setFoodQuantities] = useState<Record<string, string>>(
    {},
  );
  const [mealSelectedOptions, setMealSelectedOptions] = useState<
    Record<string, string>
  >({});
  const [alternativeSearches, setAlternativeSearches] = useState<
    Record<string, string>
  >({});
  const [foodFilter, setFoodFilter] = useState("");
  const [foodForm, setFoodForm] = useState<FoodFormState>(EMPTY_FOOD_FORM);
  const [editingFoodId, setEditingFoodId] = useState<string | null>(null);
  const [foodSubmitting, setFoodSubmitting] = useState(false);
  const [quickFoodMealId, setQuickFoodMealId] = useState<string | null>(null);
  const [quickFoodOptionNumber, setQuickFoodOptionNumber] = useState(1);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [pdfIncludeMacros, setPdfIncludeMacros] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [selectedClonePlanId, setSelectedClonePlanId] = useState("");
  const [cloningMenus, setCloningMenus] = useState(false);
  const [restrictionSubmitting, setRestrictionSubmitting] = useState(false);
  const [integerInputDrafts, setIntegerInputDrafts] = useState<
    Record<string, string>
  >({});
  const [resolvingRequestId, setResolvingRequestId] = useState<string | null>(
    null,
  );
  const [requestAdminNotes, setRequestAdminNotes] = useState<
    Record<string, string>
  >({});
  const pendingRequestToApplyRef = useRef<string | null>(null);
  const foodsRef = useRef<NutritionFood[]>([]);
  const changeRequestsRef = useRef<NutritionChangeRequest[]>([]);
  const lastChangeRequestRefreshAtRef = useRef(0);
  const [restrictionForm, setRestrictionForm] = useState<RestrictionFormState>({
    type: "intolerance",
    key: "lactose",
    foodId: "",
    notes: "",
  });

  const selectedAthleteInfo = useMemo(
    () =>
      athletes.find((athlete) => athlete.username === selectedAthlete) ?? null,
    [athletes, selectedAthlete],
  );

  const filteredAthletes = useMemo(() => {
    const q = athleteFilter.trim().toLowerCase();
    if (!q) return athletes;
    return athletes.filter(
      (athlete) =>
        athlete.name.toLowerCase().includes(q) ||
        athlete.username.toLowerCase().includes(q) ||
        athlete.email.toLowerCase().includes(q),
    );
  }, [athletes, athleteFilter]);

  const plansForAthlete = useMemo(() => {
    return plans
      .filter((item) => item.athleteUsername === selectedAthlete)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [plans, selectedAthlete]);

  const activeFoods = useMemo(
    () => foods.filter((food) => food.active),
    [foods],
  );

  const selectedAthleteRestrictions = useMemo(() => {
    return athleteRestrictions
      .filter((restriction) => restriction.athleteUsername === selectedAthlete)
      .sort((a, b) => {
        const typeCompare = a.type.localeCompare(b.type, "es");
        if (typeCompare !== 0) return typeCompare;
        return formatRestrictionLabel(a).localeCompare(
          formatRestrictionLabel(b),
          "es",
        );
      });
  }, [athleteRestrictions, selectedAthlete]);

  const filteredFoods = useMemo(() => {
    const q = foodFilter.trim().toLowerCase();
    if (!q) return foods;
    return foods.filter(
      (food) =>
        food.name.toLowerCase().includes(q) ||
        food.category.toLowerCase().includes(q),
    );
  }, [foods, foodFilter]);

  const planTotals = useMemo<NutritionTotals>(() => {
    return plan ? calculatePlanTotals(plan) : EMPTY_NUTRITION_TOTALS;
  }, [plan]);

  const hasPublishedSnapshot = Boolean(
    publishedPlan || plan?.publishedFileId || reviewPlan?.publishedFileId,
  );
  const isCurrentPlanPublished = planMode === "published";

  const cloneablePlans = useMemo(() => {
    return plans
      .filter(
        (item) =>
          item.id !== plan?.id && item.athleteUsername !== selectedAthlete,
      )
      .sort((a, b) => {
        const athleteCompare = (
          a.athleteName || a.athleteUsername
        ).localeCompare(b.athleteName || b.athleteUsername, "es");
        if (athleteCompare !== 0) return athleteCompare;
        return a.name.localeCompare(b.name, "es");
      });
  }, [plans, plan?.id, selectedAthlete]);

  const pendingChangeRequests = useMemo(
    () => changeRequests.filter((request) => request.status === "pending"),
    [changeRequests],
  );

  const selectedAthleteChangeRequests = useMemo(() => {
    return pendingChangeRequests.filter(
      (request) => request.athleteUsername === selectedAthlete,
    );
  }, [pendingChangeRequests, selectedAthlete]);

  const pendingChangeRequestGroups = useMemo(() => {
    const groups = new Map<
      string,
      {
        username: string;
        name: string;
        count: number;
        firstRequestId: string;
        firstPlanId: string;
      }
    >();

    for (const request of pendingChangeRequests) {
      const username = request.athleteUsername;
      const athlete = athletes.find((item) => item.username === username);
      const current = groups.get(username);
      if (current) {
        current.count += 1;
      } else {
        groups.set(username, {
          username,
          name: athlete?.name || request.athleteName || username,
          count: 1,
          firstRequestId: request.id,
          firstPlanId: request.planId,
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) =>
      a.name.localeCompare(b.name, "es"),
    );
  }, [athletes, pendingChangeRequests]);

  useEffect(() => {
    foodsRef.current = foods;
  }, [foods]);

  useEffect(() => {
    changeRequestsRef.current = changeRequests;
  }, [changeRequests]);

  const upsertPlanSummary = useCallback((nextPlan: NutritionPlanFull) => {
    const summary = toPlanSummary(nextPlan);
    setPlans((current) => {
      const exists = current.some((item) => item.id === summary.id);
      const next = exists
        ? current.map((item) => (item.id === summary.id ? summary : item))
        : [summary, ...current];
      return next.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  const loadInitialData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/nutrition-management", {
        cache: "no-store",
      });
      if (res.status === 401) {
        window.location.href = "/login";
        return;
      }
      if (res.status === 403) {
        toast.error("No tienes permisos de administrador.");
        window.location.href = "/dashboard";
        return;
      }

      const json = (await res.json()) as LoadResponse;
      if (!res.ok)
        throw new Error(json.error ?? "No se pudo cargar la herramienta.");

      const nextAthletes = json.athletes ?? [];
      const nextPlans = json.plans ?? [];
      const nextChangeRequests = json.changeRequests ?? [];
      lastChangeRequestRefreshAtRef.current = Date.now();
      setAthletes(nextAthletes);
      setFoods(json.foods ?? []);
      setPlans(nextPlans);
      setAthleteRestrictions(json.restrictions ?? []);
      setChangeRequests(nextChangeRequests);

      const requestedChange = initialRequestParam
        ? nextChangeRequests.find(
            (request) => request.id === initialRequestParam,
          )
        : null;
      const requestedAthlete =
        requestedChange?.athleteUsername ||
        nextAthletes.find((item) => item.username === initialAthleteParam)
          ?.username ||
        "";
      const athlete = requestedAthlete || nextAthletes[0]?.username || "";
      setSelectedAthlete(athlete);
      const firstPlan = requestedChange
        ? nextPlans.find((item) => item.id === requestedChange.planId)
        : nextPlans.find((item) => item.athleteUsername === athlete);
      if (requestedChange?.status === "pending") {
        pendingRequestToApplyRef.current = requestedChange.id;
      }
      setSelectedPlanId(firstPlan?.id ?? "");
    } catch (error) {
      console.error(error);
      toast.error("Error cargando Gestion nutricional.");
    } finally {
      setLoading(false);
    }
  }, [initialAthleteParam, initialRequestParam]);

  useEffect(() => {
    void loadInitialData();
  }, [loadInitialData]);

  const refreshPendingChangeRequests = useCallback(async () => {
    lastChangeRequestRefreshAtRef.current = Date.now();
    try {
      const res = await fetch("/api/admin/nutrition-change-requests", {
        cache: "no-store",
      });
      if (!res.ok) return;
      const json = (await res.json()) as ChangeRequestsResponse;
      const requests = json.requests ?? [];
      setChangeRequests((current) => {
        const resolvedRequests = current.filter(
          (request) => request.status !== "pending",
        );
        return [...resolvedRequests, ...requests].sort((a, b) => {
          const statusOrder = {
            pending: 0,
            approved: 1,
            denied: 2,
          } satisfies Record<NutritionChangeRequest["status"], number>;
          const statusDiff = statusOrder[a.status] - statusOrder[b.status];
          if (statusDiff !== 0) return statusDiff;
          return b.updatedAt.localeCompare(a.updatedAt);
        });
      });
    } catch (error) {
      console.error(error);
    }
  }, []);

  useEffect(() => {
    const refresh = () => {
      const now = Date.now();
      if (
        now - lastChangeRequestRefreshAtRef.current <
        CHANGE_REQUEST_FOCUS_MIN_INTERVAL_MS
      ) {
        return;
      }
      void refreshPendingChangeRequests();
    };
    const intervalId = window.setInterval(
      refresh,
      CHANGE_REQUEST_POLL_INTERVAL_MS,
    );
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [refreshPendingChangeRequests]);

  useEffect(() => {
    if (cloneablePlans.some((item) => item.id === selectedClonePlanId)) return;
    setSelectedClonePlanId(cloneablePlans[0]?.id ?? "");
  }, [cloneablePlans, selectedClonePlanId]);

  useEffect(() => {
    if (!selectedPlanId) {
      setPlan(null);
      setReviewPlan(null);
      setPublishedPlan(null);
      setPlanMode("review");
      setSaveState("idle");
      setIntegerInputDrafts({});
      setMealSelectedOptions({});
      return;
    }

    let cancelled = false;
    setPlanLoading(true);
    setIntegerInputDrafts({});
    setMealSelectedOptions({});
    fetch(`/api/admin/nutrition-management/plans/${selectedPlanId}`, {
      cache: "no-store",
    })
      .then(async (res) => {
        const json = (await res.json()) as PlanResponse;
        if (!res.ok)
          throw new Error(json.error ?? "No se pudo cargar el plan.");
        if (!cancelled) {
          let nextReviewPlan = json.plan
            ? normalizePlanGrams({ ...json.plan, status: "review" })
            : null;
          const nextPublishedPlan = json.publishedPlan
            ? normalizePlanGrams({ ...json.publishedPlan, status: "published" })
            : json.plan?.status === "published"
              ? normalizePlanGrams({ ...json.plan, status: "published" })
              : null;
          let nextSaveState: SaveState = "saved";
          const pendingRequestId = pendingRequestToApplyRef.current;
          if (nextReviewPlan && pendingRequestId) {
            const request = changeRequestsRef.current.find(
              (item) => item.id === pendingRequestId,
            );
            const requestedFood = request
              ? foodsRef.current.find(
                  (food) => food.id === request.requestedFoodId,
                )
              : null;
            if (
              request &&
              request.planId === nextReviewPlan.id &&
              !isFoodSwapRequest(request)
            ) {
              nextSaveState = "dirty";
              pendingRequestToApplyRef.current = null;
              toast.success(
                "Solicitud abierta. Ajusta el plan en revision y publica cuando este listo.",
              );
            } else if (
              request &&
              requestedFood &&
              request.planId === nextReviewPlan.id
            ) {
              nextReviewPlan = applyChangeRequestToPlanDraft(
                nextReviewPlan,
                request,
                requestedFood,
              );
              nextSaveState = "dirty";
              pendingRequestToApplyRef.current = null;
              toast.success(
                "Solicitud aplicada al editor. Ajusta el plan y aprueba/publica.",
              );
            } else if (request && request.planId === nextReviewPlan.id) {
              pendingRequestToApplyRef.current = null;
              toast.error(
                "El alimento solicitado ya no existe en el catalogo.",
              );
            }
          }
          const nextMode =
            nextPublishedPlan && nextSaveState === "saved"
              ? "published"
              : "review";
          setReviewPlan(nextReviewPlan);
          setPublishedPlan(nextPublishedPlan);
          setPlanMode(nextMode);
          setPlan(
            nextMode === "published" ? nextPublishedPlan : nextReviewPlan,
          );
          setSaveState(nextSaveState);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          console.error(error);
          toast.error("Error cargando el plan nutricional.");
          setPlan(null);
          setSaveState("error");
        }
      })
      .finally(() => {
        if (!cancelled) setPlanLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPlanId]);

  useEffect(() => {
    if (saveState !== "dirty") return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState]);

  const updatePlanDraft = useCallback(
    (updater: (current: NutritionPlanFull) => NutritionPlanFull) => {
      if (planMode === "published") return;
      setPlan((current) => {
        if (!current) return current;
        const next = normalizePlanGrams({
          ...updater({ ...current, status: "review" }),
          status: "review",
        });
        setReviewPlan(next);
        return next;
      });
      setSaveState("dirty");
    },
    [planMode],
  );

  const getIntegerInputValue = useCallback(
    (key: string, value: number, min = 0, max = 10000) => {
      if (Object.prototype.hasOwnProperty.call(integerInputDrafts, key)) {
        return integerInputDrafts[key] ?? "";
      }
      return formatIntegerValue(value, min, max);
    },
    [integerInputDrafts],
  );

  const clearIntegerInputDraft = useCallback((key: string) => {
    setIntegerInputDrafts((current) => {
      if (!Object.prototype.hasOwnProperty.call(current, key)) return current;
      const next = { ...current };
      delete next[key];
      return next;
    });
  }, []);

  const handleIntegerInputChange = useCallback(
    (
      key: string,
      rawValue: string,
      min: number,
      max: number,
      onValidValue: (value: number) => void,
    ) => {
      const sanitized = sanitizeIntegerInput(rawValue);
      setIntegerInputDrafts((current) => ({ ...current, [key]: sanitized }));
      const parsed = parseIntegerInput(sanitized);
      if (parsed === null || parsed < min) return;
      onValidValue(clampInteger(parsed, min, max));
    },
    [],
  );

  const saveCurrentPlan = useCallback(
    async (planToSave?: NutritionPlanFull | null) => {
      const basePlan =
        planMode === "published" ? reviewPlan : (planToSave ?? plan);
      const target = basePlan
        ? normalizePlanGrams({ ...basePlan, status: "review" })
        : null;
      if (!target) return null;

      setSaveState("saving");
      try {
        const res = await fetch(
          `/api/admin/nutrition-management/plans/${target.id}`,
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(target),
          },
        );
        const json = (await res.json()) as {
          plan?: NutritionPlanFull;
          error?: string;
        };
        if (!res.ok || !json.plan) {
          throw new Error(json.error ?? "No se pudo guardar.");
        }

        const normalized = normalizePlanGrams({
          ...json.plan,
          status: "review",
        });
        setPlan(normalized);
        setReviewPlan(normalized);
        setPlanMode("review");
        setIntegerInputDrafts({});
        upsertPlanSummary(json.plan);
        setSaveState("saved");
        return normalizePlanGrams(json.plan);
      } catch (error) {
        console.error(error);
        toast.error("No se pudo guardar el borrador.");
        setSaveState("error");
        return null;
      }
    },
    [plan, planMode, reviewPlan, upsertPlanSummary],
  );

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  async function handleLogout() {
    const res = await fetch("/api/logout", { method: "POST" });
    if (!res.ok) {
      toast.error("No se pudo cerrar la sesion.");
      return;
    }
    window.location.href = "/login";
  }

  async function handleCreatePlan() {
    if (!selectedAthleteInfo) {
      toast.error("Selecciona un atleta.");
      return;
    }
    if (!planNameDraft.trim()) {
      toast.error("El nombre del plan es obligatorio.");
      return;
    }

    setCreatingPlan(true);
    try {
      const res = await fetch("/api/admin/nutrition-management/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          athleteUsername: selectedAthleteInfo.username,
          name: planNameDraft,
        }),
      });
      const json = (await res.json()) as {
        plan?: NutritionPlanFull;
        error?: string;
      };
      if (!res.ok || !json.plan)
        throw new Error(json.error ?? "No se pudo crear el plan.");

      setPlanNameDraft("Dia de entrenamiento");
      upsertPlanSummary(json.plan);
      setSelectedPlanId(json.plan.id);
      const normalized = normalizePlanGrams({ ...json.plan, status: "review" });
      setPlan(normalized);
      setReviewPlan(normalized);
      setPublishedPlan(null);
      setPlanMode("review");
      setIntegerInputDrafts({});
      setSaveState("saved");
      toast.success("Plan creado.");
    } catch (error) {
      console.error(error);
      toast.error("Error creando plan.");
    } finally {
      setCreatingPlan(false);
    }
  }

  async function handleDuplicatePlan(planId: string) {
    try {
      const res = await fetch(
        `/api/admin/nutrition-management/plans/${planId}/duplicate`,
        {
          method: "POST",
        },
      );
      const json = (await res.json()) as {
        plan?: NutritionPlanFull;
        error?: string;
      };
      if (!res.ok || !json.plan)
        throw new Error(json.error ?? "No se pudo duplicar.");
      upsertPlanSummary(json.plan);
      setSelectedPlanId(json.plan.id);
      const normalized = normalizePlanGrams({ ...json.plan, status: "review" });
      setPlan(normalized);
      setReviewPlan(normalized);
      setPublishedPlan(null);
      setPlanMode("review");
      setIntegerInputDrafts({});
      setSaveState("saved");
      toast.success("Plan duplicado.");
    } catch (error) {
      console.error(error);
      toast.error("Error duplicando plan.");
    }
  }

  async function handleDeletePlan(planId: string) {
    const confirmed = window.confirm(
      "Seguro que quieres eliminar este plan y sus PDFs publicados?",
    );
    if (!confirmed) return;

    try {
      const res = await fetch(
        `/api/admin/nutrition-management/plans/${planId}`,
        {
          method: "DELETE",
        },
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(json.error ?? "No se pudo eliminar.");

      setPlans((current) => current.filter((item) => item.id !== planId));
      if (selectedPlanId === planId) {
        const nextPlan = plansForAthlete.find((item) => item.id !== planId);
        setSelectedPlanId(nextPlan?.id ?? "");
        setPlan(null);
        setReviewPlan(null);
        setPublishedPlan(null);
        setPlanMode("review");
      }
      toast.success("Plan eliminado.");
    } catch (error) {
      console.error(error);
      toast.error("Error eliminando plan.");
    }
  }

  function handleAthleteChange(username: string) {
    setSelectedAthlete(username);
    const firstPlan = plans.find((item) => item.athleteUsername === username);
    setSelectedPlanId(firstPlan?.id ?? "");
    setPlan(null);
    setReviewPlan(null);
    setPublishedPlan(null);
    setPlanMode("review");
    setIntegerInputDrafts({});
    setSaveState("idle");
  }

  function openChangeRequestGroup(input: {
    username: string;
    firstPlanId: string;
  }) {
    setSelectedAthlete(input.username);
    setSelectedPlanId(
      input.firstPlanId ||
        plans.find((item) => item.athleteUsername === input.username)?.id ||
        "",
    );
    setPlan(null);
    setReviewPlan(null);
    setPublishedPlan(null);
    setPlanMode("review");
    setIntegerInputDrafts({});
    setSaveState("idle");
  }

  function toggleFoodRestrictionTag(tag: NutritionFoodRestrictionTag) {
    setFoodForm((current) => {
      const hasTag = current.restrictionTags.includes(tag);
      return {
        ...current,
        restrictionTags: hasTag
          ? current.restrictionTags.filter((item) => item !== tag)
          : [...current.restrictionTags, tag].sort(),
      };
    });
  }

  async function addAthleteRestriction() {
    if (!selectedAthlete) {
      toast.error("Selecciona un atleta.");
      return;
    }
    const selectedRestrictionFoodId =
      restrictionForm.foodId || foods[0]?.id || "";
    if (restrictionForm.type === "dislike" && !selectedRestrictionFoodId) {
      toast.error("Selecciona un alimento.");
      return;
    }

    setRestrictionSubmitting(true);
    try {
      const payload = {
        athleteUsername: selectedAthlete,
        type: restrictionForm.type,
        key:
          restrictionForm.type === "dislike"
            ? "food_dislike"
            : restrictionForm.key,
        foodId:
          restrictionForm.type === "dislike" ? selectedRestrictionFoodId : "",
        notes: restrictionForm.notes,
      };
      const res = await fetch("/api/admin/nutrition-management/restrictions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = (await res.json()) as {
        restriction?: NutritionAthleteRestriction;
        error?: string;
      };
      if (!res.ok || !json.restriction)
        throw new Error(json.error ?? "No se pudo registrar.");

      setAthleteRestrictions((current) => [json.restriction!, ...current]);
      setRestrictionForm((current) => ({ ...current, notes: "" }));
      toast.success("Restriccion registrada.");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error registrando restriccion.",
      );
    } finally {
      setRestrictionSubmitting(false);
    }
  }

  async function deleteAthleteRestriction(restrictionId: string) {
    try {
      const res = await fetch("/api/admin/nutrition-management/restrictions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: restrictionId }),
      });
      const json = (await res.json()) as {
        restriction?: NutritionAthleteRestriction;
        error?: string;
      };
      if (!res.ok || !json.restriction)
        throw new Error(json.error ?? "No se pudo eliminar.");
      setAthleteRestrictions((current) =>
        current.filter((item) => item.id !== restrictionId),
      );
      toast.success("Restriccion eliminada.");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error
          ? error.message
          : "Error eliminando restriccion.",
      );
    }
  }

  function updatePlanField<K extends keyof NutritionPlanFull>(
    key: K,
    value: NutritionPlanFull[K],
  ) {
    updatePlanDraft((current) => ({
      ...current,
      [key]: value,
    }));
  }

  function handlePlanModeChange(nextMode: NutritionPlanStatus) {
    if (nextMode === "published") {
      if (!publishedPlan) {
        toast.error("Este plan todavia no tiene una version publicada.");
        return;
      }
      setPlanMode("published");
      setPlan(publishedPlan);
      setIntegerInputDrafts({});
      setSaveState((current) => (current === "dirty" ? current : "saved"));
      return;
    }

    const sourcePlan = reviewPlan ?? plan ?? publishedPlan;
    if (!sourcePlan) return;
    const editablePlan = normalizePlanGrams({
      ...sourcePlan,
      status: "review",
    });
    setReviewPlan(editablePlan);
    setPlan(editablePlan);
    setPlanMode("review");
    setIntegerInputDrafts({});
    setSaveState((current) => (current === "dirty" ? current : "saved"));
  }

  function updateTarget(
    key: "targetProteinG" | "targetCarbsG" | "targetFatG",
    value: number,
  ) {
    updatePlanDraft((current) => ({
      ...current,
      [key]: clampInteger(
        value,
        0,
        key === "targetCarbsG" ? 3000 : key === "targetProteinG" ? 2000 : 1000,
      ),
    }));
  }

  function addMeal() {
    updatePlanDraft((current) => {
      const now = new Date().toISOString();
      const nextMeal: NutritionPlanMeal & {
        entries: NutritionPlanFoodEntry[];
      } = {
        id: createClientId(),
        planId: current.id,
        name: `Comida ${current.meals.length + 1}`,
        position: current.meals.length + 1,
        notes: "",
        included: true,
        createdAt: now,
        updatedAt: now,
        entries: [],
      };
      return { ...current, meals: [...current.meals, nextMeal] };
    });
  }

  function updateMeal(
    mealId: string,
    updater: (
      meal: NutritionPlanFull["meals"][number],
    ) => NutritionPlanFull["meals"][number],
  ) {
    updatePlanDraft((current) => ({
      ...current,
      meals: current.meals.map((meal) =>
        meal.id === mealId ? updater(meal) : meal,
      ),
    }));
  }

  function removeMeal(mealId: string) {
    if (!plan || plan.meals.length <= 1) {
      toast.error("El plan debe tener al menos una comida.");
      return;
    }
    updatePlanDraft((current) => ({
      ...current,
      meals: current.meals
        .filter((meal) => meal.id !== mealId)
        .map((meal, index) => ({ ...meal, position: index + 1 })),
    }));
  }

  function duplicateMeal(mealId: string) {
    updatePlanDraft((current) => {
      const source = current.meals.find((meal) => meal.id === mealId);
      if (!source) return current;
      const now = new Date().toISOString();
      const nextMealId = createClientId();
      const nextMeal = {
        ...source,
        id: nextMealId,
        name: `${source.name} copia`.slice(0, 120),
        position: current.meals.length + 1,
        createdAt: now,
        updatedAt: now,
        entries: source.entries.map((entry) => {
          const nextEntryId = createClientId();
          return {
            ...entry,
            id: nextEntryId,
            mealId: nextMealId,
            alternatives: (entry.alternatives ?? []).map(
              (alternative, alternativeIndex) => ({
                ...alternative,
                id: createClientId(),
                entryId: nextEntryId,
                position: alternativeIndex + 1,
                createdAt: now,
                updatedAt: now,
              }),
            ),
            createdAt: now,
            updatedAt: now,
          };
        }),
      };
      return { ...current, meals: [...current.meals, nextMeal] };
    });
  }

  async function cloneMenusFromPlan(mode: "replace" | "append") {
    if (!plan || !selectedClonePlanId) {
      toast.error("Selecciona un plan origen.");
      return;
    }

    if (mode === "replace") {
      const confirmed = window.confirm(
        "Reemplazar los menus actuales por los del plan seleccionado?",
      );
      if (!confirmed) return;
    }

    setCloningMenus(true);
    try {
      const res = await fetch(
        `/api/admin/nutrition-management/plans/${selectedClonePlanId}`,
        {
          cache: "no-store",
        },
      );
      const json = (await res.json()) as {
        plan?: NutritionPlanFull;
        error?: string;
      };
      if (!res.ok || !json.plan)
        throw new Error(json.error ?? "No se pudo cargar el plan origen.");

      const sourceMeals = [...normalizePlanGrams(json.plan).meals].sort(
        (a, b) => a.position - b.position,
      );
      if (!sourceMeals.length) {
        toast.error("El plan origen no tiene menus.");
        return;
      }

      updatePlanDraft((current) => {
        const now = new Date().toISOString();
        const basePosition = mode === "append" ? current.meals.length : 0;
        const clonedMeals = sourceMeals.map((meal, mealIndex) => {
          const nextMealId = createClientId();
          return {
            ...meal,
            id: nextMealId,
            planId: current.id,
            position: basePosition + mealIndex + 1,
            createdAt: now,
            updatedAt: now,
            entries: meal.entries.map((entry) => {
              const nextEntryId = createClientId();
              return {
                ...entry,
                id: nextEntryId,
                planId: current.id,
                mealId: nextMealId,
                alternatives: (entry.alternatives ?? []).map(
                  (alternative, alternativeIndex) => ({
                    ...alternative,
                    id: createClientId(),
                    entryId: nextEntryId,
                    position: alternativeIndex + 1,
                    createdAt: now,
                    updatedAt: now,
                  }),
                ),
                createdAt: now,
                updatedAt: now,
              };
            }),
          };
        });
        const meals =
          mode === "replace" ? clonedMeals : [...current.meals, ...clonedMeals];
        return {
          ...current,
          meals: meals.map((meal, index) => ({ ...meal, position: index + 1 })),
        };
      });
      toast.success(
        mode === "replace" ? "Menus reemplazados." : "Menus clonados.",
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error clonando menus.",
      );
    } finally {
      setCloningMenus(false);
    }
  }

  function moveMeal(mealId: string, direction: -1 | 1) {
    updatePlanDraft((current) => {
      const index = current.meals.findIndex((meal) => meal.id === mealId);
      const targetIndex = index + direction;
      if (index < 0 || targetIndex < 0 || targetIndex >= current.meals.length)
        return current;
      const meals = [...current.meals];
      const currentMeal = meals[index];
      const targetMeal = meals[targetIndex];
      if (!currentMeal || !targetMeal) return current;
      meals[index] = targetMeal;
      meals[targetIndex] = currentMeal;
      return {
        ...current,
        meals: meals.map((meal, mealIndex) => ({
          ...meal,
          position: mealIndex + 1,
        })),
      };
    });
  }

  function addFoodToMeal(
    mealId: string,
    food: NutritionFood,
    optionNumber: number,
  ) {
    if (!plan) return;
    const optionKey = buildMealOptionKey(mealId, optionNumber);
    const quantity = clampInteger(
      parseIntegerInput(foodQuantities[optionKey] || "100") ?? 100,
      1,
      10000,
    );
    updateMeal(mealId, (meal) => ({
      ...meal,
      entries: [
        ...meal.entries,
        buildEntryFromFood(
          plan.id,
          mealId,
          food,
          quantity,
          meal.entries.filter(
            (entry) => getMealOptionNumber(entry) === optionNumber,
          ).length + 1,
          optionNumber,
        ),
      ],
    }));
    setFoodSearches((current) => ({ ...current, [optionKey]: "" }));
    setFoodQuantities((current) => ({ ...current, [optionKey]: "100" }));
  }

  function addMealOption(mealId: string) {
    const sourceMeal = plan?.meals.find((meal) => meal.id === mealId);
    const hasReferenceEntries = Boolean(
      sourceMeal?.entries.some((entry) => getMealOptionNumber(entry) === 1),
    );
    if (!hasReferenceEntries) {
      toast.error("Anade alimentos a la opcion 1 antes de crear otra opcion.");
      return;
    }

    updateMeal(mealId, (meal) => {
      const optionNumbers = getMealOptionGroups(meal).map(
        (group) => group.optionNumber,
      );
      const nextOption = Math.min(20, Math.max(...optionNumbers, 1) + 1);
      if (optionNumbers.includes(nextOption)) return meal;

      const now = new Date().toISOString();
      const referenceEntries = meal.entries
        .filter((entry) => getMealOptionNumber(entry) === 1)
        .sort((a, b) => a.position - b.position);
      const clonedEntries = referenceEntries.map((entry, index) => {
        const nextEntryId = createClientId();
        return {
          ...entry,
          id: nextEntryId,
          mealOption: nextOption,
          position: index + 1,
          alternatives: (entry.alternatives ?? []).map(
            (alternative, alternativeIndex) => ({
              ...alternative,
              id: createClientId(),
              entryId: nextEntryId,
              position: alternativeIndex + 1,
              createdAt: now,
              updatedAt: now,
            }),
          ),
          createdAt: now,
          updatedAt: now,
        };
      });

      return { ...meal, entries: [...meal.entries, ...clonedEntries] };
    });
  }

  function removeMealOption(mealId: string, optionNumber: number) {
    if (optionNumber === 1) {
      toast.error("La opcion 1 es la referencia y no se puede eliminar.");
      return;
    }

    updateMeal(mealId, (meal) => ({
      ...meal,
      entries: meal.entries.filter(
        (entry) => getMealOptionNumber(entry) !== optionNumber,
      ),
    }));
  }

  function updateEntry(
    mealId: string,
    entryId: string,
    updater: (entry: NutritionPlanFoodEntry) => NutritionPlanFoodEntry,
  ) {
    updateMeal(mealId, (meal) => ({
      ...meal,
      entries: meal.entries.map((entry) =>
        entry.id === entryId ? updater(entry) : entry,
      ),
    }));
  }

  function removeEntry(mealId: string, entryId: string) {
    updateMeal(mealId, (meal) => ({
      ...meal,
      entries: meal.entries
        .filter((entry) => entry.id !== entryId)
        .map((entry) => {
          const optionEntries = meal.entries.filter(
            (item) =>
              item.id !== entryId &&
              getMealOptionNumber(item) === getMealOptionNumber(entry),
          );
          const nextPosition =
            optionEntries.findIndex((item) => item.id === entry.id) + 1;
          return { ...entry, position: Math.max(1, nextPosition) };
        }),
    }));
    setAlternativeSearches((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
  }

  function openAlternativeSearch(entryId: string) {
    setAlternativeSearches((current) => ({
      ...current,
      [entryId]: current[entryId] ?? "",
    }));
  }

  function closeAlternativeSearch(entryId: string) {
    setAlternativeSearches((current) => {
      const next = { ...current };
      delete next[entryId];
      return next;
    });
  }

  function addAlternativeToEntry(
    mealId: string,
    entryId: string,
    food: NutritionFood,
  ) {
    updateEntry(mealId, entryId, (entry) => ({
      ...entry,
      alternatives: [
        ...(entry.alternatives ?? []),
        buildAlternativeFromFood(
          entry,
          food,
          (entry.alternatives ?? []).length + 1,
        ),
      ],
    }));
    setAlternativeSearches((current) => ({ ...current, [entryId]: "" }));
  }

  function updateAlternative(
    mealId: string,
    entryId: string,
    alternativeId: string,
    updater: (
      alternative: NutritionPlanFoodAlternative,
    ) => NutritionPlanFoodAlternative,
  ) {
    updateEntry(mealId, entryId, (entry) => ({
      ...entry,
      alternatives: (entry.alternatives ?? []).map((alternative) =>
        alternative.id === alternativeId ? updater(alternative) : alternative,
      ),
    }));
  }

  function removeAlternative(
    mealId: string,
    entryId: string,
    alternativeId: string,
  ) {
    updateEntry(mealId, entryId, (entry) => ({
      ...entry,
      alternatives: (entry.alternatives ?? [])
        .filter((alternative) => alternative.id !== alternativeId)
        .map((alternative, index) => ({ ...alternative, position: index + 1 })),
    }));
  }

  async function submitFoodForm(options?: {
    mealId?: string | null;
    optionNumber?: number;
  }) {
    const payload = buildFoodPayload(foodForm);
    if (!payload.name) {
      toast.error("El nombre del alimento es obligatorio.");
      return null;
    }

    setFoodSubmitting(true);
    try {
      const res = await fetch("/api/admin/nutrition-management/foods", {
        method: editingFoodId ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          editingFoodId ? { id: editingFoodId, ...payload } : payload,
        ),
      });
      const json = (await res.json()) as {
        food?: NutritionFood;
        error?: string;
      };
      if (!res.ok || !json.food)
        throw new Error(json.error ?? "No se pudo guardar alimento.");

      setFoods((current) => {
        const exists = current.some((food) => food.id === json.food?.id);
        return (
          exists
            ? current.map((food) =>
                food.id === json.food?.id ? json.food : food,
              )
            : [...current, json.food]
        )
          .filter((item): item is NutritionFood => Boolean(item))
          .sort((a, b) => a.name.localeCompare(b.name, "es"));
      });

      setFoodForm(EMPTY_FOOD_FORM);
      setEditingFoodId(null);
      toast.success(
        editingFoodId ? "Alimento actualizado." : "Alimento creado.",
      );

      if (options?.mealId && json.food) {
        addFoodToMeal(options.mealId, json.food, options.optionNumber ?? 1);
        setQuickFoodMealId(null);
        setQuickFoodOptionNumber(1);
      }

      return json.food;
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error guardando alimento.",
      );
      return null;
    } finally {
      setFoodSubmitting(false);
    }
  }

  async function deactivateFood(foodId: string) {
    const confirmed = window.confirm("Desactivar este alimento?");
    if (!confirmed) return;

    try {
      const res = await fetch("/api/admin/nutrition-management/foods", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: foodId }),
      });
      const json = (await res.json()) as {
        food?: NutritionFood;
        error?: string;
      };
      if (!res.ok || !json.food)
        throw new Error(json.error ?? "No se pudo desactivar.");
      setFoods((current) =>
        current.map((food) => (food.id === foodId ? json.food! : food)),
      );
      toast.success("Alimento desactivado.");
    } catch (error) {
      console.error(error);
      toast.error("Error desactivando alimento.");
    }
  }

  async function generatePreview() {
    if (!plan) return;
    setPreviewLoading(true);
    try {
      const saved =
        planMode === "published" ? plan : await saveCurrentPlan(plan);
      if (!saved) return;
      const res = await fetch(
        `/api/admin/nutrition-management/plans/${saved.id}/pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            includeMacros: pdfIncludeMacros,
            mode: planMode,
          }),
        },
      );
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(json.error ?? "No se pudo generar PDF.");
      }

      const blob = await res.blob();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      const url = URL.createObjectURL(blob);
      setPreviewUrl(url);
      setPreviewOpen(true);
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error generando PDF.",
      );
    } finally {
      setPreviewLoading(false);
    }
  }

  async function publishPlan() {
    if (!plan) return;
    if (planMode === "published") {
      toast.error("El plan publicado es solo de lectura.");
      return;
    }
    setPublishing(true);
    try {
      const saved = await saveCurrentPlan(plan);
      if (!saved) return;
      const res = await fetch(
        `/api/admin/nutrition-management/plans/${saved.id}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ includeMacros: pdfIncludeMacros }),
        },
      );
      const json = (await res.json()) as {
        plan?: NutritionPlanFull;
        file?: { id: string; name: string };
        error?: string;
      };
      if (!res.ok || !json.plan)
        throw new Error(json.error ?? "No se pudo publicar.");

      const nextPublishedPlan = normalizePlanGrams({
        ...json.plan,
        status: "published",
      });
      const nextReviewPlan = normalizePlanGrams({
        ...json.plan,
        status: "review",
      });
      setPlan(nextPublishedPlan);
      setPublishedPlan(nextPublishedPlan);
      setReviewPlan(nextReviewPlan);
      setPlanMode("published");
      setIntegerInputDrafts({});
      upsertPlanSummary(json.plan);
      setSaveState("saved");
      toast.success("Plan publicado.");
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error publicando plan.",
      );
    } finally {
      setPublishing(false);
    }
  }

  async function applyChangeRequest(request: NutritionChangeRequest) {
    pendingRequestToApplyRef.current = request.id;
    setSelectedAthlete(request.athleteUsername);

    const currentEditablePlan =
      reviewPlan?.id === request.planId
        ? reviewPlan
        : plan?.id === request.planId
          ? plan
          : null;
    if (currentEditablePlan) {
      if (!isFoodSwapRequest(request)) {
        const nextPlan = normalizePlanGrams({
          ...currentEditablePlan,
          status: "review",
        });
        setReviewPlan(nextPlan);
        setPlan(nextPlan);
        setPlanMode("review");
        setSaveState("dirty");
        pendingRequestToApplyRef.current = null;
        toast.success(
          "Solicitud abierta. Ajusta el plan en revision y publica cuando este listo.",
        );
        return;
      }

      const requestedFood = foods.find(
        (food) => food.id === request.requestedFoodId,
      );
      if (!requestedFood) {
        pendingRequestToApplyRef.current = null;
        toast.error("El alimento solicitado ya no existe en el catalogo.");
        return;
      }

      const nextPlan = applyChangeRequestToPlanDraft(
        currentEditablePlan,
        request,
        requestedFood,
      );
      setReviewPlan(nextPlan);
      setPlan(nextPlan);
      setPlanMode("review");
      setSaveState("dirty");
      pendingRequestToApplyRef.current = null;
      toast.success(
        "Solicitud aplicada al editor. Ajusta el plan y aprueba/publica.",
      );
      return;
    }

    setSelectedPlanId(request.planId);
  }

  async function resolveChangeRequest(
    request: NutritionChangeRequest,
    status: "approved" | "denied",
  ) {
    if (status === "approved" && (!plan || plan.id !== request.planId)) {
      toast.error("Abre y aplica primero la solicitud en el editor.");
      return;
    }

    const shouldReloadDeniedPlan =
      status === "denied" &&
      (plan?.id === request.planId || selectedPlanId === request.planId);
    if (pendingRequestToApplyRef.current === request.id) {
      pendingRequestToApplyRef.current = null;
    }

    setResolvingRequestId(request.id);
    try {
      const res = await fetch(
        `/api/admin/nutrition-change-requests/${request.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            adminNotes: requestAdminNotes[request.id] ?? "",
            plan: status === "approved" ? plan : undefined,
          }),
        },
      );
      const json = (await res.json()) as {
        request?: NutritionChangeRequest;
        plan?: NutritionPlanFull;
        error?: string;
      };
      if (!res.ok || !json.request) {
        throw new Error(json.error ?? "No se pudo resolver la solicitud.");
      }

      setChangeRequests((current) =>
        current.map((item) =>
          item.id === json.request?.id ? json.request : item,
        ),
      );
      if (json.plan) {
        const nextPublishedPlan = normalizePlanGrams({
          ...json.plan,
          status: "published",
        });
        const nextReviewPlan = normalizePlanGrams({
          ...json.plan,
          status: "review",
        });
        setPlan(nextPublishedPlan);
        setPublishedPlan(nextPublishedPlan);
        setReviewPlan(nextReviewPlan);
        setPlanMode("published");
        upsertPlanSummary(json.plan);
        setIntegerInputDrafts({});
        setSaveState("saved");
      } else if (shouldReloadDeniedPlan) {
        const planRes = await fetch(
          `/api/admin/nutrition-management/plans/${request.planId}`,
          {
            cache: "no-store",
          },
        );
        const planJson = (await planRes.json()) as PlanResponse;
        if (!planRes.ok || !planJson.plan) {
          throw new Error(
            planJson.error ?? "No se pudo recuperar el ultimo planning.",
          );
        }
        const nextReviewPlan = normalizePlanGrams({
          ...planJson.plan,
          status: "review",
        });
        const nextPublishedPlan = planJson.publishedPlan
          ? normalizePlanGrams({
              ...planJson.publishedPlan,
              status: "published",
            })
          : planJson.plan.status === "published"
            ? normalizePlanGrams({ ...planJson.plan, status: "published" })
            : null;
        setReviewPlan(nextReviewPlan);
        setPublishedPlan(nextPublishedPlan);
        setPlanMode(nextPublishedPlan ? "published" : "review");
        setPlan(nextPublishedPlan ?? nextReviewPlan);
        upsertPlanSummary(planJson.plan);
        setIntegerInputDrafts({});
        setSaveState("saved");
      }
      setRequestAdminNotes((current) => {
        const next = { ...current };
        delete next[request.id];
        return next;
      });
      toast.success(
        status === "approved"
          ? "Solicitud aprobada y PDF publicado."
          : "Solicitud denegada.",
      );
    } catch (error) {
      console.error(error);
      toast.error(
        error instanceof Error ? error.message : "Error resolviendo solicitud.",
      );
    } finally {
      setResolvingRequestId(null);
    }
  }

  function startQuickFood(mealId: string, optionNumber = 1) {
    const optionKey = buildMealOptionKey(mealId, optionNumber);
    const search = foodSearches[optionKey] ?? "";
    setQuickFoodMealId(mealId);
    setQuickFoodOptionNumber(optionNumber);
    setEditingFoodId(null);
    setFoodForm({ ...EMPTY_FOOD_FORM, name: search });
  }

  const saveLabel =
    saveState === "saving"
      ? "Guardando..."
      : saveState === "dirty"
        ? "Cambios pendientes"
        : saveState === "saved"
          ? "Guardado"
          : saveState === "error"
            ? "Error de guardado"
            : "Sin cambios";
  const currentRestrictionOptions = getRestrictionOptions(restrictionForm.type);
  const selectedRestrictionFoodId =
    restrictionForm.foodId || foods[0]?.id || "";

  return (
    <MotionPage>
      <div className="mx-auto w-full max-w-7xl space-y-4 px-3 py-5 sm:px-4 sm:py-6 md:px-8">
        <header className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 backdrop-blur sm:p-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <BrandLogo />
            <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
              <Link href="/dashboard" className="w-full sm:w-auto">
                <BrandButton
                  variant="ghost"
                  className="w-full justify-center px-4 py-2 sm:w-auto"
                >
                  Dashboard
                </BrandButton>
              </Link>
              <Link href="/tools" className="w-full sm:w-auto">
                <BrandButton
                  variant="ghost"
                  className="w-full justify-center px-4 py-2 sm:w-auto"
                >
                  Herramientas admin
                </BrandButton>
              </Link>
              <BrandButton className="w-full justify-center px-4 py-2 sm:w-auto">
                Gestion nutricional
              </BrandButton>
              <div className="px-2 text-left sm:text-right">
                <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">
                  Administrador
                </p>
                <p className="text-sm font-semibold text-brand-text">
                  {user.name}
                </p>
              </div>
              <BrandButton
                variant="ghost"
                className="w-full justify-center px-4 py-2 sm:w-auto"
                onClick={handleLogout}
              >
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </BrandButton>
            </div>
          </div>
        </header>

        <section className="rounded-2xl border border-brand-accent/25 bg-brand-surface p-4 shadow-glow sm:rounded-3xl sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs uppercase tracking-[0.18em] text-brand-muted sm:tracking-[0.24em]">
                Herramientas
              </p>
              <h1 className="mt-2 break-words text-2xl font-bold text-brand-text sm:text-3xl">
                Gestion nutricional
              </h1>
            </div>
            <div className="grid w-full grid-cols-2 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:items-center">
              <button
                type="button"
                onClick={() => setActivePanel("plans")}
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition sm:px-4 ${
                  activePanel === "plans"
                    ? "border-brand-accent/50 bg-brand-accent/10 text-brand-text"
                    : "border-white/20 text-brand-muted hover:bg-white/10"
                }`}
              >
                <FileText className="h-4 w-4" />
                Planes
                {pendingChangeRequests.length ? (
                  <span className="ml-1 rounded-full bg-brand-accent px-2 py-0.5 text-[11px] font-semibold text-black">
                    {pendingChangeRequests.length}
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={() => setActivePanel("foods")}
                className={`inline-flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm transition sm:px-4 ${
                  activePanel === "foods"
                    ? "border-brand-accent/50 bg-brand-accent/10 text-brand-text"
                    : "border-white/20 text-brand-muted hover:bg-white/10"
                }`}
              >
                <Utensils className="h-4 w-4" />
                Catalogo
              </button>
              <span className="col-span-2 inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-black/25 px-3 py-2 text-xs text-brand-muted sm:col-span-1">
                <Shield className="h-4 w-4 text-brand-accent" />
                {saveLabel}
              </span>
            </div>
          </div>
        </section>

        {loading ? (
          <section className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
            <Skeleton className="h-[620px] w-full rounded-2xl" />
            <Skeleton className="h-[620px] w-full rounded-2xl" />
          </section>
        ) : activePanel === "foods" ? (
          <section className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,0.9fr)]">
            <div className="min-w-0 rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
              <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <h2 className="text-lg font-semibold text-brand-text">
                  Catalogo de alimentos
                </h2>
                <label className="relative w-full max-w-sm">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                  <input
                    value={foodFilter}
                    onChange={(event) => setFoodFilter(event.target.value)}
                    placeholder="Buscar alimento"
                    className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
              </div>

              <div className="mt-4 space-y-3 md:hidden">
                {filteredFoods.length ? (
                  filteredFoods.map((food) => (
                    <article
                      key={food.id}
                      className="rounded-xl border border-white/10 bg-black/20 p-3"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="break-words text-sm font-semibold text-brand-text">
                            {food.name}
                          </p>
                          <p className="mt-1 break-words text-xs text-brand-muted">
                            {food.category || "-"}
                          </p>
                        </div>
                        <span
                          className={`inline-flex shrink-0 items-center justify-center rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
                            food.active
                              ? "border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
                              : "border-white/15 bg-white/5 text-brand-muted"
                          }`}
                        >
                          {food.active ? "Activo" : "Inactivo"}
                        </span>
                      </div>

                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                          Kcal{" "}
                          <strong className="text-brand-text">
                            {formatNumber(
                              calculateFoodCaloriesPer100g(food),
                              0,
                            )}
                          </strong>
                        </span>
                        <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                          P{" "}
                          <strong className="text-brand-text">
                            {formatNumber(food.proteinPer100g)}
                          </strong>
                        </span>
                        <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                          C{" "}
                          <strong className="text-brand-text">
                            {formatNumber(food.carbsPer100g)}
                          </strong>
                        </span>
                        <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                          G{" "}
                          <strong className="text-brand-text">
                            {formatNumber(food.fatPer100g)}
                          </strong>
                        </span>
                        <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                          Sodio{" "}
                          <strong className="text-brand-text">
                            {formatNumber(food.sodiumPer100g, 0)}
                          </strong>
                        </span>
                        <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                          Agua{" "}
                          <strong className="text-brand-text">
                            {formatNumber(food.waterPer100g)}
                          </strong>
                        </span>
                      </div>

                      <p className="mt-3 break-words text-xs text-brand-muted">
                        Etiquetas: {formatFoodTagSummary(food.restrictionTags)}
                      </p>
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setEditingFoodId(food.id);
                            setFoodForm(foodToForm(food));
                          }}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-brand-accent/40 text-brand-text transition hover:bg-brand-accent/10"
                          aria-label={`Editar ${food.name}`}
                          title="Editar"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                        {food.active ? (
                          <button
                            type="button"
                            onClick={() => void deactivateFood(food.id)}
                            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20"
                            aria-label={`Desactivar ${food.name}`}
                            title="Desactivar"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        ) : null}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-center text-sm text-brand-muted">
                    No hay alimentos para este filtro.
                  </p>
                )}
              </div>

              <div className="mt-4 hidden overflow-hidden rounded-xl border border-white/10 md:block">
                <table className="w-full table-fixed text-xs xl:text-[13px]">
                  <colgroup>
                    <col style={{ width: "20%" }} />
                    <col style={{ width: "11%" }} />
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "5%" }} />
                    <col style={{ width: "7%" }} />
                    <col style={{ width: "6%" }} />
                    <col style={{ width: "18%" }} />
                    <col style={{ width: "7%" }} />
                    <col style={{ width: "10%" }} />
                  </colgroup>
                  <thead className="bg-black/30 text-[11px] uppercase tracking-[0.08em] text-brand-muted">
                    <tr>
                      <th className="px-2 py-2 text-left">Alimento</th>
                      <th className="px-2 py-2 text-left">Categoria</th>
                      <th className="px-2 py-2 text-right">Kcal</th>
                      <th className="px-2 py-2 text-right">P</th>
                      <th className="px-2 py-2 text-right">C</th>
                      <th className="px-2 py-2 text-right">G</th>
                      <th className="px-2 py-2 text-right">Sodio</th>
                      <th className="px-2 py-2 text-right">Agua</th>
                      <th className="px-2 py-2 text-left">Etiquetas</th>
                      <th className="px-2 py-2 text-center">Estado</th>
                      <th className="px-2 py-2 text-center">Accion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredFoods.length ? (
                      filteredFoods.map((food) => (
                        <tr key={food.id} className="border-t border-white/10">
                          <td
                            className="truncate px-2 py-2 font-medium text-brand-text"
                            title={food.name}
                          >
                            {food.name}
                          </td>
                          <td
                            className="truncate px-2 py-2 text-brand-muted"
                            title={food.category || "-"}
                          >
                            {food.category || "-"}
                          </td>
                          <td className="px-2 py-2 text-right text-brand-text">
                            {formatNumber(
                              calculateFoodCaloriesPer100g(food),
                              0,
                            )}
                          </td>
                          <td className="px-2 py-2 text-right text-brand-text">
                            {formatNumber(food.proteinPer100g)}
                          </td>
                          <td className="px-2 py-2 text-right text-brand-text">
                            {formatNumber(food.carbsPer100g)}
                          </td>
                          <td className="px-2 py-2 text-right text-brand-text">
                            {formatNumber(food.fatPer100g)}
                          </td>
                          <td className="px-2 py-2 text-right text-brand-muted">
                            {formatNumber(food.sodiumPer100g, 0)}
                          </td>
                          <td className="px-2 py-2 text-right text-brand-muted">
                            {formatNumber(food.waterPer100g)}
                          </td>
                          <td
                            className="truncate px-2 py-2 text-[11px] text-brand-muted"
                            title={formatFoodTagSummary(food.restrictionTags)}
                          >
                            {formatFoodTagSummary(food.restrictionTags)}
                          </td>
                          <td className="px-2 py-2">
                            <span
                              className={`mx-auto inline-flex min-h-7 w-full max-w-[64px] items-center justify-center rounded-full border px-1 text-center text-[10px] font-semibold ${
                                food.active
                                  ? "border-emerald-300/35 bg-emerald-500/10 text-emerald-100"
                                  : "border-white/15 bg-white/5 text-brand-muted"
                              }`}
                            >
                              {food.active ? "Activo" : "Inactivo"}
                            </span>
                          </td>
                          <td className="px-2 py-2">
                            <div className="flex items-center justify-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => {
                                  setEditingFoodId(food.id);
                                  setFoodForm(foodToForm(food));
                                }}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-brand-accent/40 text-brand-text transition hover:bg-brand-accent/10"
                                aria-label={`Editar ${food.name}`}
                                title="Editar"
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {food.active ? (
                                <button
                                  type="button"
                                  onClick={() => void deactivateFood(food.id)}
                                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20"
                                  aria-label={`Desactivar ${food.name}`}
                                  title="Desactivar"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td
                          colSpan={11}
                          className="px-3 py-8 text-center text-sm text-brand-muted"
                        >
                          No hay alimentos para este filtro.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="min-w-0 rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
              <h2 className="text-lg font-semibold text-brand-text">
                {editingFoodId ? "Editar alimento" : "Nuevo alimento"}
              </h2>
              <div className="mt-3 space-y-3">
                <label className="block text-sm text-brand-muted">
                  Nombre
                  <input
                    value={foodForm.name}
                    onChange={(event) =>
                      setFoodForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <label className="block text-sm text-brand-muted">
                  Categoria
                  <input
                    value={foodForm.category}
                    onChange={(event) =>
                      setFoodForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["proteinPer100g", "Proteinas g/100g"],
                    ["carbsPer100g", "Carbos g/100g"],
                    ["fatPer100g", "Grasas g/100g"],
                    ["sodiumPer100g", "Sodio mg/100g"],
                    ["waterPer100g", "Agua g/100g"],
                  ].map(([key, label]) => (
                    <label key={key} className="block text-sm text-brand-muted">
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={foodForm[key as NutritionInputFieldKey]}
                        onChange={(event) =>
                          setFoodForm((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                      />
                    </label>
                  ))}
                </div>
                <FoodRestrictionTagPicker
                  value={foodForm.restrictionTags}
                  onToggle={toggleFoodRestrictionTag}
                />
                <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                  <BrandButton
                    onClick={() => void submitFoodForm()}
                    disabled={foodSubmitting}
                    className="w-full sm:w-auto"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    {foodSubmitting ? "Guardando..." : "Guardar alimento"}
                  </BrandButton>
                  {editingFoodId ? (
                    <BrandButton
                      variant="ghost"
                      className="w-full sm:w-auto"
                      onClick={() => {
                        setEditingFoodId(null);
                        setFoodForm(EMPTY_FOOD_FORM);
                      }}
                    >
                      Cancelar
                    </BrandButton>
                  ) : null}
                </div>
              </div>
            </div>
          </section>
        ) : (
          <section className="grid gap-4 xl:grid-cols-[310px_minmax(0,1fr)]">
            <aside className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
                <label className="relative block">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                  <input
                    value={athleteFilter}
                    onChange={(event) => setAthleteFilter(event.target.value)}
                    placeholder="Buscar atleta"
                    className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <div className="mt-3 max-h-72 space-y-2 overflow-auto pr-1">
                  {filteredAthletes.map((athlete) => (
                    <button
                      key={athlete.username}
                      type="button"
                      onClick={() => handleAthleteChange(athlete.username)}
                      className={`w-full rounded-xl border p-3 text-left transition ${
                        selectedAthlete === athlete.username
                          ? "border-brand-accent/50 bg-brand-accent/10"
                          : "border-white/10 bg-black/20 hover:bg-white/10"
                      }`}
                    >
                      <p className="text-sm font-semibold text-brand-text">
                        {athlete.name}
                      </p>
                      <p className="mt-1 text-xs text-brand-muted">
                        @{athlete.username}
                      </p>
                    </button>
                  ))}
                  {!filteredAthletes.length ? (
                    <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                      No hay atletas.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-brand-accent/20 bg-brand-surface/70 p-3 sm:p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-brand-text">
                      Solicitudes de cambios
                    </h2>
                    <p className="mt-1 text-xs text-brand-muted">
                      Pendientes de este atleta:{" "}
                      {selectedAthleteChangeRequests.length}
                    </p>
                  </div>
                  {pendingChangeRequests.length ? (
                    <span className="rounded-full bg-brand-accent px-2 py-1 text-xs font-semibold text-black">
                      {pendingChangeRequests.length}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 space-y-3">
                  {pendingChangeRequestGroups.length ? (
                    <div className="rounded-xl border border-white/10 bg-black/20 p-3">
                      <p className="text-xs uppercase tracking-[0.16em] text-brand-muted">
                        Atletas con solicitudes
                      </p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {pendingChangeRequestGroups.map((group) => (
                          <button
                            key={group.username}
                            type="button"
                            onClick={() => openChangeRequestGroup(group)}
                            className={`rounded-lg border px-3 py-1.5 text-xs transition ${
                              selectedAthlete === group.username
                                ? "border-brand-accent/60 bg-brand-accent/15 text-brand-text"
                                : "border-white/15 bg-black/20 text-brand-muted hover:bg-white/10"
                            }`}
                          >
                            {group.name} ({group.count})
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {selectedAthleteChangeRequests.map((request) => {
                    const isActiveRequest = plan?.id === request.planId;
                    const resolving = resolvingRequestId === request.id;
                    const foodSwap = isFoodSwapRequest(request);
                    return (
                      <article
                        key={request.id}
                        className="rounded-xl border border-white/10 bg-black/20 p-3"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <span className="inline-flex rounded-lg border border-brand-accent/35 bg-brand-accent/10 px-2 py-1 text-[11px] font-semibold text-brand-text">
                              {getChangeRequestTypeLabel(request)}
                            </span>
                            <p className="mt-2 truncate text-sm font-semibold text-brand-text">
                              {getChangeRequestMainText(request)}
                            </p>
                            <p className="mt-1 text-xs text-brand-muted">
                              {getChangeRequestDetailText(request)}
                            </p>
                          </div>
                          <span className="rounded-lg border border-brand-accent/35 bg-brand-accent/10 px-2 py-1 text-[11px] text-brand-text">
                            Pendiente
                          </span>
                        </div>
                        {request.athleteNotes ? (
                          <p className="mt-2 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-xs text-brand-muted">
                            {request.athleteNotes}
                          </p>
                        ) : null}
                        <textarea
                          value={requestAdminNotes[request.id] ?? ""}
                          onChange={(event) =>
                            setRequestAdminNotes((current) => ({
                              ...current,
                              [request.id]: event.target.value,
                            }))
                          }
                          rows={2}
                          placeholder="Nota para el atleta"
                          className="mt-2 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-xs text-brand-text outline-none transition focus:border-brand-accent/60"
                        />
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            onClick={() => void applyChangeRequest(request)}
                            className="inline-flex items-center gap-1 rounded-lg border border-brand-accent/40 bg-brand-accent/10 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-brand-accent/20"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                            {foodSwap
                              ? isActiveRequest
                                ? "Aplicar"
                                : "Abrir y aplicar"
                              : "Abrir editor"}
                          </button>
                          {foodSwap ? (
                            <button
                              type="button"
                              onClick={() =>
                                void resolveChangeRequest(request, "approved")
                              }
                              disabled={resolving || !isActiveRequest}
                              className="inline-flex items-center gap-1 rounded-lg border border-emerald-400/35 bg-emerald-500/10 px-2.5 py-1.5 text-xs text-emerald-100 transition hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                              title={
                                isActiveRequest
                                  ? "Guardar, publicar PDF y aprobar"
                                  : "Primero abre esta solicitud"
                              }
                            >
                              <Check className="h-3.5 w-3.5" />
                              Aprobar y publicar
                            </button>
                          ) : null}
                          <button
                            type="button"
                            onClick={() =>
                              void resolveChangeRequest(request, "denied")
                            }
                            disabled={resolving}
                            className="inline-flex items-center gap-1 rounded-lg border border-red-400/35 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                          >
                            <X className="h-3.5 w-3.5" />
                            Denegar
                          </button>
                        </div>
                      </article>
                    );
                  })}
                  {!selectedAthleteChangeRequests.length ? (
                    <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                      Sin solicitudes pendientes para este atleta.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
                <h2 className="text-lg font-semibold text-brand-text">
                  Planes del atleta
                </h2>
                <div className="mt-3 space-y-2">
                  <input
                    value={planNameDraft}
                    onChange={(event) => setPlanNameDraft(event.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                  <BrandButton
                    onClick={handleCreatePlan}
                    disabled={creatingPlan || !selectedAthlete}
                    className="w-full"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {creatingPlan ? "Creando..." : "Crear plan"}
                  </BrandButton>
                </div>
                <div className="mt-4 space-y-2">
                  {plansForAthlete.map((item) => (
                    <article
                      key={item.id}
                      className={`rounded-xl border p-3 ${
                        selectedPlanId === item.id
                          ? "border-brand-accent/50 bg-brand-accent/10"
                          : "border-white/10 bg-black/20"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedPlanId(item.id)}
                        className="w-full text-left"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm font-semibold text-brand-text">
                            {item.name}
                          </p>
                          <span
                            className={`rounded-lg border px-2 py-1 text-[11px] ${getStatusClass(item.status)}`}
                          >
                            {getStatusLabel(item.status)}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-brand-muted">
                          {formatDate(item.updatedAt)} | v{item.versionNumber}
                        </p>
                      </button>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => void handleDuplicatePlan(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-white/15 px-2.5 py-1.5 text-xs text-brand-text transition hover:bg-white/10"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Duplicar
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleDeletePlan(item.id)}
                          className="inline-flex items-center gap-1 rounded-lg border border-red-400/35 bg-red-500/10 px-2.5 py-1.5 text-xs text-red-100 transition hover:bg-red-500/20"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Eliminar
                        </button>
                      </div>
                    </article>
                  ))}
                  {!plansForAthlete.length ? (
                    <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                      Sin planes.
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
                <h2 className="text-lg font-semibold text-brand-text">
                  Intolerancias
                </h2>
                <div className="mt-3 space-y-2">
                  <label className="block text-sm text-brand-muted">
                    Tipo
                    <select
                      value={restrictionForm.type}
                      onChange={(event) => {
                        const nextType = event.target
                          .value as NutritionAthleteRestrictionType;
                        setRestrictionForm((current) => ({
                          ...current,
                          type: nextType,
                          key: getDefaultRestrictionKey(nextType),
                          foodId:
                            nextType === "dislike"
                              ? selectedRestrictionFoodId
                              : "",
                        }));
                      }}
                      disabled={!selectedAthlete}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <option value="intolerance">Intolerancia</option>
                      <option value="allergy">Alergia</option>
                      <option value="dislike">No le gusta</option>
                      <option value="diet">Dieta</option>
                    </select>
                  </label>

                  {restrictionForm.type === "dislike" ? (
                    <label className="block text-sm text-brand-muted">
                      Alimento
                      <select
                        value={selectedRestrictionFoodId}
                        onChange={(event) =>
                          setRestrictionForm((current) => ({
                            ...current,
                            foodId: event.target.value,
                          }))
                        }
                        disabled={!selectedAthlete || !foods.length}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {foods.map((food) => (
                          <option key={food.id} value={food.id}>
                            {food.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : (
                    <label className="block text-sm text-brand-muted">
                      Opción
                      <select
                        value={restrictionForm.key}
                        onChange={(event) =>
                          setRestrictionForm((current) => ({
                            ...current,
                            key: event.target
                              .value as NutritionAthleteRestrictionKey,
                          }))
                        }
                        disabled={!selectedAthlete}
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {currentRestrictionOptions.map((option) => (
                          <option key={option.key} value={option.key}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}

                  <label className="block text-sm text-brand-muted">
                    Nota
                    <input
                      value={restrictionForm.notes}
                      onChange={(event) =>
                        setRestrictionForm((current) => ({
                          ...current,
                          notes: event.target.value,
                        }))
                      }
                      disabled={!selectedAthlete}
                      className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                    />
                  </label>

                  <BrandButton
                    onClick={() => void addAthleteRestriction()}
                    disabled={!selectedAthlete || restrictionSubmitting}
                    className="w-full"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {restrictionSubmitting
                      ? "Guardando..."
                      : "Añadir restricción"}
                  </BrandButton>
                </div>

                <div className="mt-4 space-y-2">
                  {selectedAthleteRestrictions.map((restriction) => (
                    <article
                      key={restriction.id}
                      className="flex items-start gap-2 rounded-xl border border-white/10 bg-black/20 p-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span
                            className={`rounded-lg border px-2 py-1 text-[11px] ${getRestrictionTypeClass(
                              restriction.type,
                            )}`}
                          >
                            {getRestrictionTypeLabel(restriction.type)}
                          </span>
                          <p className="min-w-0 truncate text-sm font-semibold text-brand-text">
                            {formatRestrictionLabel(restriction)}
                          </p>
                        </div>
                        {restriction.notes ? (
                          <p className="mt-1 text-xs text-brand-muted">
                            {restriction.notes}
                          </p>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          void deleteAthleteRestriction(restriction.id)
                        }
                        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20"
                        aria-label={`Eliminar restricción ${formatRestrictionLabel(restriction)}`}
                        title="Eliminar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </article>
                  ))}
                  {!selectedAthleteRestrictions.length ? (
                    <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-sm text-brand-muted">
                      Sin registros.
                    </p>
                  ) : null}
                </div>
              </div>
            </aside>

            <div className="min-w-0 space-y-4">
              {planLoading ? (
                <Skeleton className="h-[640px] w-full rounded-2xl" />
              ) : !plan ? (
                <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-8 text-center text-brand-muted">
                  Selecciona o crea un plan.
                </div>
              ) : (
                <>
                  <div className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4">
                    <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_repeat(3,minmax(120px,0.5fr))_180px]">
                      <label className="block text-sm text-brand-muted">
                        Plan
                        <input
                          value={plan.name}
                          onChange={(event) =>
                            updatePlanField("name", event.target.value)
                          }
                          disabled={isCurrentPlanPublished}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Proteinas
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={getIntegerInputValue(
                            `${plan.id}:targetProteinG`,
                            plan.targetProteinG,
                            0,
                            2000,
                          )}
                          onChange={(event) =>
                            handleIntegerInputChange(
                              `${plan.id}:targetProteinG`,
                              event.target.value,
                              0,
                              2000,
                              (value) => updateTarget("targetProteinG", value),
                            )
                          }
                          onBlur={() =>
                            clearIntegerInputDraft(`${plan.id}:targetProteinG`)
                          }
                          disabled={isCurrentPlanPublished}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Carbohidratos
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={getIntegerInputValue(
                            `${plan.id}:targetCarbsG`,
                            plan.targetCarbsG,
                            0,
                            3000,
                          )}
                          onChange={(event) =>
                            handleIntegerInputChange(
                              `${plan.id}:targetCarbsG`,
                              event.target.value,
                              0,
                              3000,
                              (value) => updateTarget("targetCarbsG", value),
                            )
                          }
                          onBlur={() =>
                            clearIntegerInputDraft(`${plan.id}:targetCarbsG`)
                          }
                          disabled={isCurrentPlanPublished}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Grasas
                        <input
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          value={getIntegerInputValue(
                            `${plan.id}:targetFatG`,
                            plan.targetFatG,
                            0,
                            1000,
                          )}
                          onChange={(event) =>
                            handleIntegerInputChange(
                              `${plan.id}:targetFatG`,
                              event.target.value,
                              0,
                              1000,
                              (value) => updateTarget("targetFatG", value),
                            )
                          }
                          onBlur={() =>
                            clearIntegerInputDraft(`${plan.id}:targetFatG`)
                          }
                          disabled={isCurrentPlanPublished}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <label className="block text-sm text-brand-muted">
                        Estado
                        <select
                          value={planMode}
                          onChange={(event) =>
                            handlePlanModeChange(
                              event.target.value as NutritionPlanStatus,
                            )
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                        >
                          <option value="review">Revision</option>
                          {hasPublishedSnapshot ? (
                            <option value="published">Publicado</option>
                          ) : null}
                        </select>
                      </label>
                    </div>

                    {isCurrentPlanPublished ? (
                      <p className="mt-3 rounded-xl border border-emerald-300/25 bg-emerald-500/10 p-3 text-sm text-emerald-100">
                        Modo publicado: estos valores son la referencia
                        entregada al atleta y no se pueden editar. Cambia a
                        Revision para preparar nuevos valores.
                      </p>
                    ) : null}

                    <div className="mt-4 grid gap-3 lg:grid-cols-4">
                      <div className="min-w-0 rounded-xl border border-white/10 bg-black/25 p-3">
                        <p className="truncate text-[11px] uppercase tracking-[0.16em] text-brand-muted">
                          Kcal
                        </p>
                        <p className="mt-1 text-lg font-bold text-brand-text">
                          {formatNumber(planTotals.caloriesKcal, 0)}
                        </p>
                        <p className="mt-2 text-xs text-brand-muted">
                          Calculadas con P 4 / C 4 / G 9
                        </p>
                      </div>
                      <MacroProgress
                        label="Proteinas"
                        current={planTotals.proteinG}
                        target={plan.targetProteinG}
                      />
                      <MacroProgress
                        label="Carbohidratos"
                        current={planTotals.carbsG}
                        target={plan.targetCarbsG}
                      />
                      <MacroProgress
                        label="Grasas"
                        current={planTotals.fatG}
                        target={plan.targetFatG}
                      />
                    </div>

                    <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 lg:flex-row lg:items-end">
                      <label className="block min-w-0 flex-1 text-sm text-brand-muted">
                        Clonar menus
                        <select
                          value={selectedClonePlanId}
                          onChange={(event) =>
                            setSelectedClonePlanId(event.target.value)
                          }
                          disabled={
                            !cloneablePlans.length ||
                            cloningMenus ||
                            isCurrentPlanPublished
                          }
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {cloneablePlans.length ? (
                            cloneablePlans.map((item) => (
                              <option key={item.id} value={item.id}>
                                {(
                                  item.athleteName || item.athleteUsername
                                ).trim()}{" "}
                                - {item.name}
                              </option>
                            ))
                          ) : (
                            <option value="">
                              No hay planes de otros atletas
                            </option>
                          )}
                        </select>
                      </label>
                      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                        <button
                          type="button"
                          onClick={() => void cloneMenusFromPlan("replace")}
                          disabled={
                            !selectedClonePlanId ||
                            cloningMenus ||
                            isCurrentPlanPublished
                          }
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-brand-accent/45 bg-brand-accent/10 px-4 py-2.5 text-sm font-semibold text-brand-text transition hover:bg-brand-accent/20 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                          {cloningMenus ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Copy className="h-4 w-4" />
                          )}
                          Reemplazar
                        </button>
                        <button
                          type="button"
                          onClick={() => void cloneMenusFromPlan("append")}
                          disabled={
                            !selectedClonePlanId ||
                            cloningMenus ||
                            isCurrentPlanPublished
                          }
                          className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-brand-text transition hover:border-brand-accent/50 hover:bg-brand-accent/10 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
                        >
                          <Plus className="h-4 w-4" />
                          Anadir
                        </button>
                      </div>
                    </div>

                    <div className="mt-4 grid gap-3 lg:grid-cols-3">
                      <label className="block min-w-0 text-sm text-brand-muted">
                        Observaciones
                        <textarea
                          value={plan.notes}
                          onChange={(event) =>
                            updatePlanField("notes", event.target.value)
                          }
                          rows={3}
                          disabled={isCurrentPlanPublished}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <label className="block min-w-0 text-sm text-brand-muted">
                        Suplementacion
                        <textarea
                          value={plan.supplementation}
                          onChange={(event) =>
                            updatePlanField(
                              "supplementation",
                              event.target.value,
                            )
                          }
                          rows={3}
                          disabled={isCurrentPlanPublished}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                      <label className="block min-w-0 text-sm text-brand-muted">
                        Recomendaciones
                        <textarea
                          value={plan.recommendations}
                          onChange={(event) =>
                            updatePlanField(
                              "recommendations",
                              event.target.value,
                            )
                          }
                          rows={3}
                          disabled={isCurrentPlanPublished}
                          className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </label>
                    </div>

                    <div className="mt-4 flex flex-col gap-3 border-t border-white/10 pt-4 lg:flex-row lg:items-center lg:justify-between">
                      <div className="inline-flex w-full max-w-full rounded-xl border border-white/10 bg-black/20 p-1 sm:w-fit">
                        <button
                          type="button"
                          onClick={() => setPdfIncludeMacros(true)}
                          className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition sm:flex-none sm:px-3 ${
                            pdfIncludeMacros
                              ? "bg-brand-accent text-black"
                              : "text-brand-muted hover:bg-white/10 hover:text-brand-text"
                          }`}
                        >
                          PDF con macros
                        </button>
                        <button
                          type="button"
                          onClick={() => setPdfIncludeMacros(false)}
                          className={`flex-1 rounded-lg px-2 py-2 text-xs font-semibold transition sm:flex-none sm:px-3 ${
                            !pdfIncludeMacros
                              ? "bg-brand-accent text-black"
                              : "text-brand-muted hover:bg-white/10 hover:text-brand-text"
                          }`}
                        >
                          PDF sin macros
                        </button>
                      </div>
                      <div className="grid grid-cols-1 gap-2 sm:flex sm:flex-wrap">
                        <BrandButton
                          onClick={() => void saveCurrentPlan(plan)}
                          disabled={
                            saveState === "saving" || isCurrentPlanPublished
                          }
                          className="w-full sm:w-auto"
                        >
                          <Save className="mr-2 h-4 w-4" />
                          Guardar revision
                        </BrandButton>
                        <BrandButton
                          onClick={generatePreview}
                          disabled={previewLoading || saveState === "saving"}
                          className="w-full sm:w-auto"
                        >
                          {previewLoading ? (
                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          ) : (
                            <Eye className="mr-2 h-4 w-4" />
                          )}
                          Generar PDF
                        </BrandButton>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-4">
                    {plan.meals.map((meal, mealIndex) => {
                      const totals = calculateMealTotals(meal.entries);
                      const mealOptionGroups = getMealOptionGroups(meal);
                      const availableOptionNumbers = mealOptionGroups.map(
                        (group) => group.optionNumber,
                      );
                      const selectedOptionCandidate = normalizeMealOption(
                        mealSelectedOptions[meal.id] ?? 1,
                      );
                      const selectedOptionNumber =
                        availableOptionNumbers.includes(selectedOptionCandidate)
                          ? selectedOptionCandidate
                          : 1;
                      const optionKey = buildMealOptionKey(
                        meal.id,
                        selectedOptionNumber,
                      );
                      const search = foodSearches[optionKey] ?? "";
                      const results = search.trim()
                        ? activeFoods
                            .filter(
                              (food) =>
                                food.name
                                  .toLowerCase()
                                  .includes(search.trim().toLowerCase()) ||
                                food.category
                                  .toLowerCase()
                                  .includes(search.trim().toLowerCase()),
                            )
                            .slice(0, 8)
                        : [];

                      return (
                        <article
                          key={meal.id}
                          className="rounded-2xl border border-white/10 bg-brand-surface/70 p-3 sm:p-4"
                        >
                          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                            <div className="grid min-w-0 flex-1 gap-3 md:grid-cols-[minmax(0,1fr)_180px]">
                              <input
                                value={meal.name}
                                onChange={(event) =>
                                  updateMeal(meal.id, (current) => ({
                                    ...current,
                                    name: event.target.value,
                                  }))
                                }
                                disabled={isCurrentPlanPublished}
                                className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-base font-semibold text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                              />
                              <label className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-muted">
                                <input
                                  type="checkbox"
                                  checked={meal.included}
                                  onChange={(event) =>
                                    updateMeal(meal.id, (current) => ({
                                      ...current,
                                      included: event.target.checked,
                                    }))
                                  }
                                  disabled={isCurrentPlanPublished}
                                  className="h-4 w-4 rounded border-white/20 bg-black/20 accent-brand-accent"
                                />
                                Suma al total
                              </label>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => moveMeal(meal.id, -1)}
                                disabled={
                                  mealIndex === 0 || isCurrentPlanPublished
                                }
                                className="inline-flex aspect-square h-10 items-center justify-center rounded-xl border border-white/15 text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Subir comida"
                              >
                                <ArrowUp className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => moveMeal(meal.id, 1)}
                                disabled={
                                  mealIndex === plan.meals.length - 1 ||
                                  isCurrentPlanPublished
                                }
                                className="inline-flex aspect-square h-10 items-center justify-center rounded-xl border border-white/15 text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Bajar comida"
                              >
                                <ArrowDown className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => duplicateMeal(meal.id)}
                                disabled={isCurrentPlanPublished}
                                className="inline-flex aspect-square h-10 items-center justify-center rounded-xl border border-white/15 text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Duplicar comida"
                              >
                                <Copy className="h-4 w-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => addMealOption(meal.id)}
                                disabled={
                                  isCurrentPlanPublished ||
                                  mealOptionGroups.length >= 20
                                }
                                className="inline-flex items-center justify-center gap-2 rounded-xl border border-brand-accent/35 bg-brand-accent/10 px-3 py-2 text-xs font-semibold text-brand-text transition hover:bg-brand-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Plus className="h-3.5 w-3.5" />
                                Opcion
                              </button>
                              <button
                                type="button"
                                onClick={() => removeMeal(meal.id)}
                                disabled={
                                  isCurrentPlanPublished ||
                                  plan.meals.length <= 1
                                }
                                className="inline-flex aspect-square h-10 items-center justify-center rounded-xl border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Eliminar comida"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>

                          <div className="mt-3 flex flex-wrap gap-2">
                            <SmallTotal
                              label="Kcal"
                              value={totals.caloriesKcal}
                              unit=""
                            />
                            <SmallTotal
                              label="P"
                              value={totals.proteinG}
                              unit="g"
                            />
                            <SmallTotal
                              label="C"
                              value={totals.carbsG}
                              unit="g"
                            />
                            <SmallTotal
                              label="G"
                              value={totals.fatG}
                              unit="g"
                            />
                            <SmallTotal
                              label="Agua"
                              value={totals.waterG}
                              unit="g"
                            />
                            <SmallTotal
                              label="Sodio"
                              value={totals.sodiumMg}
                              unit="mg"
                            />
                          </div>

                          <label className="mt-3 block text-sm text-brand-muted">
                            Notas comida
                            <input
                              value={meal.notes}
                              onChange={(event) =>
                                updateMeal(meal.id, (current) => ({
                                  ...current,
                                  notes: event.target.value,
                                }))
                              }
                              disabled={isCurrentPlanPublished}
                              className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                          </label>

                          <div className="mt-4 grid gap-2 lg:grid-cols-[minmax(0,1fr)_110px_120px_150px]">
                            <div className="relative">
                              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                              <input
                                value={search}
                                onChange={(event) =>
                                  setFoodSearches((current) => ({
                                    ...current,
                                    [optionKey]: event.target.value,
                                  }))
                                }
                                placeholder="Buscar alimento"
                                disabled={isCurrentPlanPublished}
                                className="w-full rounded-xl border border-white/10 bg-black/20 py-2.5 pl-10 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                              />
                              {search.trim() ? (
                                <div className="absolute left-0 right-0 top-full z-20 mt-2 max-h-72 overflow-auto rounded-xl border border-white/10 bg-[#111114] p-2 shadow-glow">
                                  {results.length ? (
                                    results.map((food) => {
                                      const conflict = getRestrictionConflict(
                                        food,
                                        selectedAthleteRestrictions,
                                      );
                                      return (
                                        <button
                                          key={food.id}
                                          type="button"
                                          onClick={() =>
                                            addFoodToMeal(
                                              meal.id,
                                              food,
                                              selectedOptionNumber,
                                            )
                                          }
                                          disabled={isCurrentPlanPublished}
                                          className="flex w-full flex-col items-start gap-1.5 rounded-lg px-3 py-2 text-left text-sm transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-row sm:items-center sm:justify-between sm:gap-2"
                                        >
                                          <span className="flex min-w-0 items-center gap-2">
                                            <span
                                              className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                                conflict
                                                  ? "border-red-300/40 bg-red-500/10 text-red-100"
                                                  : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                              }`}
                                              title={
                                                conflict
                                                  ? `${getRestrictionTypeLabel(conflict.type)}: ${formatRestrictionLabel(conflict)}`
                                                  : "Compatible"
                                              }
                                            >
                                              {conflict ? (
                                                <ThumbsDown className="h-3.5 w-3.5" />
                                              ) : (
                                                <ThumbsUp className="h-3.5 w-3.5" />
                                              )}
                                            </span>
                                            <span className="min-w-0 truncate text-brand-text">
                                              {food.name}
                                            </span>
                                          </span>
                                          <span className="text-xs text-brand-muted sm:shrink-0">
                                            Kcal{" "}
                                            {formatNumber(
                                              calculateFoodCaloriesPer100g(
                                                food,
                                              ),
                                              0,
                                            )}{" "}
                                            | P{" "}
                                            {formatNumber(food.proteinPer100g)}{" "}
                                            | C{" "}
                                            {formatNumber(food.carbsPer100g)} |
                                            G {formatNumber(food.fatPer100g)}
                                          </span>
                                        </button>
                                      );
                                    })
                                  ) : (
                                    <button
                                      type="button"
                                      onClick={() =>
                                        startQuickFood(
                                          meal.id,
                                          selectedOptionNumber,
                                        )
                                      }
                                      disabled={isCurrentPlanPublished}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                                    >
                                      <Plus className="h-4 w-4 text-brand-accent" />
                                      Crear nuevo alimento
                                    </button>
                                  )}
                                </div>
                              ) : null}
                            </div>
                            <select
                              value={selectedOptionNumber}
                              onChange={(event) =>
                                setMealSelectedOptions((current) => ({
                                  ...current,
                                  [meal.id]: event.target.value,
                                }))
                              }
                              disabled={isCurrentPlanPublished}
                              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                              aria-label="Opcion de comida"
                            >
                              {availableOptionNumbers.map((optionNumber) => (
                                <option key={optionNumber} value={optionNumber}>
                                  Opcion {optionNumber}
                                </option>
                              ))}
                            </select>
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              aria-label="Cantidad"
                              value={foodQuantities[optionKey] ?? "100"}
                              onChange={(event) =>
                                setFoodQuantities((current) => ({
                                  ...current,
                                  [optionKey]: sanitizeIntegerInput(
                                    event.target.value,
                                  ),
                                }))
                              }
                              onBlur={() =>
                                setFoodQuantities((current) => ({
                                  ...current,
                                  [optionKey]: current[optionKey]?.trim()
                                    ? current[optionKey]
                                    : "100",
                                }))
                              }
                              disabled={isCurrentPlanPublished}
                              className="w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                startQuickFood(meal.id, selectedOptionNumber)
                              }
                              disabled={isCurrentPlanPublished}
                              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-brand-text transition hover:border-brand-accent/50 hover:bg-brand-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
                            >
                              <Plus className="h-4 w-4" />
                              Alimento
                            </button>
                          </div>

                          <div className="mt-4 space-y-3">
                            {mealOptionGroups.map(
                              ({ optionNumber, entries }) => {
                                const optionTotals = calculateMealOptionTotals(
                                  meal.entries,
                                  optionNumber,
                                );
                                const isReferenceOption = optionNumber === 1;

                                return (
                                  <div
                                    key={optionNumber}
                                    className={`rounded-2xl border p-3 ${
                                      isReferenceOption
                                        ? "border-brand-accent/35 bg-brand-accent/10"
                                        : "border-white/10 bg-black/20"
                                    }`}
                                  >
                                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                      <div>
                                        <p className="text-sm font-semibold text-brand-text">
                                          Opcion {optionNumber}
                                          {isReferenceOption
                                            ? " - referencia"
                                            : ""}
                                        </p>
                                        <p className="mt-1 text-xs text-brand-muted">
                                          {entries.length} alimentos
                                        </p>
                                      </div>
                                      <div className="flex flex-wrap gap-2">
                                        <SmallTotal
                                          label="Kcal"
                                          value={optionTotals.caloriesKcal}
                                          unit=""
                                          alert={
                                            !isReferenceOption &&
                                            optionTotals.caloriesKcal >
                                              totals.caloriesKcal
                                          }
                                        />
                                        <SmallTotal
                                          label="P"
                                          value={optionTotals.proteinG}
                                          unit="g"
                                          alert={
                                            !isReferenceOption &&
                                            optionTotals.proteinG >
                                              totals.proteinG
                                          }
                                        />
                                        <SmallTotal
                                          label="C"
                                          value={optionTotals.carbsG}
                                          unit="g"
                                          alert={
                                            !isReferenceOption &&
                                            optionTotals.carbsG > totals.carbsG
                                          }
                                        />
                                        <SmallTotal
                                          label="G"
                                          value={optionTotals.fatG}
                                          unit="g"
                                          alert={
                                            !isReferenceOption &&
                                            optionTotals.fatG > totals.fatG
                                          }
                                        />
                                        {!isReferenceOption ? (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              removeMealOption(
                                                meal.id,
                                                optionNumber,
                                              )
                                            }
                                            disabled={isCurrentPlanPublished}
                                            className="inline-flex aspect-square h-8 w-8 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                            aria-label={`Eliminar opcion ${optionNumber}`}
                                            title="Eliminar opcion"
                                          >
                                            <Trash2 className="h-3.5 w-3.5" />
                                          </button>
                                        ) : null}
                                      </div>
                                    </div>

                                    <div className="mt-3 space-y-3 lg:hidden">
                                      {entries.length ? (
                                        entries.map((entry) => {
                                          const entryTotals =
                                            calculateEntryTotals(entry);
                                          const entryCatalogFood = foods.find(
                                            (food) => food.id === entry.foodId,
                                          );
                                          const entryFood = getFoodLikeForEntry(
                                            entry,
                                            foods,
                                          );
                                          const entryConflict = entryCatalogFood
                                            ? getRestrictionConflict(
                                                entryCatalogFood,
                                                selectedAthleteRestrictions,
                                              )
                                            : null;
                                          const entryQuantityUnit =
                                            normalizeQuantityUnitForFood(
                                              entryFood,
                                              normalizeQuantityUnit(
                                                entry.quantityUnit,
                                              ),
                                            );
                                          const alternatives = [
                                            ...(entry.alternatives ?? []),
                                          ].sort(
                                            (a, b) => a.position - b.position,
                                          );
                                          const hasAlternativeSearch =
                                            Object.prototype.hasOwnProperty.call(
                                              alternativeSearches,
                                              entry.id,
                                            );
                                          const alternativeSearch =
                                            alternativeSearches[entry.id] ?? "";
                                          const alternativeQuery =
                                            alternativeSearch
                                              .trim()
                                              .toLowerCase();
                                          const alternativeResults =
                                            hasAlternativeSearch &&
                                            alternativeQuery
                                              ? activeFoods
                                                  .filter(
                                                    (food) =>
                                                      food.name
                                                        .toLowerCase()
                                                        .includes(
                                                          alternativeQuery,
                                                        ) ||
                                                      food.category
                                                        .toLowerCase()
                                                        .includes(
                                                          alternativeQuery,
                                                        ),
                                                  )
                                                  .slice(0, 8)
                                              : [];

                                          return (
                                            <article
                                              key={entry.id}
                                              className="rounded-xl border border-white/10 bg-black/20 p-3"
                                            >
                                              <div className="flex items-start justify-between gap-3">
                                                <div className="min-w-0">
                                                  <div className="flex min-w-0 items-start gap-2">
                                                    <span
                                                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                                        entryConflict
                                                          ? "border-red-300/40 bg-red-500/10 text-red-100"
                                                          : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                                      }`}
                                                      title={
                                                        entryConflict
                                                          ? `${getRestrictionTypeLabel(entryConflict.type)}: ${formatRestrictionLabel(entryConflict)}`
                                                          : "Compatible"
                                                      }
                                                    >
                                                      {entryConflict ? (
                                                        <ThumbsDown className="h-3.5 w-3.5" />
                                                      ) : (
                                                        <ThumbsUp className="h-3.5 w-3.5" />
                                                      )}
                                                    </span>
                                                    <div className="min-w-0">
                                                      <p className="break-words text-sm font-semibold text-brand-text">
                                                        {entry.foodName}
                                                      </p>
                                                      <p className="mt-1 text-xs text-brand-muted">
                                                        {formatDisplayQuantity(
                                                          entry,
                                                        )}
                                                      </p>
                                                    </div>
                                                  </div>
                                                </div>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    openAlternativeSearch(
                                                      entry.id,
                                                    )
                                                  }
                                                  disabled={
                                                    isCurrentPlanPublished
                                                  }
                                                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-brand-accent/35 bg-brand-accent/10 text-brand-text transition hover:bg-brand-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                                                  aria-label={`AÃ±adir alternativa a ${entry.foodName}`}
                                                  title="AÃ±adir alternativa"
                                                >
                                                  <Plus className="h-4 w-4" />
                                                </button>
                                              </div>

                                              <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                                                  Kcal{" "}
                                                  <strong className="text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.caloriesKcal,
                                                      0,
                                                    )}
                                                  </strong>
                                                </span>
                                                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                                                  P{" "}
                                                  <strong className="text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.proteinG,
                                                    )}
                                                  </strong>
                                                </span>
                                                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                                                  C{" "}
                                                  <strong className="text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.carbsG,
                                                    )}
                                                  </strong>
                                                </span>
                                                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                                                  G{" "}
                                                  <strong className="text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.fatG,
                                                    )}
                                                  </strong>
                                                </span>
                                                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                                                  Sodio{" "}
                                                  <strong className="text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.sodiumMg,
                                                      0,
                                                    )}{" "}
                                                    mg
                                                  </strong>
                                                </span>
                                                <span className="rounded-lg border border-white/10 bg-black/25 px-2 py-1.5 text-brand-muted">
                                                  Agua{" "}
                                                  <strong className="text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.waterG,
                                                    )}{" "}
                                                    g
                                                  </strong>
                                                </span>
                                              </div>

                                              <div className="mt-3 grid grid-cols-2 gap-2">
                                                <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted">
                                                  Cantidad
                                                  <input
                                                    type="text"
                                                    inputMode="numeric"
                                                    pattern="[0-9]*"
                                                    value={getIntegerInputValue(
                                                      `${entry.id}:quantityG`,
                                                      entry.quantityG,
                                                      1,
                                                      10000,
                                                    )}
                                                    onChange={(event) =>
                                                      handleIntegerInputChange(
                                                        `${entry.id}:quantityG`,
                                                        event.target.value,
                                                        1,
                                                        10000,
                                                        (value) =>
                                                          updateEntry(
                                                            meal.id,
                                                            entry.id,
                                                            (current) => ({
                                                              ...current,
                                                              quantityG: value,
                                                            }),
                                                          ),
                                                      )
                                                    }
                                                    onBlur={() =>
                                                      clearIntegerInputDraft(
                                                        `${entry.id}:quantityG`,
                                                      )
                                                    }
                                                    disabled={
                                                      isCurrentPlanPublished
                                                    }
                                                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-right text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                  />
                                                </label>
                                                <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted">
                                                  Unidad
                                                  <select
                                                    value={entryQuantityUnit}
                                                    onChange={(event) =>
                                                      updateEntry(
                                                        meal.id,
                                                        entry.id,
                                                        (current) => ({
                                                          ...current,
                                                          ...convertQuantityUnitForFood(
                                                            current,
                                                            getFoodLikeForEntry(
                                                              current,
                                                              foods,
                                                            ),
                                                            event.target
                                                              .value as NutritionQuantityUnit,
                                                          ),
                                                        }),
                                                      )
                                                    }
                                                    disabled={
                                                      isCurrentPlanPublished
                                                    }
                                                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                  >
                                                    {getQuantityUnitOptionsForFood(
                                                      entryFood,
                                                    ).map((option) => (
                                                      <option
                                                        key={option.value}
                                                        value={option.value}
                                                      >
                                                        {option.label}
                                                      </option>
                                                    ))}
                                                  </select>
                                                </label>
                                              </div>

                                              <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted">
                                                Texto PDF
                                                <input
                                                  value={entry.customText}
                                                  onChange={(event) =>
                                                    updateEntry(
                                                      meal.id,
                                                      entry.id,
                                                      (current) => ({
                                                        ...current,
                                                        customText:
                                                          event.target.value,
                                                      }),
                                                    )
                                                  }
                                                  placeholder={entry.foodName}
                                                  disabled={
                                                    isCurrentPlanPublished
                                                  }
                                                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                />
                                              </label>

                                              {alternatives.length ||
                                              hasAlternativeSearch ? (
                                                <div className="mt-3 space-y-2 border-l-2 border-brand-accent/40 pl-3">
                                                  {alternatives.map(
                                                    (alternative) => {
                                                      const alternativeTotals =
                                                        calculateEntryTotals(
                                                          alternative,
                                                        );
                                                      const alternativeCatalogFood =
                                                        foods.find(
                                                          (food) =>
                                                            food.id ===
                                                            alternative.foodId,
                                                        );
                                                      const alternativeFood =
                                                        getFoodLikeForEntry(
                                                          alternative,
                                                          foods,
                                                        );
                                                      const alternativeQuantityUnit =
                                                        normalizeQuantityUnitForFood(
                                                          alternativeFood,
                                                          normalizeQuantityUnit(
                                                            alternative.quantityUnit,
                                                          ),
                                                        );
                                                      const alternativeConflict =
                                                        alternativeCatalogFood
                                                          ? getRestrictionConflict(
                                                              alternativeCatalogFood,
                                                              selectedAthleteRestrictions,
                                                            )
                                                          : null;
                                                      return (
                                                        <div
                                                          key={alternative.id}
                                                          className="rounded-lg border border-white/10 bg-white/[0.03] p-3"
                                                        >
                                                          <div className="flex items-start justify-between gap-3">
                                                            <div className="min-w-0">
                                                              <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
                                                                Alternativa
                                                              </p>
                                                              <div className="mt-1 flex min-w-0 items-start gap-2">
                                                                <span
                                                                  className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                                                    alternativeConflict
                                                                      ? "border-red-300/40 bg-red-500/10 text-red-100"
                                                                      : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                                                  }`}
                                                                  title={
                                                                    alternativeConflict
                                                                      ? `${getRestrictionTypeLabel(alternativeConflict.type)}: ${formatRestrictionLabel(alternativeConflict)}`
                                                                      : "Compatible"
                                                                  }
                                                                >
                                                                  {alternativeConflict ? (
                                                                    <ThumbsDown className="h-3.5 w-3.5" />
                                                                  ) : (
                                                                    <ThumbsUp className="h-3.5 w-3.5" />
                                                                  )}
                                                                </span>
                                                                <p className="min-w-0 break-words text-sm font-semibold text-brand-text">
                                                                  {
                                                                    alternative.foodName
                                                                  }
                                                                </p>
                                                              </div>
                                                            </div>
                                                            <button
                                                              type="button"
                                                              onClick={() =>
                                                                removeAlternative(
                                                                  meal.id,
                                                                  entry.id,
                                                                  alternative.id,
                                                                )
                                                              }
                                                              disabled={
                                                                isCurrentPlanPublished
                                                              }
                                                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                                              aria-label={`Eliminar alternativa ${alternative.foodName}`}
                                                              title="Eliminar alternativa"
                                                            >
                                                              <Trash2 className="h-3.5 w-3.5" />
                                                            </button>
                                                          </div>

                                                          <div className="mt-3 grid grid-cols-2 gap-2">
                                                            <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted">
                                                              Cantidad
                                                              <input
                                                                type="text"
                                                                inputMode="numeric"
                                                                pattern="[0-9]*"
                                                                value={getIntegerInputValue(
                                                                  `${alternative.id}:quantityG`,
                                                                  alternative.quantityG,
                                                                  1,
                                                                  10000,
                                                                )}
                                                                onChange={(
                                                                  event,
                                                                ) =>
                                                                  handleIntegerInputChange(
                                                                    `${alternative.id}:quantityG`,
                                                                    event.target
                                                                      .value,
                                                                    1,
                                                                    10000,
                                                                    (value) =>
                                                                      updateAlternative(
                                                                        meal.id,
                                                                        entry.id,
                                                                        alternative.id,
                                                                        (
                                                                          current,
                                                                        ) => ({
                                                                          ...current,
                                                                          quantityG:
                                                                            value,
                                                                        }),
                                                                      ),
                                                                  )
                                                                }
                                                                onBlur={() =>
                                                                  clearIntegerInputDraft(
                                                                    `${alternative.id}:quantityG`,
                                                                  )
                                                                }
                                                                disabled={
                                                                  isCurrentPlanPublished
                                                                }
                                                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-right text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                              />
                                                            </label>
                                                            <label className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted">
                                                              Unidad
                                                              <select
                                                                value={
                                                                  alternativeQuantityUnit
                                                                }
                                                                onChange={(
                                                                  event,
                                                                ) =>
                                                                  updateAlternative(
                                                                    meal.id,
                                                                    entry.id,
                                                                    alternative.id,
                                                                    (
                                                                      current,
                                                                    ) => ({
                                                                      ...current,
                                                                      ...convertQuantityUnitForFood(
                                                                        current,
                                                                        getFoodLikeForEntry(
                                                                          current,
                                                                          foods,
                                                                        ),
                                                                        event
                                                                          .target
                                                                          .value as NutritionQuantityUnit,
                                                                      ),
                                                                    }),
                                                                  )
                                                                }
                                                                disabled={
                                                                  isCurrentPlanPublished
                                                                }
                                                                className="mt-1 w-full rounded-lg border border-white/10 bg-black/20 px-2 py-2 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                              >
                                                                {getQuantityUnitOptionsForFood(
                                                                  alternativeFood,
                                                                ).map(
                                                                  (option) => (
                                                                    <option
                                                                      key={
                                                                        option.value
                                                                      }
                                                                      value={
                                                                        option.value
                                                                      }
                                                                    >
                                                                      {
                                                                        option.label
                                                                      }
                                                                    </option>
                                                                  ),
                                                                )}
                                                              </select>
                                                            </label>
                                                          </div>

                                                          <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                                                            <span className="rounded-md bg-black/20 px-2 py-1 text-brand-text">
                                                              {formatNumber(
                                                                alternativeTotals.caloriesKcal,
                                                                0,
                                                              )}{" "}
                                                              kcal
                                                            </span>
                                                            <span className="rounded-md bg-black/20 px-2 py-1 text-brand-text">
                                                              P{" "}
                                                              {formatNumber(
                                                                alternativeTotals.proteinG,
                                                              )}
                                                            </span>
                                                            <span className="rounded-md bg-black/20 px-2 py-1 text-brand-text">
                                                              C{" "}
                                                              {formatNumber(
                                                                alternativeTotals.carbsG,
                                                              )}
                                                            </span>
                                                            <span className="rounded-md bg-black/20 px-2 py-1 text-brand-text">
                                                              G{" "}
                                                              {formatNumber(
                                                                alternativeTotals.fatG,
                                                              )}
                                                            </span>
                                                            <span className="rounded-md bg-black/20 px-2 py-1 text-brand-muted">
                                                              {formatNumber(
                                                                alternativeTotals.sodiumMg,
                                                                0,
                                                              )}{" "}
                                                              mg
                                                            </span>
                                                            <span className="rounded-md bg-black/20 px-2 py-1 text-brand-muted">
                                                              {formatNumber(
                                                                alternativeTotals.waterG,
                                                              )}{" "}
                                                              g
                                                            </span>
                                                          </div>
                                                        </div>
                                                      );
                                                    },
                                                  )}

                                                  {hasAlternativeSearch ? (
                                                    <div className="rounded-lg border border-brand-accent/25 bg-brand-accent/10 p-3">
                                                      <div className="flex items-center gap-2">
                                                        <div className="relative min-w-0 flex-1">
                                                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                                                          <input
                                                            value={
                                                              alternativeSearch
                                                            }
                                                            onChange={(event) =>
                                                              setAlternativeSearches(
                                                                (current) => ({
                                                                  ...current,
                                                                  [entry.id]:
                                                                    event.target
                                                                      .value,
                                                                }),
                                                              )
                                                            }
                                                            placeholder="Buscar alimento alternativo"
                                                            disabled={
                                                              isCurrentPlanPublished
                                                            }
                                                            className="w-full rounded-lg border border-white/10 bg-black/25 py-2 pl-9 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                          />
                                                        </div>
                                                        <button
                                                          type="button"
                                                          onClick={() =>
                                                            closeAlternativeSearch(
                                                              entry.id,
                                                            )
                                                          }
                                                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 text-brand-text transition hover:bg-white/10"
                                                          aria-label="Cerrar buscador de alternativas"
                                                          title="Cerrar"
                                                        >
                                                          <X className="h-4 w-4" />
                                                        </button>
                                                      </div>
                                                      {alternativeResults.length ? (
                                                        <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-black/80 p-1 shadow-xl">
                                                          {alternativeResults.map(
                                                            (food) => {
                                                              const foodCaloriesPer100g =
                                                                calculateFoodCaloriesPer100g(
                                                                  food,
                                                                );
                                                              const conflict =
                                                                getRestrictionConflict(
                                                                  food,
                                                                  selectedAthleteRestrictions,
                                                                );
                                                              const quantityUnit =
                                                                getDefaultQuantityUnitForFood(
                                                                  food,
                                                                );
                                                              const unitWeightG =
                                                                getDefaultUnitWeightGForFood(
                                                                  food,
                                                                  quantityUnit,
                                                                );
                                                              const caloriesPerUnit =
                                                                foodCaloriesPer100g *
                                                                (unitWeightG /
                                                                  100);
                                                              const suggestedQuantity =
                                                                quantityUnit ===
                                                                "g"
                                                                  ? entryTotals.caloriesKcal >
                                                                      0 &&
                                                                    foodCaloriesPer100g >
                                                                      0
                                                                    ? normalizeQuantityG(
                                                                        (entryTotals.caloriesKcal /
                                                                          foodCaloriesPer100g) *
                                                                          100,
                                                                      )
                                                                    : normalizeQuantityG(
                                                                        getEffectiveQuantityG(
                                                                          entry,
                                                                        ),
                                                                      )
                                                                  : entryTotals.caloriesKcal >
                                                                        0 &&
                                                                      caloriesPerUnit >
                                                                        0
                                                                    ? normalizeQuantityG(
                                                                        entryTotals.caloriesKcal /
                                                                          caloriesPerUnit,
                                                                      )
                                                                    : 1;

                                                              return (
                                                                <button
                                                                  key={food.id}
                                                                  type="button"
                                                                  onClick={() =>
                                                                    addAlternativeToEntry(
                                                                      meal.id,
                                                                      entry.id,
                                                                      food,
                                                                    )
                                                                  }
                                                                  disabled={
                                                                    isCurrentPlanPublished
                                                                  }
                                                                  className="flex w-full flex-col items-start gap-2 rounded-md px-3 py-2 text-left text-sm text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 sm:flex-row sm:items-center sm:justify-between"
                                                                >
                                                                  <span className="flex min-w-0 items-center gap-2">
                                                                    <span
                                                                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                                                        conflict
                                                                          ? "border-red-300/40 bg-red-500/10 text-red-100"
                                                                          : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                                                      }`}
                                                                      title={
                                                                        conflict
                                                                          ? `${getRestrictionTypeLabel(conflict.type)}: ${formatRestrictionLabel(conflict)}`
                                                                          : "Compatible"
                                                                      }
                                                                    >
                                                                      {conflict ? (
                                                                        <ThumbsDown className="h-3.5 w-3.5" />
                                                                      ) : (
                                                                        <ThumbsUp className="h-3.5 w-3.5" />
                                                                      )}
                                                                    </span>
                                                                    <span className="min-w-0 break-words">
                                                                      {
                                                                        food.name
                                                                      }
                                                                    </span>
                                                                  </span>
                                                                  <span className="text-xs text-brand-muted sm:shrink-0">
                                                                    {formatDisplayQuantity(
                                                                      {
                                                                        quantityG:
                                                                          suggestedQuantity,
                                                                        quantityUnit,
                                                                        unitWeightG,
                                                                      },
                                                                    )}{" "}
                                                                    -{" "}
                                                                    {formatNumber(
                                                                      foodCaloriesPer100g,
                                                                      0,
                                                                    )}{" "}
                                                                    kcal/100g
                                                                  </span>
                                                                </button>
                                                              );
                                                            },
                                                          )}
                                                        </div>
                                                      ) : alternativeQuery ? (
                                                        <p className="mt-2 text-xs text-brand-muted">
                                                          Sin resultados.
                                                        </p>
                                                      ) : null}
                                                    </div>
                                                  ) : null}
                                                </div>
                                              ) : null}

                                              <div className="mt-3 flex justify-end">
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    removeEntry(
                                                      meal.id,
                                                      entry.id,
                                                    )
                                                  }
                                                  disabled={
                                                    isCurrentPlanPublished
                                                  }
                                                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                                  aria-label={`Eliminar ${entry.foodName}`}
                                                  title="Eliminar"
                                                >
                                                  <Trash2 className="h-4 w-4" />
                                                </button>
                                              </div>
                                            </article>
                                          );
                                        })
                                      ) : (
                                        <p className="rounded-xl border border-white/10 bg-black/20 p-4 text-center text-sm text-brand-muted">
                                          Sin alimentos.
                                        </p>
                                      )}
                                    </div>

                                    <div className="mt-3 hidden overflow-x-auto rounded-xl border border-white/10 lg:block">
                                      <table className="min-w-[1080px] w-full text-sm">
                                        <thead className="bg-black/30 text-xs uppercase tracking-[0.14em] text-brand-muted">
                                          <tr>
                                            <th className="px-3 py-2 text-left">
                                              Alimento
                                            </th>
                                            <th className="px-3 py-2 text-right">
                                              Cantidad
                                            </th>
                                            <th className="px-3 py-2 text-right">
                                              Kcal
                                            </th>
                                            <th className="px-3 py-2 text-right">
                                              P
                                            </th>
                                            <th className="px-3 py-2 text-right">
                                              C
                                            </th>
                                            <th className="px-3 py-2 text-right">
                                              G
                                            </th>
                                            <th className="px-3 py-2 text-right">
                                              Sodio
                                            </th>
                                            <th className="px-3 py-2 text-right">
                                              Agua
                                            </th>
                                            <th className="px-3 py-2 text-left">
                                              Texto PDF
                                            </th>
                                            <th className="px-3 py-2 text-left">
                                              Accion
                                            </th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {entries.map((entry) => {
                                            const entryTotals =
                                              calculateEntryTotals(entry);
                                            const entryCatalogFood = foods.find(
                                              (food) =>
                                                food.id === entry.foodId,
                                            );
                                            const entryFood =
                                              getFoodLikeForEntry(entry, foods);
                                            const entryConflict =
                                              entryCatalogFood
                                                ? getRestrictionConflict(
                                                    entryCatalogFood,
                                                    selectedAthleteRestrictions,
                                                  )
                                                : null;
                                            const entryQuantityUnit =
                                              normalizeQuantityUnitForFood(
                                                entryFood,
                                                normalizeQuantityUnit(
                                                  entry.quantityUnit,
                                                ),
                                              );
                                            const alternatives = [
                                              ...(entry.alternatives ?? []),
                                            ].sort(
                                              (a, b) => a.position - b.position,
                                            );
                                            const hasAlternativeSearch =
                                              Object.prototype.hasOwnProperty.call(
                                                alternativeSearches,
                                                entry.id,
                                              );
                                            const alternativeSearch =
                                              alternativeSearches[entry.id] ??
                                              "";
                                            const alternativeQuery =
                                              alternativeSearch
                                                .trim()
                                                .toLowerCase();
                                            const alternativeResults =
                                              hasAlternativeSearch &&
                                              alternativeQuery
                                                ? activeFoods
                                                    .filter(
                                                      (food) =>
                                                        food.name
                                                          .toLowerCase()
                                                          .includes(
                                                            alternativeQuery,
                                                          ) ||
                                                        food.category
                                                          .toLowerCase()
                                                          .includes(
                                                            alternativeQuery,
                                                          ),
                                                    )
                                                    .slice(0, 8)
                                                : [];

                                            return (
                                              <Fragment key={entry.id}>
                                                <tr className="border-t border-white/10">
                                                  <td className="px-3 py-2 font-medium text-brand-text">
                                                    <div className="flex items-center justify-between gap-2">
                                                      <span className="flex min-w-0 items-center gap-2">
                                                        <span
                                                          className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                                            entryConflict
                                                              ? "border-red-300/40 bg-red-500/10 text-red-100"
                                                              : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                                          }`}
                                                          title={
                                                            entryConflict
                                                              ? `${getRestrictionTypeLabel(entryConflict.type)}: ${formatRestrictionLabel(entryConflict)}`
                                                              : "Compatible"
                                                          }
                                                        >
                                                          {entryConflict ? (
                                                            <ThumbsDown className="h-3.5 w-3.5" />
                                                          ) : (
                                                            <ThumbsUp className="h-3.5 w-3.5" />
                                                          )}
                                                        </span>
                                                        <span className="min-w-0 break-words">
                                                          {entry.foodName}
                                                        </span>
                                                      </span>
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          openAlternativeSearch(
                                                            entry.id,
                                                          )
                                                        }
                                                        disabled={
                                                          isCurrentPlanPublished
                                                        }
                                                        className="inline-flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-brand-accent/35 bg-brand-accent/10 text-brand-text transition hover:bg-brand-accent/20 disabled:cursor-not-allowed disabled:opacity-40"
                                                        aria-label={`Añadir alternativa a ${entry.foodName}`}
                                                        title="Añadir alternativa"
                                                      >
                                                        <Plus className="h-3.5 w-3.5" />
                                                      </button>
                                                    </div>
                                                  </td>
                                                  <td className="px-3 py-2 text-right">
                                                    <div className="ml-auto flex justify-end gap-1">
                                                      <input
                                                        type="text"
                                                        inputMode="numeric"
                                                        pattern="[0-9]*"
                                                        value={getIntegerInputValue(
                                                          `${entry.id}:quantityG`,
                                                          entry.quantityG,
                                                          1,
                                                          10000,
                                                        )}
                                                        onChange={(event) =>
                                                          handleIntegerInputChange(
                                                            `${entry.id}:quantityG`,
                                                            event.target.value,
                                                            1,
                                                            10000,
                                                            (value) =>
                                                              updateEntry(
                                                                meal.id,
                                                                entry.id,
                                                                (current) => ({
                                                                  ...current,
                                                                  quantityG:
                                                                    value,
                                                                }),
                                                              ),
                                                          )
                                                        }
                                                        onBlur={() =>
                                                          clearIntegerInputDraft(
                                                            `${entry.id}:quantityG`,
                                                          )
                                                        }
                                                        disabled={
                                                          isCurrentPlanPublished
                                                        }
                                                        className="w-20 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-right text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                      />
                                                      <select
                                                        value={
                                                          entryQuantityUnit
                                                        }
                                                        onChange={(event) =>
                                                          updateEntry(
                                                            meal.id,
                                                            entry.id,
                                                            (current) => ({
                                                              ...current,
                                                              ...convertQuantityUnitForFood(
                                                                current,
                                                                getFoodLikeForEntry(
                                                                  current,
                                                                  foods,
                                                                ),
                                                                event.target
                                                                  .value as NutritionQuantityUnit,
                                                              ),
                                                            }),
                                                          )
                                                        }
                                                        disabled={
                                                          isCurrentPlanPublished
                                                        }
                                                        className="w-24 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                      >
                                                        {getQuantityUnitOptionsForFood(
                                                          entryFood,
                                                        ).map((option) => (
                                                          <option
                                                            key={option.value}
                                                            value={option.value}
                                                          >
                                                            {option.label}
                                                          </option>
                                                        ))}
                                                      </select>
                                                    </div>
                                                  </td>
                                                  <td className="px-3 py-2 text-right text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.caloriesKcal,
                                                      0,
                                                    )}
                                                  </td>
                                                  <td className="px-3 py-2 text-right text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.proteinG,
                                                    )}
                                                  </td>
                                                  <td className="px-3 py-2 text-right text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.carbsG,
                                                    )}
                                                  </td>
                                                  <td className="px-3 py-2 text-right text-brand-text">
                                                    {formatNumber(
                                                      entryTotals.fatG,
                                                    )}
                                                  </td>
                                                  <td className="px-3 py-2 text-right text-brand-muted">
                                                    {formatNumber(
                                                      entryTotals.sodiumMg,
                                                      0,
                                                    )}{" "}
                                                    mg
                                                  </td>
                                                  <td className="px-3 py-2 text-right text-brand-muted">
                                                    {formatNumber(
                                                      entryTotals.waterG,
                                                    )}{" "}
                                                    g
                                                  </td>
                                                  <td className="px-3 py-2">
                                                    <input
                                                      value={entry.customText}
                                                      onChange={(event) =>
                                                        updateEntry(
                                                          meal.id,
                                                          entry.id,
                                                          (current) => ({
                                                            ...current,
                                                            customText:
                                                              event.target
                                                                .value,
                                                          }),
                                                        )
                                                      }
                                                      placeholder={
                                                        entry.foodName
                                                      }
                                                      disabled={
                                                        isCurrentPlanPublished
                                                      }
                                                      className="w-full rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                    />
                                                  </td>
                                                  <td className="px-3 py-2">
                                                    <button
                                                      type="button"
                                                      onClick={() =>
                                                        removeEntry(
                                                          meal.id,
                                                          entry.id,
                                                        )
                                                      }
                                                      disabled={
                                                        isCurrentPlanPublished
                                                      }
                                                      className="inline-flex aspect-square h-8 w-8 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                                      aria-label={`Eliminar ${entry.foodName}`}
                                                      title="Eliminar"
                                                    >
                                                      <Trash2 className="h-3.5 w-3.5" />
                                                    </button>
                                                  </td>
                                                </tr>
                                                {alternatives.length ||
                                                hasAlternativeSearch ? (
                                                  <tr className="border-t border-white/10 bg-black/20">
                                                    <td
                                                      colSpan={10}
                                                      className="px-3 py-3"
                                                    >
                                                      <div className="space-y-2 border-l-2 border-brand-accent/40 pl-3">
                                                        {alternatives.map(
                                                          (alternative) => {
                                                            const alternativeTotals =
                                                              calculateEntryTotals(
                                                                alternative,
                                                              );
                                                            const alternativeCatalogFood =
                                                              foods.find(
                                                                (food) =>
                                                                  food.id ===
                                                                  alternative.foodId,
                                                              );
                                                            const alternativeFood =
                                                              getFoodLikeForEntry(
                                                                alternative,
                                                                foods,
                                                              );
                                                            const alternativeQuantityUnit =
                                                              normalizeQuantityUnitForFood(
                                                                alternativeFood,
                                                                normalizeQuantityUnit(
                                                                  alternative.quantityUnit,
                                                                ),
                                                              );
                                                            const alternativeConflict =
                                                              alternativeCatalogFood
                                                                ? getRestrictionConflict(
                                                                    alternativeCatalogFood,
                                                                    selectedAthleteRestrictions,
                                                                  )
                                                                : null;
                                                            return (
                                                              <div
                                                                key={
                                                                  alternative.id
                                                                }
                                                                className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 lg:flex-row lg:items-center"
                                                              >
                                                                <div className="min-w-0 flex-1">
                                                                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-brand-accent">
                                                                    Alternativa
                                                                  </p>
                                                                  <div className="mt-0.5 flex items-center gap-2">
                                                                    <span
                                                                      className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                                                        alternativeConflict
                                                                          ? "border-red-300/40 bg-red-500/10 text-red-100"
                                                                          : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                                                      }`}
                                                                      title={
                                                                        alternativeConflict
                                                                          ? `${getRestrictionTypeLabel(alternativeConflict.type)}: ${formatRestrictionLabel(alternativeConflict)}`
                                                                          : "Compatible"
                                                                      }
                                                                    >
                                                                      {alternativeConflict ? (
                                                                        <ThumbsDown className="h-3.5 w-3.5" />
                                                                      ) : (
                                                                        <ThumbsUp className="h-3.5 w-3.5" />
                                                                      )}
                                                                    </span>
                                                                    <p className="min-w-0 break-words text-sm font-semibold text-brand-text">
                                                                      {
                                                                        alternative.foodName
                                                                      }
                                                                    </p>
                                                                  </div>
                                                                </div>
                                                                <label className="w-full text-[10px] font-semibold uppercase tracking-[0.12em] text-brand-muted lg:w-52">
                                                                  Cantidad
                                                                  <div className="mt-1 flex gap-1">
                                                                    <input
                                                                      type="text"
                                                                      inputMode="numeric"
                                                                      pattern="[0-9]*"
                                                                      value={getIntegerInputValue(
                                                                        `${alternative.id}:quantityG`,
                                                                        alternative.quantityG,
                                                                        1,
                                                                        10000,
                                                                      )}
                                                                      onChange={(
                                                                        event,
                                                                      ) =>
                                                                        handleIntegerInputChange(
                                                                          `${alternative.id}:quantityG`,
                                                                          event
                                                                            .target
                                                                            .value,
                                                                          1,
                                                                          10000,
                                                                          (
                                                                            value,
                                                                          ) =>
                                                                            updateAlternative(
                                                                              meal.id,
                                                                              entry.id,
                                                                              alternative.id,
                                                                              (
                                                                                current,
                                                                              ) => ({
                                                                                ...current,
                                                                                quantityG:
                                                                                  value,
                                                                              }),
                                                                            ),
                                                                        )
                                                                      }
                                                                      onBlur={() =>
                                                                        clearIntegerInputDraft(
                                                                          `${alternative.id}:quantityG`,
                                                                        )
                                                                      }
                                                                      disabled={
                                                                        isCurrentPlanPublished
                                                                      }
                                                                      className="w-20 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-right text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                                    />
                                                                    <select
                                                                      value={
                                                                        alternativeQuantityUnit
                                                                      }
                                                                      onChange={(
                                                                        event,
                                                                      ) =>
                                                                        updateAlternative(
                                                                          meal.id,
                                                                          entry.id,
                                                                          alternative.id,
                                                                          (
                                                                            current,
                                                                          ) => ({
                                                                            ...current,
                                                                            ...convertQuantityUnitForFood(
                                                                              current,
                                                                              getFoodLikeForEntry(
                                                                                current,
                                                                                foods,
                                                                              ),
                                                                              event
                                                                                .target
                                                                                .value as NutritionQuantityUnit,
                                                                            ),
                                                                          }),
                                                                        )
                                                                      }
                                                                      disabled={
                                                                        isCurrentPlanPublished
                                                                      }
                                                                      className="w-24 rounded-lg border border-white/10 bg-black/20 px-2 py-1.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                                    >
                                                                      {getQuantityUnitOptionsForFood(
                                                                        alternativeFood,
                                                                      ).map(
                                                                        (
                                                                          option,
                                                                        ) => (
                                                                          <option
                                                                            key={
                                                                              option.value
                                                                            }
                                                                            value={
                                                                              option.value
                                                                            }
                                                                          >
                                                                            {
                                                                              option.label
                                                                            }
                                                                          </option>
                                                                        ),
                                                                      )}
                                                                    </select>
                                                                  </div>
                                                                </label>
                                                                <div className="grid flex-[1.8] grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                                                                  <span className="rounded-md bg-black/20 px-2 py-1 text-right text-brand-text">
                                                                    {formatNumber(
                                                                      alternativeTotals.caloriesKcal,
                                                                      0,
                                                                    )}{" "}
                                                                    kcal
                                                                  </span>
                                                                  <span className="rounded-md bg-black/20 px-2 py-1 text-right text-brand-text">
                                                                    P{" "}
                                                                    {formatNumber(
                                                                      alternativeTotals.proteinG,
                                                                    )}
                                                                  </span>
                                                                  <span className="rounded-md bg-black/20 px-2 py-1 text-right text-brand-text">
                                                                    C{" "}
                                                                    {formatNumber(
                                                                      alternativeTotals.carbsG,
                                                                    )}
                                                                  </span>
                                                                  <span className="rounded-md bg-black/20 px-2 py-1 text-right text-brand-text">
                                                                    G{" "}
                                                                    {formatNumber(
                                                                      alternativeTotals.fatG,
                                                                    )}
                                                                  </span>
                                                                  <span className="rounded-md bg-black/20 px-2 py-1 text-right text-brand-muted">
                                                                    {formatNumber(
                                                                      alternativeTotals.sodiumMg,
                                                                      0,
                                                                    )}{" "}
                                                                    mg
                                                                  </span>
                                                                  <span className="rounded-md bg-black/20 px-2 py-1 text-right text-brand-muted">
                                                                    {formatNumber(
                                                                      alternativeTotals.waterG,
                                                                    )}{" "}
                                                                    g
                                                                  </span>
                                                                </div>
                                                                <button
                                                                  type="button"
                                                                  onClick={() =>
                                                                    removeAlternative(
                                                                      meal.id,
                                                                      entry.id,
                                                                      alternative.id,
                                                                    )
                                                                  }
                                                                  disabled={
                                                                    isCurrentPlanPublished
                                                                  }
                                                                  className="inline-flex aspect-square h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-red-400/35 bg-red-500/10 text-red-100 transition hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                                                                  aria-label={`Eliminar alternativa ${alternative.foodName}`}
                                                                  title="Eliminar alternativa"
                                                                >
                                                                  <Trash2 className="h-3.5 w-3.5" />
                                                                </button>
                                                              </div>
                                                            );
                                                          },
                                                        )}

                                                        {hasAlternativeSearch ? (
                                                          <div className="rounded-lg border border-brand-accent/25 bg-brand-accent/10 p-3">
                                                            <div className="flex items-center gap-2">
                                                              <div className="relative flex-1">
                                                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand-muted" />
                                                                <input
                                                                  value={
                                                                    alternativeSearch
                                                                  }
                                                                  onChange={(
                                                                    event,
                                                                  ) =>
                                                                    setAlternativeSearches(
                                                                      (
                                                                        current,
                                                                      ) => ({
                                                                        ...current,
                                                                        [entry.id]:
                                                                          event
                                                                            .target
                                                                            .value,
                                                                      }),
                                                                    )
                                                                  }
                                                                  placeholder="Buscar alimento alternativo"
                                                                  disabled={
                                                                    isCurrentPlanPublished
                                                                  }
                                                                  className="w-full rounded-lg border border-white/10 bg-black/25 py-2 pl-9 pr-3 text-sm text-brand-text outline-none transition focus:border-brand-accent/60 disabled:cursor-not-allowed disabled:opacity-60"
                                                                />
                                                              </div>
                                                              <button
                                                                type="button"
                                                                onClick={() =>
                                                                  closeAlternativeSearch(
                                                                    entry.id,
                                                                  )
                                                                }
                                                                className="inline-flex aspect-square h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/15 text-brand-text transition hover:bg-white/10"
                                                                aria-label="Cerrar buscador de alternativas"
                                                                title="Cerrar"
                                                              >
                                                                <X className="h-4 w-4" />
                                                              </button>
                                                            </div>
                                                            {alternativeResults.length ? (
                                                              <div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-black/80 p-1 shadow-xl">
                                                                {alternativeResults.map(
                                                                  (food) => {
                                                                    const foodCaloriesPer100g =
                                                                      calculateFoodCaloriesPer100g(
                                                                        food,
                                                                      );
                                                                    const conflict =
                                                                      getRestrictionConflict(
                                                                        food,
                                                                        selectedAthleteRestrictions,
                                                                      );
                                                                    const quantityUnit =
                                                                      getDefaultQuantityUnitForFood(
                                                                        food,
                                                                      );
                                                                    const unitWeightG =
                                                                      getDefaultUnitWeightGForFood(
                                                                        food,
                                                                        quantityUnit,
                                                                      );
                                                                    const caloriesPerUnit =
                                                                      foodCaloriesPer100g *
                                                                      (unitWeightG /
                                                                        100);
                                                                    const suggestedQuantity =
                                                                      quantityUnit ===
                                                                      "g"
                                                                        ? entryTotals.caloriesKcal >
                                                                            0 &&
                                                                          foodCaloriesPer100g >
                                                                            0
                                                                          ? normalizeQuantityG(
                                                                              (entryTotals.caloriesKcal /
                                                                                foodCaloriesPer100g) *
                                                                                100,
                                                                            )
                                                                          : normalizeQuantityG(
                                                                              getEffectiveQuantityG(
                                                                                entry,
                                                                              ),
                                                                            )
                                                                        : entryTotals.caloriesKcal >
                                                                              0 &&
                                                                            caloriesPerUnit >
                                                                              0
                                                                          ? normalizeQuantityG(
                                                                              entryTotals.caloriesKcal /
                                                                                caloriesPerUnit,
                                                                            )
                                                                          : 1;

                                                                    return (
                                                                      <button
                                                                        key={
                                                                          food.id
                                                                        }
                                                                        type="button"
                                                                        onClick={() =>
                                                                          addAlternativeToEntry(
                                                                            meal.id,
                                                                            entry.id,
                                                                            food,
                                                                          )
                                                                        }
                                                                        disabled={
                                                                          isCurrentPlanPublished
                                                                        }
                                                                        className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm text-brand-text transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
                                                                      >
                                                                        <span className="flex min-w-0 items-center gap-2">
                                                                          <span
                                                                            className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${
                                                                              conflict
                                                                                ? "border-red-300/40 bg-red-500/10 text-red-100"
                                                                                : "border-emerald-300/40 bg-emerald-500/10 text-emerald-100"
                                                                            }`}
                                                                            title={
                                                                              conflict
                                                                                ? `${getRestrictionTypeLabel(conflict.type)}: ${formatRestrictionLabel(conflict)}`
                                                                                : "Compatible"
                                                                            }
                                                                          >
                                                                            {conflict ? (
                                                                              <ThumbsDown className="h-3.5 w-3.5" />
                                                                            ) : (
                                                                              <ThumbsUp className="h-3.5 w-3.5" />
                                                                            )}
                                                                          </span>
                                                                          <span className="min-w-0 truncate">
                                                                            {
                                                                              food.name
                                                                            }
                                                                          </span>
                                                                        </span>
                                                                        <span className="shrink-0 text-xs text-brand-muted">
                                                                          {formatDisplayQuantity(
                                                                            {
                                                                              quantityG:
                                                                                suggestedQuantity,
                                                                              quantityUnit,
                                                                              unitWeightG,
                                                                            },
                                                                          )}{" "}
                                                                          -{" "}
                                                                          {formatNumber(
                                                                            foodCaloriesPer100g,
                                                                            0,
                                                                          )}{" "}
                                                                          kcal/100g
                                                                        </span>
                                                                      </button>
                                                                    );
                                                                  },
                                                                )}
                                                              </div>
                                                            ) : alternativeQuery ? (
                                                              <p className="mt-2 text-xs text-brand-muted">
                                                                Sin resultados.
                                                              </p>
                                                            ) : null}
                                                          </div>
                                                        ) : null}
                                                      </div>
                                                    </td>
                                                  </tr>
                                                ) : null}
                                              </Fragment>
                                            );
                                          })}
                                          {!entries.length ? (
                                            <tr>
                                              <td
                                                colSpan={10}
                                                className="px-3 py-6 text-center text-sm text-brand-muted"
                                              >
                                                Sin alimentos.
                                              </td>
                                            </tr>
                                          ) : null}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                );
                              },
                            )}
                          </div>
                        </article>
                      );
                    })}

                    <button
                      type="button"
                      onClick={addMeal}
                      disabled={isCurrentPlanPublished}
                      className="inline-flex w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-brand-accent/45 bg-brand-accent/10 px-4 py-4 text-sm font-semibold text-brand-text transition hover:bg-brand-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Plus className="h-4 w-4" />
                      Anadir comida
                    </button>
                  </div>
                </>
              )}
            </div>
          </section>
        )}

        {quickFoodMealId ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
            <div className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-white/10 bg-[#111114] p-4 shadow-glow sm:p-5">
              <div className="flex items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-brand-text">
                  Nuevo alimento
                </h2>
                <button
                  type="button"
                  onClick={() => {
                    setQuickFoodMealId(null);
                    setQuickFoodOptionNumber(1);
                    setFoodForm(EMPTY_FOOD_FORM);
                  }}
                  className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-brand-text transition hover:bg-white/10"
                >
                  Cerrar
                </button>
              </div>
              <div className="mt-4 space-y-3">
                <label className="block text-sm text-brand-muted">
                  Nombre
                  <input
                    value={foodForm.name}
                    onChange={(event) =>
                      setFoodForm((current) => ({
                        ...current,
                        name: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <label className="block text-sm text-brand-muted">
                  Categoria
                  <input
                    value={foodForm.category}
                    onChange={(event) =>
                      setFoodForm((current) => ({
                        ...current,
                        category: event.target.value,
                      }))
                    }
                    className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                  />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["proteinPer100g", "Proteinas"],
                    ["carbsPer100g", "Carbos"],
                    ["fatPer100g", "Grasas"],
                    ["sodiumPer100g", "Sodio"],
                    ["waterPer100g", "Agua"],
                  ].map(([key, label]) => (
                    <label key={key} className="block text-sm text-brand-muted">
                      {label}
                      <input
                        type="number"
                        min="0"
                        step="0.1"
                        value={foodForm[key as NutritionInputFieldKey]}
                        onChange={(event) =>
                          setFoodForm((current) => ({
                            ...current,
                            [key]: event.target.value,
                          }))
                        }
                        className="mt-2 w-full rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 text-sm text-brand-text outline-none transition focus:border-brand-accent/60"
                      />
                    </label>
                  ))}
                </div>
                <FoodRestrictionTagPicker
                  value={foodForm.restrictionTags}
                  onToggle={toggleFoodRestrictionTag}
                />
                <BrandButton
                  onClick={() =>
                    void submitFoodForm({
                      mealId: quickFoodMealId,
                      optionNumber: quickFoodOptionNumber,
                    })
                  }
                  disabled={foodSubmitting}
                  className="w-full"
                >
                  <Check className="mr-2 h-4 w-4" />
                  {foodSubmitting ? "Guardando..." : "Guardar y anadir"}
                </BrandButton>
              </div>
            </div>
          </div>
        ) : null}

        {previewOpen && previewUrl ? (
          <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/75 p-3">
            <div className="flex h-[92dvh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#111114] shadow-glow">
              <div className="flex flex-col gap-3 border-b border-white/10 p-4 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-[0.18em] text-brand-muted">
                    Previsualizacion PDF
                  </p>
                  <h2 className="truncate text-lg font-semibold text-brand-text">
                    {plan?.name ?? "Plan"}
                  </h2>
                </div>
                <div className="grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap">
                  <a
                    href={previewUrl}
                    download={`${plan?.name ?? "plan-nutricional"}.pdf`}
                    className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-semibold text-brand-text transition hover:border-brand-accent/50 hover:bg-brand-accent/10 sm:w-auto"
                  >
                    <Download className="h-4 w-4" />
                    Descargar PDF
                  </a>
                  <BrandButton
                    onClick={publishPlan}
                    disabled={publishing || planMode === "published"}
                    className="w-full whitespace-normal sm:w-auto"
                  >
                    {publishing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Check className="mr-2 h-4 w-4" />
                    )}
                    Confirmar / Publicar
                  </BrandButton>
                  <BrandButton
                    variant="ghost"
                    onClick={() => setPreviewOpen(false)}
                    className="w-full sm:w-auto"
                  >
                    Volver
                  </BrandButton>
                </div>
              </div>
              <iframe
                title="Previsualizacion PDF"
                src={previewUrl}
                className="min-h-0 flex-1 bg-white"
              />
            </div>
          </div>
        ) : null}
      </div>
    </MotionPage>
  );
}
