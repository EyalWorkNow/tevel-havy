import type { EntityTimelineItem, EventParticipantRecord, EventRecord, TimelineItemRecord } from "./types";
import { stableHash } from "./normalization";

const sortTime = (value?: string): string => value || "9999-12-31";

export const buildEntityTimelines = (
  entities: { id: string }[],
  events: EventRecord[],
  participants: EventParticipantRecord[],
): Record<string, EntityTimelineItem[]> =>
  Object.fromEntries(
    entities.map((entity) => {
      const items = participants
        .filter((participant) => participant.entity_id === entity.id)
        .map((participant) => {
          const event = events.find((candidate) => candidate.id === participant.event_id);
          if (!event) return null;
          return {
            entity_id: entity.id,
            event_id: event.id,
            title: event.title,
            event_type: event.event_type,
            time_start: event.time_start,
            time_end: event.time_end,
            confidence: Math.max(participant.confidence, event.confidence),
            evidence_ids: event.supporting_evidence_ids,
            source_document_ids: Array.isArray(event.attributes_json.source_doc_ids)
              ? (event.attributes_json.source_doc_ids as string[])
              : [],
            uncertainty_notes: Array.isArray(event.attributes_json.uncertainty_notes)
              ? (event.attributes_json.uncertainty_notes as string[])
              : [],
          } satisfies EntityTimelineItem;
        })
        .filter((item): item is EntityTimelineItem => Boolean(item))
        .sort((left, right) => sortTime(left.time_start).localeCompare(sortTime(right.time_start)) || right.confidence - left.confidence);
      return [entity.id, items];
    }),
  );

export const flattenEntityTimelines = (
  timelines: Record<string, EntityTimelineItem[]>,
): TimelineItemRecord[] =>
  Object.entries(timelines).flatMap(([entityId, items]) =>
    items.map((item) => ({
      ...item,
      id: item.id || `timeline_${stableHash(`${entityId}:${item.event_id}:${item.time_start || "unknown"}`)}`,
      entity_id: entityId,
    })),
  );
