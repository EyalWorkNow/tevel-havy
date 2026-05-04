import type { StudyItem, Entity, Relation } from "../../types";
import { isEntityMatch } from "../intelligenceService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerFileScenario {
  studyId: string;
  title: string;
  mainActors: string[];
  keyEvents: string[];
  dominantRelationType: string | null;
}

export interface SharedEntity {
  canonicalName: string;
  entityType: string;
  appearsIn: Array<{ studyId: string; title: string; localName: string }>;
  unifiedRole: string;
}

export interface CrossFilePattern {
  type:
    | "RECURRING_ACTOR"
    | "RECURRING_RELATION"
    | "COMMUNICATION_CHAIN"
    | "MONEY_FLOW"
    | "STRUCTURAL_PARALLEL";
  description: string;
  evidenceStudyIds: string[];
}

export interface RoleEquivalence {
  canonicalName: string;
  aliases: string[];
  seenInStudyIds: string[];
}

export interface CrossDocumentSynthesisResult {
  studyCount: number;
  perFile: PerFileScenario[];
  sharedEntities: SharedEntity[];
  crossFilePatterns: CrossFilePattern[];
  roleEquivalences: RoleEquivalence[];
  synthesisTimestamp: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const normalizeKey = (s: string): string =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const ACTOR_TYPES = new Set([
  "PERSON",
  "ORG",
  "ORGANIZATION",
  "AGENCY",
  "COMPANY",
  "COUNTERPARTY",
]);

const MONEY_RELATION_TYPES = new Set([
  "FUNDED",
  "FUNDED_BY",
  "TRANSFERS_MONEY_TO",
  "PAYS",
  "SHAREHOLDER_OF",
]);

const COMMUNICATION_RELATION_TYPES = new Set([
  "COMMUNICATED_WITH",
  "COMMUNICATES_WITH",
  "USES_COVER_IDENTITY",
  "SHARES_INFRASTRUCTURE_WITH",
]);

const dominantRelationType = (relations: Relation[]): string | null => {
  if (!relations.length) return null;
  const counts: Record<string, number> = {};
  for (const r of relations) {
    counts[r.type] = (counts[r.type] || 0) + 1;
  }
  return Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
};

const actorsFromStudy = (study: StudyItem, max = 5): string[] =>
  study.intelligence.entities
    .filter((e) => ACTOR_TYPES.has(e.type))
    .sort((a, b) => (b.salience ?? b.confidence ?? 0) - (a.salience ?? a.confidence ?? 0))
    .slice(0, max)
    .map((e) => e.name);

const keyEventsFromStudy = (study: StudyItem, max = 3): string[] =>
  study.intelligence.insights
    .sort((a, b) => b.importance - a.importance)
    .slice(0, max)
    .map((i) => i.text);

// ---------------------------------------------------------------------------
// Step 1: Per-file scenario summaries
// ---------------------------------------------------------------------------

const buildPerFileScenarios = (studies: StudyItem[]): PerFileScenario[] =>
  studies.map((study) => ({
    studyId: study.id,
    title: study.title,
    mainActors: actorsFromStudy(study),
    keyEvents: keyEventsFromStudy(study),
    dominantRelationType: dominantRelationType(study.intelligence.relations),
  }));

// ---------------------------------------------------------------------------
// Step 2: Shared entity mapping
// ---------------------------------------------------------------------------

const buildSharedEntities = (studies: StudyItem[]): SharedEntity[] => {
  // Index all entities per study
  const studyEntities: Array<{ study: StudyItem; entity: Entity }> = [];
  for (const study of studies) {
    for (const entity of study.intelligence.entities) {
      studyEntities.push({ study, entity });
    }
  }

  // Group by canonical name (match across studies)
  const groups: Array<{ canonical: Entity; members: Array<{ study: StudyItem; entity: Entity }> }> = [];

  for (const se of studyEntities) {
    let found = false;
    for (const group of groups) {
      if (isEntityMatch(group.canonical.name, se.entity.name)) {
        if (!group.members.some((m) => m.study.id === se.study.id && m.entity.id === se.entity.id)) {
          group.members.push(se);
        }
        found = true;
        break;
      }
    }
    if (!found) {
      groups.push({ canonical: se.entity, members: [se] });
    }
  }

  // Keep only entities that appear in 2+ distinct studies
  return groups
    .filter((g) => new Set(g.members.map((m) => m.study.id)).size >= 2)
    .map((g) => {
      const studySet = [...new Set(g.members.map((m) => m.study.id))];
      const appearsIn = studySet.map((sid) => {
        const member = g.members.find((m) => m.study.id === sid)!;
        return { studyId: sid, title: member.study.title, localName: member.entity.name };
      });
      const roles = g.members.map((m) => m.entity.description).filter(Boolean) as string[];
      return {
        canonicalName: g.canonical.name,
        entityType: g.canonical.type,
        appearsIn,
        unifiedRole: roles[0] || g.canonical.type,
      };
    })
    .sort((a, b) => b.appearsIn.length - a.appearsIn.length);
};

// ---------------------------------------------------------------------------
// Step 3: Cross-file patterns
// ---------------------------------------------------------------------------

const buildCrossFilePatterns = (
  studies: StudyItem[],
  sharedEntities: SharedEntity[],
): CrossFilePattern[] => {
  const patterns: CrossFilePattern[] = [];

  // Actors appearing in 3+ files
  const recurringActors = sharedEntities.filter(
    (se) => ACTOR_TYPES.has(se.entityType) && se.appearsIn.length >= 3,
  );
  for (const actor of recurringActors.slice(0, 3)) {
    patterns.push({
      type: "RECURRING_ACTOR",
      description: `${actor.canonicalName} מופיע ב-${actor.appearsIn.length} קבצים בתפקיד: ${actor.unifiedRole}`,
      evidenceStudyIds: actor.appearsIn.map((a) => a.studyId),
    });
  }

  // Relation types recurring across 2+ studies
  const relTypeCounts: Record<string, Set<string>> = {};
  for (const study of studies) {
    for (const rel of study.intelligence.relations) {
      if (!relTypeCounts[rel.type]) relTypeCounts[rel.type] = new Set();
      relTypeCounts[rel.type].add(study.id);
    }
  }
  const recurringRelTypes = Object.entries(relTypeCounts)
    .filter(([, ids]) => ids.size >= 2)
    .sort((a, b) => b[1].size - a[1].size)
    .slice(0, 3);
  for (const [relType, studyIds] of recurringRelTypes) {
    const isMoney = MONEY_RELATION_TYPES.has(relType);
    const isComm = COMMUNICATION_RELATION_TYPES.has(relType);
    patterns.push({
      type: isMoney ? "MONEY_FLOW" : isComm ? "COMMUNICATION_CHAIN" : "RECURRING_RELATION",
      description: `קשר מסוג ${relType} חוזר ב-${studyIds.size} קבצים`,
      evidenceStudyIds: [...studyIds],
    });
  }

  // Structural parallel: same dominant relation type across studies
  const dominantTypes = studies.map((s) => ({
    studyId: s.id,
    dominant: dominantRelationType(s.intelligence.relations),
  }));
  const dominantCounts: Record<string, string[]> = {};
  for (const { studyId, dominant } of dominantTypes) {
    if (!dominant) continue;
    if (!dominantCounts[dominant]) dominantCounts[dominant] = [];
    dominantCounts[dominant].push(studyId);
  }
  const parallelDominant = Object.entries(dominantCounts).filter(([, ids]) => ids.length >= 2);
  for (const [relType, studyIds] of parallelDominant.slice(0, 2)) {
    if (!recurringRelTypes.some(([rt]) => rt === relType)) {
      patterns.push({
        type: "STRUCTURAL_PARALLEL",
        description: `${studyIds.length} קבצים חולקים מבנה קשרים דומיננטי: ${relType}`,
        evidenceStudyIds: studyIds,
      });
    }
  }

  return patterns;
};

// ---------------------------------------------------------------------------
// Step 4: Role equivalences (alias detection across files)
// ---------------------------------------------------------------------------

const buildRoleEquivalences = (studies: StudyItem[]): RoleEquivalence[] => {
  const equivalences: RoleEquivalence[] = [];
  const seen = new Set<string>();

  for (const study of studies) {
    for (const rel of study.intelligence.relations) {
      if (rel.type !== "ALIAS_OF") continue;
      const key = normalizeKey(rel.source) + "|" + normalizeKey(rel.target);
      if (seen.has(key)) continue;
      seen.add(key);

      // Find all studies where either name appears
      const studyIds = studies
        .filter(
          (s) =>
            s.intelligence.entities.some(
              (e) => isEntityMatch(e.name, rel.source) || isEntityMatch(e.name, rel.target),
            ),
        )
        .map((s) => s.id);

      equivalences.push({
        canonicalName: rel.source,
        aliases: [rel.target],
        seenInStudyIds: studyIds,
      });
    }
  }

  return equivalences;
};

// ---------------------------------------------------------------------------
// Main synthesis function
// ---------------------------------------------------------------------------

export const synthesizeAcrossDocuments = (studies: StudyItem[]): CrossDocumentSynthesisResult => {
  if (!studies.length) {
    return {
      studyCount: 0,
      perFile: [],
      sharedEntities: [],
      crossFilePatterns: [],
      roleEquivalences: [],
      synthesisTimestamp: Date.now(),
    };
  }

  const perFile = buildPerFileScenarios(studies);
  const sharedEntities = buildSharedEntities(studies);
  const crossFilePatterns = buildCrossFilePatterns(studies, sharedEntities);
  const roleEquivalences = buildRoleEquivalences(studies);

  return {
    studyCount: studies.length,
    perFile,
    sharedEntities,
    crossFilePatterns,
    roleEquivalences,
    synthesisTimestamp: Date.now(),
  };
};

// ---------------------------------------------------------------------------
// Hebrew formatted output
// ---------------------------------------------------------------------------

export const formatCrossDocumentSynthesisHebrew = (
  result: CrossDocumentSynthesisResult,
): string => {
  if (!result.studyCount) return "לא נמצאו מסמכים לסינתזה.";

  const lines: string[] = [];

  lines.push(`## סינתזה חוצת-מסמכים — ${result.studyCount} קבצים\n`);

  // Per-file scenario
  lines.push("### תרחיש לפי קובץ");
  for (const pf of result.perFile) {
    lines.push(`\n**${pf.title}**`);
    if (pf.mainActors.length) {
      lines.push(`- שחקנים מרכזיים: ${pf.mainActors.join(", ")}`);
    }
    if (pf.keyEvents.length) {
      for (const ev of pf.keyEvents) {
        lines.push(`- ${ev}`);
      }
    }
    if (pf.dominantRelationType) {
      lines.push(`- סוג קשר דומיננטי: ${pf.dominantRelationType}`);
    }
  }

  // Shared entities
  if (result.sharedEntities.length) {
    lines.push("\n### ישויות משותפות בין קבצים");
    for (const se of result.sharedEntities.slice(0, 10)) {
      const fileList = se.appearsIn.map((a) => `"${a.title}"`).join(", ");
      lines.push(`- **${se.canonicalName}** (${se.entityType}): מופיע ב-${se.appearsIn.length} קבצים — ${fileList}`);
      if (se.unifiedRole && se.unifiedRole !== se.entityType) {
        lines.push(`  תפקיד: ${se.unifiedRole}`);
      }
    }
  }

  // Cross-file patterns
  if (result.crossFilePatterns.length) {
    lines.push("\n### דפוסים חוזרים בין קבצים");
    for (const pattern of result.crossFilePatterns) {
      lines.push(`- ${pattern.description}`);
    }
  }

  // Role equivalences
  if (result.roleEquivalences.length) {
    lines.push("\n### זהויות מקבילות / כינויים");
    for (const eq of result.roleEquivalences) {
      lines.push(`- ${eq.canonicalName} ← ${eq.aliases.join(", ")}`);
    }
  }

  return lines.join("\n");
};

// ---------------------------------------------------------------------------
// English formatted output
// ---------------------------------------------------------------------------

export const formatCrossDocumentSynthesisEnglish = (
  result: CrossDocumentSynthesisResult,
): string => {
  if (!result.studyCount) return "No documents available for synthesis.";

  const lines: string[] = [];

  lines.push(`## Cross-Document Synthesis — ${result.studyCount} files\n`);

  lines.push("### Per-File Scenario");
  for (const pf of result.perFile) {
    lines.push(`\n**${pf.title}**`);
    if (pf.mainActors.length) {
      lines.push(`- Key actors: ${pf.mainActors.join(", ")}`);
    }
    for (const ev of pf.keyEvents) {
      lines.push(`- ${ev}`);
    }
    if (pf.dominantRelationType) {
      lines.push(`- Dominant relation: ${pf.dominantRelationType}`);
    }
  }

  if (result.sharedEntities.length) {
    lines.push("\n### Shared Entities Across Files");
    for (const se of result.sharedEntities.slice(0, 10)) {
      const fileList = se.appearsIn.map((a) => `"${a.title}"`).join(", ");
      lines.push(
        `- **${se.canonicalName}** (${se.entityType}): appears in ${se.appearsIn.length} files — ${fileList}`,
      );
    }
  }

  if (result.crossFilePatterns.length) {
    lines.push("\n### Recurring Cross-File Patterns");
    for (const pattern of result.crossFilePatterns) {
      lines.push(`- [${pattern.type}] ${pattern.description}`);
    }
  }

  if (result.roleEquivalences.length) {
    lines.push("\n### Role Equivalences / Aliases");
    for (const eq of result.roleEquivalences) {
      lines.push(`- ${eq.canonicalName} ← ${eq.aliases.join(", ")}`);
    }
  }

  return lines.join("\n");
};
