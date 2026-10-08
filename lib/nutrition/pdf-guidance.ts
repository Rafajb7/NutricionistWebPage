import { parseGuidanceEntries } from "./guidance";
import { MENU_PAGE, paintPdfLines, wrapPdfText } from "./pdf-layout";

type GuidanceLine = { text: string; bullet: boolean; height: number };

export function drawGuidanceSection(doc: PDFKit.PDFDocument, title: string, subtitle: string, text: string, emptyText: string) {
  const entries = parseGuidanceEntries(text);
  const capacity = 306;
  const pages: GuidanceLine[][] = [[]];
  let used = 0;
  for (const entry of entries.length ? entries : [emptyText]) {
    const lines = wrapPdfText(doc, entry, 848, 10.5).map((line, index, all) => ({
      text: line, bullet: entries.length > 0 && index === 0,
      height: 14.7 + (index === all.length - 1 ? 10 : 0)
    }));
    const height = lines.reduce((sum, line) => sum + line.height, 0);
    // Keep an entry together when possible; exceptionally long entries continue without a second bullet.
    if (used > 0 && height <= capacity && used + height > capacity) {
      pages.push([]);
      used = 0;
    }
    for (const line of lines) {
      if (used + line.height > capacity) {
        pages.push([]);
        used = 0;
      }
      pages[pages.length - 1].push(line);
      used += line.height;
    }
  }
  pages.forEach((lines, page) => {
    doc.addPage(MENU_PAGE);
    paintPdfLines(doc, [title.toUpperCase()], 34, 36, 30, "#FFFFFF", true);
    paintPdfLines(doc, [subtitle], 34, 85, 8, "#FFD21C", true);
    const height = Math.max(80, lines.reduce((sum, line) => sum + line.height, 0) + 30);
    doc.rect(34, 123, 892, height).fill("#121212");
    doc.rect(34, 123, 2, height).fill("#FFD21C");
    let cursor = 138;
    for (const line of lines) {
      if (line.bullet) doc.rect(48, cursor + 4, 4, 4).fill("#FFD21C");
      paintPdfLines(doc, [line.text], 58, cursor, 10.5, entries.length ? "#D8D8D3" : "#A7A7A7");
      cursor += line.height;
    }
    if (pages.length > 1) paintPdfLines(doc, [`${page + 1} / ${pages.length}`], 852, 86, 8, "#A7A7A7");
    if (title === "Recomendaciones" && page === pages.length - 1) {
      paintPdfLines(doc, ["CADA PAUTA EXISTE PARA LLEGAR EN TU MEJOR ESTADO POSIBLE."], 34, 468, 8, "#FFD21C", true);
    }
  });
}
