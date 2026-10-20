// Minimal Truevision TGA reader — ported near-verbatim from gfx-studio-2's
// shared/tgaDecoder.js (a separate, already-working broadcast-graphics app).
// Covers image types 2/10 (true-color, uncompressed/RLE) and 3/11
// (grayscale, uncompressed/RLE) at 8/24/32 bits per pixel — what real export
// pipelines (After Effects, Photoshop, etc.) actually produce. Indexed-color
// TGAs and right-to-left pixel order are out of scope (essentially unused in
// the wild), matching the original's own scope.
//
// Used by CgTemplateDesigner.tsx's Sequence import: a dropped/picked .tga
// frame is decoded here, converted to a PNG, then saved via the existing
// `import_image` Tauri command (see src/utils/project.ts / lib/cloudSync.ts
// for the same call shape) exactly like any other image in this app.

export function decodeTGAPixels(arrayBuffer: ArrayBuffer): { width: number; height: number; data: Uint8ClampedArray } {
  const buf = new Uint8Array(arrayBuffer);
  const dv = new DataView(arrayBuffer);

  const idLength = buf[0];
  const colorMapType = buf[1];
  const imageType = buf[2];
  const colorMapLength = dv.getUint16(5, true);
  const colorMapEntrySize = buf[7];
  const width = dv.getUint16(12, true);
  const height = dv.getUint16(14, true);
  const pixelDepth = buf[16];
  const imageDescriptor = buf[17];

  if (![1, 2, 3, 9, 10, 11].includes(imageType)) {
    throw new Error(`Unsupported TGA image type ${imageType} (only true-color/grayscale, with or without RLE, are supported)`);
  }
  if (imageType === 1 || imageType === 9) {
    throw new Error('Indexed-color TGA files are not supported — export as true-color.');
  }
  if (![8, 24, 32].includes(pixelDepth)) {
    throw new Error(`Unsupported TGA bit depth ${pixelDepth} (only 8/24/32 are supported)`);
  }

  let offset = 18 + idLength;
  if (colorMapType === 1) {
    offset += colorMapLength * Math.ceil(colorMapEntrySize / 8);
  }

  const bpp = pixelDepth / 8;
  const isRLE = imageType === 9 || imageType === 10 || imageType === 11;
  const topToBottom = (imageDescriptor & 0x20) !== 0;
  const totalPixels = width * height;
  const out = new Uint8ClampedArray(totalPixels * 4);

  function readPixel(p: number): [number, number, number, number] {
    let r: number, g: number, b: number, a: number;
    if (pixelDepth === 32) { b = buf[p]; g = buf[p + 1]; r = buf[p + 2]; a = buf[p + 3]; }
    else if (pixelDepth === 24) { b = buf[p]; g = buf[p + 1]; r = buf[p + 2]; a = 255; }
    else { const v = buf[p]; r = g = b = v; a = 255; }
    return [r, g, b, a];
  }

  function writePixel(fileIndex: number, r: number, g: number, b: number, a: number) {
    const col = fileIndex % width;
    const fileRow = Math.floor(fileIndex / width);
    const displayRow = topToBottom ? fileRow : (height - 1 - fileRow);
    const idx = (displayRow * width + col) * 4;
    out[idx] = r; out[idx + 1] = g; out[idx + 2] = b; out[idx + 3] = a;
  }

  let p = offset;
  if (!isRLE) {
    for (let i = 0; i < totalPixels; i++) {
      const [r, g, b, a] = readPixel(p);
      p += bpp;
      writePixel(i, r, g, b, a);
    }
  } else {
    let i = 0;
    while (i < totalPixels) {
      const header = buf[p++];
      const count = (header & 0x7f) + 1;
      const packetIsRLE = (header & 0x80) !== 0;
      if (packetIsRLE) {
        const [r, g, b, a] = readPixel(p);
        p += bpp;
        for (let k = 0; k < count && i < totalPixels; k++, i++) writePixel(i, r, g, b, a);
      } else {
        for (let k = 0; k < count && i < totalPixels; k++, i++) {
          const [r, g, b, a] = readPixel(p);
          p += bpp;
          writePixel(i, r, g, b, a);
        }
      }
    }
  }

  return { width, height, data: out };
}

export function tgaToCanvas(arrayBuffer: ArrayBuffer): HTMLCanvasElement {
  const { width, height, data } = decodeTGAPixels(arrayBuffer);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const imgData = ctx.createImageData(width, height);
  imgData.data.set(data);
  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/** TGA bytes → a base64-encoded PNG data payload (no `data:` prefix), ready
 *  for the `import_image` Tauri command's `dataBase64` argument. */
export function tgaFileToPngBase64(arrayBuffer: ArrayBuffer): Promise<string> {
  const canvas = tgaToCanvas(arrayBuffer);
  const dataUrl = canvas.toDataURL('image/png');
  return Promise.resolve(dataUrl.split(',')[1]);
}
