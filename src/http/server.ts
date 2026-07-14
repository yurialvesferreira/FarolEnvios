import path from "node:path";
import { fileURLToPath } from "node:url";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
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

export interface CreateAppOptions {
  quoteService: QuoteService;
  providerName: string;
}

/**
 * Camada de transporte, deliberadamente fina: parse do body, CORS e mapa
 * de erros → status. Toda regra de negócio vive em QuoteService.
 */
export function createApp({ quoteService, providerName }: CreateAppOptions) {
  const app = express();
  app.use(express.json());

  // CORS aberto para facilitar plugar o endpoint em qualquer frontend.
  // Em produção, restrinja o origin ao(s) domínio(s) do seu sistema.
  app.use((req, res, next) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") {
      res.sendStatus(204);
      return;
    }
    next();
  });

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
      console.error(error);
      res.status(500).json({ error: "Erro interno" });
    },
  );

  return app;
}
