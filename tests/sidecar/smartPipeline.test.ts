import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { parseSourceInput } from "../../services/sidecar/parsers";
import {
  prepareSmartIngestedDocument,
  runSmartExtractionPipeline,
  searchSmartPipelinePayload,
} from "../../services/sidecar/smartPipeline";

const HTML_INPUT = `<!doctype html>
<html lang="en">
  <head>
    <title>Incident Update</title>
    <meta name="author" content="Leah Ben Ami" />
  </head>
  <body>
    <article>
      <h1>Incident Update</h1>
      <p>On 2026-04-12 Maya Cohen emailed ops@orion.example about Orion Logistics at Pier 9.</p>
      <p>Cedar Finance Group funded Falcon Brokers while North Wharf remained under review.</p>
    </article>
  </body>
</html>`;

const createSimplePdfBuffer = (text: string): Buffer => {
  const escapePdfText = (value: string): string => value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
  const stream = `BT\n/F1 18 Tf\n72 720 Td\n(${escapePdfText(text)}) Tj\nET`;
  const objects = [
    "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    "3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n",
    `4 0 obj\n<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream\nendobj\n`,
    "5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n",
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(Buffer.byteLength(pdf, "utf8"));
    pdf += object;
  }

  const xrefStart = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (let index = 1; index < offsets.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, "utf8");
};

test("smart parser uses trafilatura for HTML input and retains source artifact metadata", () => {
  const parsed = parseSourceInput({
    source_doc_id: "doc-html",
    raw_content: HTML_INPUT,
    source_mime_type: "text/html",
    source_uri: "https://example.com/incidents/update",
  });

  assert.equal(parsed.source_parser?.parser_name, "trafilatura");
  assert.equal(parsed.source_parser?.parser_view, "parsed_text");
  assert.equal(parsed.source_parser?.source_uri, "https://example.com/incidents/update");
  assert.ok(parsed.raw_content.includes("Maya Cohen emailed"));
  assert.ok(parsed.source_input_content?.includes("<html"));
});

test("smart parser leaves plain text sources untouched even when they carry a source URI", () => {
  const parsed = parseSourceInput({
    source_doc_id: "doc-plain-uri",
    raw_content: "Maya Cohen emailed Orion Logistics about Pier 9.",
    source_uri: "https://example.com/incidents/update",
    source_mime_type: "text/plain",
  });

  assert.equal(parsed.source_parser?.parser_name, "raw_text");
  assert.equal(parsed.raw_content, "Maya Cohen emailed Orion Logistics about Pier 9.");
  assert.equal(parsed.source_input_content, "Maya Cohen emailed Orion Logistics about Pier 9.");
});

test("smart parser supports HTML file ingestion without breaking provenance metadata", () => {
  const filePath = path.resolve(process.cwd(), "tests/fixtures/investigative_article.html");
  const document = prepareSmartIngestedDocument({
    source_doc_id: "doc-html-file",
    file_path: filePath,
    source_uri: "https://example.com/fixture",
  });

  assert.equal(document.source_parser?.parser_input_kind, "file");
  assert.ok(document.source_parser?.parser_name === "trafilatura" || document.source_parser?.parser_name === "plain_file");
  assert.ok(document.raw_content.includes("Cedar Finance Group funded Falcon Brokers"));
  assert.ok(document.source_input_content?.includes("<title>Incident Update</title>"));
});

test("smart parser extracts text from PDF uploads through the sidecar file parser", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tevel-pdf-test-"));
  const filePath = path.join(tempDir, "sample.pdf");
  fs.writeFileSync(filePath, createSimplePdfBuffer("Tevel PDF extraction test for Maya Cohen at Ashdod Port."));

  try {
    const parsed = parseSourceInput({
      source_doc_id: "doc-pdf-file",
      file_path: filePath,
      source_mime_type: "application/pdf",
      source_filename: "sample.pdf",
    });

    assert.ok(["docling", "pypdf"].includes(parsed.source_parser?.parser_name ?? ""));
    assert.ok(parsed.raw_content.includes("Maya Cohen"));
    assert.ok(parsed.raw_content.includes("Ashdod Port"));
    assert.equal(parsed.source_parser?.parser_input_kind, "file");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("smart parser decodes UTF-16 text uploads without mojibake", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tevel-utf16-test-"));
  const filePath = path.join(tempDir, "sample.txt");
  const utf16Content = Buffer.concat([
    Buffer.from([0xff, 0xfe]),
    Buffer.from("שלום לעולם\nMaya Cohen coordinated Ashdod Port.", "utf16le"),
  ]);
  fs.writeFileSync(filePath, utf16Content);

  try {
    const parsed = parseSourceInput({
      source_doc_id: "doc-utf16-file",
      file_path: filePath,
      source_mime_type: "text/plain",
      source_filename: "sample.txt",
    });

    assert.equal(parsed.source_parser?.parser_name, "plain_file");
    assert.ok(parsed.raw_content.includes("שלום לעולם"));
    assert.ok(parsed.raw_content.includes("Ashdod Port"));
    assert.ok(parsed.source_input_content?.includes("שלום לעולם"));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("smart parser does not leak binary upload bytes into raw_content when parsing fails", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tevel-bin-test-"));
  const filePath = path.join(tempDir, "sample.bin");
  fs.writeFileSync(filePath, Buffer.from([0x00, 0xff, 0x10, 0x80, 0x00, 0x04, 0x7f, 0x13, 0x01, 0x02]));

  try {
    const parsed = parseSourceInput({
      source_doc_id: "doc-binary-file",
      file_path: filePath,
      source_filename: "sample.bin",
    });

    assert.equal(parsed.raw_content, "");
    assert.equal(parsed.source_input_content, undefined);
    assert.equal(parsed.source_parser?.parser_input_kind, "file");
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("smart pipeline emits stronger structured relation, event, and claim outputs", () => {
  const payload = runSmartExtractionPipeline({
    source_doc_id: "doc-smart-structured",
    raw_content:
      "On 2026-04-12 Maya Cohen emailed ops@orion.example about Orion Logistics at Pier 9. Cedar Finance Group funded Falcon Brokers. Leah Ben Ami requested follow-up on North Wharf.",
  });

  assert.ok(payload.mentions.length > 0);
  const fundedRelation = payload.relation_candidates.find((relation) => relation.relation_type === "FUNDED");
  const communicationEvent = payload.event_candidates.find((event) => event.event_type === "COMMUNICATION_EVENT");
  const requestClaim = payload.claim_candidates.find((claim) => claim.claim_type === "REQUEST");
  const allowedExtractors = new Set(["spacy_rule_hybrid_v1", "spacy_gliner_hybrid_v2"]);

  assert.ok(fundedRelation);
  assert.ok(communicationEvent);
  assert.ok(requestClaim);
  assert.ok(allowedExtractors.has(String(fundedRelation!.metadata?.source_extractor)));
  assert.ok(allowedExtractors.has(String(fundedRelation!.evidence.source_extractor)));
  assert.ok(allowedExtractors.has(String(communicationEvent!.metadata?.source_extractor)));
  assert.ok(allowedExtractors.has(String(requestClaim!.metadata?.source_extractor)));
  assert.ok(payload.relation_candidates.every((relation) => relation.evidence.raw_end > relation.evidence.raw_start));
  assert.ok(payload.event_candidates.every((event) => event.evidence.raw_end > event.evidence.raw_start));
  assert.ok(payload.claim_candidates.every((claim) => claim.evidence.raw_end > claim.evidence.raw_start));
  assert.ok(payload.stats.event_count > 0);
  assert.ok(payload.stats.claim_count > 0);
});

test("smart pipeline preserves Milestone 1.5 raw-source fidelity on raw text inputs", () => {
  const payload = runSmartExtractionPipeline({
    source_doc_id: "doc-smart-fidelity",
    raw_content: " \r\nOn 2026-04-12,\tMaya  Cohen emailed ops@orion.example about Orion Logistics.\r\n",
  });
  const mayaMention = payload.mentions.find((mention) => mention.mention_text === "Maya Cohen");

  assert.ok(mayaMention);
  assert.equal(payload.raw_text.slice(mayaMention!.raw_char_start, mayaMention!.raw_char_end), "Maya  Cohen");
  assert.equal(
    payload.normalized_text.slice(mayaMention!.normalized_char_start, mayaMention!.normalized_char_end),
    "Maya Cohen",
  );
  assert.ok(mayaMention!.evidence.raw_supporting_snippet.includes("\tMaya  Cohen emailed"));
});

test("smart pipeline remains usable on noisy investigative text", () => {
  const payload = runSmartExtractionPipeline({
    source_doc_id: "doc-smart-noisy",
    raw_content:
      "SOURCE CAPTURE\r\n\r\nALPHA NODE met Falcon Brokers on 11/04/2026.\n\nCedar Finance Group funded Falcon Brokers while Maya Cohen reviewed Pier 9.\n",
  });
  const hits = searchSmartPipelinePayload(payload, "Falcon Brokers Cedar Finance", 5);

  assert.ok(payload.entities.length > 0);
  assert.ok(payload.relation_candidates.some((relation) => relation.relation_type === "FUNDED"));
  assert.ok(hits.length > 0);
  assert.ok(hits.some((hit) => hit.snippet.includes("Falcon Brokers")));
});

test("smart pipeline detects vehicle and identifier entities in non-security mixed-domain text", () => {
  const payload = runSmartExtractionPipeline({
    source_doc_id: "doc-smart-vehicle",
    raw_content:
      "On 2026-04-14 Dr. Lina Haddad inspected Toyota Corolla near Meridian Clinic Building A. Vehicle plate AX-442-19 and VIN JTMAB3FV70D123456 were recorded beside container MSCU1234567.",
  });

  const names = new Set(payload.entities.map((entity) => entity.canonical_name));
  const types = new Set(payload.entities.map((entity) => entity.entity_type));

  assert.ok(names.has("Toyota Corolla"));
  assert.ok(names.has("AX-442-19"));
  assert.ok(names.has("JTMAB3FV70D123456"));
  assert.ok(types.has("VEHICLE"));
  assert.ok(types.has("IDENTIFIER"));
});

test("smart pipeline detects untitled person names from action context", () => {
  const payload = runSmartExtractionPipeline({
    source_doc_id: "doc-smart-people",
    raw_content:
      "Investigators met Lina Haddad and later contacted Omar Saleh near Tel Aviv before transfer to Ashdod Port.",
  });

  const names = new Set(payload.entities.map((entity) => entity.canonical_name));
  const types = new Set(payload.entities.map((entity) => entity.entity_type));

  assert.ok(names.has("Lina Haddad"));
  assert.ok(names.has("Omar Saleh"));
  assert.ok(names.has("Tel Aviv"));
  assert.ok(types.has("PERSON"));
  assert.ok(types.has("LOCATION"));
});
