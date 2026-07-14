import { z } from "zod";
import { InvalidQuoteRequestError } from "./errors.js";
import type { QuoteRequest, ShippingProvider, ShippingQuote } from "./types.js";

/** Aceita "01310-100" ou "01310100" e normaliza para 8 dígitos. */
const zipSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{8}$/, "CEP deve ter 8 dígitos"));

// Limites das encomendas nacionais dos Correios (caixa/pacote).
const quoteRequestSchema = z.object({
  originZip: zipSchema,
  destinationZip: zipSchema,
  package: z.object({
    weightGrams: z.number().int().min(1).max(30_000),
    lengthCm: z.number().int().min(15).max(100),
    widthCm: z.number().int().min(10).max(100),
    heightCm: z.number().int().min(1).max(100),
  }),
  declaredValueCents: z.number().int().min(0).optional(),
  serviceCodes: z.array(z.string().regex(/^\d{5}$/)).optional(),
});

interface CacheEntry {
  quotes: ShippingQuote[];
  expiresAt: number;
}

export interface QuoteServiceOptions {
  /** TTL do cache em segundos. 0 desativa o cache. */
  cacheTtlSeconds?: number;
}

/**
 * Caso de uso central: valida o pedido, consulta o provider e cacheia.
 *
 * O cache em memória evita repetir chamadas idênticas aos Correios (a API
 * tem limites de taxa e latência alta). Para múltiplas instâncias, troque
 * por Redis mantendo a mesma chave.
 */
export class QuoteService {
  private readonly provider: ShippingProvider;
  private readonly cacheTtlMs: number;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(provider: ShippingProvider, options: QuoteServiceOptions = {}) {
    this.provider = provider;
    this.cacheTtlMs = (options.cacheTtlSeconds ?? 0) * 1000;
  }

  async getQuotes(input: unknown): Promise<ShippingQuote[]> {
    const parsed = quoteRequestSchema.safeParse(input);
    if (!parsed.success) {
      const issues = parsed.error.issues.map(
        (issue) => `${issue.path.join(".") || "raiz"}: ${issue.message}`,
      );
      throw new InvalidQuoteRequestError(issues);
    }

    const request: QuoteRequest = parsed.data;

    const cacheKey = JSON.stringify(request);
    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.quotes;
    }

    const quotes = await this.provider.getQuotes(request);
    const sorted = [...quotes].sort((a, b) => a.priceCents - b.priceCents);

    if (this.cacheTtlMs > 0) {
      this.cache.set(cacheKey, {
        quotes: sorted,
        expiresAt: Date.now() + this.cacheTtlMs,
      });
      this.pruneExpired();
    }

    return sorted;
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
      }
    }
  }
}
