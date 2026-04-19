# RGSS301.dll / Game.exe 분석

## PE 분석 방법

RGSS301.dll은 ASProtect SKE 2.1x로 보호되어 있으나, **Export/Import 테이블은 PE 헤더에서 추출 가능**하다.

### DLL 확보 경로

| 경로 | 설명 |
|------|------|
| RPG Maker VX Ace 설치 | `C:\Program Files\Enterbrain\RPG Maker VX Ace\RGSS301.dll` |
| Steam | `Steam\steamapps\common\RPG Maker VX Ace\RGSS301.dll` |
| 게임 배포본 | `Game.exe`와 동일 폴더의 `RGSS301.dll` |

### 분석 도구

**Windows (Visual Studio Developer Command Prompt):**
```cmd
dumpbin /EXPORTS RGSS301.dll
dumpbin /IMPORTS RGSS301.dll
```

**Linux (mingw-w64 objdump):**
```bash
# i686-w64-mingw32-objdump 또는 x86_64-w64-mingw32-objdump
objdump -x RGSS301.dll | grep -A 200 "Export"
objdump -x RGSS301.dll | grep -A 100 "Import"
```

**스크립트 (DLL 경로 인자):**
```bash
./application/wscp-frontend/lib/webrgss/scripts/pe-analyze-rgss301.sh /path/to/RGSS301.dll
```

---

## 개요

### RGSS301.dll
- **파일**: RGSS301.dll (PE32, i386, Windows)
- **빌드**: 2012-02-22 (Enterbrain)
- **역할**: RPG Maker VX Ace (RGSS3) Ruby 런타임 임베딩 레이어

## Export 함수 (27개)

| Ordinal | 함수명 | 추정 역할 |
|---------|--------|-----------|
| 1 | RGSSAddRTPPath | RTP 경로 추가 |
| 2 | RGSSAudioFinalize | 오디오 정리 |
| 3 | RGSSAudioInitialize | 오디오 초기화 |
| 4 | RGSSClearRTPPath | RTP 경로 초기화 |
| 5 | RGSSErrorMessage | 에러 메시지 반환 |
| 6 | RGSSErrorType | 에러 타입 반환 |
| 7 | RGSSEval | Ruby 코드 실행 (eval) |
| 8 | RGSSFinalize | 런타임 종료 |
| 9 | RGSSGC | 가비지 컬렉션 |
| 10 | RGSSGameMain | 게임 메인 루프 진입점 |
| 11 | RGSSGetBool | Ruby → C bool 전달 |
| 12 | RGSSGetDouble | Ruby → C double 전달 |
| 13 | RGSSGetInt | Ruby → C int 전달 |
| 14 | RGSSGetPathWithRTP | RTP 포함 경로 해석 |
| 15 | RGSSGetRTPPath | RTP 경로 반환 |
| 16 | RGSSGetStringACP | Ruby → C 문자열 (ACP) |
| 17 | RGSSGetStringUTF16 | Ruby → C 문자열 (UTF-16) |
| 18 | RGSSGetStringUTF8 | Ruby → C 문자열 (UTF-8) |
| 19 | RGSSGetSymbol | Ruby Symbol → C |
| 20 | RGSSGetTable | Ruby Hash/Array → C |
| 21 | RGSSInitialize3 | RGSS3 런타임 초기화 |
| 22 | RGSSSetString | C → Ruby 문자열 |
| 23 | RGSSSetStringACP | C → Ruby 문자열 (ACP) |
| 24 | RGSSSetStringUTF16 | C → Ruby 문자열 (UTF-16) |
| 25 | RGSSSetStringUTF8 | C → Ruby 문자열 (UTF-8) |
| 26 | RGSSSetupFonts | 폰트 설정 |
| 27 | RGSSSetupRTP | RTP 설정 |

## Import (의존 DLL)

- **kernel32**: GetProcAddress, GetModuleHandleA, LoadLibraryA, RaiseException
- **user32**: GetAsyncKeyState (Input 처리)
- **gdi32**: GetGlyphOutlineW (폰트/텍스트 렌더링)
- **advapi32**: GetUserNameW
- **shell32**: SHGetPathFromIDListW
- **winmm**: timeBeginPeriod (오디오 타이밍)
- **comctl32**: PropertySheetW
- **ws2_32**: 네트워크
- **msacm32**: acmStreamConvert (오디오 변환)
- **ole32**, **oleaut32**: COM/Variant

## 구조 해석

1. **RGSS301.dll은 C 레벨 진입점만 노출**
   - Graphics, Input, Audio, Sprite, Bitmap 등 RGSS3 클래스는 **DLL 내부 Ruby C 확장**으로 등록
   - Export에는 Ruby 임베딩용 함수만 있음

2. **Game.exe 호출 흐름 (추정)**
   ```
   RGSSInitialize3() → RGSSSetupRTP() → RGSSSetupFonts()
   → RGSSEval(Scripts.rvdata2 로드/실행)
   → RGSSGameMain()  // 메인 루프
   → RGSSFinalize()
   ```

3. **Scripts.rvdata2**
   - Marshal 직렬화된 Ruby 스크립트 배열
   - RGSSEval로 순차 실행
   - Main 스크립트의 `rgss_main { }` 블록이 실제 게임 루프

---

## Game.exe 분석

- **파일**: Game.exe (PE32, i386, Windows)
- **빌드**: 2011-10-06 (Enterbrain)
- **역할**: RGSS3 게임 런처 (RGSS301.dll 동적 로드)

### RGSS301.dll 로딩

Game.exe는 **정적 Import에 RGSS301.dll이 없음**. `LoadLibrary` + `GetProcAddress`로 동적 로드.
DLL 경로는 Game.exe와 동일 디렉터리의 `RGSS301.dll`로 추정 (GetModuleFileName 기반).

### Game.exe가 사용하는 RGSS 함수 (6개)

| 함수명 | 용도 |
|--------|------|
| RGSSInitialize3 | 런타임 초기화 |
| RGSSSetupRTP | RTP 경로 설정 |
| RGSSSetupFonts | 폰트 설정 |
| RGSSEval | Scripts.rvdata2 로드 및 Ruby 코드 실행 |
| RGSSGameMain | 게임 메인 루프 |
| RGSSFinalize | 런타임 종료 |

### Game.exe Import (직접 의존)

- **KERNEL32**: LoadLibraryA/W, GetProcAddress, GetModuleFileName, GetPrivateProfileStringW, CreateFile, ReadFile 등
- **USER32**: CreateWindowExW, MessageBoxW, PeekMessageW, GetDC, ShowWindow 등 (윈도우/메시지)
- **GDI32**: GetStockObject
- **ADVAPI32**: RegOpenKeyExW, RegQueryValueExW (레지스트리, 설정)

---

## WebRGSS 대응

| Game.exe → RGSS301.dll | WebRGSS (WasmRgssRuntime) |
|------------------------|---------------------------|
| LoadLibrary(RGSS301.dll) | import(webrgss.mjs) |
| RGSSInitialize3 | wrgss_init |
| RGSSSetupRTP | RtpLoader / RtpBackedResourceLoader |
| RGSSSetupFonts | (부트스트랩/폰트 설정) |
| RGSSEval(Scripts) | fnExecScript (스크립트 순차 실행) |
| RGSSGameMain | FRAME_TICK_SCRIPT (매 프레임) |
| RGSSFinalize | fnShutdown |
| Graphics/Input/Audio (C 확장) | WasmRgssBridge js_* → Graphics/Input/Audio |

---

## Window / Window_Base 연관 함수 (lib.orzfly.com 기반)

RGSS301.dll은 ASProtect SKE 2.1x로 보호되어 직접 디컴파일이 어렵다. 대신 **공식 기본 스크립트(Window_Base)** 와 [lib.orzfly.com](http://lib.orzfly.com/sites/rpgmaker-default-scripts-docs/docs/rpgmaker-vxace.ja/classes/Window_Base.html) 문서로 연관 함수와 구현을 확인한다.

### RGSS301.dll 내부 구조 (추정)

- **Window 클래스**: DLL 내부 Ruby C 확장으로 등록. Export에는 없음.
- **C 확장이 제공하는 것**: `openness` (attr_accessor), `open?`, `close?` — 이들은 C에서 구현되어 Ruby에 노출.
- **open(), close()**: C가 아닌 **Window_Base(Ruby)** 에서 정의. Scripts.rvdata2에 포함된 기본 스크립트.

### Window_Base (Ruby) 구현 (lib.orzfly.com)

```ruby
# def open — 열기 애니메이션 시작
def open
  @opening = true unless open?
  @closing = false
  self
end

# def close — 닫기 애니메이션 시작
def close
  @closing = true unless close?
  @opening = false
  self
end

# def update — 프레임 갱신
def update
  super
  update_tone
  update_open if @opening
  update_close if @closing
end

# def update_open — openness += 48, 완료 시 @opening = false
def update_open
  self.openness += 48
  @opening = false if open?
end

# def update_close — openness -= 48, 완료 시 @closing = false
def update_close
  self.openness -= 48
  @closing = false if close?
end
```

- **open?**: `openness >= 255` (C 확장에서 구현)
- **close?**: `openness <= 0` (C 확장에서 구현)
- **openness 변화량**: 프레임당 **48** (OPENNESS_STEP)

### webrgss C/JS 대응

| RGSS301 (C 확장) | webrgss rgss_window.c | WasmRgssBridge |
|------------------|------------------------|----------------|
| open? (조건) | js_window_open(id) → 1 if openness>=255 | w.isOpen() |
| close? (조건) | js_window_close(id) → 1 if openness<=0 | w.isClosed() |
| openness= | js_window_set_openness(id, v) | w.openness = v |
| openness | js_window_get_openness(id) | w.openness |
| update | js_window_update(id) | w.update() |

- **open(), close()**: Ruby(Window_Base)에서 처리. C/JS는 `openness` 읽기/쓰기와 `open?`/`close?` 조건만 제공.
- **js_window_do_open / js_window_do_close**: C에서 호출되지 않음 (Ruby가 open/close 처리). 필요 시 Ruby 스크립트 없이 직접 제어용으로만 사용 가능.

---

## mkxp 참조 구현

[mkxp](https://github.com/Ancurio/mkxp) / [mkxp-z](https://github.com/mkxp-z/mkxp-z) 는 RGSS의 오픈소스 C++ 재구현이다. webrgss Window/Sprite/Bitmap 구현 시 mkxp 소스를 참조한다.

### WindowVX (RGSS2/VX Ace)

| 항목 | mkxp-z windowvx.cpp | webrgss Window.ts |
|------|---------------------|---------------------|
| openness | NormValue (0–255), 기본 255 | number (0–255) |
| isOpen() | `openness == 255` | `openness === 255` |
| isClosed() | `openness == 0` | `openness === 0` |
| openness 렌더 | `pos(0, (h/2)*(1-norm), w, h*norm)` 수직 클리핑 | 동일 방식 |
| openness < 255 | 베이스만 그리기, controls/contents 생략 | 동일 |
| padding (RGSS3) | 12 | 12 |
| backOpacity (RGSS3) | 192 | 192 |
