const baseUrl = (process.env.OLLAMA_BASE_URL || "http://127.0.0.1:11434").replace(/\/$/, "");
const chatModel = process.env.OLLAMA_MODEL || "gemma4:e4b";
const embedModel = process.env.OLLAMA_EMBED_MODEL || "embeddinggemma";
const requestTimeoutMs = 120000;

const syntheticDocument = `
On 2026-04-12, Maya Cohen reviewed a report on Orion Logistics, Falcon Brokers, Cedar Finance Group, Ashdod, Eilat, Pier 9, and Warehouse 12.
Orion Logistics coordinated transport from Ashdod to Eilat through Pier 9 and Warehouse 12.
Cedar Finance Group funded Falcon Brokers while Maya Cohen flagged the link for follow-up.
`;

async function request(path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${path} failed with ${response.status}: ${text}`);
  }

  return response.json();
}

function extractJsonObject(content) {
  const trimmed = String(content || "").trim();
  if (!trimmed) {
    throw new Error("Chat endpoint returned empty content.");
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1));
    }
    throw new Error(`Unable to parse chat response as JSON: ${trimmed.slice(0, 240)}`);
  }
}

async function main() {
  const tagsResponse = await fetch(`${baseUrl}/api/tags`);
  if (!tagsResponse.ok) {
    throw new Error(`Unable to reach Ollama tags endpoint: ${tagsResponse.status}`);
  }

  const tagsPayload = await tagsResponse.json();
  const modelNames = (tagsPayload.models || []).flatMap((model) => [model.name, model.model]).filter(Boolean);

  if (!modelNames.some((name) => String(name).includes(chatModel))) {
    throw new Error(`Chat model "${chatModel}" is not installed locally.`);
  }

  if (!modelNames.some((name) => String(name).includes(embedModel))) {
    throw new Error(`Embedding model "${embedModel}" is not installed locally.`);
  }

  const embedPayload = await request("/api/embed", {
    model: embedModel,
    input: [
      "Orion Logistics coordinated transport between Ashdod and Eilat.",
      "Blue Lantern Holdings funded Falcon Brokers.",
    ],
  });

  const embeddings = embedPayload.embeddings || [];
  if (!embeddings.length || !Array.isArray(embeddings[0]) || !embeddings[0].length) {
    throw new Error("Embedding endpoint returned no usable vectors.");
  }

  const chatPayload = await request("/api/chat", {
    model: chatModel,
    stream: false,
    options: {
      temperature: 0,
      num_predict: 120,
    },
    messages: [
      {
        role: "system",
        content: "Return valid JSON only.",
      },
      {
        role: "user",
        content: `Read the short report below and return a compact JSON object with exactly these keys:
- status
- entities
- summary

Rules:
- status must be "ok"
- entities must contain up to 6 exact strings copied from the report
- summary must be at most 18 words

REPORT:
"""${syntheticDocument}"""`,
      },
    ],
  });

  const content = chatPayload.message?.content || chatPayload.response || "";
  const parsed = extractJsonObject(content);

  console.log(
    JSON.stringify(
      {
        baseUrl,
        chatModel,
        embedModel,
        installedModels: modelNames,
        embeddingDimensions: embeddings[0].length,
        status: parsed.status || "missing",
        entityCount: Array.isArray(parsed.entities) ? parsed.entities.length : 0,
        sampleEntities: Array.isArray(parsed.entities) ? parsed.entities.slice(0, 6) : [],
        summary: parsed.summary || "",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
