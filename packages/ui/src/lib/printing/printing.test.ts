import { describe, expect, it } from "vitest";
import { isDarkPixel } from "./raster";

describe("receipt rasterization", () => {
  it("treats dark opaque pixels as printed ink and white or transparent pixels as paper", () => {
    expect(isDarkPixel(0, 0, 0, 255)).toBe(true);
    expect(isDarkPixel(255, 255, 255, 255)).toBe(false);
    expect(isDarkPixel(0, 0, 0, 0)).toBe(false);
    expect(isDarkPixel(20, 20, 20, 200)).toBe(true);
  });
});
