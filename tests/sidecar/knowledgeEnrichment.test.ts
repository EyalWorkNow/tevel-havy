import assert from "node:assert/strict";
import test from "node:test";

import { enrichKnowledgeForCase } from "../../services/sidecar/knowledge/service";
import type { KnowledgeEnrichmentRequest } from "../../services/sidecar/knowledge/contracts";

const buildMockFetch = (): typeof fetch => async (input) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("wikidata.org/w/api.php")) {
    return new Response(
      JSON.stringify({
        search: [
          { id: "Q1", label: "Lina Haddad", description: "researcher", aliases: ["Dr Lina Haddad"] },
          { id: "Q2", label: "Meridian Institute", description: "research institute", aliases: ["Meridian Labs"] },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.includes("Special:EntityData/Q1.json")) {
    return new Response(
      JSON.stringify({
        entities: {
          Q1: {
            descriptions: { en: { value: "researcher" } },
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

  if (url.includes("Special:EntityData/Q2.json")) {
    return new Response(
      JSON.stringify({
        entities: {
          Q2: {
            descriptions: { en: { value: "research institute" } },
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
            id: "https://openalex.org/A1",
            display_name: "Lina Haddad",
            works_count: 77,
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
            id: "https://openalex.org/I1",
            display_name: "Meridian Institute",
            works_count: 420,
            country_code: "IL",
            type: "education",
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  if (url.includes("watchlist.local/match")) {
    return new Response(
      JSON.stringify({
        results: [
          {
            id: "watchlist:meridian-01",
            caption: "Meridian Institute",
            collection: "operator_watchlist",
            score: 0.91,
            score_breakdown: {
              alias_similarity: 0.94,
              registry_score: 0.88,
              context_score: 0.91,
            },
            explanation: ["Matched configured operator watchlist entry."],
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }

  throw new Error(`Unexpected fetch: ${url}`);
};

test("enrichKnowledgeForCase returns FtM canonical entities plus external reference knowledge and watchlist hits", async () => {
  process.env.TEVEL_YENTE_API_BASE = "https://watchlist.local";

  const request: KnowledgeEnrichmentRequest = {
    caseId: "knowledge-case-1",
    documentId: "doc-a",
    entities: [
      {
        entity_id: "person-1",
        name: "Dr. Lina Haddad",
        type: "PERSON",
        description: "Professor and researcher tied to Meridian Institute",
        aliases: ["Lina Haddad", "ד\"ר לינה חדאד"],
        confidence: 0.92,
        evidence: ["Dr. Lina Haddad briefed the team."],
        document_ids: ["doc-a"],
      },
      {
        entity_id: "org-1",
        name: "Meridian Institute",
        type: "ORGANIZATION",
        description: "Research institute operating in Haifa",
        aliases: ["Meridian Labs"],
        confidence: 0.88,
        evidence: ["Meridian Institute reviewed the transfer request."],
        document_ids: ["doc-a"],
      },
    ],
    relations: [
      {
        source: "Dr. Lina Haddad",
        target: "Meridian Institute",
        type: "ASSOCIATED_WITH",
        confidence: 0.84,
      },
    ],
    eventIds: ["evt-1"],
  };

  const result = await enrichKnowledgeForCase(request, buildMockFetch());
  const personProfile = result.reference_knowledge["person-1"];
  const orgProfile = result.reference_knowledge["org-1"];

  assert.equal(result.canonical_entities.length, 2);
  assert.equal(personProfile.ftm_schema, "Person");
  assert.ok(personProfile.links.some((link) => link.namespace === "wikidata"));
  assert.ok(personProfile.links.some((link) => link.namespace === "openalex"));
  assert.ok(personProfile.aliases.includes("לינה חדאד"));
  assert.ok(orgProfile.watchlist_hits.length > 0);
  assert.ok(result.watchlist_hits.some((hit) => hit.list_name === "operator_watchlist"));
  assert.ok(result.knowledge_sources.some((snapshot) => snapshot.namespace === "graphiti"));
});

test("enrichKnowledgeForCase keeps OpenAlex enrichment gated when research cues are weak", async () => {
  delete process.env.TEVEL_YENTE_API_BASE;

  const result = await enrichKnowledgeForCase(
    {
      caseId: "knowledge-case-2",
      documentId: "doc-b",
      entities: [
        {
          entity_id: "org-ops",
          name: "Orion Logistics",
          type: "ORGANIZATION",
          description: "Shipping and routing company",
          aliases: ["Orion"],
          confidence: 0.83,
          document_ids: ["doc-b"],
        },
      ],
    },
    buildMockFetch(),
  );

  const profile = result.reference_knowledge["org-ops"];
  assert.ok(profile.links.every((link) => link.namespace !== "openalex"));
  assert.ok(result.knowledge_sources.some((snapshot) => snapshot.namespace === "openalex" && snapshot.status === "skipped"));
});

