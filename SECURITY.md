# 🛡️ Security Policy — FarolEnvios

Este documento descreve as decisões de segurança implementadas no boilerplate **FarolEnvios**, os vetores de risco considerados e as instruções para reportar vulnerabilidades.

---

## 📋 Versões Suportadas

| Versão | Suportada |
|--------|-----------|
| `main` | ✅ Ativa |

---

## 🔒 Decisões de Segurança Implementadas

### 1. Validação Estrita de Entrada (Zod)

**Vetor:** Payloads maliciosos ou malformados — tipos inesperados, valores fora de domínio, campos extras injetados (mass assignment).

**Solução adotada:** todo input passa por um schema Zod antes de tocar qualquer regra de negócio. CEPs são normalizados e validados por regex, dimensões e peso têm limites de domínio (os mesmos dos Correios) e **campos desconhecidos são descartados** na saída do parse:

```ts
// src/core/quote-service.ts
const zipSchema = z
  .string()
  .transform((value) => value.replace(/\D/g, ""))
  .pipe(z.string().regex(/^\d{8}$/, "CEP deve ter 8 dígitos"));

package: z.object({
  weightGrams: z.number().int().min(1).max(30_000),
  // ...
})
```

A validação vive no **núcleo de domínio**, não na rota HTTP — quem acoplar o `QuoteService` diretamente (sem a camada Express) herda a mesma proteção.

---

### 2. Ocultação de Erros Internos (Information Disclosure)

**Vetor:** stack traces, URLs internas ou respostas cruas dos Correios vazando para o cliente.

**Solução adotada:** erros de domínio são mapeados para respostas genéricas; o detalhe técnico fica apenas no log do servidor:

```ts
// src/http/server.ts
if (error instanceof ProviderError) {
  console.error(error); // detalhe completo: só no log interno
  res.status(502).json({
    error: "O provider de frete não conseguiu cotar este envio",
  });
}
```

O único erro detalhado ao cliente é o `422` de validação — que descreve o *pedido dele*, nunca o sistema.

---

### 3. Proteção de Segredos (.env e credenciais Correios)

**Vetor:** commit acidental de credenciais do contrato (usuário, código de acesso, cartão de postagem) ou vazamento delas em logs e respostas.

**Solução adotada:**

```gitignore
# .gitignore — o .env real nunca é commitado
.env
```

- O repositório versiona apenas o `.env.example`, com placeholders vazios;
- As credenciais são lidas uma única vez no boot (`src/config.ts`) com **fail-fast**: se `SHIPPING_PROVIDER=correios` e faltar credencial, o processo não sobe;
- O token JWT dos Correios vive **somente em memória** (`CorreiosTokenManager`), com renovação automática antes de expirar;
- Nenhuma credencial aparece em mensagens de erro ou logs — as falhas de autenticação apontam *quais variáveis revisar*, nunca seus valores.

---

### 4. CORS Restritivo e Configurável

**Vetor:** `Access-Control-Allow-Origin: *` permitindo que qualquer site consuma a API em nome dos visitantes.

**Solução adotada:** origens permitidas são configuráveis por ambiente, com validação de origem por requisição:

```bash
# .env — produção
CORS_ORIGINS=https://minhaloja.com.br,https://admin.minhaloja.com.br
```

O padrão `*` existe apenas para desenvolvimento; se o provider real dos Correios sobe com CORS aberto, o servidor **loga um aviso explícito** no boot.

---

### 5. Cabeçalhos de Segurança (helmet)

**Vetor:** clickjacking, MIME sniffing, ausência de Content-Security-Policy.

**Solução adotada:** o [helmet](https://helmetjs.github.io/) aplica o conjunto padrão de cabeçalhos (CSP `default-src 'self'`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`, HSTS etc.). O frontend em `public/` foi escrito **sem scripts nem estilos inline** justamente para funcionar sob CSP estrita, sem exceções. O header `X-Powered-By` é desabilitado.

---

### 6. Rate Limiting por IP

**Vetor:** abuso do endpoint público de cotação — cada requisição pode gerar chamadas à API dos Correios (que tem limites de contrato) — e DoS básico.

**Solução adotada:** `express-rate-limit` em todas as rotas `/api`, configurável por ambiente:

```bash
RATE_LIMIT_WINDOW_SECONDS=60
RATE_LIMIT_MAX=60          # 60 req/min por IP → HTTP 429 ao exceder
TRUST_PROXY=true           # atrás de reverse proxy, usa o IP real (X-Forwarded-For)
```

O cache com TTL do `QuoteService` complementa: cotações repetidas nem chegam aos Correios.

---

### 7. Limite de Tamanho de Body

**Vetor:** payloads gigantes esgotando memória do processo.

**Solução adotada:** `express.json({ limit: "10kb" })` — o maior payload legítimo de cotação tem ~300 bytes; 10 kB já é folga generosa.

---

### 8. Chamadas Externas com Timeout e URLs Fixas (anti-SSRF)

**Vetor:** SSRF (input do usuário virando URL de requisição) e conexões penduradas esgotando recursos.

**Solução adotada:** a base da URL dos Correios é fixa no adapter; input do usuário entra **apenas como query string escapada** via `URLSearchParams`, nunca compõe host ou caminho. Toda chamada tem `AbortSignal.timeout` (10s por padrão):

```ts
// src/providers/correios/correios-provider.ts
const precoParams = new URLSearchParams({ cepOrigem: request.originZip, ... });
fetch(`${this.baseUrl}/preco/v1/nacional/${serviceCode}?${precoParams}`, {
  signal: AbortSignal.timeout(this.timeoutMs),
});
```

---

### 9. Frontend sem XSS

**Vetor:** dados da API (ou manipulados por proxy) injetando HTML/script na página.

**Solução adotada:** o frontend monta o DOM exclusivamente com `createElement` e `textContent` — **nenhum `innerHTML`** em todo o código. Combinado com a CSP do helmet, script injetado não executa nem se chegasse ao DOM.

---

### 10. Dependências Auditadas Continuamente

**Vetor:** vulnerabilidades conhecidas em dependências transitivas.

**Solução adotada:**

- `npm audit` limpo: **0 vulnerabilidades** na data desta revisão;
- **Dependabot** habilitado (`.github/dependabot.yml`): PRs semanais para atualizações de segurança;
- Superfície mínima: apenas 5 dependências de produção (`express`, `helmet`, `express-rate-limit`, `zod`, `dotenv`).

---

## ✅ Checklist Antes de Expor em Produção

O boilerplate sai seguro por padrão, mas alguns controles dependem do seu ambiente:

- [ ] Definir `CORS_ORIGINS` com os domínios reais (remover `*`);
- [ ] Servir atrás de HTTPS (reverse proxy Nginx/Caddy ou plataforma com TLS) — o HSTS do helmet só tem efeito sob HTTPS;
- [ ] `TRUST_PROXY=true` se houver reverse proxy, para o rate limit usar o IP real;
- [ ] Adicionar **autenticação** (API key/JWT) se o endpoint não for de consumo público anônimo;
- [ ] Trocar o cache em memória por Redis ao rodar múltiplas instâncias (evita rate limit e cache inconsistentes);
- [ ] Manter os PRs do Dependabot em dia.

---

## 🚨 Reportando uma Vulnerabilidade

Se você encontrar uma vulnerabilidade de segurança neste repositório:

1. **NÃO abra uma issue pública.** Isso expõe o problema antes que possa ser corrigido.
2. Use o **report privado do GitHub** (aba *Security* → *Report a vulnerability*) ou envie e-mail diretamente ao mantenedor descrevendo:
   - O vetor de ataque;
   - Passos para reproduzir;
   - Impacto potencial.
3. Você receberá uma resposta em até **72 horas**.
4. Após a correção ser publicada, a vulnerabilidade poderá ser divulgada publicamente (*responsible disclosure*).

---

## 🔮 Melhorias Futuras de Segurança

Para versões futuras do FarolEnvios, considere implementar:

- [ ] **Autenticação por API key** com escopos por consumidor;
- [ ] **Rate limit distribuído** (Redis) para múltiplas instâncias;
- [ ] **Logs estruturados** (pino) com redação automática de campos sensíveis;
- [ ] **CI com `npm audit` bloqueante** e testes em cada PR;
- [ ] **Secrets Manager** (AWS Secrets Manager, HashiCorp Vault) para as credenciais dos Correios em produção.

---

*Documento mantido pela comunidade FarolEnvios. Última revisão: Julho 2026.*
