import { loadConfig } from "./config.js";
import { QuoteService } from "./core/quote-service.js";
import type { ShippingProvider } from "./core/types.js";
import { CorreiosShippingProvider } from "./providers/correios/correios-provider.js";
import { MockShippingProvider } from "./providers/mock/mock-provider.js";
import { createApp } from "./http/server.js";

const config = loadConfig();

const provider: ShippingProvider =
  config.provider === "correios"
    ? new CorreiosShippingProvider({
        credentials: {
          user: config.correios.user,
          accessCode: config.correios.accessCode,
          postageCard: config.correios.postageCard,
        },
        defaultServiceCodes: config.correios.serviceCodes,
        timeoutMs: config.correios.timeoutMs,
      })
    : new MockShippingProvider();

const quoteService = new QuoteService(provider, {
  cacheTtlSeconds: config.quoteCacheTtlSeconds,
});

if (
  config.provider === "correios" &&
  config.security.corsOrigins.includes("*")
) {
  console.warn(
    "[segurança] CORS aberto (*) com o provider real dos Correios. " +
      "Defina CORS_ORIGINS com os domínios do seu sistema antes de expor em produção.",
  );
}

const app = createApp({
  quoteService,
  providerName: provider.name,
  security: config.security,
});

app.listen(config.port, () => {
  console.log(
    `FarolEnvios no ar em http://localhost:${config.port} (provider: ${provider.name})`,
  );
});
