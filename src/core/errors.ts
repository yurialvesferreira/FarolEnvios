/** Erros de domínio, mapeados para status HTTP na camada de transporte. */

export class InvalidQuoteRequestError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(`Pedido de cotação inválido: ${issues.join("; ")}`);
    this.name = "InvalidQuoteRequestError";
    this.issues = issues;
  }
}

export class ProviderError extends Error {
  readonly provider: string;

  constructor(provider: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderError";
    this.provider = provider;
  }
}

export class ProviderAuthError extends ProviderError {
  constructor(provider: string, message: string, options?: ErrorOptions) {
    super(provider, message, options);
    this.name = "ProviderAuthError";
  }
}
