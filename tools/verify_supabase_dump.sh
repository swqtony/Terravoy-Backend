#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
RAW_DIR="${ROOT}/supabase_raw"

echo "Checking Supabase dump assets in ${RAW_DIR}"

missing=0

for f in schema.sql functions migrations; do
  path="${RAW_DIR}/${f}"
  if [[ ! -e "${path}" ]]; then
    echo "MISSING: ${path}"
    missing=1
  else
    if [[ -f "${path}" ]]; then
      size=$(stat -c%s "${path}")
      echo "FOUND file ${path} (size=${size} bytes)"
      if [[ "${f}" == "schema.sql" && "${size}" -eq 0 ]]; then
        echo "WARNING: schema.sql is empty (dump failed or not yet captured)"
        missing=1
      fi
    else
      echo "FOUND dir  ${path}"
    fi
  fi
done

if compgen -G "${RAW_DIR}/data.sql" > /dev/null; then
  size=$(stat -c%s "${RAW_DIR}/data.sql")
  echo "FOUND optional data.sql (size=${size} bytes)"
else
  echo "INFO: data.sql not present (optional)"
fi

if [[ "${missing}" -ne 0 ]]; then
  echo "Verification failed: missing or empty required assets."
  exit 1
fi

echo "Verification passed."
