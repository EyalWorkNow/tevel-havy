import test from "node:test";
import assert from "node:assert/strict";

import type { StudyItem } from "../../types";
import { getLinkedStudiesForEntity, isEquivalentStudyContext } from "../../services/correlationUtils";

const buildStudy = (overrides: Partial<StudyItem> = {}): StudyItem => ({
  id: overrides.id || "study-1",
  title: overrides.title || "CIA - MOSSAD - INTERPOL",
  date: overrides.date || "2026-04-14",
  source: overrides.source || "Report",
  status: overrides.status || "Approved",
  tags: overrides.tags || [],
  intelligence: overrides.intelligence || {
    clean_text: "CIA met MOSSAD in Paris.",
    raw_text: "CIA met MOSSAD in Paris.",
    word_count: 5,
    entities: [
      { id: "e1", name: "CIA", type: "ORG" },
      { id: "e2", name: "MOSSAD", type: "ORG" },
      { id: "e3", name: "Paris", type: "LOCATION" },
    ],
    relations: [],
    insights: [],
    context_cards: {},
    graph: { nodes: [], edges: [] },
  },
});

test("isEquivalentStudyContext treats duplicated persisted copies of the same study as the same context", () => {
  const currentStudy = buildStudy({ id: "local-copy" });
  const duplicateStudy = buildStudy({ id: "db-copy" });

  assert.equal(isEquivalentStudyContext(currentStudy, duplicateStudy), true);
});

test("getLinkedStudiesForEntity excludes same-study clones from external correlations", () => {
  const currentStudy = buildStudy({ id: "local-copy" });
  const duplicateStudy = buildStudy({ id: "db-copy" });
  const realExternalStudy = buildStudy({
    id: "study-2",
    title: "European Liaison Activity",
    date: "2026-04-13",
    intelligence: {
      clean_text: "CIA coordinated with Europol in Brussels.",
      raw_text: "CIA coordinated with Europol in Brussels.",
      word_count: 6,
      entities: [
        { id: "e9", name: "CIA", type: "ORG" },
        { id: "e10", name: "Europol", type: "ORG" },
      ],
      relations: [],
      insights: [],
      context_cards: {},
      graph: { nodes: [], edges: [] },
    },
  });

  const linked = getLinkedStudiesForEntity(currentStudy, [currentStudy, duplicateStudy, realExternalStudy], "CIA");

  assert.deepEqual(linked.map((study) => study.id), ["study-2"]);
});
