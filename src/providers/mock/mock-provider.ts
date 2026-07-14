import type {
  QuoteRequest,
  ShippingProvider,
  ShippingQuote,
} from "../../core/types.js";

interface MockService {
  code: string;
  name: string;
  baseCents: number;
  centsPerKg: number;
  baseDays: number;
}

// Espelha os códigos reais de contrato para que trocar mock -> correios
// não exija mudança em quem consome a API.
const SERVICES: MockService[] = [
  { code: "03220", name: "SEDEX", baseCents: 2450, centsPerKg: 850, baseDays: 1 },
  { code: "03298", name: "PAC", baseCents: 1690, centsPerKg: 520, baseDays: 4 },
];

/**
 * Provider determinístico para desenvolvimento e testes: não exige
 * credenciais e devolve preços plausíveis derivados de peso, volume e
 * "distância" (diferença entre prefixos de CEP, que nos Correios indicam
 * região geográfica).
 */
export class MockShippingProvider implements ShippingProvider {
  readonly name = "mock";
  private readonly latencyMs: number;

  constructor(options: { latencyMs?: number } = {}) {
    this.latencyMs = options.latencyMs ?? 150;
  }

  async getQuotes(request: QuoteRequest): Promise<ShippingQuote[]> {
    if (this.latencyMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.latencyMs));
    }

    const services = request.serviceCodes?.length
      ? SERVICES.filter((s) => request.serviceCodes!.includes(s.code))
      : SERVICES;

    const originRegion = Number(request.originZip.slice(0, 3));
    const destinationRegion = Number(request.destinationZip.slice(0, 3));
    const distanceFactor = Math.min(
      Math.abs(originRegion - destinationRegion) / 100,
      4,
    );

    const { weightGrams, lengthCm, widthCm, heightCm } = request.package;
    // Peso cubado, mesma regra dos Correios: cm³ / 6000 = kg.
    const cubicWeightKg = (lengthCm * widthCm * heightCm) / 6000;
    const billableKg = Math.max(weightGrams / 1000, cubicWeightKg);

    const insuranceCents = Math.round((request.declaredValueCents ?? 0) * 0.01);

    return services.map((service) => ({
      serviceCode: service.code,
      serviceName: service.name,
      priceCents: Math.round(
        (service.baseCents + service.centsPerKg * billableKg) *
          (1 + distanceFactor * 0.2) +
          insuranceCents,
      ),
      deadlineBusinessDays: service.baseDays + Math.ceil(distanceFactor),
      provider: this.name,
    }));
  }
}
