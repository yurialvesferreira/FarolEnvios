import { ProviderAuthError } from "../../core/errors.js";

export interface CorreiosCredentials {
  /** Usuário do Meu Correios. */
  user: string;
  /** Código de acesso à API, gerado no portal CWS. */
  accessCode: string;
  /** Número do cartão de postagem do contrato. */
  postageCard: string;
}

interface TokenResponse {
  token: string;
  expiraEm: string;
}

/** Renova o token este tempo antes de expirar, para evitar corrida. */
const EXPIRY_MARGIN_MS = 5 * 60 * 1000;

/**
 * Gerencia o token JWT do CWS (válido por ~24h). Uma única autenticação é
 * compartilhada entre chamadas concorrentes via `pending`.
 */
export class CorreiosTokenManager {
  private readonly baseUrl: string;
  private readonly credentials: CorreiosCredentials;
  private token: string | null = null;
  private expiresAt = 0;
  private pending: Promise<string> | null = null;

  constructor(credentials: CorreiosCredentials, baseUrl: string) {
    this.credentials = credentials;
    this.baseUrl = baseUrl;
  }

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.expiresAt - EXPIRY_MARGIN_MS) {
      return this.token;
    }
    this.pending ??= this.authenticate().finally(() => {
      this.pending = null;
    });
    return this.pending;
  }

  private async authenticate(): Promise<string> {
    const basic = Buffer.from(
      `${this.credentials.user}:${this.credentials.accessCode}`,
    ).toString("base64");

    let response: Response;
    try {
      response = await fetch(
        `${this.baseUrl}/token/v1/autentica/cartaopostagem`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${basic}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ numero: this.credentials.postageCard }),
        },
      );
    } catch (cause) {
      throw new ProviderAuthError(
        "correios",
        "Falha de rede ao autenticar nos Correios",
        { cause },
      );
    }

    if (!response.ok) {
      throw new ProviderAuthError(
        "correios",
        `Autenticação nos Correios falhou (HTTP ${response.status}). ` +
          "Verifique CORREIOS_USER, CORREIOS_ACCESS_CODE e CORREIOS_POSTAGE_CARD.",
      );
    }

    const body = (await response.json()) as TokenResponse;
    this.token = body.token;
    this.expiresAt = Date.parse(body.expiraEm);
    return this.token;
  }
}
