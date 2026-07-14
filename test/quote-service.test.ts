import { describe, expect, it, vi } from "vitest";
import { InvalidQuoteRequestError } from "../src/core/errors.js";
import { QuoteService } from "../src/core/quote-service.js";
import type {
  QuoteRequest,
  ShippingProvider,
  ShippingQuote,
} from "../src/core/types.js";

const validInput = {
  originZip: "01310-100",
  destinationZip: "90010150",
  package: { weightGrams: 800, lengthCm: 20, widthCm: 15, heightCm: 10 },
};

function providerReturning(quotes: ShippingQuote[]): ShippingProvider & {
  calls: QuoteRequest[];
} {
  const calls: QuoteRequest[] = [];
  return {
    name: "fake",
    calls,
    async getQuotes(request) {
      calls.push(request);
      return quotes;
    },
  };
}

const sedex: ShippingQuote = {
  serviceCode: "03220",
  serviceName: "SEDEX",
  priceCents: 4200,
  deadlineBusinessDays: 2,
  provider: "fake",
};

const pac: ShippingQuote = {
  serviceCode: "03298",
  serviceName: "PAC",
  priceCents: 2100,
  deadlineBusinessDays: 6,
  provider: "fake",
};

describe("QuoteService", () => {
  it("normaliza CEPs com máscara antes de chamar o provider", async () => {
    const provider = providerReturning([sedex]);
    const service = new QuoteService(provider);

    await service.getQuotes(validInput);

    expect(provider.calls[0]?.originZip).toBe("01310100");
    expect(provider.calls[0]?.destinationZip).toBe("90010150");
  });

  it("ordena as cotações por preço crescente", async () => {
    const service = new QuoteService(providerReturning([sedex, pac]));

    const quotes = await service.getQuotes(validInput);

    expect(quotes.map((q) => q.serviceCode)).toEqual(["03298", "03220"]);
  });

  it("rejeita CEP inválido com os campos apontados", async () => {
    const service = new QuoteService(providerReturning([]));

    await expect(
      service.getQuotes({ ...validInput, destinationZip: "123" }),
    ).rejects.toThrowError(InvalidQuoteRequestError);

    await expect(
      service.getQuotes({ ...validInput, destinationZip: "123" }),
    ).rejects.toMatchObject({
      issues: [expect.stringContaining("destinationZip")],
    });
  });

  it("rejeita pacote fora dos limites dos Correios", async () => {
    const service = new QuoteService(providerReturning([]));

    await expect(
      service.getQuotes({
        ...validInput,
        package: { ...validInput.package, weightGrams: 50_000 },
      }),
    ).rejects.toThrowError(InvalidQuoteRequestError);
  });

  it("usa o cache dentro do TTL e expira depois dele", async () => {
    vi.useFakeTimers();
    try {
      const provider = providerReturning([sedex]);
      const service = new QuoteService(provider, { cacheTtlSeconds: 60 });

      await service.getQuotes(validInput);
      await service.getQuotes(validInput);
      expect(provider.calls).toHaveLength(1);

      vi.advanceTimersByTime(61_000);
      await service.getQuotes(validInput);
      expect(provider.calls).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("não cacheia quando o TTL é 0", async () => {
    const provider = providerReturning([sedex]);
    const service = new QuoteService(provider, { cacheTtlSeconds: 0 });

    await service.getQuotes(validInput);
    await service.getQuotes(validInput);

    expect(provider.calls).toHaveLength(2);
  });
});
