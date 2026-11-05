import { describe, expect, it } from "vitest";
import {
  addCentavos,
  assertCentavos,
  centavosToPesoInput,
  formatPeso,
  pesosToCentavos,
} from "./money";

describe("money in integer centavos", () => {
  it("formats centavos as Philippine pesos", () => {
    expect(formatPeso(123450)).toBe("₱1,234.50");
    expect(formatPeso(3900)).toBe("₱39.00");
    expect(formatPeso(0)).toBe("₱0.00");
  });

  it("formats refunds and discounts as negative pesos", () => {
    expect(formatPeso(-500)).toBe("-₱5.00");
  });

  it("rejects fractional centavos so floats never sneak into money", () => {
    expect(() => assertCentavos(10.5)).toThrow(RangeError);
    expect(() => formatPeso(0.1)).toThrow(RangeError);
    expect(() => assertCentavos(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(assertCentavos(250)).toBe(250);
  });

  it("adds amounts without floating point drift", () => {
    expect(addCentavos(10, 20, 30)).toBe(60);
    expect(addCentavos()).toBe(0);
  });

  it("converts a typed peso amount to centavos exactly", () => {
    expect(pesosToCentavos("245")).toBe(24500);
    expect(pesosToCentavos("0.10")).toBe(10);
    expect(pesosToCentavos("1,299.95")).toBe(129995);
    expect(pesosToCentavos("19.9")).toBe(1990);
  });

  it("refuses peso strings it cannot convert exactly", () => {
    expect(() => pesosToCentavos("12.345")).toThrow(RangeError);
    expect(() => pesosToCentavos("abc")).toThrow(RangeError);
    expect(() => pesosToCentavos("")).toThrow(RangeError);
  });

  it("shows centavos as a peso amount someone can edit", () => {
    expect(centavosToPesoInput(12050)).toBe("120.50");
    expect(centavosToPesoInput(9000)).toBe("90");
    expect(centavosToPesoInput(5)).toBe("0.05");
    expect(centavosToPesoInput(-150)).toBe("-1.50");
    expect(pesosToCentavos(centavosToPesoInput(129995))).toBe(129995);
  });
});
