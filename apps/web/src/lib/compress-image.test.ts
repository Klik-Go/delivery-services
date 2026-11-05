import { describe, expect, it } from "vitest";
import { fitWithin } from "./compress-image";

describe("photo resizing", () => {
  it("fits the long side within 1280 px and keeps the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
    expect(fitWithin(1080, 1920, 1280)).toEqual({ width: 720, height: 1280 });
  });

  it("never enlarges small photos", () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
  });
});
