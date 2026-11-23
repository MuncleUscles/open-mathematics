#!/usr/bin/env bash
set -euo pipefail
# This is trusted setup, before any contribution is loaded. All submissions use
# the resulting immutable image ID with networking and host writes disabled.
root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
docker build --platform=linux/amd64 -f "$root/github/FullLean.Dockerfile" -t open-math-full-lean "$root/github"
image_id=$(docker image inspect open-math-full-lean --format '{{.Id}}')
if [[ -n "${GITHUB_ENV:-}" ]]; then
    printf 'TRUSTED_LEAN_IMAGE=%s\n' "$image_id" >> "$GITHUB_ENV"
else
    printf 'export TRUSTED_LEAN_IMAGE=%q\n' "$image_id"
fi
