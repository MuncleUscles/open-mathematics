#!/usr/bin/env bash
set -euo pipefail
mkdir -p .data/image
curl --fail --location --retry 3 --output .data/image/lean.tar.zst https://github.com/leanprover/lean4/releases/download/v4.19.0/lean-4.19.0-linux.tar.zst
printf '%s  %s\n' '6fe3ce97a58f44e2b3567d455b994eacec5bfe9ae7774f2a573444480ba813fe' '.data/image/lean.tar.zst' | sha256sum --check
tar --zstd -xf .data/image/lean.tar.zst -C .data/image
rm .data/image/lean.tar.zst
docker build --platform=linux/amd64 --network=none -f github/Lean.Dockerfile -t open-math-verifier .data/image
image_id=$(docker image inspect open-math-verifier --format '{{.Id}}')
printf 'TRUSTED_LEAN_IMAGE=%s\n' "$image_id" >> "$GITHUB_ENV"
