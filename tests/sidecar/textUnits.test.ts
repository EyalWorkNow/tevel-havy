import assert from "node:assert/strict";
import test from "node:test";

import {
  createTextUnits,
  mapNormalizedSpanToRawSpan,
  mapRawSpanToNormalizedSpan,
  normalizeSourceDocument,
  normalizeSourceDocumentContent,
} from "../../services/sidecar/textUnits";

test("createTextUnits preserves exact substrings and ordering", () => {
  const text = "  First paragraph line one.\nStill first paragraph.\n\nSecond paragraph mentions Orion Logistics at Pier 9.  \n";
  const normalized = normalizeSourceDocumentContent(text);
  const units = createTextUnits("doc-test", text, {
    maxChars: 80,
    metadata: { source_type: "REPORT", page_number: 1, title: "Doc Test" },
  });

  assert.equal(units.length, 2);
  assert.deepEqual(
    units.map((unit) => unit.text),
    [
      "First paragraph line one.\nStill first paragraph.",
      "Second paragraph mentions Orion Logistics at Pier 9.",
    ],
  );

  units.forEach((unit, index) => {
    assert.equal(unit.ordinal, index);
    assert.equal(normalized.slice(unit.start, unit.end), unit.text);
    assert.equal(text.slice(unit.raw_start, unit.raw_end), unit.raw_text);
    assert.ok(unit.text_unit_id.includes(`${unit.start}-${unit.end}`));
    assert.equal(unit.metadata?.source_type, "REPORT");
    assert.equal(unit.metadata?.page_number, 1);
    assert.equal(unit.metadata?.title, "Doc Test");
  });
});

test("createTextUnits splits long text without losing coverage", () => {
  const text =
    "Alpha node moved through Warehouse 12. Bravo node moved through Pier 9. Cedar Finance Group funded Orion Logistics. Maya Cohen reviewed the route.";
  const normalized = normalizeSourceDocumentContent(text);
  const units = createTextUnits("doc-long", text, { maxChars: 55 });

  assert.ok(units.length >= 3);
  assert.ok(units.every((unit) => unit.char_length <= 55));
  assert.ok(units.every((unit) => normalized.slice(unit.start, unit.end) === unit.text));
});

test("normalization preserves raw-to-normalized and normalized-to-raw span fidelity", () => {
  const rawText = " \r\nAlpha\t  Node\r\n\r\n\r\nmet  Orion Logistics  \n";
  const normalized = normalizeSourceDocument(rawText);

  assert.equal(normalized.normalized_text, "Alpha Node\n\nmet Orion Logistics");

  const alphaNodeStart = normalized.normalized_text.indexOf("Alpha Node");
  const alphaNodeEnd = alphaNodeStart + "Alpha Node".length;
  const rawAlphaNode = mapNormalizedSpanToRawSpan(alphaNodeStart, alphaNodeEnd, normalized.offset_map);
  const normalizedAlphaNode = mapRawSpanToNormalizedSpan(rawAlphaNode.start, rawAlphaNode.end, normalized.offset_map);

  assert.equal(rawText.slice(rawAlphaNode.start, rawAlphaNode.end), "Alpha\t  Node");
  assert.equal(normalizedAlphaNode.start, alphaNodeStart);
  assert.equal(normalizedAlphaNode.end, alphaNodeEnd);

  const orionRawStart = rawText.indexOf("Orion Logistics");
  const orionRawEnd = orionRawStart + "Orion Logistics".length;
  const normalizedOrion = mapRawSpanToNormalizedSpan(orionRawStart, orionRawEnd, normalized.offset_map);

  assert.equal(
    normalized.normalized_text.slice(normalizedOrion.start, normalizedOrion.end),
    "Orion Logistics",
  );
});
