#!/usr/bin/env bash
# Build the wscp-superkomi WASM runtime inside a transient Docker container,
# then copy /opt/superkomi/{webrgss.mjs,webrgss.wasm} into
# /home/zuzunza/dist/external/superkomi/<rev>/. Idempotent: skip when the
# expected webrgss.wasm already exists for the requested revision (override
# with SUPERKOMI_FORCE=1).
set -euo pipefail

REV="${SUPERKOMI_REV:-main}"
EXPORT_ROOT="${SUPERKOMI_EXPORT_ROOT:-/home/zuzunza/dist/external/superkomi}"
EXPORT_DIR="${EXPORT_ROOT}/${REV}"
LATEST_LINK="${EXPORT_ROOT}/current"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DOCKERFILE="${SCRIPT_DIR}/Dockerfile.build"
IMAGE_TAG="${SUPERKOMI_IMAGE_TAG:-zuzunza/superkomi-builder:${REV}}"

log() { printf '[superkomi] %s\n' "$*" >&2; }

if [ -f "${EXPORT_DIR}/webrgss.wasm" ] && [ -z "${SUPERKOMI_FORCE:-}" ]; then
  log "webrgss.wasm already built at ${EXPORT_DIR} (set SUPERKOMI_FORCE=1 to rebuild)"
else
  log "building image ${IMAGE_TAG} from ${DOCKERFILE}"
  docker build \
    --build-arg "MRUBY_REF=${MRUBY_REF:-3.3.0}" \
    --build-arg "EMSDK_VERSION=${EMSDK_VERSION:-3.1.74}" \
    -t "${IMAGE_TAG}" \
    -f "${DOCKERFILE}" \
    "${SCRIPT_DIR}"

  log "exporting /opt/superkomi tree to ${EXPORT_DIR}"
  install -d "${EXPORT_ROOT}"
  rm -rf "${EXPORT_DIR}.tmp"
  install -d "${EXPORT_DIR}.tmp"

  CID="$(docker create "${IMAGE_TAG}" /bin/true)"
  trap 'docker rm -f "${CID}" >/dev/null 2>&1 || true' EXIT
  docker cp "${CID}:/opt/superkomi/." "${EXPORT_DIR}.tmp/"
  docker rm -f "${CID}" >/dev/null
  trap - EXIT

  rm -rf "${EXPORT_DIR}.bak"
  if [ -d "${EXPORT_DIR}" ]; then
    mv "${EXPORT_DIR}" "${EXPORT_DIR}.bak"
  fi
  mv "${EXPORT_DIR}.tmp" "${EXPORT_DIR}"
  rm -rf "${EXPORT_DIR}.bak"
fi

mkdir -p "${EXPORT_ROOT}"
ln -sfn "${EXPORT_DIR}" "${LATEST_LINK}"

log "artifact dir : ${EXPORT_DIR}"
log "webrgss.mjs  : $(stat -c '%s bytes' "${EXPORT_DIR}/webrgss.mjs"  2>/dev/null || echo missing)"
log "webrgss.wasm : $(stat -c '%s bytes' "${EXPORT_DIR}/webrgss.wasm" 2>/dev/null || echo missing)"
