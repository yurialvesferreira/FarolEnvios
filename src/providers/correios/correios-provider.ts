import { ProviderError } from "../../core/errors.js";
import type {
  QuoteRequest,
  ShippingProvider,
  ShippingQuote,
} from "../../core/types.js";
import {
  CorreiosTokenManager,
  type CorreiosCredentials,
} from "./correios-auth.js";

/** Nomes amigáveis para os códigos de serviço mais comuns do contrato. */
const SERVICE_NAMES: Record<string, string> = {
  "03220": "SEDEX",
  "03204": "SEDEX Hoje",
  "03158": "SEDEX 10",
  "03298": "PAC",
  "04227": "Mini Envios",
};

interface PrecoResponse {
  pcFinal: string;
}

interface PrazoResponse {
  prazoEntrega: number;
}

export interface CorreiosProviderOptions {
  credentials: CorreiosCredentials;
  /** Códigos de serviço cotados por padrão quando o pedido não especifica. */
  defaultServiceCodes: string[];
  baseUrl?: string;
  timeoutMs?: number;
}

/**
 * Adapter para o CWS (Correios Web Services, api.correios.com.br).
 *
 * Requer contrato com os Correios. Usa duas APIs por serviço cotado:
 *   GET /preco/v1/nacional/{servico}  → preço final
 *   GET /prazo/v1/nacional/{servico}  → prazo em dias úteis
 *
 * Serviços que falham individualmente (ex.: indisponível para o trecho) são
 * omitidos do resultado em vez de derrubar a cotação inteira; a cotação só
 * falha se nenhum serviço responder.
 */
export class CorreiosShippingProvider implements ShippingProvider {
  readonly name = "correios";
  private readonly tokens: CorreiosTokenManager;
  private readonly baseUrl: string;
  private readonly defaultServiceCodes: string[];
  private readonly timeoutMs: number;

  constructor(options: CorreiosProviderOptions) {
    this.baseUrl = options.baseUrl ?? "https://api.correios.com.br";
    this.defaultServiceCodes = options.defaultServiceCodes;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.tokens = new CorreiosTokenManager(options.credentials, this.baseUrl);
  }

  async getQuotes(request: QuoteRequest): Promise<ShippingQuote[]> {
    const codes = request.serviceCodes?.length
      ? request.serviceCodes
      : this.defaultServiceCodes;

    const token = await this.tokens.getToken();

    const results = await Promise.allSettled(
      codes.map((code) => this.quoteService(code, request, token)),
    );

    const quotes = results
      .filter(
        (r): r is PromiseFulfilledResult<ShippingQuote> =>
          r.status === "fulfilled",
      )
      .map((r) => r.value);

    if (quotes.length === 0) {
      const firstError = results.find(
        (r): r is PromiseRejectedResult => r.status === "rejected",
      );
      throw new ProviderError(
        this.name,
        "Nenhum serviço dos Correios retornou cotação para este trecho",
        { cause: firstError?.reason },
      );
    }

    return quotes;
  }

  private async quoteService(
    serviceCode: string,
    request: QuoteRequest,
    token: string,
  ): Promise<ShippingQuote> {
    const precoParams = new URLSearchParams({
      cepOrigem: request.originZip,
      cepDestino: request.destinationZip,
      psObjeto: String(request.package.weightGrams),
      tpObjeto: "2", // 2 = pacote/caixa
      comprimento: String(request.package.lengthCm),
      largura: String(request.package.widthCm),
      altura: String(request.package.heightCm),
    });
    if (request.declaredValueCents && request.declaredValueCents > 0) {
      precoParams.set(
        "vlDeclarado",
        (request.declaredValueCents / 100).toFixed(2),
      );
    }

    const prazoParams = new URLSearchParams({
      cepOrigem: request.originZip,
      cepDestino: request.destinationZip,
    });

    const [preco, prazo] = await Promise.all([
      this.getJson<PrecoResponse>(
        `/preco/v1/nacional/${serviceCode}?${precoParams}`,
        token,
      ),
      this.getJson<PrazoResponse>(
        `/prazo/v1/nacional/${serviceCode}?${prazoParams}`,
        token,
      ),
    ]);

    return {
      serviceCode,
      serviceName: SERVICE_NAMES[serviceCode] ?? serviceCode,
      priceCents: parseBrlToCents(preco.pcFinal),
      deadlineBusinessDays: prazo.prazoEntrega,
      provider: this.name,
    };
  }

  private async getJson<T>(path: string, token: string): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (cause) {
      throw new ProviderError(
        this.name,
        `Falha de rede/timeout em GET ${path}`,
        { cause },
      );
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new ProviderError(
        this.name,
        `Correios respondeu HTTP ${response.status} em ${path}: ${body.slice(0, 300)}`,
      );
    }

    return (await response.json()) as T;
  }
}

/** Converte "1.234,56" (formato da API dos Correios) para 123456 centavos. */
export function parseBrlToCents(value: string): number {
  const normalized = value.replace(/\./g, "").replace(",", ".");
  const parsed = Number(normalized);
  if (Number.isNaN(parsed)) {
    throw new ProviderError(
      "correios",
      `Preço em formato inesperado: "${value}"`,
    );
  }
  return Math.round(parsed * 100);
}
