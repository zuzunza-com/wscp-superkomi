import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// `wscp-superkomi/ts/wasm/` -> up 2 levels -> `wscp-superkomi/`.
// C runtime source lives in `wscp-superkomi/src/` alongside `ts/`.
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const SUPERKOMI_SRC_DIR = resolve(__dirname, '..', '..', 'src');

function readRuntimeSource(file: string): string {
  return readFileSync(join(SUPERKOMI_SRC_DIR, file), 'utf8');
}

test('window_new allocates subclass instances and calls initialize', () => {
  const source = readRuntimeSource('rgss_window.c');

  assert.match(source, /mrb_data_object_alloc\(mrb,\s*mrb_class_ptr\(klass\)/);
  assert.match(source, /mrb_funcall_argv\(mrb,\s*obj,[\s\S]*initialize[\s\S]*argc,\s*argv\)/);
});

test('sprite and viewport constructors allocate subclass instances and call initialize', () => {
  const source = readRuntimeSource('rgss_sprite.c');

  assert.match(source, /mrb_data_object_alloc\(mrb,\s*mrb_class_ptr\(klass\),\s*d,\s*&rgss_viewport_type\)/);
  assert.match(source, /mrb_data_object_alloc\(mrb,\s*mrb_class_ptr\(klass\),\s*d,\s*&rgss_sprite_type\)/);
  assert.match(source, /mrb_funcall_argv\(mrb,\s*obj,[\s\S]*initialize[\s\S]*argc,\s*argv\)/);
});

test('bitmap_new allocates subclass instances and calls initialize', () => {
  const source = readRuntimeSource('rgss_bitmap.c');

  assert.match(source, /mrb_data_object_alloc\(mrb,\s*mrb_class_ptr\(klass\),\s*d,\s*&rgss_bitmap_type\)/);
  assert.match(source, /mrb_funcall_argv\(mrb,\s*obj,[\s\S]*initialize[\s\S]*argc,\s*argv\)/);
});

test('bitmap source exposes font sync hooks for Ruby Font proxies', () => {
  const source = readRuntimeSource('rgss_bitmap.c');

  assert.match(source, /__wrgss_font_name=/);
  assert.match(source, /__wrgss_font_size=/);
  assert.match(source, /__wrgss_font_color=/);
  assert.match(source, /js_bitmap_set_font_name/);
  assert.match(source, /js_bitmap_set_font_color/);
});

test('bitmap helpers construct Color/Rect via class new (initialized data objects)', () => {
  const source = readRuntimeSource('rgss_bitmap.c');

  assert.match(source, /mrb_funcall_argv\(/);
  assert.match(source, /mrb_obj_value\(mrb_class_get\(mrb,\s*"Color"\)\)/);
  assert.match(source, /mrb_obj_value\(mrb_class_get\(mrb,\s*"Rect"\)\)/);
  assert.match(source, /mrb_intern_lit\(mrb,\s*"new"\)/);
  assert.doesNotMatch(source, /mrb_obj_new\(mrb,\s*mrb_class_get\(mrb,\s*"Color"\)/);
  assert.doesNotMatch(source, /mrb_obj_new\(mrb,\s*mrb_class_get\(mrb,\s*"Rect"\)/);
});

test('color constructor preserves subclass instances and dispatches initialize for subclasses', () => {
  const source = readRuntimeSource('rgss_color.c');

  assert.match(source, /mrb_data_object_alloc\(mrb,\s*mrb_class_ptr\(klass\),\s*c,\s*&rgss_color_type\)/);
  assert.match(source, /if\s*\(mrb_class_ptr\(klass\)\s*==\s*color_cls\)/);
  assert.match(source, /mrb_funcall_argv\(mrb,\s*obj,[\s\S]*initialize[\s\S]*argc,\s*argv\)/);
});

test('color/tone set accept duck-typed objects exposing channel readers', () => {
  const source = readRuntimeSource('rgss_color.c');

  assert.match(source, /mrb_respond_to\(mrb,\s*arg1,\s*mrb_intern_lit\(mrb,\s*"red"\)\)/);
  assert.match(source, /mrb_respond_to\(mrb,\s*arg1,\s*mrb_intern_lit\(mrb,\s*"green"\)\)/);
  assert.match(source, /mrb_respond_to\(mrb,\s*arg1,\s*mrb_intern_lit\(mrb,\s*"blue"\)\)/);
  assert.match(source, /mrb_respond_to\(mrb,\s*arg1,\s*mrb_intern_lit\(mrb,\s*"gray"\)\)/);
  assert.match(source, /mrb_respond_to\(mrb,\s*arg1,\s*mrb_intern_lit\(mrb,\s*"alpha"\)\)/);
});

test('window/sprite setters accept boolean values for visible/active-style properties', () => {
  const windowSource = readRuntimeSource('rgss_window.c');
  const spriteSource = readRuntimeSource('rgss_sprite.c');

  assert.match(windowSource, /mrb_true_p\(/);
  assert.match(windowSource, /mrb_get_args\(mrb,\s*"o",\s*&v\)/);
  assert.match(spriteSource, /mrb_true_p\(/);
  assert.match(spriteSource, /mrb_get_args\(mrb,\s*"o",\s*&v\)/);
});

test('window_update syncs @cursor_rect mutations to native window state each frame', () => {
  const source = readRuntimeSource('rgss_window.c');

  assert.match(source, /static mrb_value window_update\(mrb_state \*mrb, mrb_value self\)/);
  assert.match(source, /mrb_iv_get\(mrb,\s*self,\s*mrb_intern_cstr\(mrb,\s*"@cursor_rect"\)\)/);
  assert.match(source, /mrb_respond_to\(mrb,\s*rect,\s*mrb_intern_lit\(mrb,\s*"x"\)\)/);
  assert.match(source, /mrb_respond_to\(mrb,\s*rect,\s*mrb_intern_lit\(mrb,\s*"width"\)\)/);
  assert.match(source, /js_window_set_cursor_rect\(WIN_ID\(mrb,self\),\s*x,\s*y,\s*w,\s*h\)/);
});
