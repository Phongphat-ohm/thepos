export function isDarkPixel(red: number, green: number, blue: number, alphaByte: number) {
  const alpha = alphaByte / 255;
  const luminance = (0.299 * red + 0.587 * green + 0.114 * blue) * alpha + 255 * (1 - alpha);
  return luminance < 140;
}
