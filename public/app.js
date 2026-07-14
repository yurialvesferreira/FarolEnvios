/**
 * Frontend mínimo de validação do FarolEnvios.
 * Sem framework nem build: consome apenas POST /api/quotes e GET /api/health.
 */

const form = document.getElementById("quote-form");
const submitBtn = document.getElementById("submit-btn");
const feedback = document.getElementById("feedback");
const results = document.getElementById("results");
const quotesList = document.getElementById("quotes-list");
const providerBadge = document.getElementById("provider-badge");

const brl = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

async function loadHealth() {
  try {
    const response = await fetch("/api/health");
    const body = await response.json();
    providerBadge.textContent = `provider: ${body.provider}`;
  } catch {
    providerBadge.textContent = "API indisponível";
  }
}

function showFeedback(message, kind = "error") {
  feedback.textContent = message;
  feedback.className = kind === "info" ? "feedback info" : "feedback";
  feedback.hidden = false;
}

function hideFeedback() {
  feedback.hidden = true;
}

function renderQuotes(quotes) {
  quotesList.replaceChildren(
    ...quotes.map((quote) => {
      const item = document.createElement("div");
      item.className = "quote";

      const info = document.createElement("div");
      const service = document.createElement("div");
      service.className = "service";
      service.textContent = quote.serviceName;
      const meta = document.createElement("div");
      meta.className = "meta";
      const days = quote.deadlineBusinessDays;
      meta.textContent = `${days} ${days === 1 ? "dia útil" : "dias úteis"} · código ${quote.serviceCode}`;
      info.append(service, meta);

      const price = document.createElement("div");
      price.className = "price";
      price.textContent = brl.format(quote.priceCents / 100);

      item.append(info, price);
      return item;
    }),
  );
  results.hidden = false;
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  hideFeedback();
  results.hidden = true;
  submitBtn.disabled = true;
  submitBtn.textContent = "Cotando…";

  const data = new FormData(form);
  const declaredValue = parseFloat(data.get("declaredValue"));

  const payload = {
    originZip: data.get("originZip"),
    destinationZip: data.get("destinationZip"),
    package: {
      weightGrams: Number(data.get("weightGrams")),
      lengthCm: Number(data.get("lengthCm")),
      widthCm: Number(data.get("widthCm")),
      heightCm: Number(data.get("heightCm")),
    },
  };
  if (!Number.isNaN(declaredValue) && declaredValue > 0) {
    payload.declaredValueCents = Math.round(declaredValue * 100);
  }

  try {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await response.json();

    if (!response.ok) {
      const issues = body.issues ? `\n• ${body.issues.join("\n• ")}` : "";
      showFeedback(`${body.error ?? "Erro ao cotar"}${issues}`);
      return;
    }

    if (body.quotes.length === 0) {
      showFeedback("Nenhuma opção de frete disponível para este envio.", "info");
      return;
    }

    renderQuotes(body.quotes);
  } catch {
    showFeedback("Não foi possível conectar à API. O servidor está rodando?");
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = "Cotar frete";
  }
});

loadHealth();
