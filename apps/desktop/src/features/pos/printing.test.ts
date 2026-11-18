import { describe, expect, it } from "vitest";
import { isDarkPixel } from "./raster";

describe("receipt raster threshold", () => {
  it("uses BT.601 luminance and composites transparency over white", () => {
    expect(isDarkPixel(0, 0, 0, 255)).toBe(true);
    expect(isDarkPixel(255, 255, 255, 255)).toBe(false);
    // Red has luminance ~76.2 -> prints black
    expect(isDarkPixel(255, 0, 0, 255)).toBe(true);
    // Bright yellow has luminance ~225.9 -> prints white
    expect(isDarkPixel(255, 255, 0, 255)).toBe(false);
    // Fully transparent black composites onto white background -> prints white
    expect(isDarkPixel(0, 0, 0, 0)).toBe(false);
  });
});
