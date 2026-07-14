# FarolEnvios 🔦

Boilerplate plugável para **cotação de frete via API dos Correios (CWS)**, com:

- **API REST** mínima (`POST /api/quotes`) para plugar em qualquer sistema web;
- **Provider mock** que funciona sem credenciais `npm run dev` e já dá para validar;
- **Provider Correios** real (api.correios.com.br), ativado por variável de ambiente;
- **Frontend mínimo** em vanilla JS para as primeiras validações;
- Núcleo de domínio desacoplado (validação com Zod, cache em memória, dinheiro em centavos).

## Início rápido

```bash
npm install
npm run dev
# abra http://localhost:3000
```

Sem configurar nada, o provider é o **mock**: preços plausíveis e determinísticos,
ótimos para desenvolver o frontend e a integração antes de ter contrato com os Correios.

## Usando a API dos Correios de verdade

A API pública antiga dos Correios foi descontinuada. A atual (**CWS - Correios
Web Services**) exige **contrato** e credenciais geradas em
[cws.correios.com.br](https://cws.correios.com.br):

```bash
cp .env.example .env
# edite o .env:
#   SHIPPING_PROVIDER=correios
#   CORREIOS_USER=seu-usuario-meu-correios
#   CORREIOS_ACCESS_CODE=codigo-de-acesso-da-api   # não é a senha do portal!
#   CORREIOS_POSTAGE_CARD=numero-do-cartao-de-postagem
npm run dev
```

Códigos de serviço padrão: `03220` (SEDEX contrato) e `03298` (PAC contrato)
ajuste em `CORREIOS_SERVICES` conforme o seu contrato.

## API

### `POST /api/quotes`

```jsonc
// request
{
  "originZip": "01310-100", // com ou sem hífen
  "destinationZip": "90010150",
  "package": {
    "weightGrams": 800, // 1 a 30.000
    "lengthCm": 20, // 15 a 100
    "widthCm": 15, // 10 a 100
    "heightCm": 10, // 1 a 100
  },
  "declaredValueCents": 15000, // opcional (seguro)
  "serviceCodes": ["03220"], // opcional; omite = todos os configurados
}
```

```jsonc
// response 200 — ordenado por preço crescente
{
  "quotes": [
    {
      "serviceCode": "03298",
      "serviceName": "PAC",
      "priceCents": 2134, // dinheiro sempre em centavos (int)
      "deadlineBusinessDays": 6,
      "provider": "mock",
    },
  ],
}
```

Erros: `422` (payload inválido, com lista `issues`), `502` (falha no provider),
`500` (inesperado).

### `GET /api/health`

`{ "status": "ok", "provider": "mock" }` útil para o frontend exibir qual
provider está ativo e para probes de liveness.

## Arquitetura

```text
src/
├── core/                    # domínio puro, sem HTTP nem Correios
│   ├── types.ts             # QuoteRequest, ShippingQuote, ShippingProvider (porta)
│   ├── quote-service.ts     # validação (Zod) + cache TTL + ordenação
│   └── errors.ts            # erros de domínio → mapeados p/ status HTTP
├── providers/               # adapters (implementações da porta ShippingProvider)
│   ├── correios/            # CWS: auth por token JWT + APIs de preço e prazo
│   └── mock/                # determinístico, para dev/testes/CI
├── http/server.ts           # Express fino: parse, CORS, mapa de erros
├── config.ts                # env → config validada (fail-fast)
└── index.ts                 # composição: escolhe provider e sobe o servidor
public/                      # frontend mínimo (vanilla, sem build)
test/                        # vitest
```

**Decisões que importam ao plugar em outro sistema:**

- **Porta e adapters (hexagonal):** o resto do sistema só conhece
  `ShippingProvider`. Para adicionar Jadlog, Loggi, Melhor Envio etc., crie um
  adapter em `src/providers/` e registre no factory de `src/index.ts` nada
  mais muda.
- **Dinheiro em centavos (inteiros):** evita erros de ponto flutuante. A
  conversão do formato `"1.234,56"` dos Correios acontece na borda do adapter.
- **Mock como default:** desenvolvimento, testes e CI não dependem de
  credenciais nem da disponibilidade dos Correios. Os códigos de serviço do
  mock espelham os reais, então trocar de provider não quebra consumidores.
- **Cache com TTL:** cotações idênticas dentro de `QUOTE_CACHE_TTL_SECONDS`
  não repetem a chamada aos Correios (latência alta e limites de taxa). Para
  múltiplas instâncias, troque o `Map` por Redis mantendo a mesma chave.
- **Falha parcial tolerada:** se um serviço não atende o trecho, os demais
  ainda retornam; só falha se nenhum cotar.
- **Camada HTTP descartável:** para usar dentro de um app Express/Nest/Next
  existente, importe `QuoteService` + um provider e exponha na sua própria
  rota a pasta `http/` é só uma conveniência.

## Como plugar no seu sistema

**Opção A - microserviço:** rode o FarolEnvios como está e chame
`POST /api/quotes` do seu backend ou frontend (CORS já habilitado; restrinja o
`origin` em produção em `src/http/server.ts`).

**Opção B - biblioteca:** importe o núcleo no seu código:

```ts
import { QuoteService } from "./core/quote-service.js";
import { CorreiosShippingProvider } from "./providers/correios/correios-provider.js";

const service = new QuoteService(
  new CorreiosShippingProvider({
    credentials: { user, accessCode, postageCard },
    defaultServiceCodes: ["03220", "03298"],
  }),
  { cacheTtlSeconds: 300 },
);

const quotes = await service.getQuotes({
  originZip,
  destinationZip,
  package: pkg,
});
```

## Segurança

O boilerplate sai endurecido por padrão: validação estrita de entrada (Zod),
cabeçalhos de segurança (helmet), rate limiting por IP, limite de body,
CORS configurável por ambiente, timeouts nas chamadas externas e `npm audit`
limpo com Dependabot habilitado.

As decisões de segurança, os vetores considerados e o **checklist antes de
expor em produção** estão documentados em [SECURITY.md](SECURITY.md).

## Scripts

| Comando             | O que faz                       |
| ------------------- | ------------------------------- |
| `npm run dev`       | servidor com reload (tsx watch) |
| `npm run build`     | compila TypeScript para `dist/` |
| `npm start`         | roda o build de produção        |
| `npm test`          | testes (vitest)                 |
| `npm run typecheck` | checagem de tipos sem emitir    |

## Limitações conhecidas (por ser boilerplate)

- Cache e rate limit em memória (não compartilhados entre instâncias — use
  Redis ao escalar horizontalmente);
- Sem autenticação no endpoint público — adicione API key/JWT se o consumo
  não for anônimo (veja [SECURITY.md](SECURITY.md));
- Prazo (`/prazo`) e preço (`/preco`) são duas chamadas por serviço no CWS;
- Sem retry/backoff nas chamadas aos Correios (timeout simples de 10s).
