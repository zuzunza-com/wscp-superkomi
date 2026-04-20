#!/usr/bin/env bash
# Build zuzunza-ruffle web selfhosted bundle and copy into SUPERKOMI_EXPORT_ROOT alongside WebRGSS artifacts.
# Idempotent: skips when stamp matches (override with ZUZUNZA_RUFFLE_FORCE=1).
set -euo pipefail

REV="${SUPERKOMI_REV:-main}"
EXPORT_ROOT="${SUPERKOMI_EXPORT_ROOT:-/home/zuzunza/dist/external/superkomi}"
EXPORT_DIR="${EXPORT_ROOT}/${REV}"
RUFFLE_OUT="${EXPORT_DIR}/ruffle"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SUPERKOMI_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

# Default: sibling of zuzunza-waterscape (…/src/zuzunza-ruffle). Override with ZUZUNZA_RUFFLE_ROOT.
ZUZUNZA_RUFFLE_ROOT="${ZUZUNZA_RUFFLE_ROOT:-${SUPERKOMI_DIR}/../../../zuzunza-ruffle}"
ZUZUNZA_RUFFLE_ROOT="$(cd "${ZUZUNZA_RUFFLE_ROOT}" && pwd)"
WEB_DIR="${ZUZUNZA_RUFFLE_ROOT}/web"

log() { printf '[build-ruffle] %s\n' "$*" >&2; }

if [[ ! -f "${WEB_DIR}/package.json" ]]; then
  log "error: zuzunza-ruffle web not found at ${WEB_DIR}"
  log "Set ZUZUNZA_RUFFLE_ROOT to the zuzunza-ruffle repo root."
  exit 1
fi

# zuzunza-compose deploy: scripts/zuzunza_compose_build.py 가 env.conf 에서
# OBFUSCATOR_API_TOKEN·ZUZUNZA_RUFFLE_* 등을 병합해 이 스크립트에 넘긴다.
# 수동 실행 시 토큰이 필요하면: export … 또는 ZUZUNZA_RUFFLE_LOAD_ENV_CONF=1
if [[ "${ZUZUNZA_RUFFLE_LOAD_ENV_CONF:-}" == "1" ]]; then
  _ecf="${ZUZUNZA_ENV_CONF:-${HOME}/conf.d/env.conf}"
  if [[ -f "${_ecf}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${_ecf}"
    set +a
    log "loaded environment from ${_ecf}"
  else
    log "warning: ZUZUNZA_RUFFLE_LOAD_ENV_CONF=1 but ${_ecf} not found"
  fi
fi

stamp_in() {
  (
    cd "${ZUZUNZA_RUFFLE_ROOT}" && git rev-parse HEAD 2>/dev/null || echo "nogit"
    find "${WEB_DIR}/packages/selfhosted" -type f \( -name "*.ts" -o -name "*.js" -o -name "*.mjs" -o -name "*.json" \) 2>/dev/null | sort | xargs sha256sum 2>/dev/null
  ) | sha256sum | awk '{print $1}'
}

STAMP_CUR="$(stamp_in)"
STAMP_FILE="${RUFFLE_OUT}/.build-stamp"

if [[ -f "${RUFFLE_OUT}/ruffle.js" ]] && [[ -z "${ZUZUNZA_RUFFLE_FORCE:-}" ]] && [[ -f "${STAMP_FILE}" ]] && [[ "$(cat "${STAMP_FILE}")" == "${STAMP_CUR}" ]]; then
  log "ruffle.js up to date at ${RUFFLE_OUT} (set ZUZUNZA_RUFFLE_FORCE=1 to rebuild)"
  exit 0
fi

log "installing npm deps in ${WEB_DIR}"
(
  cd "${WEB_DIR}"
  # 상위 환경이 NODE_ENV=production 이면 devDependencies(webpack 등)가 빠져 빌드가 실패한다.
  npm ci --include=dev
)

# Origin lock at bundle time (comma-separated origins). Empty = no runtime origin check in the player.
export ZUZUNZA_RUFFLE_ALLOWED_ORIGINS="${ZUZUNZA_RUFFLE_ALLOWED_ORIGINS:-}"

log "building selfhosted (webpack + optional Obfuscator.io Pro VM)"
(
  cd "${WEB_DIR}/packages/selfhosted"
  if command -v pnpm >/dev/null 2>&1; then
    pnpm run build
  else
    npm run build
  fi
)

install -d "${RUFFLE_OUT}.tmp"
rm -rf "${RUFFLE_OUT}.tmp"/*
cp -a "${WEB_DIR}/packages/selfhosted/dist/." "${RUFFLE_OUT}.tmp/"
echo "${STAMP_CUR}" >"${RUFFLE_OUT}.tmp/.build-stamp"

rm -rf "${RUFFLE_OUT}.bak"
if [[ -d "${RUFFLE_OUT}" ]]; then
  mv "${RUFFLE_OUT}" "${RUFFLE_OUT}.bak"
fi
mv "${RUFFLE_OUT}.tmp" "${RUFFLE_OUT}"
rm -rf "${RUFFLE_OUT}.bak"

log "ruffle bundle: ${RUFFLE_OUT}/ruffle.js"
log "stamp written: ${STAMP_FILE}"
