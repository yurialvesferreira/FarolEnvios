import "dotenv/config";

export interface AppConfig {
  port: number;
  provider: "mock" | "correios";
  quoteCacheTtlSeconds: number;
  security: {
    corsOrigins: string[];
    trustProxy: boolean;
    rateLimit: { windowSeconds: number; max: number };
  };
  correios: {
    user: string;
    accessCode: string;
    postageCard: string;
    serviceCodes: string[];
    timeoutMs: number;
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const provider = env.SHIPPING_PROVIDER ?? "mock";
  if (provider !== "mock" && provider !== "correios") {
    throw new Error(
      `SHIPPING_PROVIDER inválido: "${provider}" (use "mock" ou "correios")`,
    );
  }

  const config: AppConfig = {
    port: Number(env.PORT ?? 3000),
    provider,
    quoteCacheTtlSeconds: Number(env.QUOTE_CACHE_TTL_SECONDS ?? 300),
    security: {
      corsOrigins: (env.CORS_ORIGINS ?? "*")
        .split(",")
        .map((origin) => origin.trim())
        .filter(Boolean),
      trustProxy: env.TRUST_PROXY === "true",
      rateLimit: {
        windowSeconds: Number(env.RATE_LIMIT_WINDOW_SECONDS ?? 60),
        max: Number(env.RATE_LIMIT_MAX ?? 60),
      },
    },
    correios: {
      user: env.CORREIOS_USER ?? "",
      accessCode: env.CORREIOS_ACCESS_CODE ?? "",
      postageCard: env.CORREIOS_POSTAGE_CARD ?? "",
      serviceCodes: (env.CORREIOS_SERVICES ?? "03220,03298")
        .split(",")
        .map((code) => code.trim())
        .filter(Boolean),
      timeoutMs: Number(env.CORREIOS_TIMEOUT_MS ?? 10_000),
    },
  };

  if (config.provider === "correios") {
    const missing = [
      ["CORREIOS_USER", config.correios.user],
      ["CORREIOS_ACCESS_CODE", config.correios.accessCode],
      ["CORREIOS_POSTAGE_CARD", config.correios.postageCard],
    ]
      .filter(([, value]) => !value)
      .map(([name]) => name);
    if (missing.length > 0) {
      throw new Error(
        `SHIPPING_PROVIDER=correios exige as variáveis: ${missing.join(", ")}`,
      );
    }
  }

  return config;
}
