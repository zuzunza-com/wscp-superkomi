/*
 * rgss_graphics.c — Graphics module.
 *
 * Most functionality delegates to js_graphics_*. Graphics.update and
 * Graphics.wait call the JS implementation and (in the prelude) Fiber.yield
 * after the call so that rgss_main cooperates with the outer tick loop.
 */

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"
#include "webrgss_imports.h"

static mrb_value
m_update(mrb_state *mrb, mrb_value self) { (void)self; js_graphics_update(); return mrb_nil_value(); }

static mrb_value
m_wait(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int duration = 1;
  mrb_get_args(mrb, "i", &duration);
  js_graphics_wait((int32_t)duration);
  return mrb_nil_value();
}

static mrb_value
m_fadeout(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int d = 0; mrb_get_args(mrb, "i", &d);
  js_graphics_fadeout((int32_t)d); return mrb_nil_value();
}

static mrb_value
m_fadein(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int d = 0; mrb_get_args(mrb, "i", &d);
  js_graphics_fadein((int32_t)d); return mrb_nil_value();
}

static mrb_value
m_freeze(mrb_state *mrb, mrb_value self) { (void)self; js_graphics_freeze(); return mrb_nil_value(); }

static mrb_value
m_transition(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int duration = 10; mrb_value filename = mrb_nil_value(); mrb_int vague = 40;
  mrb_get_args(mrb, "|iSi", &duration, &filename, &vague);
  const char *fn = mrb_string_p(filename) ? mrb_string_cstr(mrb, filename) : NULL;
  js_graphics_transition((int32_t)duration, fn, (int32_t)vague);
  return mrb_nil_value();
}

static mrb_value
m_snap_to_bitmap(mrb_state *mrb, mrb_value self)
{
  (void)self;
  int id = js_graphics_snap_to_bitmap();
  if (!id) return mrb_nil_value();
  struct RClass *bmp = mrb_class_get(mrb, "Bitmap");
  mrb_value obj = mrb_obj_new(mrb, bmp, 0, NULL);
  wrgss_set_id(mrb, obj, id);
  return obj;
}

static mrb_value
m_frame_reset(mrb_state *mrb, mrb_value self) { (void)self; js_graphics_frame_reset(); return mrb_nil_value(); }

static mrb_value m_width(mrb_state *mrb, mrb_value self)  { (void)self; return mrb_int_value(mrb, js_graphics_get_width());  }
static mrb_value m_height(mrb_state *mrb, mrb_value self) { (void)self; return mrb_int_value(mrb, js_graphics_get_height()); }

static mrb_value
m_resize_screen(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int w, h; mrb_get_args(mrb, "ii", &w, &h);
  js_graphics_resize_screen((int32_t)w, (int32_t)h);
  return mrb_nil_value();
}

static mrb_value m_frame_rate_get(mrb_state *mrb, mrb_value self)  { (void)self; return mrb_int_value(mrb, js_graphics_get_frame_rate()); }
static mrb_value m_frame_rate_set(mrb_state *mrb, mrb_value self)  { (void)self; mrb_int v; mrb_get_args(mrb, "i", &v); js_graphics_set_frame_rate((int32_t)v); return mrb_int_value(mrb, v); }
static mrb_value m_frame_count_get(mrb_state *mrb, mrb_value self) { (void)self; return mrb_int_value(mrb, js_graphics_get_frame_count()); }
static mrb_value m_frame_count_set(mrb_state *mrb, mrb_value self) { (void)self; mrb_int v; mrb_get_args(mrb, "i", &v); js_graphics_set_frame_count((int32_t)v); return mrb_int_value(mrb, v); }
static mrb_value m_brightness_get(mrb_state *mrb, mrb_value self)  { (void)self; return mrb_int_value(mrb, js_graphics_get_brightness()); }
static mrb_value m_brightness_set(mrb_state *mrb, mrb_value self)  { (void)self; mrb_int v; mrb_get_args(mrb, "i", &v); js_graphics_set_brightness((int32_t)v); return mrb_int_value(mrb, v); }

static mrb_value
m_play_movie(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value path; mrb_get_args(mrb, "S", &path);
  js_graphics_play_movie(mrb_string_cstr(mrb, path));
  return mrb_nil_value();
}

void
wrgss_register_graphics(mrb_state *mrb)
{
  struct RClass *g = mrb_define_module(mrb, "Graphics");
#define M(name, fn, args) mrb_define_module_function(mrb, g, name, fn, args)
  M("update",        m_update,         MRB_ARGS_NONE());
  M("wait",          m_wait,           MRB_ARGS_REQ(1));
  M("fadeout",       m_fadeout,        MRB_ARGS_REQ(1));
  M("fadein",        m_fadein,         MRB_ARGS_REQ(1));
  M("freeze",        m_freeze,         MRB_ARGS_NONE());
  M("transition",    m_transition,     MRB_ARGS_ARG(1, 2));
  M("snap_to_bitmap", m_snap_to_bitmap, MRB_ARGS_NONE());
  M("frame_reset",   m_frame_reset,    MRB_ARGS_NONE());
  M("width",         m_width,          MRB_ARGS_NONE());
  M("height",        m_height,         MRB_ARGS_NONE());
  M("resize_screen", m_resize_screen,  MRB_ARGS_REQ(2));
  M("frame_rate",    m_frame_rate_get, MRB_ARGS_NONE());
  M("frame_rate=",   m_frame_rate_set, MRB_ARGS_REQ(1));
  M("frame_count",   m_frame_count_get, MRB_ARGS_NONE());
  M("frame_count=",  m_frame_count_set, MRB_ARGS_REQ(1));
  M("brightness",    m_brightness_get, MRB_ARGS_NONE());
  M("brightness=",   m_brightness_set, MRB_ARGS_REQ(1));
  M("play_movie",    m_play_movie,     MRB_ARGS_REQ(1));
#undef M
}
