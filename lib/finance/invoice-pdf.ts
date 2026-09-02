import fs from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import {
  calculateInvoiceLineBaseCents,
  formatCents,
  roundToCents
} from "@/lib/finance/calculations";
import type { FinanceInvoice } from "@/lib/finance/types";

const COLORS = {
  text: "#111827",
  muted: "#6B7280",
  line: "#E5E7EB",
  panel: "#F8FAFC",
  accent: "#FACC15",
  accentDark: "#171717",
  danger: "#DC2626",
  white: "#FFFFFF"
};

let cachedLogoBuffer: Buffer | null | undefined;

function formatDate(value: string): string {
  if (!value) return "-";
  const parsed = new Date(`${value}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString("es-ES", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  });
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("es-ES", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2
  }).format(value);
}

function formatRate(value: number): string {
  return `${formatNumber(value)}%`;
}

function safeText(value: string): string {
  return value.trim() || "-";
}

function getLogoBuffer(): Buffer | null {
  if (cachedLogoBuffer !== undefined) return cachedLogoBuffer;
  const logoPath = path.join(process.cwd(), "public", "logo-bueno.png");
  cachedLogoBuffer = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;
  return cachedLogoBuffer;
}

function drawLogo(doc: PDFKit.PDFDocument, x: number, y: number, size: number) {
  const logo = getLogoBuffer();
  if (!logo) return;
  try {
    doc.image(logo, x, y, { fit: [size, size] });
  } catch {
    doc.circle(x + size / 2, y + size / 2, size / 2 - 3).strokeColor(COLORS.accent).lineWidth(1).stroke();
  }
}

function drawAddressBlock(
  doc: PDFKit.PDFDocument,
  title: string,
  lines: string[],
  x: number,
  y: number,
  width: number
) {
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text(title, x, y, { width, characterSpacing: 1.1 });
  doc
    .fillColor(COLORS.text)
    .font("Helvetica-Bold")
    .fontSize(11)
    .text(safeText(lines[0] ?? ""), x, y + 17, { width });
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(8.5)
    .text(lines.slice(1).filter(Boolean).join("\n"), x, y + 34, { width, lineGap: 2 });
}

function drawMetaBox(doc: PDFKit.PDFDocument, invoice: FinanceInvoice, x: number, y: number, width: number) {
  const rows = [
    ["Numero", invoice.invoiceNumber],
    ["Fecha expedicion", formatDate(invoice.issueDate)],
    ["Fecha operacion", formatDate(invoice.operationDate)],
    ["Vencimiento", formatDate(invoice.dueDate)]
  ];
  const rowHeight = 22;

  doc.roundedRect(x, y, width, rows.length * rowHeight + 16, 6).fill(COLORS.panel);
  rows.forEach(([label, value], index) => {
    const rowY = y + 8 + index * rowHeight;
    doc
      .fillColor(COLORS.muted)
      .font("Helvetica-Bold")
      .fontSize(7.8)
      .text(label.toUpperCase(), x + 14, rowY + 1, { width: width / 2 - 12 });
    doc
      .fillColor(COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(9)
      .text(value, x + width / 2, rowY, { width: width / 2 - 14, align: "right" });
  });
}

function ensureSpace(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight <= doc.page.height - doc.page.margins.bottom - 64) return;
  doc.addPage();
  doc.y = doc.page.margins.top;
}

type TableColumn = {
  label: string;
  width: number;
  align?: "left" | "right";
};

function drawTableHeader(doc: PDFKit.PDFDocument, columns: TableColumn[], x: number, y: number) {
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  doc.roundedRect(x, y, tableWidth, 24, 5).fill(COLORS.accentDark);
  let cursorX = x;
  columns.forEach((column) => {
    doc
      .fillColor(COLORS.white)
      .font("Helvetica-Bold")
      .fontSize(7.4)
      .text(column.label, cursorX + 8, y + 8, {
        width: column.width - 16,
        align: column.align ?? "left",
        characterSpacing: 0.8,
        lineBreak: false
      });
    cursorX += column.width;
  });
}

function drawLineRow(
  doc: PDFKit.PDFDocument,
  columns: TableColumn[],
  values: string[],
  x: number,
  y: number,
  height: number,
  shaded: boolean
) {
  const tableWidth = columns.reduce((sum, column) => sum + column.width, 0);
  doc.rect(x, y, tableWidth, height).fill(shaded ? COLORS.panel : COLORS.white);
  let cursorX = x;
  columns.forEach((column, index) => {
    doc
      .fillColor(index === 0 ? COLORS.text : COLORS.muted)
      .font(index === 0 ? "Helvetica-Bold" : "Helvetica")
      .fontSize(8.2)
      .text(values[index] ?? "", cursorX + 8, y + 8, {
        width: column.width - 16,
        height: height - 12,
        align: column.align ?? "left",
        lineGap: 2
      });
    cursorX += column.width;
  });
  doc.moveTo(x, y + height).lineTo(x + tableWidth, y + height).strokeColor(COLORS.line).lineWidth(0.8).stroke();
}

function drawInvoiceLines(doc: PDFKit.PDFDocument, invoice: FinanceInvoice, x: number, y: number, width: number) {
  const columns: TableColumn[] = [
    { label: "CONCEPTO", width: 250 },
    { label: "CANT.", width: 42, align: "right" },
    { label: "PRECIO", width: 70, align: "right" },
    { label: "DTO.", width: 42, align: "right" },
    { label: "IVA", width: 38, align: "right" },
    { label: "BASE", width: width - 442, align: "right" }
  ];

  ensureSpace(doc, 56);
  drawTableHeader(doc, columns, x, y);
  doc.y = y + 24;

  invoice.lineItems.forEach((line, index) => {
    const lineBase = calculateInvoiceLineBaseCents(line);
    const descriptionHeight = doc.heightOfString(line.description, {
      width: columns[0].width - 16,
      lineGap: 2
    });
    const rowHeight = Math.max(32, descriptionHeight + 18);
    ensureSpace(doc, rowHeight + 6);
    const rowY = doc.y;
    drawLineRow(
      doc,
      columns,
      [
        line.description,
        formatNumber(line.quantity),
        formatCents(line.unitPriceCents, invoice.currency),
        formatRate(line.discountPercent),
        formatRate(line.vatRate),
        formatCents(lineBase.taxableBaseCents, invoice.currency)
      ],
      x,
      rowY,
      rowHeight,
      index % 2 === 1
    );
    doc.y = rowY + rowHeight;
  });
}

function buildVatBreakdown(invoice: FinanceInvoice): Array<{ rate: number; baseCents: number; vatCents: number }> {
  const map = new Map<number, { rate: number; baseCents: number; vatCents: number }>();
  invoice.lineItems.forEach((line) => {
    const base = calculateInvoiceLineBaseCents(line).taxableBaseCents;
    const current = map.get(line.vatRate) ?? { rate: line.vatRate, baseCents: 0, vatCents: 0 };
    current.baseCents += base;
    current.vatCents += roundToCents(base * (line.vatRate / 100));
    map.set(line.vatRate, current);
  });
  return Array.from(map.values()).sort((a, b) => a.rate - b.rate);
}

function drawTotals(doc: PDFKit.PDFDocument, invoice: FinanceInvoice, x: number, y: number, width: number) {
  const rows: Array<{ label: string; value: string; strong?: boolean; danger?: boolean }> = [
    { label: "Subtotal", value: formatCents(invoice.totals.subtotalCents, invoice.currency) }
  ];
  if (invoice.totals.discountCents > 0) {
    rows.push({
      label: "Descuentos",
      value: `-${formatCents(invoice.totals.discountCents, invoice.currency)}`
    });
  }
  rows.push({
    label: "Base imponible",
    value: formatCents(invoice.totals.taxableBaseCents, invoice.currency)
  });
  buildVatBreakdown(invoice).forEach((item) => {
    rows.push({
      label: `IVA ${formatRate(item.rate)}`,
      value: formatCents(item.vatCents, invoice.currency)
    });
  });
  if (invoice.totals.irpfCents > 0) {
    rows.push({
      label: `Retencion IRPF ${formatRate(invoice.irpfRate)}`,
      value: `-${formatCents(invoice.totals.irpfCents, invoice.currency)}`
    });
  }
  rows.push({
    label: "TOTAL",
    value: formatCents(invoice.totals.totalCents, invoice.currency),
    strong: true
  });

  const panelHeight = rows.length * 23 + 18;
  ensureSpace(doc, panelHeight + 24);
  doc.roundedRect(x, y, width, panelHeight, 6).fill(COLORS.panel);
  rows.forEach((row, index) => {
    const rowY = y + 10 + index * 23;
    doc
      .fillColor(row.strong ? COLORS.text : COLORS.muted)
      .font(row.strong ? "Helvetica-Bold" : "Helvetica")
      .fontSize(row.strong ? 12 : 9)
      .text(row.label, x + 16, rowY + (row.strong ? 0 : 2), { width: width / 2 });
    doc
      .fillColor(row.danger ? COLORS.danger : COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(row.strong ? 13 : 9)
      .text(row.value, x + width / 2, rowY, { width: width / 2 - 16, align: "right" });
  });
  doc.y = y + panelHeight;
}

function drawPaymentAndNotes(doc: PDFKit.PDFDocument, invoice: FinanceInvoice, x: number, y: number, width: number) {
  const lines = [
    invoice.paymentMethod ? `Metodo de pago: ${invoice.paymentMethod}` : "",
    invoice.issuer.bankIban ? `IBAN: ${invoice.issuer.bankIban}` : "",
    invoice.notes ? `Notas: ${invoice.notes}` : "",
    invoice.issuer.notes ? invoice.issuer.notes : ""
  ].filter(Boolean);

  if (!lines.length) return;
  const text = lines.join("\n");
  const textHeight = doc.heightOfString(text, { width: width - 28, lineGap: 3 });
  ensureSpace(doc, textHeight + 44);
  doc.roundedRect(x, y, width, textHeight + 32, 6).fill(COLORS.white).stroke(COLORS.line);
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica-Bold")
    .fontSize(8)
    .text("PAGO Y OBSERVACIONES", x + 14, y + 12, { width: width - 28, characterSpacing: 1.1 });
  doc
    .fillColor(COLORS.text)
    .font("Helvetica")
    .fontSize(9)
    .text(text, x + 14, y + 28, { width: width - 28, lineGap: 3 });
}

function drawFooter(doc: PDFKit.PDFDocument, invoice: FinanceInvoice) {
  const left = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const y = doc.page.height - doc.page.margins.bottom - 26;
  doc
    .moveTo(left, y)
    .lineTo(left + width, y)
    .strokeColor(COLORS.line)
    .lineWidth(0.8)
    .stroke();
  doc
    .fillColor(COLORS.muted)
    .font("Helvetica")
    .fontSize(7.6)
    .text(`${invoice.invoiceNumber} - ${invoice.issuer.businessName || "Factura"}`, left, y + 9, {
      width,
      align: "center"
    });
}

export async function renderFinanceInvoicePdf(invoice: FinanceInvoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 44,
      bufferPages: true,
      info: {
        Title: `Factura ${invoice.invoiceNumber}`,
        Author: invoice.issuer.businessName || "Finanzas"
      }
    });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    drawLogo(doc, left, 42, 62);
    doc
      .fillColor(COLORS.text)
      .font("Helvetica-Bold")
      .fontSize(28)
      .text("FACTURA", left + 78, 52, { width: 220 });
    if (invoice.status === "cancelled") {
      doc
        .fillColor(COLORS.danger)
        .font("Helvetica-Bold")
        .fontSize(10)
        .text("CANCELADA", left + 78, 87, { width: 220, characterSpacing: 1.6 });
    }
    drawMetaBox(doc, invoice, left + width - 210, 44, 210);

    const issuerLines = [
      invoice.issuer.businessName,
      `NIF: ${safeText(invoice.issuer.taxId)}`,
      invoice.issuer.address,
      [invoice.issuer.postalCode, invoice.issuer.city, invoice.issuer.province].filter(Boolean).join(" "),
      invoice.issuer.country,
      [invoice.issuer.email, invoice.issuer.phone].filter(Boolean).join(" | "),
      invoice.issuer.website
    ];
    const clientLines = [
      invoice.client.name,
      `NIF: ${safeText(invoice.client.taxId)}`,
      invoice.client.address,
      [invoice.client.postalCode, invoice.client.city, invoice.client.province].filter(Boolean).join(" "),
      invoice.client.country,
      invoice.client.email
    ];

    drawAddressBlock(doc, "EMISOR", issuerLines, left, 154, 235);
    drawAddressBlock(doc, "CLIENTE", clientLines, left + width - 235, 154, 235);

    doc.y = 276;
    drawInvoiceLines(doc, invoice, left, doc.y, width);
    doc.y += 24;
    drawTotals(doc, invoice, left + width - 238, doc.y, 238);
    doc.y += 18;
    drawPaymentAndNotes(doc, invoice, left, doc.y, width);

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      drawFooter(doc, invoice);
    }

    doc.end();
  });
}
