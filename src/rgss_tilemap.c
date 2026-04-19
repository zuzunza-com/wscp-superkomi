/*
 * rgss_tilemap.c — RGSS Tilemap class.
 *
 * Supports:
 *   tilemap.bitmaps[index] = Bitmap.new(...)     # via TilemapBitmaps wrapper
 *   tilemap.map_data = Table
 *   tilemap.flags = Table
 *   tilemap.flash_data = Table
 *   tilemap.viewport / visible / ox / oy
 */

#include <mruby.h>
#include <mruby/array.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>
#include <mruby/numeric.h>

#include "webrgss.h"
#include "webrgss_imports.h"

static mrb_sym SYM_BITMAPS, SYM_MAP_DATA, SYM_FLAGS, SYM_FLASH_DATA, SYM_VIEWPORT, SYM_DISPOSED;

static mrb_value
m_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_value vp = mrb_nil_value();
  mrb_get_args(mrb, "|o", &vp);
  int vp_id = mrb_nil_p(vp) ? 0 : wrgss_get_id(mrb, vp);
  int id = js_tilemap_create(vp_id);
  if (!id) mrb_raise(mrb, E_RUNTIME_ERROR, "Tilemap: allocation failed");
  wrgss_set_id(mrb, self, id);

  /* bitmaps is a user-visible array: tilemap.bitmaps[i] = bmp */
  mrb_iv_set(mrb, self, SYM_BITMAPS, mrb_ary_new(mrb));
  mrb_iv_set(mrb, self, SYM_VIEWPORT, vp);
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_false_value());
  return self;
}

static mrb_value
m_dispose(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  if (id) { js_tilemap_dispose(id); wrgss_set_id(mrb, self, 0); }
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_true_value());
  return mrb_nil_value();
}
static mrb_value m_disposed(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_DISPOSED); }

static mrb_value m_update(mrb_state *mrb, mrb_value self)
{ js_tilemap_update(wrgss_get_id(mrb, self)); return mrb_nil_value(); }

/* Ruby-side getter returns the Array; user mutates via tilemap.bitmaps[i]=,
 * and the prelude watches for set and calls __wrgss_tilemap_set_bitmap. */
static mrb_value m_bitmaps_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_BITMAPS); }

static mrb_value
m_wrgss_set_bitmap(mrb_state *mrb, mrb_value self)
{
  /* __wrgss_tilemap_set_bitmap(index, bitmap) — called by prelude */
  mrb_int index; mrb_value bitmap;
  mrb_get_args(mrb, "io", &index, &bitmap);
  int bid = mrb_nil_p(bitmap) ? 0 : wrgss_get_id(mrb, bitmap);
  js_tilemap_set_bitmap(wrgss_get_id(mrb, self), (int32_t)index, bid);
  /* Mirror into the Ruby array */
  mrb_value arr = mrb_iv_get(mrb, self, SYM_BITMAPS);
  if (mrb_array_p(arr)) {
    while (RARRAY_LEN(arr) <= index) mrb_ary_push(mrb, arr, mrb_nil_value());
    mrb_ary_set(mrb, arr, index, bitmap);
  }
  return bitmap;
}

static mrb_value m_map_data_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_MAP_DATA); }
static mrb_value
m_map_data_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int tid = mrb_nil_p(v) ? 0 : wrgss_get_id(mrb, v);
  js_tilemap_set_map_data(wrgss_get_id(mrb, self), tid);
  mrb_iv_set(mrb, self, SYM_MAP_DATA, v);
  return v;
}

static mrb_value m_flags_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_FLAGS); }
static mrb_value
m_flags_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int tid = mrb_nil_p(v) ? 0 : wrgss_get_id(mrb, v);
  js_tilemap_set_flags(wrgss_get_id(mrb, self), tid);
  mrb_iv_set(mrb, self, SYM_FLAGS, v);
  return v;
}

static mrb_value m_flash_data_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_FLASH_DATA); }
static mrb_value
m_flash_data_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int tid = mrb_nil_p(v) ? 0 : wrgss_get_id(mrb, v);
  js_tilemap_set_flash_data(wrgss_get_id(mrb, self), tid);
  mrb_iv_set(mrb, self, SYM_FLASH_DATA, v);
  return v;
}

#define I_SET(name, js_fn)                                                   \
static mrb_value                                                             \
m_##name##_set(mrb_state *mrb, mrb_value self) {                             \
  mrb_int v; mrb_get_args(mrb, "i", &v);                                     \
  js_fn(wrgss_get_id(mrb, self), (int32_t)v);                                \
  return mrb_int_value(mrb, v);                                              \
}
#define B_SET(name, js_fn)                                                   \
static mrb_value                                                             \
m_##name##_set(mrb_state *mrb, mrb_value self) {                             \
  mrb_value v; mrb_get_args(mrb, "o", &v);                                   \
  js_fn(wrgss_get_id(mrb, self), mrb_test(v) ? 1 : 0);                       \
  return v;                                                                  \
}
B_SET(visible, js_tilemap_set_visible)
I_SET(ox, js_tilemap_set_ox)
I_SET(oy, js_tilemap_set_oy)

void
wrgss_register_tilemap(mrb_state *mrb)
{
  SYM_BITMAPS    = mrb_intern_lit(mrb, "@bitmaps");
  SYM_MAP_DATA   = mrb_intern_lit(mrb, "@map_data");
  SYM_FLAGS      = mrb_intern_lit(mrb, "@flags");
  SYM_FLASH_DATA = mrb_intern_lit(mrb, "@flash_data");
  SYM_VIEWPORT   = mrb_intern_lit(mrb, "@viewport");
  SYM_DISPOSED   = mrb_intern_lit(mrb, "@__wrgss_disposed");

  struct RClass *c = mrb_define_class(mrb, "Tilemap", mrb->object_class);
#define M(name, fn, args) mrb_define_method(mrb, c, name, fn, args)
  M("initialize",   m_initialize,   MRB_ARGS_OPT(1));
  M("dispose",      m_dispose,      MRB_ARGS_NONE());
  M("disposed?",    m_disposed,     MRB_ARGS_NONE());
  M("update",       m_update,       MRB_ARGS_NONE());
  M("bitmaps",      m_bitmaps_get,  MRB_ARGS_NONE());
  M("__wrgss_tilemap_set_bitmap", m_wrgss_set_bitmap, MRB_ARGS_REQ(2));
  M("map_data",     m_map_data_get,    MRB_ARGS_NONE());
  M("map_data=",    m_map_data_set,    MRB_ARGS_REQ(1));
  M("flags",        m_flags_get,       MRB_ARGS_NONE());
  M("flags=",       m_flags_set,       MRB_ARGS_REQ(1));
  M("flash_data",   m_flash_data_get,  MRB_ARGS_NONE());
  M("flash_data=",  m_flash_data_set,  MRB_ARGS_REQ(1));
  M("visible=",     m_visible_set,     MRB_ARGS_REQ(1));
  M("ox=",          m_ox_set,          MRB_ARGS_REQ(1));
  M("oy=",          m_oy_set,          MRB_ARGS_REQ(1));
#undef M
}
