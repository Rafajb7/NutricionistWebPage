import { describe, expect, it } from "vitest";
import { extractImageUrl } from "@/lib/parse-image-formula";

describe("extractImageUrl", () => {
  it("extracts from IMAGE formula with valid drive id and maps to local view endpoint", () => {
    const value =
      '=IMAGE("https://drive.google.com/uc?id=1aUQq2TmlgcnrWlTpDGEGyr5qSpYTRLIO&export=download"; 4; 300; 300)';
    expect(extractImageUrl(value)).toBe(
      "/api/photos/view/1aUQq2TmlgcnrWlTpDGEGyr5qSpYTRLIO"
    );
  });

  it("extracts plain https url", () => {
    const value = "https://example.com/file.jpg";
    expect(extractImageUrl(value)).toBe("https://example.com/file.jpg");
  });

  it("returns null for non-url content", () => {
    expect(extractImageUrl("sin enlace")).toBeNull();
  });
});
