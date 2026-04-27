import assert from "node:assert/strict";
import test from "node:test";

import { projectEntitiesToCanonicalFtM } from "../../services/sidecar/knowledge/ftmProjector";

test("projectEntitiesToCanonicalFtM collapses duplicate multilingual person mentions into a stable FtM entity", () => {
  const projected = projectEntitiesToCanonicalFtM(
    "case-knowledge-1",
    [
      {
        entity_id: "person-1",
        name: "Mousa Abu Marzook",
        type: "PERSON",
        aliases: ["Musa Abu Marzuq", "מוסא אבו מרזוק"],
        description: "Named in the uploaded case file",
        confidence: 0.88,
        document_ids: ["doc-1"],
      },
      {
        entity_id: "person-2",
        name: "Mousa Abu Marzook",
        type: "PERSON",
        aliases: ["Mousa A. Marzook"],
        description: "Referenced again in a second fragment",
        confidence: 0.79,
        document_ids: ["doc-2"],
      },
    ],
    [],
    ["evt-1"],
  );

  assert.equal(projected.length, 1);
  assert.equal(projected[0].schema, "Person");
  assert.match(projected[0].ftm_id, /^ftm_person_/);
  assert.deepEqual(
    new Set(projected[0].source_entity_ids),
    new Set(["person-1", "person-2"]),
  );
  assert.ok(projected[0].aliases.includes("מוסא אבו מרזוק"));
  assert.ok(projected[0].aliases.includes("Mousa A. Marzook"));
  assert.ok(projected[0].merge_rationale.some((line) => /Merged/.test(line)));
});

test("projectEntitiesToCanonicalFtM maps organizations and locations into explicit FtM schemata", () => {
  const projected = projectEntitiesToCanonicalFtM("case-knowledge-2", [
    {
      entity_id: "org-1",
      name: "Meridian Institute",
      type: "ORGANIZATION",
      aliases: ["Meridian Labs"],
      confidence: 0.84,
    },
    {
      entity_id: "loc-1",
      name: "Haifa Port",
      type: "LOCATION",
      aliases: ["Port of Haifa"],
      confidence: 0.81,
    },
  ]);

  assert.equal(projected.length, 2);
  assert.equal(projected.find((entity) => entity.caption === "Meridian Institute")?.schema, "Organization");
  assert.equal(projected.find((entity) => entity.caption === "Haifa Port")?.schema, "Location");
});

