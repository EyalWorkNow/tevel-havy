import assert from "node:assert/strict";
import test from "node:test";

import { resolveLocationMentions } from "../../services/sidecar/location/resolver";

const originalFetch = globalThis.fetch;
const originalPeliasBase = process.env.TEVEL_PELIAS_API_BASE;

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalPeliasBase === undefined) {
    delete process.env.TEVEL_PELIAS_API_BASE;
  } else {
    process.env.TEVEL_PELIAS_API_BASE = originalPeliasBase;
  }
});

test("location resolver geocodes address-like mentions via structured Pelias path", async () => {
  process.env.TEVEL_PELIAS_API_BASE = "https://pelias.test/v1/";
  globalThis.fetch = (async (input: URL | RequestInfo) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    assert.ok(url.includes("search/structured"));
    return new Response(
      JSON.stringify({
        features: [
          {
            geometry: { coordinates: [34.7818, 32.0853] },
            properties: {
              name: "42 Herzl St",
              label: "42 Herzl St, Tel Aviv, Israel",
              country: "Israel",
              region: "Tel Aviv District",
              locality: "Tel Aviv",
              gid: "whosonfirst:address:1",
              source: "whosonfirst",
              source_id: "123",
              confidence: 0.92,
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }) as typeof fetch;

  const result = await resolveLocationMentions("case-address", [
    {
      mention_id: "m-address",
      raw_text: "42 Herzl St, Tel Aviv",
      sentence_text: "The handoff happened at 42 Herzl St, Tel Aviv.",
      document_id: "doc-1",
      surrounding_entities: ["Israel", "Tel Aviv"],
      source_confidence: 0.88,
    },
  ]);

  assert.equal(result.fallback_mode, "pelias");
  assert.equal(result.resolved_locations[0]?.resolution_method, "pelias_structured");
  assert.equal(result.resolved_locations[0]?.pin_confidence, "high");
});

test("location resolver keeps ambiguous toponyms unresolved when multiple candidates remain weak", async () => {
  process.env.TEVEL_PELIAS_API_BASE = "https://pelias.test/v1/";
  globalThis.fetch = (async () =>
    new Response(
      JSON.stringify({
        features: [
          {
            geometry: { coordinates: [35.9, 31.95] },
            properties: {
              name: "Amman",
              label: "Amman, Jordan",
              country: "Jordan",
              region: "Amman Governorate",
              locality: "Amman",
              gid: "geonames:locality:1",
              source: "geonames",
              source_id: "111",
              confidence: 0.41,
            },
          },
          {
            geometry: { coordinates: [-86.5, 34.7] },
            properties: {
              name: "Amman",
              label: "Amman, Alabama, United States",
              country: "United States",
              region: "Alabama",
              locality: "Amman",
              gid: "geonames:locality:2",
              source: "geonames",
              source_id: "222",
              confidence: 0.39,
            },
          },
        ],
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )) as typeof fetch;

  const result = await resolveLocationMentions("case-ambiguous", [
    {
      mention_id: "m-ambiguous",
      raw_text: "Amman",
      sentence_text: "The contact moved through Amman after a transfer.",
      document_id: "doc-2",
      surrounding_entities: [],
      source_confidence: 0.35,
    },
  ]);

  assert.equal(result.resolved_locations.length, 0);
  assert.equal(result.candidate_sets[0]?.accepted_location_id, undefined);
  assert.equal(result.candidate_sets[0]?.candidates.length, 2);
});

test("location resolver falls back to heuristic pins when Pelias is unavailable", async () => {
  delete process.env.TEVEL_PELIAS_API_BASE;
  const result = await resolveLocationMentions("case-heuristic", [
    {
      mention_id: "m-port",
      raw_text: "Ashdod Port",
      sentence_text: "The shipment reached Ashdod Port before inspection.",
      document_id: "doc-3",
      surrounding_entities: ["Israel"],
      source_confidence: 0.8,
    },
  ]);

  assert.equal(result.fallback_mode, "heuristic");
  assert.equal(result.resolved_locations[0]?.resolution_method, "heuristic_fallback");
  assert.equal(result.resolved_locations[0]?.pin_confidence, "medium");
});
