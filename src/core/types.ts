/**
 * Contratos centrais do FarolEnvios.
 *
 * Todo o resto do sistema (HTTP, providers, frontend) depende apenas destes
 * tipos — para plugar em outro sistema, importe `ShippingProvider` e
 * `QuoteService` e ignore a camada HTTP.
 */

/** Dimensões e peso do pacote. Valores sempre em unidades inteiras (g, cm). */
export interface PackageSpec {
  /** Peso em gramas. */
  weightGrams: number;
  /** Comprimento em centímetros. */
  lengthCm: number;
  /** Largura em centímetros. */
  widthCm: number;
  /** Altura em centímetros. */
  heightCm: number;
}

/** Pedido de cotação de frete. CEPs sempre com 8 dígitos, sem hífen. */
export interface QuoteRequest {
  originZip: string;
  destinationZip: string;
  package: PackageSpec;
  /** Valor declarado em centavos, para seguro. Opcional. */
  declaredValueCents?: number | undefined;
  /** Restringe a cotação a estes códigos de serviço. Vazio = todos do provider. */
  serviceCodes?: string[] | undefined;
}

/** Uma opção de frete retornada por um provider. */
export interface ShippingQuote {
  /** Código do serviço no provider (ex.: "03220" para SEDEX contrato). */
  serviceCode: string;
  /** Nome amigável do serviço (ex.: "SEDEX"). */
  serviceName: string;
  /** Preço em centavos — inteiros evitam bugs de ponto flutuante com dinheiro. */
  priceCents: number;
  /** Prazo estimado em dias úteis. */
  deadlineBusinessDays: number;
  /** Nome do provider que gerou a cotação (ex.: "correios", "mock"). */
  provider: string;
}

/**
 * Porta de saída (hexagonal): qualquer transportadora vira um provider.
 * Para adicionar Jadlog, Loggi etc., basta implementar esta interface e
 * registrar no factory em `src/index.ts`.
 */
export interface ShippingProvider {
  readonly name: string;
  getQuotes(request: QuoteRequest): Promise<ShippingQuote[]>;
}
