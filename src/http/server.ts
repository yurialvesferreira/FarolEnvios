import path from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import {
  InvalidQuoteRequestError,
  ProviderAuthError,
  ProviderError,
} from "../core/errors.js";
import type { QuoteService } from "../core/quote-service.js";

const publicDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../public",
);

/** Limite generoso: o maior payload legítimo de cotação tem ~300 bytes. */
const JSON_BODY_LIMIT = "10kb";

export interface SecurityOptions {
  /**
   * Origens permitidas no CORS. `["*"]` libera qualquer origem (só para
   * desenvolvimento). Em produção, liste os domínios do seu sistema.
   */
  corsOrigins: string[];
  /**
   * Habilite quando atrás de reverse proxy (Nginx, load balancer) para que
   * o rate limit enxergue o IP real do cliente via X-Forwarded-For.
   */
  trustProxy: boolean;
  /** Janela e teto do rate limit por IP nas rotas /api. */
  rateLimit: { windowSeconds: number; max: number };
}

export interface CreateAppOptions {
  quoteService: QuoteService;
  providerName: string;
  security: SecurityOptions;
}

/**
 * Camada de transporte, deliberadamente fina: parse do body, controles de
 * segurança (headers, CORS, rate limit) e mapa de erros → status.
 * Toda regra de negócio vive em QuoteService.
 */
export function createApp({
  quoteService,
  providerName,
  security,
}: CreateAppOptions) {
  const app = express();

  app.disable("x-powered-by");
  if (security.trustProxy) {
    app.set("trust proxy", 1);
  }

  // Cabeçalhos de segurança (CSP, X-Content-Type-Options, frameguard etc.).
  // O frontend em public/ não usa scripts nem estilos inline, então a CSP
  // padrão do helmet ("self") funciona sem exceções.
  app.use(helmet());

  app.use(express.json({ limit: JSON_BODY_LIMIT }));

  const allowAnyOrigin = security.corsOrigins.includes("*");
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (allowAnyOrigin) {
      res.setHeader("Access-Control-Allow-Origin", "*");
    } else if (origin && security.corsOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

  app.use(
    "/api",
    rateLimit({
      windowMs: security.rateLimit.windowSeconds * 1000,
      limit: security.rateLimit.max,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      message: {
        error: "Muitas requisições deste IP. Tente novamente em instantes.",
      },
    }),
  );

  app.use(express.static(publicDir));

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok", provider: providerName });
  });

  app.post("/api/quotes", async (req, res, next) => {
    try {
      const quotes = await quoteService.getQuotes(req.body);
      res.json({ quotes });
    } catch (error) {
      next(error);
    }
  });

  // Mapa de erros: detalhes técnicos ficam nos logs do servidor; o cliente
  // recebe apenas mensagens genéricas (evita information disclosure).
  app.use(
    (error: unknown, _req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof InvalidQuoteRequestError) {
        res.status(422).json({ error: error.message, issues: error.issues });
        return;
      }
      if (error instanceof ProviderAuthError) {
        console.error(error);
        res.status(502).json({
          error: "Falha de autenticação junto ao provider de frete",
        });
        return;
      }
      if (error instanceof ProviderError) {
        console.error(error);
        res.status(502).json({
          error: "O provider de frete não conseguiu cotar este envio",
        });
        return;
      }
      // Erros 4xx do body-parser (JSON inválido → 400, body > limite → 413):
      // devolve o status correto sem vazar detalhes internos.
      const httpError = error as { status?: unknown; expose?: unknown };
      if (
        typeof httpError.status === "number" &&
        httpError.status >= 400 &&
        httpError.status < 500
      ) {
        res.status(httpError.status).json({
          error:
            httpError.status === 413
              ? "Payload excede o tamanho máximo permitido"
              : "Requisição malformada",
        });
        return;
      }
      console.error(error);
      res.status(500).json({ error: "Erro interno" });
    },
  );

  return app;
}
