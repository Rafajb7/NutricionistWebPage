import { describe, expect, it } from "vitest";
import {
  detectRevisionPhotoFormat,
  isLikelyAcceptedRevisionPhotoFile,
  normalizeRevisionPhotoMimeType,
  resolveRevisionPhotoMimeType
} from "@/lib/revision-photos";

describe("revision photo helpers", () => {
  it("normalizes browser mime aliases", () => {
    expect(normalizeRevisionPhotoMimeType("image/jpg")).toBe("image/jpeg");
    expect(normalizeRevisionPhotoMimeType("image/heic-sequence")).toBe("image/heic");
    expect(normalizeRevisionPhotoMimeType("image/heif-sequence")).toBe("image/heif");
  });

  it("accepts likely supported client files by extension or mime type", () => {
    expect(isLikelyAcceptedRevisionPhotoFile({ name: "foto.heic", type: "" })).toBe(true);
    expect(isLikelyAcceptedRevisionPhotoFile({ name: "foto.jpeg", type: "image/jpeg" })).toBe(
      true
    );
    expect(isLikelyAcceptedRevisionPhotoFile({ name: "archivo.pdf", type: "application/pdf" })).toBe(
      false
    );
  });

  it("detects jpeg buffers", () => {
    const buffer = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43]);
    expect(detectRevisionPhotoFormat(buffer)).toMatchObject({
      format: "jpeg",
      mimeType: "image/jpeg"
    });
  });

  it("detects png buffers", () => {
    const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(detectRevisionPhotoFormat(buffer)).toMatchObject({
      format: "png",
      mimeType: "image/png"
    });
  });

  it("detects webp buffers", () => {
    const buffer = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50
    ]);
    expect(detectRevisionPhotoFormat(buffer)).toMatchObject({
      format: "webp",
      mimeType: "image/webp"
    });
  });

  it("detects heic buffers from the ftyp brand", () => {
    const buffer = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63
    ]);
    expect(detectRevisionPhotoFormat(buffer)).toMatchObject({
      format: "heic",
      mimeType: "image/heic"
    });
  });

  it("falls back to the declared mime type when signature detection is unavailable", () => {
    const buffer = Buffer.from([0x01, 0x02, 0x03, 0x04]);
    expect(
      resolveRevisionPhotoMimeType({
        buffer,
        declaredMimeType: "image/png"
      })
    ).toMatchObject({
      format: "png",
      mimeType: "image/png"
    });
  });
});
