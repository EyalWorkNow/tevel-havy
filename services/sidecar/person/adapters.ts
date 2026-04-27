import { execFileSync } from "node:child_process";
import path from "node:path";

import { resolvePythonBinary } from "../pythonRuntime";

const HELPER_PATH = path.resolve(process.cwd(), "scripts/sidecar_m2_helper.py");

export const runPythonPersonAdapter = <T,>(command: "person_extract" | "person_build_dossier", payload: unknown): T => {
  const stdout = execFileSync(resolvePythonBinary(), [HELPER_PATH, command], {
    cwd: process.cwd(),
    input: JSON.stringify(payload),
    encoding: "utf-8",
    maxBuffer: 20 * 1024 * 1024,
  });
  return JSON.parse(stdout) as T;
};
