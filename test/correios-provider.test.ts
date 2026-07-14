import { describe, expect, it } from "vitest";
import { parseBrlToCents } from "../src/providers/correios/correios-provider.js";
import { ProviderError } from "../src/core/errors.js";

describe("parseBrlToCents", () => {
  it("converte o formato monetário da API dos Correios", () => {
    expect(parseBrlToCents("27,90")).toBe(2790);
    expect(parseBrlToCents("1.234,56")).toBe(123456);
    expect(parseBrlToCents("0,00")).toBe(0);
  });

  it("rejeita formato inesperado", () => {
    expect(() => parseBrlToCents("abc")).toThrowError(ProviderError);
  });
});
