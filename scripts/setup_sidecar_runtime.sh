#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv-sidecar"
pick_python_bin() {
  if [ -n "${PYTHON_BIN:-}" ]; then
    printf '%s' "${PYTHON_BIN}"
    return
  fi

  for candidate in python3.12 python3.11 python3.10 python3; do
    if command -v "${candidate}" >/dev/null 2>&1; then
      printf '%s' "${candidate}"
      return
    fi
  done

  return 1
}

PYTHON_BIN="$(pick_python_bin || true)"
if [ -z "${PYTHON_BIN}" ]; then
  echo "No supported Python interpreter was found (tried python3.12, python3.11, python3.10, python3)." >&2
  exit 1
fi

if [ -d "${VENV_DIR}" ] && [ ! -x "${VENV_DIR}/bin/pip" ]; then
  rm -rf "${VENV_DIR}"
fi

if [ ! -d "${VENV_DIR}" ]; then
  "${PYTHON_BIN}" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip wheel setuptools
"${VENV_DIR}/bin/pip" install -r "${ROOT_DIR}/requirements-sidecar.txt"

echo "Sidecar runtime is ready."
echo "Interpreter: ${VENV_DIR}/bin/python"
echo "Tip: export TEVEL_PYTHON_BIN=${VENV_DIR}/bin/python"
