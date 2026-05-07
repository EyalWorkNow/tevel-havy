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

test("createTextUnits classifies markdown table rows as table_row kind", () => {
  const text = "| Name | Role | Country |\n| --- | --- | --- |\n| Orion Logistics | Shipper | AE |\n| Cedar Finance | Funder | CH |";
  const units = createTextUnits("doc-table", text, { maxChars: 500 });

  const tableRows = units.filter((u) => u.kind === "table_row");
  assert.ok(tableRows.length >= 2, `Expected ≥2 table_row units, got ${tableRows.length}`);
  assert.ok(tableRows.every((u) => u.text.startsWith("|")), "All table_row units should start with |");
  const sepRow = units.find((u) => u.text.match(/^\|[-| :]+\|/));
  assert.equal(sepRow, undefined, "Separator row should not be emitted as a text unit");
});

test("createTextUnits classifies headings as heading kind", () => {
  const text = "CONTRACT TERMS\n\nThis agreement is between parties.\n\n## Scope of Work\n\nAll deliverables are defined herein.";
  const units = createTextUnits("doc-heading", text, { maxChars: 500 });

  const headings = units.filter((u) => u.kind === "heading");
  assert.ok(headings.length >= 1, `Expected ≥1 heading unit, got ${headings.length}`);
});

test("createTextUnits classifies emphasis blocks as emphasis_block kind", () => {
  const text = "Background context.\n\nIMPORTANT NOTE: All shipments require prior authorization.\n\nFurther details follow.";
  const units = createTextUnits("doc-emphasis", text, { maxChars: 500 });

  const emphasis = units.filter((u) => u.kind === "emphasis_block");
  assert.ok(emphasis.length >= 1, `Expected ≥1 emphasis_block unit, got ${emphasis.length}`);
  assert.ok(emphasis[0].text.includes("IMPORTANT NOTE"), "emphasis_block should contain the IMPORTANT NOTE text");
});

test("createTextUnits classifies form fields as form_field kind", () => {
  const text = "VENDOR NAME: Orion Logistics Ltd\nCONTRACT NO: OL-2025-001\nEFFECTIVE DATE: 2025-01-01";
  const units = createTextUnits("doc-form", text, { maxChars: 500 });

  const formFields = units.filter((u) => u.kind === "form_field");
  assert.ok(formFields.length >= 1, `Expected ≥1 form_field unit, got ${formFields.length}`);
});
