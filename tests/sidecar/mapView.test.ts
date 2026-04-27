import assert from "node:assert/strict";
import test from "node:test";

import { buildLocationMentionsForEntities, buildLocationQueriesForEntity } from "../../services/locationResolutionUtils";

test("buildLocationQueriesForEntity harvests map anchors from aliases and evidence snippets", () => {
  const queries = buildLocationQueriesForEntity({
    name: "Meridian Logistics Campus",
    aliases: ["Meridian Campus"],
    evidence: ["Dr. Lina Haddad met Maya Cohen at Meridian Logistics Campus in Tel Aviv before transfer to Ashdod Port."],
  });

  assert.ok(queries.includes("Meridian Logistics Campus"));
  assert.ok(queries.includes("Meridian Campus"));
  assert.ok(queries.includes("Tel Aviv"));
  assert.ok(queries.includes("Ashdod Port"));
});

test("buildLocationMentionsForEntities emits evidence-linked location mentions for backend resolution", () => {
  const mentions = buildLocationMentionsForEntities(
    [
      {
        id: "loc-1",
        name: "Meridian Logistics Campus",
        type: "LOCATION",
        aliases: ["Meridian Campus"],
        evidence: ["Shipment review at Meridian Logistics Campus in Tel Aviv before transfer to Ashdod Port."],
        confidence: 0.8,
        source_chunks: [4],
      },
    ],
    [{ source: "loc-1", target: "Orion Logistics", type: "OPERATED_BY", confidence: 0.7 }],
    "case-77",
  );

  assert.ok(mentions.length >= 2);
  assert.ok(mentions.every((mention) => mention.document_id === "case-77"));
  assert.ok(mentions.some((mention) => mention.raw_text === "Tel Aviv"));
  assert.ok(mentions.some((mention) => mention.surrounding_entities.includes("Orion Logistics")));
});
