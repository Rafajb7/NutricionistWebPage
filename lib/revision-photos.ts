export const REVISION_PHOTO_MAX_FILES = 4;
export const REVISION_PHOTO_VERCEL_SAFE_MAX_BYTES = 4 * 1024 * 1024;

export const REVISION_PHOTO_ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence"
] as const;

export const REVISION_PHOTO_ACCEPTED_EXTENSIONS = [
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".heic",
  ".heif"
] as const;

export const REVISION_PHOTO_ACCEPT_ATTRIBUTE = [
  ...REVISION_PHOTO_ACCEPTED_MIME_TYPES,
  ...REVISION_PHOTO_ACCEPTED_EXTENSIONS
].join(",");

const acceptedMimeTypeSet = new Set<string>(REVISION_PHOTO_ACCEPTED_MIME_TYPES);
const acceptedExtensionSet = new Set<string>(REVISION_PHOTO_ACCEPTED_EXTENSIONS);

const HEIF_BRANDS = new Set([
  "heic",
  "heix",
  "hevc",
  "hevx",
  "heim",
  "heis",
  "hevm",
  "hevs",
  "mif1",
  "msf1"
]);

export type RevisionPhotoFormat = {
  extension: ".heic" | ".heif" | ".jpeg" | ".png" | ".webp";
  format: "heic" | "heif" | "jpeg" | "png" | "webp";
  mimeType: "image/heic" | "image/heif" | "image/jpeg" | "image/png" | "image/webp";
};

export function normalizeRevisionPhotoMimeType(value: string | undefined): string {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "image/jpg") return "image/jpeg";
  if (normalized === "image/heic-sequence") return "image/heic";
  if (normalized === "image/heif-sequence") return "image/heif";
  return normalized;
}

export function getRevisionPhotoExtension(fileName: string | undefined): string {
  const normalizedName = String(fileName ?? "").trim().toLowerCase();
  const lastDotIndex = normalizedName.lastIndexOf(".");
  if (lastDotIndex === -1) return "";
  return normalizedName.slice(lastDotIndex);
}

export function toRevisionPhotoUploadFileName(fileName: string | undefined): string {
  const normalizedName = String(fileName ?? "").trim();
  const lastDotIndex = normalizedName.lastIndexOf(".");
  const baseName =
    (lastDotIndex === -1 ? normalizedName : normalizedName.slice(0, lastDotIndex)).trim() ||
    "revision-photo";

  return `${baseName}.jpeg`;
}

export function isAcceptedRevisionPhotoMimeType(value: string | undefined): boolean {
  return acceptedMimeTypeSet.has(normalizeRevisionPhotoMimeType(value));
}

export function isAcceptedRevisionPhotoFileName(fileName: string | undefined): boolean {
  return acceptedExtensionSet.has(getRevisionPhotoExtension(fileName));
}

export function resolveRevisionPhotoTypeFromFileName(
  fileName: string | undefined
): RevisionPhotoFormat | null {
  switch (getRevisionPhotoExtension(fileName)) {
    case ".jpg":
    case ".jpeg":
      return {
        extension: ".jpeg",
        format: "jpeg",
        mimeType: "image/jpeg"
      };
    case ".png":
      return {
        extension: ".png",
        format: "png",
        mimeType: "image/png"
      };
    case ".webp":
      return {
        extension: ".webp",
        format: "webp",
        mimeType: "image/webp"
      };
    case ".heic":
      return {
        extension: ".heic",
        format: "heic",
        mimeType: "image/heic"
      };
    case ".heif":
      return {
        extension: ".heif",
        format: "heif",
        mimeType: "image/heif"
      };
    default:
      return null;
  }
}

export function isLikelyAcceptedRevisionPhotoFile(input: {
  name?: string;
  type?: string;
}): boolean {
  return (
    isAcceptedRevisionPhotoMimeType(input.type) ||
    isAcceptedRevisionPhotoFileName(input.name)
  );
}

export function getAcceptedRevisionPhotoMimeTypes(): Set<string> {
  return new Set<string>(
    REVISION_PHOTO_ACCEPTED_MIME_TYPES.map((mimeType) =>
      normalizeRevisionPhotoMimeType(mimeType)
    )
  );
}

export function detectRevisionPhotoFormat(
  input: Buffer | Uint8Array
): RevisionPhotoFormat | null {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return {
      extension: ".jpeg",
      format: "jpeg",
      mimeType: "image/jpeg"
    };
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return {
      extension: ".png",
      format: "png",
      mimeType: "image/png"
    };
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return {
      extension: ".webp",
      format: "webp",
      mimeType: "image/webp"
    };
  }

  if (bytes.length >= 12) {
    const boxType = String.fromCharCode(bytes[4], bytes[5], bytes[6], bytes[7]);
    if (boxType === "ftyp") {
      const majorBrand = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]).toLowerCase();
      if (HEIF_BRANDS.has(majorBrand)) {
        const isHeifFamily = majorBrand === "mif1" || majorBrand === "msf1";
        return {
          extension: isHeifFamily ? ".heif" : ".heic",
          format: isHeifFamily ? "heif" : "heic",
          mimeType: isHeifFamily ? "image/heif" : "image/heic"
        };
      }
    }
  }

  return null;
}

export function resolveRevisionPhotoMimeType(input: {
  buffer: Buffer | Uint8Array;
  declaredMimeType?: string;
}): RevisionPhotoFormat | null {
  const detected = detectRevisionPhotoFormat(input.buffer);
  if (detected) return detected;

  const normalizedMimeType = normalizeRevisionPhotoMimeType(input.declaredMimeType);
  switch (normalizedMimeType) {
    case "image/jpeg":
      return {
        extension: ".jpeg",
        format: "jpeg",
        mimeType: "image/jpeg"
      };
    case "image/png":
      return {
        extension: ".png",
        format: "png",
        mimeType: "image/png"
      };
    case "image/webp":
      return {
        extension: ".webp",
        format: "webp",
        mimeType: "image/webp"
      };
    case "image/heic":
      return {
        extension: ".heic",
        format: "heic",
        mimeType: "image/heic"
      };
    case "image/heif":
      return {
        extension: ".heif",
        format: "heif",
        mimeType: "image/heif"
      };
    default:
      return null;
  }
}
