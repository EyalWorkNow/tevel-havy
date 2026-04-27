import { performance } from "node:perf_hooks";

import { projectEntitiesToCanonicalFtM } from "../services/sidecar/knowledge/ftmProjector";
import { enrichKnowledgeForCase } from "../services/sidecar/knowledge/service";
import type { KnowledgeEnrichmentRequest } from "../services/sidecar/knowledge/contracts";

const FIXTURE_REQUEST: KnowledgeEnrichmentRequest = {
  caseId: "benchmark-case",
  documentId: "benchmark-doc",
  entities: [
    {
      entity_id: "person-1",
      name: "Dr. Lina Haddad",
      type: "PERSON",
      description: "Professor and researcher tied to Meridian Institute",
      aliases: ["Lina Haddad", "ד\"ר לינה חדאד"],
      confidence: 0.91,
      evidence: ["Dr. Lina Haddad briefed analysts at Meridian Institute."],
      document_ids: ["benchmark-doc"],
    },
    {
      entity_id: "org-1",
      name: "Meridian Institute",
      type: "ORGANIZATION",
      description: "Research institute operating in Haifa",
      aliases: ["Meridian Labs"],
      confidence: 0.88,
      evidence: ["Meridian Institute reviewed the transfer request."],
      document_ids: ["benchmark-doc"],
    },
  ],
  relations: [
    {
      source: "Dr. Lina Haddad",
      target: "Meridian Institute",
      type: "ASSOCIATED_WITH",
      confidence: 0.82,
    },
  ],
  eventIds: ["evt-1", "evt-2"],
};

const mockedFetch: typeof fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("wikidata.org/w/api.php")) {
    return new Response(
      JSON.stringify({
        search: [
          { id: "Q123", label: "Lina Haddad", description: "researcher", aliases: ["Dr Lina Haddad"] },
          { id: "Q456", label: "Meridian Institute", description: "research institute", aliases: ["Meridian Labs"] },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.includes("Special:EntityData/Q123.json")) {
    return new Response(
      JSON.stringify({
        entities: {
          Q123: {
            descriptions: {
              en: { value: "researcher" },
            },
            aliases: {
              en: [{ value: "Dr Lina Haddad" }],
              he: [{ value: "לינה חדאד" }],
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.includes("Special:EntityData/Q456.json")) {
    return new Response(
      JSON.stringify({
        entities: {
          Q456: {
            descriptions: {
              en: { value: "research institute" },
            },
            aliases: {
              en: [{ value: "Meridian Labs" }],
            },
          },
        },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.includes("api.openalex.org/authors")) {
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "https://openalex.org/A123",
            display_name: "Lina Haddad",
            works_count: 55,
            last_known_institution: {
              display_name: "Meridian Institute",
              country_code: "IL",
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.includes("api.openalex.org/institutions")) {
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "https://openalex.org/I123",
            display_name: "Meridian Institute",
            works_count: 410,
            country_code: "IL",
            type: "education",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.includes("/match")) {
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "watchlist:meridian-01",
            caption: "Meridian Institute",
            collection: "operator_watchlist",
            score: 0.89,
            score_breakdown: {
              alias_similarity: 0.92,
              registry_score: 0.85,
              context_score: 0.9,
            },
            explanation: ["Matched configured operator watchlist entry."],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ ok: true, url, init }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
};

const round = (value: number, digits = 2) => Number(value.toFixed(digits));

const main = async () => {
  process.env.TEVEL_YENTE_API_BASE = "https://watchlist.local";
  const projectionStart = performance.now();
  const canonical = projectEntitiesToCanonicalFtM(
    FIXTURE_REQUEST.caseId,
    FIXTURE_REQUEST.entities,
    FIXTURE_REQUEST.relations,
    FIXTURE_REQUEST.eventIds,
  );
  const projectionMs = performance.now() - projectionStart;

  const enrichmentStart = performance.now();
  const enriched = await enrichKnowledgeForCase(FIXTURE_REQUEST, mockedFetch);
  const enrichmentMs = performance.now() - enrichmentStart;

  console.log(
    JSON.stringify(
      {
        projection_ms: round(projectionMs),
        enrichment_ms: round(enrichmentMs),
        canonical_entity_count: canonical.length,
        reference_link_count: Object.values(enriched.reference_knowledge).reduce(
          (acc, profile) => acc + profile.links.length,
          0,
        ),
        watchlist_hit_count: enriched.watchlist_hits.length,
        warning_count: enriched.reference_warnings.length,
      },
      null,
      2,
    ),
  );
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

