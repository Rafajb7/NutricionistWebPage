export const MENU_PAGE = { size: [960, 540] as [number, number], layout: "portrait" as const,
  margins: { top: 32, left: 34, right: 34, bottom: 36 } };

export function wrapPdfText(doc: PDFKit.PDFDocument, value: string, width: number, size: number, bold = false): string[] {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
  const lines: string[] = [];
  for (const paragraph of value.split(/\r?\n/)) {
    let line = "";
    for (const word of paragraph.trim().split(/\s+/).filter(Boolean)) {
      if (doc.widthOfString(line ? `${line} ${word}` : word) <= width) {
        line = line ? `${line} ${word}` : word;
        continue;
      }
      if (line) lines.push(line);
      line = "";
      for (const character of word) {
        if (line && doc.widthOfString(line + character) > width) { lines.push(line); line = ""; }
        line += character;
      }
    }
    lines.push(line);
  }
  return lines;
}

export function paintPdfLines(doc: PDFKit.PDFDocument, lines: string[], x: number, y: number, size: number,
  color = "#FFFFFF", bold = false, leading = size * 1.4) {
  doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
  lines.forEach((line, index) => doc.text(line, x, y + index * leading, { lineBreak: false }));
}
