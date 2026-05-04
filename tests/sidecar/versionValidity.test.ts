import assert from "node:assert/strict";
import test from "node:test";

import { runFastExtractionPipeline } from "../../services/sidecar/pipeline";
import { buildRetrievalArtifactsFromPayload } from "../../services/sidecar/retrieval";
import { buildVersionValidityReport } from "../../services/sidecar/versionValidity/service";

const buildPayload = (sourceDocId: string, text: string, versionLabel: string) =>
  runFastExtractionPipeline(sourceDocId, text, {
    textUnit: {
      maxChars: 90,
      metadata: {
        document_id: "policy-alpha",
        version_label: versionLabel,
        source_trust: 0.92,
        authority_level: "official",
      },
    },
  });

test("VersionRAG builds evidence atoms, versions, and diff edges across document versions", () => {
  const v1Payload = buildPayload("doc-v1", "Old rule says access is allowed before 2026.", "v1");
  const v1 = buildVersionValidityReport({ caseId: "case-version", payload: v1Payload });
  const v2Payload = buildPayload("doc-v2", "Current rule says access is denied after 2026.", "v2");
  const v2 = buildVersionValidityReport({ caseId: "case-version", payload: v2Payload, previousReport: v1 });

  assert.equal(v2.document_identity, "policy-alpha");
  assert.equal(v2.versions.length, 2);
  assert.ok(v2.atoms.some((atom) => atom.version_state === "current"));
  assert.ok(v2.atoms.some((atom) => atom.version_state === "historical"));
  assert.ok(v2.edges.some((edge) => edge.edge_type === "replaces" && edge.detected_from === "diff"));
  assert.ok(v2.metrics.average_validity_score > 0);
});

test("VersionRAG detects explicit supersession and Hebrew cancellation cues", () => {
  const supersedes = buildVersionValidityReport({
    caseId: "case-cues",
    payload: buildPayload("doc-supersedes", "This policy supersedes the previous operating rule.", "v2"),
  });
  const cancels = buildVersionValidityReport({
    caseId: "case-cues",
    payload: buildPayload("doc-cancels", "ההחלטה מבטלת את ההוראה הישנה.", "v3"),
  });

  assert.ok(supersedes.edges.some((edge) => edge.edge_type === "supersedes"));
  assert.ok(supersedes.atoms.some((atom) => atom.version_state === "superseded"));
  assert.ok(cancels.edges.some((edge) => edge.edge_type === "cancels"));
  assert.ok(cancels.atoms.some((atom) => atom.version_state === "cancelled"));
});

test("version-aware retrieval keeps current evidence ahead of historical atoms for current-answer bundles", () => {
  const v1Payload = buildPayload("doc-old", "Old rule says Meridian access is allowed.", "v1");
  const v1 = buildVersionValidityReport({ caseId: "case-retrieval", payload: v1Payload });
  const v2Payload = buildPayload("doc-current", "Current rule says Meridian access is denied.", "v2");
  const v2 = buildVersionValidityReport({ caseId: "case-retrieval", payload: v2Payload, previousReport: v1 });

  const artifacts = buildRetrievalArtifactsFromPayload(v2Payload, [], [], (entityId) => entityId, undefined, v2);
  const hits = artifacts.bundles.case_brief.hits;

  assert.ok(hits.length >= 2);
  assert.equal(hits[0].version_state, "current");
  assert.ok(hits.some((hit) => hit.version_state === "historical"));
  assert.equal(artifacts.diagnostics?.version_validity_enabled, true);
});

