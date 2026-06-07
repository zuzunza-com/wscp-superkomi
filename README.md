# wscp-superkomi — WebRGSS WASM mruby runtime & TypeScript client

> **ZUZUNZA Waterscape** 플랫폼의 RGSS3 게임 플레이어 서브모듈. RPG Maker VX Ace
> (RGSS3 / `RGSS301.dll`) 게임을 브라우저에서 그대로 구동하기 위한 WebAssembly
> mruby 런타임과 그 위에 올라가는 TypeScript 클라이언트 스택을 제공합니다.

`wscp-superkomi` 는 두 개의 층으로 구성됩니다.

1. **네이티브 코어** — `src/*.c` (C, mruby 임베딩) 를 emscripten 으로 컴파일한
   `webrgss.wasm` + `webrgss.mjs`. mruby VM 안에서 RGSS3 스크립트를 실제로 실행하며,
   그리기/오디오/입력/파일 I/O 는 `js_*` import 를 통해 호스트(JS)로 위임합니다.
2. **TypeScript 클라이언트** — `ts/*`. WASM 로더·ABI 브리지·RGSS3 공개 API(Graphics,
   Sprite, Window …)·Canvas2D/WebGPU 렌더러·`.rvdata2`/`.rgss3a`/RTP 리소스 로더·
   Ruby Marshal 파서를 묶어, `wscp-frontend` 가 그대로 import 하는 패키지 표면을 만듭니다.

설계는 clean-room 이며 mkxp-z / mkxp-web 의 **동작만** 참조합니다(코드 미포함).
라이선스·고지는 [NOTICE.md](./NOTICE.md) 를 참조하세요.

---

## 목차

1. [기술 스택](#1-기술-스택)
2. [디렉토리 구조](#2-디렉토리-구조)
3. [주요 기능](#3-주요-기능)
4. [아키텍처 / ABI 계약](#4-아키텍처--abi-계약)
5. [빌드 파이프라인 (build.sh / Makefile / Dockerfile.build)](#5-빌드-파이프라인-buildsh--makefile--dockerfilebuild)
6. [빌드 및 실행](#6-빌드-및-실행)
7. [환경 변수 / 설정](#7-환경-변수--설정)
8. [라이선스 / 고지](#8-라이선스--고지)

---

## 1. 기술 스택

| 영역 | 사용 기술 |
| --- | --- |
| 네이티브 코어 언어 | **C** (`src/*.c`, `include/*.h`), mruby C API 임베딩 |
| 스크립트 VM | **mruby 3.3** (`-DMRB_INT64 -DMRB_USE_FLOAT32 -DMRB_UTF8_STRING`), Fiber 기반 메인 루프 |
| 임베디드 Ruby | `scripts/webrgss_prelude.rb` → `mrbc -B` 로 RITE 바이트코드화하여 wasm 에 내장 |
| WASM 툴체인 | **Emscripten 3.1.74** (`emcc`/`em++`/`emar`), ASYNCIFY, ES6 modularize, `EXPORT_NAME=createWebRgssModule` |
| 클라이언트 언어 | **TypeScript** (ESM, `target ES2020`, `moduleResolution bundler`, `strict`) |
| 렌더러 | WebGPU(WGSL) 우선, 미지원 시 Canvas 2D fallback |
| 리소스/직렬화 | Ruby Marshal 파서, `jszip` · `fflate` · `@qnighy/marshal` (peerDependencies) |
| 빌드 오케스트레이션 | `build.sh`(Docker 래퍼) → `Dockerfile.build`(`debian:12-slim`) → `Makefile`(컨테이너 내부 `make`) |
| 테스트 / 타입체크 | `node --test --experimental-strip-types` (ts/**/*.test.ts), `tsc --noEmit` |
| 동반 번들(선택) | `zuzunza-ruffle` selfhosted(Flash, Rust `wasm32` + `wasm-bindgen`) — `scripts/build-ruffle.sh` |

> `src/` 는 C/C++ 가 아니라 **순수 C** 입니다. Rust 는 이 저장소 빌드에 쓰이지 않으며,
> 동반 `ruffle` 번들을 직접 소스에서 빌드할 때만(선택) 등장합니다.

## 2. 디렉토리 구조

```
.
├── build.sh              # Docker 빌드 래퍼 (멱등: webrgss.wasm 존재 시 skip)
├── Dockerfile.build      # debian:12-slim + emsdk + mruby 빌더 이미지 (BUILD-ONLY)
├── Makefile              # 컨테이너 내부 빌드: mruby(host+cross) → .o → emcc 링크
├── build_config.rb       # mruby Build/CrossBuild gembox 정의 (host=mrbc, emscripten=libmruby.a)
├── package.json          # ESM 패키지 표면(./api ./wasm ./renderer ./rvdata2 …) + scripts
├── tsconfig.json         # tsc --noEmit (ts/**/*.ts)
├── NOTICE.md             # 제3자 참조/고지 (mkxp-z, mkxp-web — clean-room)
│
├── include/
│   ├── webrgss.h            # 런타임 내부 API (클래스 등록, data_type, 변환 헬퍼)
│   └── webrgss_imports.h    # 호스트가 제공하는 js_* extern 선언 (ABI 계약)
│
├── scripts/
│   ├── webrgss_prelude.rb   # wasm 내장 mruby 부트스트랩 (rgss_main Fiber, Font/Tilemap 프록시)
│   └── build-ruffle.sh      # (선택) zuzunza-ruffle selfhosted 번들 빌드
│
├── src/                     # === C 네이티브 코어 ===
│   ├── webrgss.c            # _wrgss_{init,exec_script,exec_bytecode,tick,shutdown} + debug probe
│   ├── webrgss_class.c      # 공용 클래스/data_type 등록 헬퍼
│   ├── rgss_graphics.c      # Graphics 모듈        ├── rgss_input.c    # Input 모듈
│   ├── rgss_audio.c         # Audio 모듈           ├── rgss_bitmap.c   # Bitmap
│   ├── rgss_sprite.c        # Sprite              ├── rgss_window.c   # Window
│   ├── rgss_plane.c         # Plane               ├── rgss_tilemap.c  # Tilemap
│   ├── rgss_color.c         # Color               ├── rgss_rect.c     # Rect
│   ├── rgss_table.c         # Table               ├── rgss_font.c     # Font
│   ├── rgss_regexp.c        # 호스트 정규식 위임  └── rgss_data.c     # rgss_main/msgbox/File/Dir/Time/Win32API 등
│
└── ts/                      # === TypeScript 클라이언트 ===
    ├── index.ts             # 패키지 최상위 export 파사드
    ├── WebRGSS.ts           # 런타임 파사드 (부트 모드, 렌더 루프, 리소스 로드)
    ├── RgssEmulator.ts      # Game.exe 흐름 에뮬레이터 (RTP→로드→WASM→메인 루프)
    ├── loadGameFromZip.ts   # zip / rgss3a 게임 로더
    ├── wasm/                # WasmRgssRuntime, WasmRgssBridge(js_* 구현), WasmMemory, boot-lock, path-sanitize
    ├── api/                 # RGSS3 공개 API: Graphics/Input/Bitmap/Sprite/Window/Viewport/Plane/Tilemap/Table/Color/Tone/Rect/Font/Audio
    ├── renderer/            # IRenderer + CanvasRenderer(2D) + WebGPURenderer(WGSL)
    ├── runtime/            # DataManager/SceneManager/RgssHost 브리지, ScriptRuntime
    ├── rvdata2/             # Ruby Marshal 디코더 + Scripts.rvdata2 파서
    ├── resources/           # ResourceLoader, Rgss3aLoader, RTP/RouteRtp/StreamPack 로더
    ├── rpg/                 # RPG::System 등 데이터 정규화
    ├── rgss/ · ux/ · game/ · utils/ · types/   # 스크립트 파서, msgbox UX, TitleScene 등
    └── resources/RGSS301.dll # DLL 분석용 참조 바이너리 (런타임 미사용, docs/RGSS301_DLL_ANALYSIS.md)
```

## 3. 주요 기능

| 기능 | 설명 |
| --- | --- |
| RGSS3 스크립트 실행 | `Scripts.rvdata2` 의 Ruby 소스/RITE 바이트코드를 mruby VM 에서 직접 실행 |
| Fiber 메인 루프 | `rgss_main { ... }` 을 Fiber 로 감싸 프레임당 한 번 `resume` (프리엠션식 틱) |
| RGSS3 클래스 풀세트 | Graphics·Input·Audio·Bitmap·Sprite·Viewport·Window·Plane·Tilemap·Color·Tone·Rect·Table·Font 네이티브 등록 |
| 호스트 위임 그리기/오디오 | 모든 드로잉·BGM/SE·입력·파일은 `js_*` import 로 JS(WebGPU/Canvas/WebAudio) 에 위임 |
| 다중 부트 모드 | `wasm_mruby`(기본) · `transpiled_rgss3`(JS 트랜스파일) · `legacy_title_demo`(정적 타이틀) |
| 리소스 로딩 | `.zip` · `.rgss3a` 아카이브 · RTP · StreamPack · EXE(SFX) 패키지 |
| Marshal 파서 | `.rvdata2`(Ruby Marshal) → JS 객체 디코딩, Scripts 추출 |
| 렌더러 | WebGPU 하드웨어 가속(WGSL 셰이더) + Canvas 2D fallback |
| 고속 재생 | `playbackSpeed`(1/2/4/8) — WASM 틱을 배치 실행해 JS 루프 한계 우회 |
| 진단 훅 | `onWasmDiagnostics`(lastMsgbox/printErr/tick counter) + `_wrgss_debug_*` probe |
| Font/Tilemap 프록시 | 프렐류드가 `bitmap.font.size=` , `tilemap.bitmaps[]=` 를 네이티브 setter 로 연결 |

## 4. 아키텍처 / ABI 계약

```
ts/api/* (Graphics, Sprite …)          ← 게임이 보는 RGSS3 표면
   ▲
ts/wasm/WasmRgssBridge.ts  buildImports()  ── js_* 구현, int32 핸들 레지스트리
   │ (Emscripten import table "env")
   ▼
webrgss.wasm  (C: src/*.c + mruby + 내장 prelude irep)
   │  exports: _wrgss_init / _wrgss_exec_script / _wrgss_exec_bytecode /
   │           _wrgss_tick / _wrgss_shutdown / _wrgss_debug_* / _wrgss_alloc/free
   ▼
ts/wasm/WasmRgssRuntime.ts  ── export 바인딩, 프레임 틱, 진단
```

**WASM export 함수** (`Makefile` 의 `EXPORTED_FUNCS`, `EMSCRIPTEN_KEEPALIVE`):

| Export | 설명 |
| --- | --- |
| `_wrgss_init` | mruby state 생성, 모든 RGSS 클래스 등록, prelude irep 로드 |
| `_wrgss_exec_script(src,name)` | Ruby 소스 문자열 평가 (Scripts 슬롯 1개) |
| `_wrgss_exec_bytecode(buf,len,name)` | RITE 바이트코드 블롭 평가 |
| `_wrgss_tick` | `__wrgss_tick_internal` 호출 → rgss_main Fiber 한 프레임 resume (alive=1) |
| `_wrgss_shutdown` | `mrb_close`, 상태 정리 |
| `_wrgss_debug_tick_probe` / `_wrgss_debug_game_running` / `_wrgss_debug_is_fiber` | 진단 probe |
| `_wrgss_alloc` / `_wrgss_free` | 호스트 버퍼 전달용 malloc/free 래퍼 |

**ABI 계약 (중요):** C 코어가 import 하는 `js_*` 시그니처(`include/webrgss_imports.h`,
`import_module("env")`)는 호스트의 `WasmRgssBridge.ts#buildImports()` 구현과 **1:1**
로 일치해야 합니다. 시그니처를 추가·변경할 때는 두 곳을 **동시에** 갱신하세요.
(`-lexports.js` 로 import/export 이름 minify 를 끄는 이유는 `Makefile` 주석 참조.)

## 5. 빌드 파이프라인 (build.sh / Makefile / Dockerfile.build)

WASM 산출물은 **3단계** 로 만들어집니다.

1. **`build.sh`** (호스트, Docker 래퍼)
   - `webrgss.wasm` 가 이미 있으면 skip — `SUPERKOMI_FORCE=1` 로 강제.
   - `Dockerfile.build` 로 빌더 이미지를 빌드(`MRUBY_REF`, `EMSDK_VERSION` build-arg).
   - 컨테이너의 `/opt/superkomi/` 트리를 `docker cp` 로 꺼내 `EXPORT_ROOT/<rev>/` 에 원자적 교체,
     `current` 심볼릭 링크 갱신.

2. **`Dockerfile.build`** (`debian:12-slim`, BUILD-ONLY)
   - apt: gcc/clang/ruby/bison/cmake 등 → `emsdk` (`EMSDK_VERSION`, 기본 3.1.74) install+activate
     → `mruby` (`MRUBY_REF`, 기본 3.3.0) 체크아웃.
   - `Makefile`/`build_config.rb`/`src`/`include`/`scripts` 복사 후
     `source emsdk_env.sh && make -j all` → `/opt/superkomi/webrgss.{mjs,wasm}` 로 export.

3. **`Makefile`** (컨테이너 내부)
   - `mruby` 타깃: `MRUBY_CONFIG=build_config.rb rake` 로 **host**(`mrbc`)와
     **emscripten cross**(`libmruby.a`, emcc/em++/emar) 두 빌드를 생성.
   - `scripts/webrgss_prelude.rb` → `mrbc -B wrgss_prelude_irep` → `.c` → `.o`.
   - `src/*.c` 각각 `emcc -c` 컴파일 → 프렐류드 `.o` + cross `libmruby.a` 와 함께
     `emcc` 로 링크해 `build/webrgss.mjs` + `build/webrgss.wasm` 생성
     (ASYNCIFY, `MODULARIZE`, `EXPORT_ES6`, `ALLOW_MEMORY_GROWTH`, 64MiB→512MiB).

`build_config.rb` 는 RGSS3 호환을 위해 mruby gembox(`mruby-fiber`, `mruby-eval`,
`mruby-pack`, `mruby-time`, `mruby-sprintf`, `mruby-compiler` …)와
`MRB_INT64`/`MRB_USE_FLOAT32`/`MRB_UTF8_STRING` 매크로를 지정합니다.

## 6. 빌드 및 실행

### WASM 코어 빌드

```bash
# 표준: Docker 경유 (멱등)
./build.sh
# 또는
pnpm run build:wasm

# 강제 재빌드
SUPERKOMI_FORCE=1 ./build.sh

# 툴체인 버전 핀 변경
MRUBY_REF=3.3.0 EMSDK_VERSION=3.1.74 ./build.sh
```

산출물:

```
${SUPERKOMI_EXPORT_ROOT:-/home/zuzunza/dist/external/superkomi}/<rev>/
├── webrgss.mjs       # Emscripten ES6 글루 (createWebRgssModule)
├── webrgss.wasm      # WebAssembly 바이너리
└── ruffle/           # (선택) zuzunza-ruffle selfhosted 번들
current -> <rev>      # 마지막 빌드 심볼릭 링크
```

`wscp-frontend` 는 빌드 시 위 `webrgss.{mjs,wasm}` 를 자신의 정적 자산
(`public/player/wasm/`) 으로 연결하고, 런타임에서 `WasmRgssRuntime` 가 로드합니다.

### TypeScript 검증 / 테스트

```bash
pnpm run typecheck      # tsc --noEmit
pnpm test               # node --test (ts/**/*.test.ts)
pnpm run test:bindings  # ABI 시그니처 일치 검증 (WasmBindingsSource.test.ts)
```

### (선택) Ruffle Flash 번들

```bash
# 모노레포 루트에서 형제 리포 클론 후
ZUZUNZA_RUFFLE_ALLOWED_ORIGINS="https://example.com" ./scripts/build-ruffle.sh
```

> `ruffle-core` WASM 빌드에는 Rust `wasm32-unknown-unknown` + `wasm-bindgen-cli`
> (프로젝트 크레이트 버전과 동일), 선택적으로 `wasm-opt` 가 필요합니다.

## 7. 환경 변수 / 설정

| 변수 | 대상 | 기본값 | 설명 |
| --- | --- | --- | --- |
| `SUPERKOMI_REV` | build.sh | `main` | export 디렉터리 rev 이름 |
| `SUPERKOMI_EXPORT_ROOT` | build.sh | `/home/zuzunza/dist/external/superkomi` | 산출물 루트 |
| `SUPERKOMI_FORCE` | build.sh | (unset) | 캐시 skip 무시·강제 재빌드 |
| `SUPERKOMI_IMAGE_TAG` | build.sh | `zuzunza/superkomi-builder:<rev>` | 빌더 이미지 태그 |
| `MRUBY_REF` | Dockerfile | `3.3.0` | mruby 체크아웃 브랜치/태그 |
| `EMSDK_VERSION` | Dockerfile | `3.1.74` | emsdk 핀 버전 |
| `ZUZUNZA_RUFFLE_ROOT` | build-ruffle.sh | (자동 탐색) | zuzunza-ruffle 리포 경로 |
| `ZUZUNZA_RUFFLE_ALLOWED_ORIGINS` | build-ruffle.sh | (없음) | 번들 시 origin lock(콤마 구분) |
| `ZUZUNZA_RUFFLE_FORCE` / `..._USE_EXPORT_ONLY` / `..._LOAD_ENV_CONF` | build-ruffle.sh | (unset) | 재빌드 강제 / 기존 번들 재사용 / env.conf 로드 |

런타임 설정은 코드(`WebRGSSConfig`, `RgssEmulatorConfig`)로 전달됩니다: `canvas`,
`width/height`(기본 544×416), `frameRate`(기본 60), `playbackSpeed`, `bootMode`,
`useWebGPU`, 그리고 `onStateChange`/`onProgress`/`onError`/`onMsgbox`/`onWasmDiagnostics`
등의 콜백. EXE 게임 실행 시에는 서버측 `prepareExePackage` preparer 를 주입해야 합니다
(이 패키지는 프레임워크·서버 비의존).

## 8. 라이선스 / 고지

본체는 독립 저작물이며 상위 `zuzunza-waterscape` 의 라이선스 정책을 따릅니다
(`package.json` license: `UNLICENSED`, private). mkxp-z / mkxp-web (GPL-2.0+) 는
**소스 미포함, 관찰 가능한 동작만 clean-room 참조**합니다. 따라서 GPL 의무는
발생하지 않습니다. 전체 제3자 참조·감사·참조 인덱스 양식은 [NOTICE.md](./NOTICE.md)
를 반드시 확인하세요. `ts/resources/RGSS301.dll` 은 분석 참조용 바이너리이며 런타임에
포함·배포되지 않습니다.

---

*ZUZUNZA Waterscape — wscp-superkomi: 브라우저에서 RPG Maker VX Ace(RGSS3) 게임을 구동하는 WebAssembly mruby 런타임 + TypeScript 클라이언트.*
