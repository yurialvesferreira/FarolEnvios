import { describe, expect, it } from "vitest";
import { MockShippingProvider } from "../src/providers/mock/mock-provider.js";
import type { QuoteRequest } from "../src/core/types.js";

const baseRequest: QuoteRequest = {
  originZip: "01310100",
  destinationZip: "90010150",
  package: { weightGrams: 800, lengthCm: 20, widthCm: 15, heightCm: 10 },
};

const provider = new MockShippingProvider({ latencyMs: 0 });

describe("MockShippingProvider", () => {
  it("retorna SEDEX e PAC por padrão", async () => {
    const quotes = await provider.getQuotes(baseRequest);

    expect(quotes.map((q) => q.serviceCode).sort()).toEqual([
      "03220",
      "03298",
    ]);
    for (const quote of quotes) {
      expect(quote.priceCents).toBeGreaterThan(0);
      expect(quote.deadlineBusinessDays).toBeGreaterThanOrEqual(1);
      expect(quote.provider).toBe("mock");
    }
  });

  it("respeita o filtro de serviceCodes", async () => {
    const quotes = await provider.getQuotes({
      ...baseRequest,
      serviceCodes: ["03298"],
    });

    expect(quotes).toHaveLength(1);
    expect(quotes[0]?.serviceName).toBe("PAC");
  });

  it("cobra mais por envios mais pesados", async () => {
    const light = await provider.getQuotes(baseRequest);
    const heavy = await provider.getQuotes({
      ...baseRequest,
      package: { ...baseRequest.package, weightGrams: 10_000 },
    });

    expect(heavy[0]!.priceCents).toBeGreaterThan(light[0]!.priceCents);
  });

  it("é determinístico para o mesmo pedido", async () => {
    const first = await provider.getQuotes(baseRequest);
    const second = await provider.getQuotes(baseRequest);

    expect(second).toEqual(first);
  });
});
