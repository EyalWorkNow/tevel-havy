import { execFileSync } from "node:child_process";
import path from "node:path";

import { NormalizedAddressResult } from "./types";

const HELPER_PATH = path.resolve(process.cwd(), "scripts/sidecar_m2_helper.py");

const heuristicNormalize = (rawText: string): NormalizedAddressResult => {
  const normalized = rawText
    .normalize("NFKC")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/[()[\]{}]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const components: Record<string, string> = {};
  normalized.split(",").map((part) => part.trim()).filter(Boolean).forEach((part, index) => {
    components[`segment_${index + 1}`] = part;
  });

  return {
    normalized_query: normalized,
    components,
    source: "heuristic",
    confidence: normalized ? 0.46 : 0,
  };
};

export const normalizeAddressLikeMention = (rawText: string, language?: string): NormalizedAddressResult => {
  if (!rawText.trim()) {
    return heuristicNormalize(rawText);
  }

  try {
    const stdout = execFileSync("python3", [HELPER_PATH, "normalize_location"], {
      cwd: process.cwd(),
      input: JSON.stringify({ raw_text: rawText, language }),
      encoding: "utf-8",
      maxBuffer: 2 * 1024 * 1024,
    });
    const result = JSON.parse(stdout) as NormalizedAddressResult;
    if (result?.normalized_query?.trim()) {
      return result;
    }
  } catch {
    // fall back to deterministic normalization
  }

  return heuristicNormalize(rawText);
};
