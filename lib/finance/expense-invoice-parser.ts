import { PDFParse } from "pdf-parse";
import { isIsoDate, parseCurrencyToCents, toIsoDate } from "@/lib/finance/calculations";

export type ParsedExpenseInvoicePdf = {
  date: string | null;
  amountCents: number | null;
  supplier: string;
  category: string;
  textPreview: string;
};

const CATEGORY_HINTS: Array<{ category: string; terms: string[] }> = [
  {
    category: "Suministros",
    terms: ["electricidad", "luz", "agua", "gas", "endesa", "iberdrola", "naturgy"]
  },
  {
    category: "Alquiler",
    terms: ["alquiler", "arrendamiento", "renta local", "renta mensual"]
  },
  {
    category: "Comunicaciones",
    terms: ["internet", "telefono", "movistar", "vodafone", "orange", "o2", "fibra"]
  },
  {
    category: "Software",
    terms: ["software", "suscripcion", "licencia", "hosting", "dominio", "vercel", "google workspace"]
  },
  {
    category: "Material",
    terms: ["material", "equipamiento", "papeleria", "impresora", "toner"]
  },
  {
    category: "Transporte",
    terms: ["combustible", "gasolina", "diesel", "parking", "peaje", "taxi", "uber", "cabify"]
  },
  {
    category: "Servicios profesionales",
    terms: ["asesoria", "gestoria", "abogado", "consultoria", "profesional"]
  }
];

function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function compactText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function compactLetters(value: string): string {
  return normalizeText(value).replace(/[^a-z0-9]/g, "");
}

function parseDateToken(token: string): string | null {
  const normalized = token.replace(/[.]/g, "/").replace(/-/g, "/");
  const isoMatch = normalized.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  const euMatch = normalized.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);

  const year = isoMatch ? Number(isoMatch[1]) : euMatch ? Number(euMatch[3]) : NaN;
  const month = isoMatch ? Number(isoMatch[2]) : euMatch ? Number(euMatch[2]) : NaN;
  const day = isoMatch ? Number(isoMatch[3]) : euMatch ? Number(euMatch[1]) : NaN;
  const fullYear = year < 100 ? 2000 + year : year;

  if (!Number.isFinite(fullYear) || !Number.isFinite(month) || !Number.isFinite(day)) return null;
  if (fullYear < 2000 || fullYear > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }

  const parsed = new Date(Date.UTC(fullYear, month - 1, day));
  const iso = toIsoDate(parsed);
  return isIsoDate(iso) ? iso : null;
}

function extractWindow(value: string, start: number, end: number, before = 48, after = 24): string {
  return value.slice(Math.max(0, start - before), Math.min(value.length, end + after));
}

function findInvoiceDate(lines: string[]): string | null {
  const dateRegex = /\b(?:\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}|\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2})\b/g;
  const candidates: Array<{ date: string; score: number; index: number }> = [];

  lines.forEach((line, index) => {
    const normalized = normalizeText(line);
    for (const match of line.matchAll(dateRegex)) {
      const token = match[0];
      const date = parseDateToken(token);
      if (!date) continue;

      const matchIndex = match.index ?? 0;
      const near = normalizeText(extractWindow(line, matchIndex, matchIndex + token.length, 42, 16));
      let score = 0;
      if (near.includes("fecha de operacion") || near.includes("fecha operacion")) score += 70;
      else if (near.includes("operacion")) score += 55;
      if (near.includes("fecha")) score += 15;
      if (near.includes("factura")) score += 8;
      if (near.includes("expedicion") || near.includes("emision")) score += 6;
      if (near.includes("vencimiento")) score -= 55;
      if (near.includes("caducidad")) score -= 55;
      if (!score && normalized.includes("fecha")) score += 8;
      score -= Math.min(index, 30) * 0.05;
      candidates.push({ date, score, index });
    }
  });

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates[0]?.date ?? null;
}

function findInvoiceAmountCents(lines: string[]): number | null {
  const amountRegex = /-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:[.,]\d{2})/g;
  const labeledTotalRegex =
    /(?:^|[^a-zA-Z])(?:total(?:\s+(?:factura|a\s+pagar))?|importe\s+total)\b[^\d-]{0,40}(-?\d{1,3}(?:[.\s]\d{3})*(?:,\d{2})|-?\d+(?:[.,]\d{2}))/gi;
  const candidates: Array<{ cents: number; score: number; index: number }> = [];

  lines.forEach((line, index) => {
    const normalized = normalizeText(line);

    for (const match of line.matchAll(labeledTotalRegex)) {
      const token = match[1] ?? "";
      const cents = parseCurrencyToCents(token);
      if (cents === null || cents <= 0 || cents > 100_000_000) continue;

      const matchIndex = match.index ?? 0;
      const near = normalizeText(extractWindow(line, matchIndex, matchIndex + match[0].length, 10, 10));
      let score = 95;
      if (near.includes("total factura")) score += 10;
      if (near.includes("total a pagar")) score += 10;
      if (near.includes("importe total")) score += 8;
      if (/[\u20ac]|eur/i.test(near)) score += 5;
      candidates.push({ cents, score: score + index * 0.01, index });
    }

    for (const match of line.matchAll(amountRegex)) {
      const token = match[0];
      const cents = parseCurrencyToCents(token);
      if (cents === null || cents <= 0 || cents > 100_000_000) continue;

      const matchIndex = match.index ?? 0;
      const near = normalizeText(extractWindow(line, matchIndex, matchIndex + token.length, 52, 18));
      let score = 0;
      if (near.includes("total factura")) score += 50;
      if (near.includes("total a pagar")) score += 48;
      if (near.includes("importe total")) score += 45;
      if (near.includes("total")) score += 34;
      if (/[\u20ac]|eur/i.test(extractWindow(line, matchIndex, matchIndex + token.length, 2, 8))) {
        score += 10;
      }
      if (near.includes("subtotal")) score -= 30;
      if (near.includes("base imponible")) score -= 25;
      if (near.includes("iva")) score -= 18;
      if (near.includes("irpf") || near.includes("retencion")) score -= 18;
      if (!score && /[\u20ac]|eur/i.test(line)) score += 4;
      if (normalized.includes("total") && score < 10) score += 4;
      score += Math.min(index, 80) * 0.02;
      candidates.push({ cents, score, index });
    }
  });

  candidates.sort((a, b) => b.score - a.score || b.cents - a.cents || b.index - a.index);
  if (candidates[0] && candidates[0].score > 0) return candidates[0].cents;

  const euroAmounts = candidates.filter((candidate) => candidate.score >= 8);
  if (euroAmounts.length) return Math.max(...euroAmounts.map((candidate) => candidate.cents));
  return null;
}

function findSupplier(lines: string[], fallbackName: string): string {
  const blockedTerms = [
    "factura",
    "invoice",
    "fecha",
    "numero",
    "nif",
    "cif",
    "dni",
    "cliente",
    "direccion",
    "telefono",
    "email",
    "www",
    "http",
    "total",
    "base",
    "iva",
    "iban",
    "vencimiento",
    "operacion",
    "expedicion",
    "pago"
  ];

  const isCandidate = (line: string): boolean => {
    const normalized = normalizeText(line);
    const letters = compactLetters(line);
    return (
      /[a-zA-Z]/.test(line) &&
      line.length >= 3 &&
      line.length <= 90 &&
      !/^--\s*\d+/.test(line) &&
      !["emisor", "cliente", "concepto", "cantpreciodtoivabase"].includes(letters) &&
      !blockedTerms.some((term) => normalized.includes(term))
    );
  };

  const issuerIndex = lines.findIndex((line) => compactLetters(line) === "emisor");
  if (issuerIndex >= 0) {
    const issuerCandidate = lines
      .slice(issuerIndex + 1, issuerIndex + 8)
      .map((line) => compactText(line))
      .find(isCandidate);
    if (issuerCandidate) return issuerCandidate;
  }

  const inlineIssuer = lines
    .slice(0, 20)
    .map((line) => line.match(/e\s*m\s*i\s*s\s*o\s*r\s+(.+?)(?:\s+nif\b|\s+cif\b|$)/i)?.[1] ?? "")
    .map((line) => compactText(line))
    .find(isCandidate);
  if (inlineIssuer) return inlineIssuer;

  const candidate = lines
    .slice(0, 20)
    .map((line) => compactText(line))
    .find(isCandidate);

  return candidate ?? fallbackName.replace(/\.pdf$/i, "").replace(/[_-]+/g, " ").trim();
}

function inferCategory(text: string): string {
  const normalized = normalizeText(text);
  const match = CATEGORY_HINTS.find((item) =>
    item.terms.some((term) => normalized.includes(term))
  );
  return match?.category ?? "Factura recibida";
}

export async function parseExpenseInvoicePdf(
  buffer: Buffer,
  fileName: string
): Promise<ParsedExpenseInvoicePdf> {
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    const rawText = result.text ?? "";
    const lines = rawText
      .split(/\r?\n/)
      .map((line) => compactText(line))
      .filter(Boolean);
    const text = lines.join("\n");

    return {
      date: findInvoiceDate(lines),
      amountCents: findInvoiceAmountCents(lines),
      supplier: findSupplier(lines, fileName),
      category: inferCategory(text),
      textPreview: compactText(text).slice(0, 1500)
    };
  } finally {
    await parser.destroy();
  }
}
