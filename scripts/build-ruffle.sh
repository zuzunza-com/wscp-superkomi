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

# …/wscp-superkomi → …/zuzunza-waterscape 는 ../.., 상위(모노레포/작업 루트)에 zuzunza-ruffle 이 있으면 …/../…/zuzunza-ruffle
# (구 레이아웃: …/src/zuzunza-waterscape/... → ../../../zuzunza-ruffle). Clone 위치에 맞게 ZUZUNZA_RUFFLE_ROOT 를 주면 됨.
log() { printf '[build-ruffle] %s\n' "$*" >&2; }

# 사전 배치된 selfhosted 번들만 쓸 때(예: @ruffle-rs/ruffle 시드, CI 산출물). 소스 클론이 있어도 스킵.
if [[ -f "${RUFFLE_OUT}/ruffle.js" ]] && [[ -z "${ZUZUNZA_RUFFLE_FORCE:-}" ]]; then
  case "${ZUZUNZA_RUFFLE_USE_EXPORT_ONLY:-}" in
    1|true|yes|on)
      log "reusing ${RUFFLE_OUT}/ruffle.js (ZUZUNZA_RUFFLE_USE_EXPORT_ONLY; override with ZUZUNZA_RUFFLE_FORCE=1)"
      exit 0
      ;;
  esac
fi

resolve_zuzunza_ruffle_root() {
  # 모노레포 표준: zuzunza-waterscape/application/zuzunza-ruffle (형제: wscp-superkomi → ../zuzunza-ruffle)
  local p cands=(
    "${ZUZUNZA_RUFFLE_ROOT:-}"
    "${SUPERKOMI_DIR}/../zuzunza-ruffle"
    "${SUPERKOMI_DIR}/../../../zuzunza-ruffle"
    "${SUPERKOMI_DIR}/../../../../zuzunza-ruffle"
    "${SUPERKOMI_DIR}/../../zuzunza-ruffle"
  )
  for p in "${cands[@]}"; do
    [[ -z "${p}" ]] && continue
    if [[ -f "${p}/web/package.json" ]]; then
      (cd "${p}" && pwd)
      return 0
    fi
  done
  return 1
}

if ZUZUNZA_RUFFLE_ROOT="$(resolve_zuzunza_ruffle_root 2>/dev/null)"; then
  :
else
  if [[ -f "${RUFFLE_OUT}/ruffle.js" ]]; then
    log "zuzunza-ruffle 소스( web/package.json )를 찾지 못했습니다. 기존 번들 ${RUFFLE_OUT}/ruffle.js 를 사용합니다(재빌드: clone 후 ZUZUNZA_RUFFLE_ROOT=…)."
    exit 0
  fi
  log "error: zuzunza-ruffle repo not found. Tried: ZUZUNZA_RUFFLE_ROOT='${ZUZUNZA_RUFFLE_ROOT:-}',"
  log "  ${SUPERKOMI_DIR}/../zuzunza-ruffle (application/zuzunza-ruffle), ../../.., and no ${RUFFLE_OUT}/ruffle.js to fall back to."
  log "  Fix: from zuzunza-waterscape repo root run:  make ruffle-clone"
  log "  Or:  git clone git@github.com:zuzunza-com/zuzunza-ruffle.git application/zuzunza-ruffle"
  log "  Or set ZUZUNZA_RUFFLE_ROOT to the repo root (must contain web/package.json)."
  exit 1
fi
WEB_DIR="${ZUZUNZA_RUFFLE_ROOT}/web"

# zuzunza-compose deploy: scripts/zuzunza_compose_build.py 가 env.conf 에서
# OBFUSCATOR_API_TOKEN·ZUZUNZA_RUFFLE_* 등을 병합해 이 스크립트에 넘긴다.
# 수동 실행 시 토큰이 필요하면: export … 또는 ZUZUNZA_RUFFLE_LOAD_ENV_CONF=1
if [[ "${ZUZUNZA_RUFFLE_LOAD_ENV_CONF:-}" == "1" ]]; then
  _repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
  _ecf="${ZUZUNZA_ENV_CONF:-${_repo_root}/deploy/.env}"
  if [[ ! -f "${_ecf}" && -f "${HOME}/conf.d/env.conf" ]]; then
    _ecf="${HOME}/conf.d/env.conf"
  fi
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
  # web 루트는 위에서 npm ci 로 설치함. pnpm-lock 이 없는데 pnpm run build 만 쓰면
  # selfhosted 에 로컬 node_modules 가 없어 webpack 을 못 찾는다 → npm run build 사용.
  if [[ -f "${WEB_DIR}/pnpm-lock.yaml" ]] && command -v pnpm >/dev/null 2>&1; then
    (cd "${WEB_DIR}" && pnpm install --frozen-lockfile)
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
