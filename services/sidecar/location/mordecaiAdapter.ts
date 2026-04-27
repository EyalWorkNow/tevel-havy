import { execFileSync } from "node:child_process";
import path from "node:path";

import { AmbiguousToponymHint } from "./types";

const HELPER_PATH = path.resolve(process.cwd(), "scripts/sidecar_m2_helper.py");

const heuristicHints = (rawText: string, sentenceText: string, surroundingEntities: string[]): AmbiguousToponymHint[] => {
  const context = `${sentenceText} ${surroundingEntities.join(" ")}`.toLowerCase();
  const hints: AmbiguousToponymHint[] = [];

  if (/\b(israel|tel aviv|haifa|ashdod|jerusalem)\b/i.test(context)) {
    hints.push({ text: rawText, country: "Israel", locality: "Tel Aviv", confidence: 0.52, source: "heuristic" });
  }
  if (/\b(jordan|amman)\b/i.test(context)) {
    hints.push({ text: rawText, country: "Jordan", locality: "Amman", confidence: 0.5, source: "heuristic" });
  }
  if (/\b(lebanon|beirut)\b/i.test(context)) {
    hints.push({ text: rawText, country: "Lebanon", locality: "Beirut", confidence: 0.5, source: "heuristic" });
  }

  return hints;
};

export const resolveAmbiguousToponym = (
  rawText: string,
  sentenceText: string,
  surroundingEntities: string[],
  language?: string,
): AmbiguousToponymHint[] => {
  try {
    const stdout = execFileSync("python3", [HELPER_PATH, "resolve_toponym_context"], {
      cwd: process.cwd(),
      input: JSON.stringify({
        raw_text: rawText,
        sentence_text: sentenceText,
        surrounding_entities: surroundingEntities,
        language,
      }),
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024,
    });
    const result = JSON.parse(stdout) as AmbiguousToponymHint[];
    if (Array.isArray(result) && result.length) {
      return result;
    }
  } catch {
    // fallback below
  }

  return heuristicHints(rawText, sentenceText, surroundingEntities);
};
