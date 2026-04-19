# WebRGSS C 바인딩 가이드

webrgss C/mruby 소스에 추가할 바인딩. `js_*` 함수는 WasmRgssBridge.buildImports()의 env에 등록됨.

## 1. msgbox

```c
static mrb_value mrb_msgbox(mrb_state *mrb, mrb_value self) {
  mrb_value msg;
  mrb_get_args(mrb, "o", &msg);
  const char *str = mrb_string_cstr(mrb, mrb_obj_as_string(mrb, msg));
  size_t len = strlen(str);
  /* env에서 js_msgbox 가져와 호출. str을 WASM 메모리에 복사 후 포인터 전달 */
  /* js_msgbox(msg_ptr) */
  return mrb_nil_value();
}
/* mrb_define_global_function(mrb, "msgbox", mrb_msgbox, MRB_ARGS_REQ(1)); */
```

## 2. exit

```c
static mrb_value mrb_exit(mrb_state *mrb, mrb_value self) {
  mrb_int code = 0;
  mrb_get_args(mrb, "|i", &code);
  /* js_rgss_stop() 호출 */
  mrb_exit(mrb, (int)code);
  return mrb_nil_value();
}
/* mrb_define_global_function(mrb, "exit", mrb_exit, MRB_ARGS_OPT(1)); */
```

## 3. sprintf

mruby-sprintf가 gembox에 있으면 사용 가능. 없으면 Kernel#sprintf 또는 C snprintf 사용.

## 4. Audio.setup_midi

```c
static mrb_value mrb_audio_setup_midi(mrb_state *mrb, mrb_value self) {
  /* no-op: 웹에서 MIDI 미지원 */
  return mrb_nil_value();
}
/* mrb_define_module_function(mrb, audio_module, "setup_midi", mrb_audio_setup_midi, MRB_ARGS_NONE()); */
```

## 5. js_bitmap_clone

`js_bitmap_clone(id)` → 새 비트맵 ID 반환. 이미 env에 등록됨.

## 6. Viewport.new / Rect.new (인자 없음)

- `Viewport.new` → `js_viewport_create(0, 0, Graphics.width, Graphics.height)`
- `Rect.new` → `Rect.new(0, 0, 0, 0)`

## 7. Bitmap#draw_text(rect, str, align)

C에서 `draw_text` 호출 시 인자 개수/타입에 따라:
- 3인자 (rect, str, align) → `js_bitmap_draw_text(id, rect.x, rect.y, rect.width, rect.height, str_ptr, align)`
- 6인자 (x, y, w, h, str, align) → 기존 동일

## 8. File.open / File.delete / File.mtime

- `File.open(path, "wb") { |f| f.write(data) }` → `js_file_write(path, data)` 호출
- `File.open(path, "rb") { |f| f.read }` → `js_file_read(path)` 호출
- `File.delete(path)` → `js_file_delete(path)` 호출
- `File.mtime(path)` → `js_file_mtime(path)` 반환 (ms, 0이면 Time.at(0))

## 9. Dir.glob

- `Dir.glob("Save*.rvdata2")` → `js_dir_glob(pattern)` 호출, 반환 문자열(\\n 구분) 파싱 후 배열 반환

## 10. Viewport.new / Rect.new (인자 없음)

- `Viewport.new` → `js_viewport_create(0, 0, 0, 0)` 호출. w=0, h=0이면 bridge에서 Graphics.width/height 사용.
- `Rect.new` → C에서 Rect(0, 0, 0, 0) 생성.

## 11. Time.at

- `Time.at(sec)` → `js_time_at(sec)` 호출해 ms 타임스탬프 획득 후 Time 객체 생성.

## 12. Tilemap / Plane

- `js_tilemap_create`, `js_tilemap_set_map_data`, `js_tilemap_set_bitmap`, `js_tilemap_set_flags`, `js_tilemap_set_ox`, `js_tilemap_set_oy`, `js_tilemap_update`, `js_tilemap_dispose`
- `js_plane_create`, `js_plane_set_bitmap`, `js_plane_set_ox`, `js_plane_set_oy`, `js_plane_set_z`, `js_plane_update`, `js_plane_dispose`

## 13. RGSS JIT — 바이트코드 실행 (_wrgss_exec_bytecode)

Ruby 소스 대신 RITE 바이트코드(.mrb)를 사전 컴파일하여 실행 시 파싱 오버헤드를 제거.

**Emscripten export (신규):**

```c
/* buf: RITE 바이너리, len: 길이, namePtr: 스크립트명(디버그/traceback용) */
int wrgss_exec_bytecode(uint8_t *buf, size_t len, const char *name);
```

**구현 예시:**

```c
#include "mruby.h"
#include "mruby/irep.h"

int wrgss_exec_bytecode(mrb_state *mrb, uint8_t *buf, size_t len, const char *name) {
  mrb_irep *irep = mrb_read_irep(mrb, buf);
  if (!irep) return -1;
  mrb_load_irep(mrb, irep);
  if (mrb->exc) {
    /* 예외 시 js_msgbox로 traceback 전달 (기존 예외 핸들러 활용) */
    return -1;
  }
  return 0;
}
```

- `mrb_read_irep` / `mrb_load_irep` 등 mruby API 사용
- 예외 발생 시 기존 C 예외 핸들러가 `js_msgbox`로 전달
