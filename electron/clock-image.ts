import { nativeImage } from "electron";
/** Prepares only the already-authorized crop; never acquires additional pixels. */
export function clockImages(png: Buffer): Buffer[] {
  const image = nativeImage.createFromBuffer(png);
  const { width, height } = image.getSize();
  if (
    image.isEmpty() ||
    width < 40 ||
    width > 640 ||
    height < 20 ||
    height > 160
  )
    throw new Error("Invalid clock crop image.");
  const scale = Math.max(1, Math.min(4, Math.ceil(120 / height)));
  const enlarged = image.resize({
    width: width * scale,
    height: height * scale,
    quality: "best",
  });
  const size = enlarged.getSize();
  const pixels = enlarged.toBitmap();
  const histogram = new Uint32Array(256);
  const luminance = new Uint8Array(size.width * size.height);
  for (let i = 0; i < luminance.length; i++) {
    const p = i * 4;
    // Bitmap channel order is platform-dependent; equal RGB weights are portable.
    const value = Math.round((pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3);
    luminance[i] = value;
    histogram[value]++;
  }
  const percentile = (fraction: number) => {
    let count = 0;
    for (let i = 0; i < 256; i++) {
      count += histogram[i];
      if (count >= luminance.length * fraction) return i;
    }
    return 255;
  };
  const low = percentile(0.01),
    high = percentile(0.99);
  const invert = percentile(0.5) < (low + high) / 2;
  const padding = 12;
  const outputSize = {
    width: size.width + padding * 2,
    height: size.height + padding * 2,
  };
  const make = (threshold: boolean) => {
    const output = Buffer.alloc(outputSize.width * outputSize.height * 4, 255);
    for (let y = 0; y < size.height; y++)
      for (let x = 0; x < size.width; x++) {
        let value = Math.round(
          Math.max(
            0,
            Math.min(
              255,
              ((luminance[y * size.width + x] - low) * 255) /
                Math.max(1, high - low),
            ),
          ),
        );
        if (invert) value = 255 - value;
        if (threshold) value = value < 140 ? 0 : 255;
        const p = ((y + padding) * outputSize.width + x + padding) * 4;
        output[p] = output[p + 1] = output[p + 2] = value;
      }
    return nativeImage.createFromBitmap(output, outputSize).toPNG();
  };
  return [make(false), make(true), png];
}
