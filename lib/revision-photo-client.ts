import {
  REVISION_PHOTO_VERCEL_SAFE_MAX_BYTES,
  normalizeRevisionPhotoMimeType,
  toRevisionPhotoUploadFileName
} from "@/lib/revision-photos";

const OUTPUT_MIME_TYPE = "image/jpeg";
const DIMENSION_STEPS = [2560, 2200, 1920, 1600, 1365, 1280, 1080, 960];
const QUALITY_STEPS = [0.86, 0.8, 0.74, 0.68, 0.62, 0.56, 0.5, 0.44];

export type PreparedRevisionPhotoUpload = {
  file: File;
  originalFileName: string;
  originalMimeType: string;
  originalSizeBytes: number;
  outputMimeType: string;
  outputSizeBytes: number;
  wasCompressed: boolean;
};

function fitWithinBox(width: number, height: number, maxDimension: number): {
  width: number;
  height: number;
} {
  const largestSide = Math.max(width, height);
  if (!largestSide || largestSide <= maxDimension) {
    return { width, height };
  }

  const scale = maxDimension / largestSide;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale))
  };
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) {
          reject(new Error("No se pudo generar la imagen comprimida."));
          return;
        }
        resolve(blob);
      },
      mimeType,
      quality
    );
  });
}

function loadImageElement(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);

    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("El navegador no pudo abrir la foto para optimizarla."));
    };
    image.src = objectUrl;
  });
}

function chooseDimensionSteps(width: number, height: number): number[] {
  const largestSide = Math.max(width, height);
  const candidates = [largestSide, ...DIMENSION_STEPS]
    .filter((value, index, list) => value > 0 && list.indexOf(value) === index)
    .filter((value) => value <= largestSide)
    .sort((a, b) => b - a);

  return candidates.length ? candidates : [largestSide];
}

function toOutputFile(blob: Blob, originalFile: File): File {
  return new File([blob], toRevisionPhotoUploadFileName(originalFile.name), {
    type: OUTPUT_MIME_TYPE,
    lastModified: originalFile.lastModified
  });
}

export async function prepareRevisionPhotoForUpload(input: {
  file: File;
  targetMaxBytes?: number;
}): Promise<PreparedRevisionPhotoUpload> {
  const targetMaxBytes = input.targetMaxBytes ?? REVISION_PHOTO_VERCEL_SAFE_MAX_BYTES;
  const normalizedMimeType = normalizeRevisionPhotoMimeType(input.file.type);

  if (input.file.size <= targetMaxBytes) {
    return {
      file: input.file,
      originalFileName: input.file.name,
      originalMimeType: normalizedMimeType,
      originalSizeBytes: input.file.size,
      outputMimeType: normalizedMimeType || OUTPUT_MIME_TYPE,
      outputSizeBytes: input.file.size,
      wasCompressed: false
    };
  }

  const image = await loadImageElement(input.file);
  const dimensionSteps = chooseDimensionSteps(image.naturalWidth, image.naturalHeight);
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("El navegador no permite optimizar la foto antes de subirla.");
  }

  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  let smallestBlob: Blob | null = null;

  for (const maxDimension of dimensionSteps) {
    const dimensions = fitWithinBox(image.naturalWidth, image.naturalHeight, maxDimension);
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    context.clearRect(0, 0, dimensions.width, dimensions.height);
    context.drawImage(image, 0, 0, dimensions.width, dimensions.height);

    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, OUTPUT_MIME_TYPE, quality);
      if (!smallestBlob || blob.size < smallestBlob.size) {
        smallestBlob = blob;
      }

      if (blob.size <= targetMaxBytes) {
        const file = toOutputFile(blob, input.file);
        return {
          file,
          originalFileName: input.file.name,
          originalMimeType: normalizedMimeType,
          originalSizeBytes: input.file.size,
          outputMimeType: file.type,
          outputSizeBytes: file.size,
          wasCompressed: file.size !== input.file.size || file.name !== input.file.name
        };
      }
    }
  }

  if (smallestBlob) {
    throw new Error(
      `No se pudo reducir la foto por debajo de ${Math.round(targetMaxBytes / (1024 * 1024))} MB.`
    );
  }

  throw new Error("No se pudo optimizar la foto antes de subirla.");
}
