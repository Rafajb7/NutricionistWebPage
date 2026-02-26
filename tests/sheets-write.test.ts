import { describe, expect, it, vi } from "vitest";
import { appendRevisionRowsWithClient } from "@/lib/google/sheets";

describe("appendRevisionRowsWithClient", () => {
  it("writes rows in expected A:E format", async () => {
    const appendMock = vi.fn().mockResolvedValue({});
    const fakeClient = {
      spreadsheets: {
        values: {
          append: appendMock
        }
      }
    } as any;

    await appendRevisionRowsWithClient({
      sheetsClient: fakeClient,
      spreadsheetId: "sheet-id",
      worksheetName: "Revision",
      rows: [
        {
          nombre: "Rafa",
          fecha: "2026-02-26",
          usuario: "rafa_user",
          pregunta: "Energia",
          respuesta: "Alta"
        }
      ]
    });

    expect(appendMock).toHaveBeenCalledTimes(1);
    expect(appendMock).toHaveBeenCalledWith({
      spreadsheetId: "sheet-id",
      range: "'Revision'!A:E",
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [["Rafa", "2026-02-26", "rafa_user", "Energia", "Alta"]]
      }
    });
  });
});
