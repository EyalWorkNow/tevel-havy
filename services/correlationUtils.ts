import type { StudyItem } from "../types";
import { isEntityMatch } from "./geminiService";

const normalize = (value?: string | null): string =>
  (value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/['"״׳`]/g, "")
    .replace(/[-_/]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const getStudyBody = (study: StudyItem): string =>
  normalize(study.intelligence.raw_text || study.intelligence.clean_text || "");

const getStudyEntitySet = (study: StudyItem): Set<string> =>
  new Set(
    (study.intelligence.entities || [])
      .map((entity) => normalize(entity.name))
      .filter(Boolean),
  );

const getOverlapRatio = (left: Set<string>, right: Set<string>): number => {
  if (!left.size || !right.size) return 0;

  let matches = 0;
  left.forEach((value) => {
    if (right.has(value)) matches += 1;
  });

  return matches / Math.min(left.size, right.size);
};

export const isEquivalentStudyContext = (currentStudy: StudyItem, candidateStudy: StudyItem): boolean => {
  if (currentStudy.id === candidateStudy.id) return true;

  const currentTitle = normalize(currentStudy.title);
  const candidateTitle = normalize(candidateStudy.title);
  const sameTitle = !!currentTitle && currentTitle === candidateTitle;
  const sameSource = normalize(currentStudy.source) === normalize(candidateStudy.source);
  const sameDate = normalize(currentStudy.date) === normalize(candidateStudy.date);

  const currentBody = getStudyBody(currentStudy);
  const candidateBody = getStudyBody(candidateStudy);
  const sameBody = !!currentBody && currentBody === candidateBody;

  const entityOverlap = getOverlapRatio(getStudyEntitySet(currentStudy), getStudyEntitySet(candidateStudy));

  if (sameBody && (sameTitle || entityOverlap >= 0.6)) return true;
  if (sameTitle && sameSource && sameDate && entityOverlap >= 0.4) return true;

  return false;
};

export const getLinkedStudiesForEntity = (
  currentStudy: StudyItem,
  allStudies: StudyItem[],
  entityName: string,
): StudyItem[] =>
  allStudies.filter((study) => {
    if (isEquivalentStudyContext(currentStudy, study)) return false;
    return (study.intelligence.entities || []).some((entity) => isEntityMatch(entity.name, entityName));
  });
