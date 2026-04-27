import fs from "node:fs";
import path from "node:path";

const candidatePythonBinaries = (): string[] => {
  const cwd = process.cwd();
  const envPython = process.env.TEVEL_PYTHON_BIN?.trim();
  const candidates = [
    envPython,
    path.resolve(cwd, ".venv-sidecar", "bin", "python"),
    path.resolve(cwd, ".venv", "bin", "python"),
    "python3",
  ].filter(Boolean) as string[];

  return Array.from(new Set(candidates));
};

export const resolvePythonBinary = (): string => {
  for (const candidate of candidatePythonBinaries()) {
    if (candidate === "python3") return candidate;
    if (fs.existsSync(candidate)) return candidate;
  }

  return "python3";
};
