# wscp-superkomi

WebRGSS WASM mruby 런타임. RPG Maker VX Ace (RGSS3) 게임을 브라우저에서 구동하기 위한
Emscripten 기반 RGSS301.dll 모사 모듈입니다.

`zuzunza-compose build wscp-superkomi` 명령이 이 디렉터리의 `build.sh`를 호출해
`debian:12-slim` 컨테이너 안에서 emsdk + mruby + RGSS C 바인딩을 컴파일하고,
산출물을 `/home/zuzunza/dist/external/superkomi/<rev>/` 에 export합니다.
`wscp-frontend` 는 빌드 시점에 해당 디렉터리에서 `webrgss.{mjs,wasm}` 을
`public/player/wasm/` 으로 심볼릭 링크합니다.

## 디렉터리 레이아웃

```
.
├── README.md                # 이 파일
├── .gitignore               # build/ dist/
├── Dockerfile.build         # debian:12-slim + emsdk + mruby toolchain
├── build.sh                 # idempotent: 캐시 hit 시 skip
├── Makefile                 # 컨테이너 내부에서 mruby + emcc 빌드
├── build_config.rb          # mruby gembox 정의
├── scripts/
│   └── webrgss_prelude.rb   # mruby 부트스트랩 (rgss_main 등 핵심 패치)
├── include/
│   └── webrgss_imports.h    # js_* extern 선언 (WasmRgssBridge.ts와 1:1)
└── src/
    ├── webrgss.c            # _wrgss_{init,exec_script,exec_bytecode,tick,shutdown}
    ├── webrgss_class.c      # 공용 데이터 타입 등록 헬퍼
    ├── rgss_graphics.c      # Graphics 모듈
    ├── rgss_input.c         # Input 모듈
    ├── rgss_audio.c         # Audio 모듈
    ├── rgss_bitmap.c        # Bitmap 클래스
    ├── rgss_sprite.c        # Sprite 클래스
    ├── rgss_window.c        # Window 클래스
    ├── rgss_viewport.c      # Viewport 클래스
    ├── rgss_plane.c         # Plane 클래스
    ├── rgss_tilemap.c       # Tilemap 클래스
    ├── rgss_color.c         # Color 클래스
    ├── rgss_tone.c          # Tone 클래스
    ├── rgss_rect.c          # Rect 클래스
    ├── rgss_table.c         # Table 클래스
    ├── rgss_font.c          # Font 클래스
    └── rgss_data.c          # msgbox/exit/sprintf/Win32API/File/Dir/Time 글로벌
```

## ABI 계약

C 측이 호출하는 `js_*` extern 시그니처는 반드시
`application/wscp-frontend/lib/webrgss/wasm/WasmRgssBridge.ts` `buildImports()`
에 등록된 시그니처와 1:1 일치해야 합니다.

신규 시그니처 추가 시 다음 두 곳을 동시에 갱신하세요:
- `include/webrgss_imports.h` (extern 선언)
- `application/wscp-frontend/lib/webrgss/wasm/WasmRgssBridge.ts` (구현)

## Export 함수

| Export                       | 설명                                                   |
| ---------------------------- | ------------------------------------------------------ |
| `_wrgss_init`                | mruby state 초기화, 모든 RGSS 클래스 등록              |
| `_wrgss_exec_script(s, n)`   | Ruby 소스 실행 (Scripts.rvdata2 한 슬롯)               |
| `_wrgss_exec_bytecode(b,l,n)`| RITE 바이트코드 실행 (JIT)                             |
| `_wrgss_tick`                | rgss_main Fiber 한 프레임 resume                       |
| `_wrgss_shutdown`            | 자원 정리                                              |
| `_wrgss_debug_tick_probe`    | 진단: 마지막 tick 위치 코드                            |
| `_wrgss_debug_game_running`  | 진단: 게임 루프 상태                                   |
| `_wrgss_debug_is_fiber`      | 진단: rgss_main Fiber 살아있는지                       |

## 빌드

### 표준 (zuzunza-compose 경유)

```bash
cd /home/zuzunza/src/zuzunza-waterscape
scripts/zuzunza-compose build wscp-superkomi
# 또는 강제 재빌드
SUPERKOMI_FORCE=1 scripts/zuzunza-compose build wscp-superkomi
```

### 직접 호출 (디버깅용)

```bash
cd application/wscp-superkomi
SUPERKOMI_FORCE=1 ./build.sh
```

## 산출물 위치

```
/home/zuzunza/dist/external/superkomi/<rev>/
├── webrgss.mjs   # Emscripten ES6 글루
└── webrgss.wasm  # WebAssembly 바이너리
```

`current` 심볼릭 링크가 마지막 빌드 rev를 가리키며, frontend 빌드 시점에
`application/wscp-frontend/public/player/wasm/{webrgss.mjs,webrgss.wasm}` 으로
심볼릭 링크됩니다.
