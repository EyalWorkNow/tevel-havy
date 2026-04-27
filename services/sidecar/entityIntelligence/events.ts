import { buildTemporalEventRecords } from "../temporal/projector";
import type { SidecarExtractionPayload } from "../types";
import type { EventParticipantRecord, EventRecord } from "./types";
import { stableHash } from "./normalization";

export const buildEventLayer = (
  payload: SidecarExtractionPayload,
  mentionEntityMap: Record<string, string>,
  resolveEntityName: (entityId: string) => string,
): {
  events: EventRecord[];
  participants: EventParticipantRecord[];
} => {
  const temporalRecords = buildTemporalEventRecords(payload.event_candidates, resolveEntityName);
  const participants: EventParticipantRecord[] = [];

  const events = temporalRecords.map((record) => ({
    id: record.event_id,
    event_type: record.event_type,
    title: record.title,
    description: [record.trigger_text, ...record.uncertainty_notes].filter(Boolean).join(" "),
    time_start: record.normalized_start,
    time_end: record.normalized_end,
    location_entity_id: record.location_entities[0],
    confidence: Math.max(record.confidence, record.temporal_confidence),
    attributes_json: {
      temporal_precision: record.temporal_precision,
      assertion_mode: record.assertion_mode,
      uncertainty_notes: record.uncertainty_notes,
      contradiction_ids: record.contradiction_ids,
    },
    supporting_evidence_ids: record.supporting_evidence_ids,
  }));

  payload.event_candidates.forEach((event) => {
    const pushParticipant = (mentionIds: string[], roleInEvent: string) => {
      mentionIds.forEach((mentionId) => {
        const entityId = mentionEntityMap[mentionId];
        if (!entityId) return;
        participants.push({
          event_id: event.event_id,
          entity_id: entityId,
          role_in_event: roleInEvent,
          confidence: event.confidence,
        });
      });
    };

    pushParticipant(event.actor_mention_ids || [], "actor");
    pushParticipant(event.target_mention_ids || [], "target");
    pushParticipant(event.location_mention_ids || [], "location");
  });

  return {
    events,
    participants: participants.filter(
      (item, index, array) =>
        array.findIndex(
          (candidate) =>
            candidate.event_id === item.event_id &&
            candidate.entity_id === item.entity_id &&
            candidate.role_in_event === item.role_in_event,
        ) === index,
    ),
  };
};

export const relationParticipantId = (left: string, right: string, type: string): string =>
  `rel_${stableHash(`${left}:${right}:${type}`)}`;
