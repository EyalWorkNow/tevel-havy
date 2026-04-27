import type { EntityMentionRecord, ReferenceLinkRecord } from "./types";
import { lexicalSimilarity, normalizeEntityText, stableHash, surnameOf } from "./normalization";

const acronymFor = (value: string): string =>
  value
    .split(/\s+/)
    .filter(Boolean)
    .filter((part) => /^[A-Za-z]/.test(part))
    .map((part) => part[0]?.toUpperCase() || "")
    .join("");

export const buildReferenceLinks = (mentions: EntityMentionRecord[]): ReferenceLinkRecord[] => {
  const links: ReferenceLinkRecord[] = [];

  for (let leftIndex = 0; leftIndex < mentions.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < mentions.length; rightIndex += 1) {
      const left = mentions[leftIndex];
      const right = mentions[rightIndex];
      if (left.document_id !== right.document_id || left.label !== right.label) continue;

      const reasons: string[] = [];
      let score = 0;
      let linkType: ReferenceLinkRecord["link_type"] | null = null;

      if (
        left.mention_type === "structured-id" &&
        right.mention_type === "structured-id" &&
        left.normalized_text &&
        left.normalized_text === right.normalized_text
      ) {
        score = 0.99;
        linkType = "structured_id";
        reasons.push("Structured identifier surfaces match exactly.");
      }

      const lexical = lexicalSimilarity(left.text, right.text);
      if (!linkType && lexical >= 0.9 && left.canonical_text === right.canonical_text) {
        score = 0.92;
        linkType = "alias";
        reasons.push("Surface forms normalize to the same alias.");
      }

      if (!linkType && left.label === "PERSON") {
        const leftSurname = surnameOf(left.text);
        const rightSurname = surnameOf(right.text);
        const leftParts = normalizeEntityText(left.text).split(" ").filter(Boolean);
        const rightParts = normalizeEntityText(right.text).split(" ").filter(Boolean);
        if (
          leftSurname &&
          rightSurname &&
          leftSurname === rightSurname &&
          ((leftParts.length >= 2 && rightParts.length === 1) || (rightParts.length >= 2 && leftParts.length === 1))
        ) {
          score = 0.76;
          linkType = "full_name_to_short";
          reasons.push("Person surname aligns with a fuller name mention in the same document.");
        }

        if (!linkType && leftSurname && rightSurname && leftSurname === rightSurname) {
          const leftInitial = left.text.trim()[0]?.toLowerCase();
          const rightInitial = right.text.trim()[0]?.toLowerCase();
          const leftLooksInitial = /^[a-z]\.?$/i.test(left.text.trim().split(/\s+/)[0] || "");
          const rightLooksInitial = /^[a-z]\.?$/i.test(right.text.trim().split(/\s+/)[0] || "");
          if (
            (leftLooksInitial || rightLooksInitial) &&
            leftInitial &&
            rightInitial &&
            leftInitial === rightInitial
          ) {
            score = 0.74;
            linkType = "alias";
            reasons.push("Initial-plus-surname mention aligns with a fuller person name.");
          }
        }

        if (!linkType && (/\b(minister|director|agent|commander)\b/i.test(left.text) || /\b(minister|director|agent|commander)\b/i.test(right.text))) {
          const titleSide = /\b(minister|director|agent|commander)\b/i.test(left.text) ? left : right;
          const personSide = titleSide.id === left.id ? right : left;
          if (surnameOf(titleSide.text) && surnameOf(titleSide.text) === surnameOf(personSide.text)) {
            score = 0.7;
            linkType = "title_to_person";
            reasons.push("Title-bearing person reference shares the same surname.");
          }
        }
      }

      if (!linkType && left.label === "ORG") {
        const leftAcronym = acronymFor(left.text);
        const rightAcronym = acronymFor(right.text);
        const normalizedLeft = left.normalized_text.replace(/\s+/g, "");
        const normalizedRight = right.normalized_text.replace(/\s+/g, "");
        if (
          (leftAcronym && leftAcronym.length >= 2 && leftAcronym.toLowerCase() === normalizedRight) ||
          (rightAcronym && rightAcronym.length >= 2 && rightAcronym.toLowerCase() === normalizedLeft)
        ) {
          score = 0.84;
          linkType = "org_short_form";
          reasons.push("Organization acronym matches a longer expanded form.");
        }
      }

      if (!linkType && (left.mention_type === "pronoun" || right.mention_type === "pronoun")) {
        const pronoun = left.mention_type === "pronoun" ? left : right;
        const referent = pronoun.id === left.id ? right : left;
        if (pronoun.sentence_id === referent.sentence_id || pronoun.paragraph_id === referent.paragraph_id) {
          score = 0.56;
          linkType = "pronoun";
          reasons.push("Pronoun mention occurs in the same local context as a named entity.");
        }
      }

      if (!linkType || score <= 0) continue;

      links.push({
        id: `reflink_${stableHash(`${left.id}:${right.id}:${linkType}`)}`,
        source_mention_id: left.id,
        target_mention_id: right.id,
        link_type: linkType,
        score,
        features_json: {
          lexical,
          same_document: true,
        },
        decision_reason: reasons.join(" "),
      });
    }
  }

  return links.sort((left, right) => right.score - left.score);
};
