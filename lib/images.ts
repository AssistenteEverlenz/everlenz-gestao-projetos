import type { JournalPhoto } from "@/app/_components/types";

const maxDimension = 1600;
const targetBytes = 1_200_000;

function canvasToBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function compressJournalPhoto(file: File): Promise<JournalPhoto> {
  if (!file.type.startsWith("image/")) throw new Error(`${file.name} não é uma imagem válida.`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Não foi possível processar ${file.name}. Use JPG, PNG, WebP ou uma foto da câmera.`);
  }

  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) { bitmap.close(); throw new Error("O navegador não conseguiu preparar a imagem."); }
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();

  let blob: Blob | null = null;
  for (const quality of [0.76, 0.66, 0.56, 0.48]) {
    blob = await canvasToBlob(canvas, quality);
    if (blob && blob.size <= targetBytes) break;
  }
  if (!blob) throw new Error(`Não foi possível compactar ${file.name}.`);

  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
  return {
    url,
    originalName: file.name.replace(/\.[^.]+$/, ".jpg"),
    mimeType: "image/jpeg",
    sizeBytes: blob.size,
  };
}
