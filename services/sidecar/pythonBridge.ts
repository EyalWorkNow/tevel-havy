import { execFileSync } from "node:child_process";
import path from "node:path";

import { resolvePythonBinary } from "./pythonRuntime";

const HELPER_PATH = path.resolve(process.cwd(), "scripts/sidecar_m2_helper.py");

export const runPythonSidecarHelper = <T>(command: "parse_html" | "parse_file" | "smart_extract", payload: unknown): T => {
  let stdout: string;
  try {
    stdout = execFileSync(resolvePythonBinary(), [HELPER_PATH, command], {
      cwd: process.cwd(),
      input: JSON.stringify(payload),
      encoding: "utf-8",
      maxBuffer: 20 * 1024 * 1024,
    });
  } catch (err: unknown) {
    const execErr = err as { stdout?: string; stderr?: string; code?: number };
    const detail = execErr.stderr?.trim().slice(0, 400) || String(err);
    throw new Error(`Python sidecar (${command}) exited with code ${execErr.code ?? "?"}: ${detail}`);
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new Error(`Python sidecar (${command}) returned invalid JSON: ${stdout.slice(0, 200)}`);
  }
};
