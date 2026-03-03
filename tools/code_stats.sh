#!/usr/bin/env bash
set -euo pipefail

# Configure suffixes here (without the leading dot).
SUFFIXES=("py" "tsx" "md")

# Optional first argument: directory to scan (default: current directory).
ROOT_DIR="${1:-.}"

if [[ ! -d "${ROOT_DIR}" ]]; then
  echo "Error: '${ROOT_DIR}' is not a directory." >&2
  exit 1
fi

printf "%-8s %10s %12s\n" "Suffix" "Files" "Total Lines"
printf "%-8s %10s %12s\n" "------" "-----" "-----------"

for suffix in "${SUFFIXES[@]}"; do
  file_count=0
  line_sum=0

  while IFS= read -r -d '' file; do
    ((file_count += 1))
    lines="$(wc -l < "${file}")"
    lines="${lines//[[:space:]]/}"
    ((line_sum += lines))
  done < <(find "${ROOT_DIR}" \
    -type d -path '*/.*' -prune -o \
    -type f -name "*.${suffix}" -print0)

  printf ".%-7s %10d %12d\n" "${suffix}" "${file_count}" "${line_sum}"
done
