import type { TimelineEvent } from "../../../types";
import type { SidecarEventCandidate } from "../types";
import type { TemporalEventRecord, TemporalRelationRecord } from "./contracts";
import { normalizeTemporalExpression } from "./normalizer";

const stableHash = (value: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const buildTemporalEventRecords = (
  events: SidecarEventCandidate[],
  resolveEntityName: (entityId: string) => string,
  referenceDate?: string,
): TemporalEventRecord[] => {
  const baseRecords = events.map<TemporalEventRecord>((event, index) => {
    const anchor = normalizeTemporalExpression(
      event.timestamp || event.evidence.timestamp || event.evidence.normalized_supporting_snippet,
      referenceDate,
    );
    const uncertaintyNotes: string[] = [];

    if (!anchor.normalized_start && anchor.raw_text) {
      uncertaintyNotes.push("Temporal expression detected but could not be normalized exactly.");
    } else if (!anchor.normalized_start) {
      uncertaintyNotes.push("No explicit temporal anchor found; ordering may be inferred.");
    }

    if (anchor.precision === "approximate") {
      uncertaintyNotes.push("Date precision is approximate.");
    }

    const actorEntities = event.actor_entity_ids.map(resolveEntityName).filter(Boolean);
    const targetEntities = event.target_entity_ids.map(resolveEntityName).filter(Boolean);
    const locationEntities = event.location_entity_ids.map(resolveEntityName).filter(Boolean);
    const supportingEvidenceIds = [event.evidence.evidence_id].filter(Boolean);
    const titleBits = [
      event.event_type.replace(/_/g, " "),
      actorEntities[0],
      targetEntities[0] ? `-> ${targetEntities[0]}` : "",
    ].filter(Boolean);

    return {
      event_id: event.event_id || `event_${index}_${stableHash(event.normalized_text)}`,
      source_doc_id: event.source_doc_id,
      source_text_unit_id: event.source_text_unit_id,
      event_type: event.event_type,
      title: titleBits.join(" "),
      trigger_text: event.trigger_text,
      actor_entities: actorEntities,
      target_entities: targetEntities,
      location_entities: locationEntities,
      time_expression_raw: anchor.raw_text,
      normalized_start: anchor.normalized_start,
      normalized_end: anchor.normalized_end,
      temporal_precision: anchor.precision,
      assertion_mode: anchor.assertion_mode,
      temporal_confidence: anchor.confidence,
      confidence: event.confidence,
      uncertainty_notes: uncertaintyNotes,
      contradiction_ids: [],
      supporting_evidence_ids: supportingEvidenceIds,
    };
  });

  const contradictionPairs = new Map<string, string[]>();
  baseRecords.forEach((record) => {
    const key = `${record.event_type}|${record.actor_entities.join(",")}|${record.target_entities.join(",")}`;
    const list = contradictionPairs.get(key) ?? [];
    list.push(record.event_id);
    contradictionPairs.set(key, list);
  });

  contradictionPairs.forEach((eventIds) => {
    if (eventIds.length < 2) return;
    const relatedRecords = baseRecords.filter((record) => eventIds.includes(record.event_id));
    const explicitDates = Array.from(new Set(relatedRecords.map((record) => record.normalized_start).filter(Boolean)));
    if (explicitDates.length > 1) {
      relatedRecords.forEach((record) => {
        record.contradiction_ids = relatedRecords
          .filter((candidate) => candidate.event_id !== record.event_id)
          .map((candidate) => candidate.event_id);
        record.uncertainty_notes = Array.from(
          new Set([...record.uncertainty_notes, "Conflicting temporal evidence exists for this event pattern."]),
        );
      });
    }
  });

  return baseRecords.sort((left, right) => {
    const leftDate = left.normalized_start || "9999-12-31";
    const rightDate = right.normalized_start || "9999-12-31";
    return leftDate.localeCompare(rightDate) || right.confidence - left.confidence;
  });
};

export const buildTemporalRelations = (records: TemporalEventRecord[]): TemporalRelationRecord[] => {
  const explicitRecords = records.filter((record) => record.normalized_start);
  const relations: TemporalRelationRecord[] = [];

  for (let index = 0; index < explicitRecords.length - 1; index += 1) {
    const current = explicitRecords[index];
    const next = explicitRecords[index + 1];
    if (!current.normalized_start || !next.normalized_start) continue;

    const sameDate = current.normalized_start === next.normalized_start;
    relations.push({
      relation_id: `temporal_${current.event_id}_${next.event_id}`,
      source_event_id: current.event_id,
      target_event_id: next.event_id,
      relation_type: sameDate ? "overlap" : "before",
      assertion_mode: "inferred",
      confidence: sameDate ? 0.68 : 0.76,
      supporting_evidence_ids: Array.from(new Set([...current.supporting_evidence_ids, ...next.supporting_evidence_ids])),
    });
  }

  return relations;
};

export const projectTimelineEvents = (records: TemporalEventRecord[]): TimelineEvent[] =>
  records.map((record) => ({
    date: record.normalized_start || record.time_expression_raw || "9999-12-31",
    event: `${record.event_type}: ${record.title || record.trigger_text}`,
  }));
