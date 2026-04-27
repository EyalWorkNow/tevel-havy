import path from "node:path";
import { performance } from "node:perf_hooks";

import {
  buildSmartExtractionPayload,
  buildSmartPipelineLexicalIndex,
  prepareSmartIngestedDocument,
} from "../services/sidecar/smartPipeline";
import { searchLexicalIndex } from "../services/sidecar/retrieval";
import { buildRetrievalArtifactsFromPayload } from "../services/sidecar/retrieval";
import { buildTemporalEventRecords } from "../services/sidecar/temporal/projector";
import { SidecarSourceInput } from "../services/sidecar/parsers";

type BenchmarkDoc = SidecarSourceInput & {
  id: string;
  queries: string[];
};

const FIXTURE_HTML_PATH = path.resolve(process.cwd(), "tests/fixtures/investigative_article.html");

const BASE_CORPUS: Array<{
  id: string;
  queries: string[];
  text: string;
}> = [
  {
    id: "doc-maritime",
    queries: ["Behshad Houthi Red Sea", "IRGC Eilat diversion"],
    text: `INTERCEPTED SIGNAL
SOURCE: Houthi Coastal Battery, Hodeidah
DATE: 2026-04-12

Radar signature confirmed activation of anti-ship missile battery at grid 44R.
Simultaneous telemetry link detected from IRGC ship Behshad in the Red Sea.
Drone swarm launched toward Eilat as diversion while Orion Logistics handled a shadow shipment through Pier 9.`,
  },
  {
    id: "doc-finance",
    queries: ["Orion Logistics Cedar Finance", "Maya Cohen Eilat"],
    text: `On 2026-04-12, Maya Cohen reviewed a report on Orion Logistics, Falcon Brokers, Cedar Finance Group, Ashdod, Eilat, Pier 9, and Warehouse 12.
Orion Logistics coordinated transport from Ashdod to Eilat through Pier 9 and Warehouse 12.
Cedar Finance Group funded Falcon Brokers while Maya Cohen flagged the link for follow-up via ops@orion.example.`,
  },
  {
    id: "doc-cyber",
    queries: ["wallet Tehran hospital", "C2 server ransomware"],
    text: `INCIDENT REPORT: Ziv Medical Center
VECTOR: RDP Brute Force (IP: 192.168.1.104)
DATE: 13/04/2026

Attackers deployed ransomware encrypting patient DB.
Ransom note demands payment to wallet 0x4a12345bcdef6789.
Traffic analysis shows C2 server located in Tehran and a mirror domain at https://shadow-node.example.`,
  },
  {
    id: "doc-email-thread",
    queries: ["Leah Ben Ami North Wharf", "Falcon Brokers forwarded"],
    text: `FW: Re: urgent routing issue
From: leah.ben-ami@northwharf.example
To: ops@falcon.example
Date: 2026-04-09

Leah Ben Ami wrote that Falcon Brokers should avoid North Wharf until Orion Logistics confirms the customs seal.
Forward this to Maya Cohen and keep Warehouse 12 off the visible manifest.`,
  },
  {
    id: "doc-customs",
    queries: ["Port Said Container 441", "Cedar Finance manifest"],
    text: `CUSTOMS NOTE
Port Said inspection flagged Container 441-AZ and Container 442-AZ.
Cedar Finance Group appears in supporting paperwork beside Orion Logistics LLC.
Declared route: Port Said -> Ashdod -> Eilat.
Declared contact: manifests@cedar.example`,
  },
  {
    id: "doc-telecom",
    queries: ["192.168.77.14 Falcon relay", "https://relay-observer.example"],
    text: `Network capture 7
2026-04-08 02:14 UTC connection from 192.168.77.14 to relay-observer.example.
Operator note ties the relay to Falcon Brokers and to field handset ZR-2.
Mirror panel exposed at https://relay-observer.example/admin before takedown.`,
  },
  {
    id: "doc-watchlist",
    queries: ["ALPHA NODE Cedar Finance", "Behshad Falcon"],
    text: `WATCHLIST UPDATE:
ALPHA NODE met Falcon Brokers on 11/04/2026.
BRAVO NODE referenced Behshad and Cedar Finance Group in the same memo.
Case officer Maya Cohen requested follow-up before 2026-04-15.`,
  },
  {
    id: "doc-social-dump",
    queries: ["#RedSea Orion Logistics", "Pier 9 post"],
    text: `Collected posts:
1) "Pier 9 was busy tonight" #RedSea #OrionLogistics
2) "Maya Cohen knows why Warehouse 12 went dark."
3) Link reposted from www.shadow-trace.example/threads/pier-9`,
  },
  {
    id: "doc-facility",
    queries: ["Ziv Medical Center Tehran", "RDP Brute Force"],
    text: `INCIDENT REPORT: Ziv Medical Center
VECTOR: RDP Brute Force
DATE: 13/04/2026

Badge logs show visitor Amir Lev entered the server wing at 07:41.
Outbound traffic later touched Tehran through IP 10.44.12.9 and backup node 10.44.12.10.`,
  },
  {
    id: "doc-procurement",
    queries: ["Nile Holdings Falcon Brokers", "invoice Warehouse 12"],
    text: `Procurement ledger excerpt
Vendor: Nile Holdings Ltd
Counterparty: Falcon Brokers
Delivery point: Warehouse 12
Invoice memo says equipment was redirected to Pier 9 after review by Leah Ben Ami on 2026-04-06.`,
  },
  {
    id: "doc-ocr-scan",
    queries: ["Ashdod Orion Logistics", "0x9988aa77bb66cc55"],
    text: `Scanned memo (OCR):
0rion L0gistics / Orion Logistics
ASHDOD terminal \t\t reviewed 2026-04-05.
Loose note reads: "send settlement to 0x9988aa77bb66cc55"
Possible reviewer: Maya Cohen`,
  },
  {
    id: "doc-field-notes",
    queries: ["North Wharf Camp Cedar", "Amir Lev Eilat"],
    text: `FIELD NOTES
North Wharf camp received three vehicles.
Amir Lev mentioned Cedar Finance Group, Eilat, and Pier 9 in one breath.
No direct proof yet, but Falcon Brokers was written in the margin beside Orion Logistics.`,
  },
  {
    id: "doc-multisource",
    queries: ["Behshad Warehouse 12", "ops@orion.example Tehran"],
    text: `Cross-source merge draft
- Behshad appeared in one maritime trace.
- Warehouse 12 appeared in two finance memos.
- ops@orion.example was copied on the same day Tehran routing was discussed.
- Reviewer: Maya Cohen`,
  },
];

const round = (value: number, digits = 2): number => Number(value.toFixed(digits));

const applyNoiseEnvelope = (text: string, variant: number): string => {
  const headers = [
    "  \t",
    "SOURCE CAPTURE\r\n\r\n",
    "EXTRACT // analyst scratchpad\n\n",
  ];
  const footers = [
    "\n\nEND OF RECORD",
    "\n\n-- forwarded copy --",
    "\n\n### partial export ###",
  ];
  const header = headers[variant % headers.length];
  const footer = footers[variant % footers.length];
  const body =
    variant % 3 === 0
      ? text.replace(/\n/g, "\n\n")
      : variant % 3 === 1
        ? text.replace(/ /g, "  ").replace(/:\s/g, ":\t")
        : text.replace(/\n/g, "\r\n").replace(/Warehouse 12/g, "Warehouse 12 / W-12");

  return `${header}${body}${footer}`;
};

const asHtmlDocument = (title: string, text: string, author: string): string => {
  const paragraphs = text
    .split(/\n{2,}|\r\n\r\n/)
    .map((paragraph) => paragraph.replace(/\n/g, " ").trim())
    .filter(Boolean)
    .map((paragraph) => `      <p>${paragraph}</p>`)
    .join("\n");

  return `<!doctype html>
<html lang="en">
  <head>
    <title>${title}</title>
    <meta name="author" content="${author}" />
  </head>
  <body>
    <article>
      <h1>${title}</h1>
${paragraphs}
    </article>
  </body>
</html>`;
};

const buildBenchmarkCorpus = (): BenchmarkDoc[] => {
  const rawDocs = BASE_CORPUS.flatMap((doc, index) => [
    {
      id: `${doc.id}-clean`,
      source_doc_id: `${doc.id}-clean`,
      raw_content: doc.text,
      queries: doc.queries,
    },
    {
      id: `${doc.id}-noisy`,
      source_doc_id: `${doc.id}-noisy`,
      raw_content: applyNoiseEnvelope(doc.text, index),
      queries: doc.queries,
    },
  ]);

  const htmlDocs = BASE_CORPUS.slice(0, 4).map((doc, index) => ({
    id: `${doc.id}-html`,
    source_doc_id: `${doc.id}-html`,
    raw_content: asHtmlDocument(`Investigative ${index + 1}`, doc.text, "Leah Ben Ami"),
    source_mime_type: "text/html",
    source_uri: `https://example.com/${doc.id}`,
    queries: doc.queries,
  }));

  const fileDocs: BenchmarkDoc[] = [
    {
      id: "fixture-html-file",
      source_doc_id: "fixture-html-file",
      file_path: FIXTURE_HTML_PATH,
      source_uri: "https://example.com/fixture/investigative-article",
      queries: ["Cedar Finance Falcon Brokers", "Maya Cohen Orion Logistics"],
    },
  ];

  return [...rawDocs, ...htmlDocs, ...fileDocs];
};

const main = () => {
  const corpus = buildBenchmarkCorpus();
  const parseLatencies: number[] = [];
  const extractionLatencies: number[] = [];
  const retrievalLatencies: number[] = [];
  const payloads = [];

  const endToEndStart = performance.now();

  corpus.forEach((doc) => {
    const parseStart = performance.now();
    const ingested = prepareSmartIngestedDocument(doc);
    parseLatencies.push(performance.now() - parseStart);

    const extractionStart = performance.now();
    const payload = buildSmartExtractionPayload(ingested);
    extractionLatencies.push(performance.now() - extractionStart);
    payloads.push(payload);

    const lexicalIndex = buildSmartPipelineLexicalIndex(payload);
    doc.queries.forEach((query) => {
      const retrievalStart = performance.now();
      searchLexicalIndex(lexicalIndex, query, 5);
      retrievalLatencies.push(performance.now() - retrievalStart);
    });
  });

  const totalMs = performance.now() - endToEndStart;
  const docs = payloads.length;
  const textUnits = payloads.reduce((sum, payload) => sum + payload.text_units.length, 0);
  const candidates = payloads.reduce((sum, payload) => sum + payload.candidates.length, 0);
  const mentions = payloads.reduce((sum, payload) => sum + payload.mentions.length, 0);
  const entities = payloads.reduce((sum, payload) => sum + payload.entities.length, 0);
  const relations = payloads.reduce((sum, payload) => sum + payload.relation_candidates.length, 0);
  const events = payloads.reduce((sum, payload) => sum + payload.event_candidates.length, 0);
  const claims = payloads.reduce((sum, payload) => sum + payload.claim_candidates.length, 0);
  const temporalRecords = payloads.flatMap((payload) =>
    buildTemporalEventRecords(
      payload.event_candidates,
      (entityId) => payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
      payload.source_parser?.published_at || payload.generated_at?.slice(0, 10),
    ),
  );
  const retrievalArtifacts = payloads.map((payload) =>
    buildRetrievalArtifactsFromPayload(
      payload,
      buildTemporalEventRecords(
        payload.event_candidates,
        (entityId) => payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
        payload.source_parser?.published_at || payload.generated_at?.slice(0, 10),
      ),
      payload.relation_candidates.map((relation) => ({
        source: payload.entities.find((entity) => entity.entity_id === relation.source_entity_id)?.canonical_name || relation.source_entity_id,
        target: payload.entities.find((entity) => entity.entity_id === relation.target_entity_id)?.canonical_name || relation.target_entity_id,
        type: relation.relation_type,
        confidence: relation.confidence,
      })),
      (entityId) => payload.entities.find((entity) => entity.entity_id === entityId)?.canonical_name || entityId,
    ),
  );
  const duplicateCollapseRate = payloads.reduce((sum, payload) => sum + payload.stats.duplicate_collapse_rate, 0) / docs;
  const evidenceCoverageRate = payloads.reduce((sum, payload) => sum + payload.stats.evidence_coverage_rate, 0) / docs;
  const rawEvidenceRoundTripRate =
    candidates === 0
      ? 1
      : payloads.reduce(
          (sum, payload) =>
            sum +
            payload.candidates.filter(
              (candidate) =>
                payload.raw_text.slice(candidate.raw_char_start, candidate.raw_char_end) === candidate.raw_text &&
                payload.normalized_text.slice(candidate.normalized_char_start, candidate.normalized_char_end).length > 0,
            ).length,
          0,
        ) / candidates;
  const parserCounts = payloads.reduce<Record<string, number>>((counts, payload) => {
    const parserName = payload.source_parser?.parser_name ?? "unknown";
    counts[parserName] = (counts[parserName] ?? 0) + 1;
    return counts;
  }, {});
  const normalizedTemporalEventCount = temporalRecords.filter((record) => !!record.normalized_start).length;
  const contradictoryTemporalEventCount = temporalRecords.filter((record) => (record.contradiction_ids || []).length > 0).length;
  const retrievalBundleCount = retrievalArtifacts.reduce((sum, artifact) => sum + artifact.bundle_count, 0);
  const retrievalCitedEvidenceCount = retrievalArtifacts.reduce(
    (sum, artifact) =>
      sum +
      Object.values(artifact.bundles).reduce((bundleSum, bundle) => bundleSum + bundle.cited_evidence_ids.length, 0),
    0,
  );

  const summary = {
    pipelineVersion: payloads[0]?.pipeline_version ?? "unknown",
    corpusSize: docs,
    parserCounts,
    docsPerSecond: round((docs / totalMs) * 1000),
    textUnitsPerSecond: round((textUnits / totalMs) * 1000),
    docsProcessed: docs,
    totalTextUnitsProduced: textUnits,
    extractionCandidatesFound: candidates,
    mentionsPerDoc: round(mentions / docs),
    entitiesPerDoc: round(entities / docs),
    relationsPerDoc: round(relations / docs),
    eventCandidatesPerDoc: round(events / docs),
    temporalEventCount: temporalRecords.length,
    normalizedTemporalEventCount,
    contradictoryTemporalEventCount,
    retrievalBundleCount,
    retrievalCitedEvidenceCount,
    claimCandidatesPerDoc: round(claims / docs),
    averageParseLatencyMsPerDoc: round(parseLatencies.reduce((sum, value) => sum + value, 0) / docs),
    averageExtractionLatencyMsPerDoc: round(extractionLatencies.reduce((sum, value) => sum + value, 0) / docs),
    averageEndToEndLatencyMsPerDoc: round(totalMs / docs),
    averageLexicalRetrievalLatencyMs: round(
      retrievalLatencies.reduce((sum, value) => sum + value, 0) / Math.max(1, retrievalLatencies.length),
      4,
    ),
    duplicateCollapseRate: round(duplicateCollapseRate, 4),
    evidenceCoverageRate: round(evidenceCoverageRate, 4),
    rawEvidenceRoundTripRate: round(rawEvidenceRoundTripRate, 4),
    memoryRssMb: round(process.memoryUsage().rss / (1024 * 1024)),
  };

  console.log(JSON.stringify(summary, null, 2));
};

main();
