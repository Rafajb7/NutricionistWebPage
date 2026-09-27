import { paintPdfLines, wrapPdfText } from "@/lib/nutrition/pdf-layout";

export type PdfContentsEntry = {
  title: string;
  detail: string;
  destination: string;
  firstPage: number;
  lastPage: number;
};

export const CONTENTS_ENTRIES_PER_PAGE = 10;

/** Fill the reserved pages after rendering, so every number and link refers to
 * the actual document, including optional sections and continuation pages. */
export function drawPdfContents(doc: PDFKit.PDFDocument, entries: PdfContentsEntry[], pages: number[]) {
  pages.forEach((page, pageIndex) => {
    doc.switchToPage(page);
    if (pageIndex === 0) doc.addNamedDestination("nutrition-contents", "Fit");
    doc.save().translate(34, 30).polygon([5, 0], [186, 0], [181, 65], [0, 65]).fill("#FFD21C").restore();
    paintPdfLines(doc, ["INDICE"], 49, 46, 32, "#10100E", true);
    paintPdfLines(doc, ["El contenido de tu plan, en orden. Pulsa un bloque para ir a su pagina."], 34, 109, 9, "#B7B7AF");
    if (pages.length > 1) paintPdfLines(doc, [`${pageIndex + 1} / ${pages.length}`], 846, 108, 8, "#B7B7AF");
    const batch = entries.slice(pageIndex * CONTENTS_ENTRIES_PER_PAGE, (pageIndex + 1) * CONTENTS_ENTRIES_PER_PAGE);
    batch.forEach((entry, index) => {
      const x = 34 + index % 2 * 455;
      const y = 139 + Math.floor(index / 2) * 62;
      const width = 437;
      doc.rect(x, y, width, 53).fill("#121212");
      doc.rect(x, y, 2, 53).fill("#FFD21C");
      paintPdfLines(doc, [String(pageIndex * CONTENTS_ENTRIES_PER_PAGE + index + 1).padStart(2, "0")], x + 13, y + 13, 21, "#494225", true);
      const title = wrapPdfText(doc, entry.title.toLocaleUpperCase("es"), width - 119, 11, true);
      // Index labels are summaries; the full titles remain on their section pages.
      const visible = title.length > 2 ? [title[0], `${title[1].slice(0, -3)}...`] : title;
      paintPdfLines(doc, visible, x + 51, y + 9, 11, "#FFFFFF", true, 12);
      const details = wrapPdfText(doc, entry.detail, width - 119, 6.5)[0];
      paintPdfLines(doc, [details], x + 51, y + 37, 6.5, "#97978E");
      const range = entry.firstPage === entry.lastPage ? String(entry.firstPage) : `${entry.firstPage}-${entry.lastPage}`;
      doc.font("Helvetica-Bold").fontSize(8).fillColor("#FFD21C")
        .text(`P. ${range}`, x + width - 63, y + 21, { width: 51, align: "right", lineBreak: false });
      doc.goTo(x, y, width, 53, entry.destination);
    });
  });
}
