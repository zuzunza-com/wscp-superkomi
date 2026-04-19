/*
 * rgss_window.c — RGSS Window class.
 *
 * Signatures:
 *   Window.new
 *   Window.new(x, y, width, height)
 *
 * Backed by MRB_TT_DATA so user-defined subclasses preserve their class tag
 * (Window_Base, Window_MenuCommand, etc.). Most accessors delegate to
 * js_window_*. The prelude installs Ruby-side aliases that keep `@contents`
 * / `@windowskin` / font proxies in sync with the native widget state.
 *
 * On every frame, `window_update` re-reads `@cursor_rect` through its duck-
 * typed `x / y / width / height` methods and pushes the resulting rectangle
 * back to the JS bridge — this lets user scripts mutate the Rect in place
 * (the canonical RGSS idiom) without having to call a dedicated setter.
 */

#include <string.h>

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/data.h>
#include <mruby/numeric.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"
#include "webrgss_imports.h"

struct rgss_window_data {
  int32_t id;
};

static void
rgss_window_data_free(mrb_state *mrb, void *p)
{
  mrb_free(mrb, p);
}

const struct mrb_data_type rgss_window_type = {
  "Window", rgss_window_data_free,
};

#define WIN_ID(mrb, self) wrgss_get_id((mrb), (self))

static struct RClass *window_cls;

static mrb_sym SYM_WINDOWSKIN, SYM_CONTENTS, SYM_TONE, SYM_DISPOSED, SYM_CURSOR_RECT;

static mrb_value
window_new(mrb_state *mrb, mrb_value klass)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);

  struct rgss_window_data *d = (struct rgss_window_data *)mrb_malloc(mrb, sizeof(*d));
  memset(d, 0, sizeof(*d));
  struct RData *r = mrb_data_object_alloc(mrb, mrb_class_ptr(klass), d, &rgss_window_type);
  mrb_value obj = mrb_obj_value(r);
  mrb_funcall_argv(mrb, obj, mrb_intern_lit(mrb, "initialize"), argc, argv);
  return obj;
}

static mrb_value
window_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_int x = 0, y = 0, w = 160, h = 96;
  mrb_get_args(mrb, "|iiii", &x, &y, &w, &h);
  int id = js_window_create((int32_t)x, (int32_t)y,
                            w > 0 ? (int32_t)w : 1, h > 0 ? (int32_t)h : 1);
  if (!id) mrb_raise(mrb, E_RUNTIME_ERROR, "Window: allocation failed");
  wrgss_set_id(mrb, self, id);
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_false_value());
  return self;
}

static mrb_value
window_dispose(mrb_state *mrb, mrb_value self)
{
  int id = WIN_ID(mrb, self);
  if (id) { js_window_dispose(id); wrgss_set_id(mrb, self, 0); }
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_true_value());
  return mrb_nil_value();
}
static mrb_value window_disposed(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_DISPOSED); }

static mrb_value window_update(mrb_state *mrb, mrb_value self)
{
  mrb_value rect = mrb_iv_get(mrb, self, mrb_intern_cstr(mrb, "@cursor_rect"));
  int x = 0, y = 0, w = 0, h = 0;
  if (!mrb_nil_p(rect)
      && mrb_respond_to(mrb, rect, mrb_intern_lit(mrb, "x"))
      && mrb_respond_to(mrb, rect, mrb_intern_lit(mrb, "y"))
      && mrb_respond_to(mrb, rect, mrb_intern_lit(mrb, "width"))
      && mrb_respond_to(mrb, rect, mrb_intern_lit(mrb, "height"))) {
    x = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "x", 0));
    y = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "y", 0));
    w = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "width", 0));
    h = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "height", 0));
  }
  js_window_set_cursor_rect(WIN_ID(mrb,self), x, y, w, h);
  js_window_update(WIN_ID(mrb, self));
  return mrb_nil_value();
}

static mrb_value
window_move(mrb_state *mrb, mrb_value self)
{
  mrb_int x, y, w, h;
  mrb_get_args(mrb, "iiii", &x, &y, &w, &h);
  js_window_move(WIN_ID(mrb, self), (int32_t)x, (int32_t)y, (int32_t)w, (int32_t)h);
  return mrb_nil_value();
}

static mrb_value window_open_q(mrb_state *mrb, mrb_value self)  { return js_window_open(WIN_ID(mrb, self))  ? mrb_true_value() : mrb_false_value(); }
static mrb_value window_close_q(mrb_state *mrb, mrb_value self) { return js_window_close(WIN_ID(mrb, self)) ? mrb_true_value() : mrb_false_value(); }
static mrb_value window_do_open(mrb_state *mrb, mrb_value self)  { js_window_do_open(WIN_ID(mrb, self));  return mrb_nil_value(); }
static mrb_value window_do_close(mrb_state *mrb, mrb_value self) { js_window_do_close(WIN_ID(mrb, self)); return mrb_nil_value(); }

static mrb_value window_windowskin_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_WINDOWSKIN); }
static mrb_value
window_windowskin_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int bid = mrb_nil_p(v) ? 0 : wrgss_get_id(mrb, v);
  js_window_set_windowskin(WIN_ID(mrb, self), bid);
  mrb_iv_set(mrb, self, SYM_WINDOWSKIN, v);
  return v;
}

static mrb_value window_contents_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_CONTENTS); }
static mrb_value
window_contents_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int bid = mrb_nil_p(v) ? 0 : wrgss_get_id(mrb, v);
  js_window_set_contents(WIN_ID(mrb, self), bid);
  mrb_iv_set(mrb, self, SYM_CONTENTS, v);
  return v;
}

static mrb_value window_cursor_rect_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_CURSOR_RECT); }
static mrb_value
window_cursor_rect_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int x = 0, y = 0, w = 0, h = 0;
  if (!mrb_nil_p(v)) {
    x = wrgss_to_int(mrb, mrb_funcall(mrb, v, "x", 0));
    y = wrgss_to_int(mrb, mrb_funcall(mrb, v, "y", 0));
    w = wrgss_to_int(mrb, mrb_funcall(mrb, v, "width", 0));
    h = wrgss_to_int(mrb, mrb_funcall(mrb, v, "height", 0));
  }
  js_window_set_cursor_rect(WIN_ID(mrb, self), x, y, w, h);
  mrb_iv_set(mrb, self, SYM_CURSOR_RECT, v);
  return v;
}

#define WIN_I_SET(name, js_fn)                                               \
static mrb_value                                                             \
window_##name##_set(mrb_state *mrb, mrb_value self) {                        \
  mrb_int v; mrb_get_args(mrb, "i", &v);                                     \
  js_fn(WIN_ID(mrb, self), (int32_t)v);                                      \
  return mrb_int_value(mrb, v);                                              \
}
#define WIN_B_SET(name, js_fn)                                               \
static mrb_value                                                             \
window_##name##_set(mrb_state *mrb, mrb_value self) {                        \
  mrb_value v; mrb_get_args(mrb, "o", &v);                                   \
  int truthy = mrb_true_p(v) || (!mrb_nil_p(v) && !mrb_false_p(v));          \
  js_fn(WIN_ID(mrb, self), truthy ? 1 : 0);                                  \
  return v;                                                                  \
}
WIN_B_SET(active,         js_window_set_active)
WIN_B_SET(visible,        js_window_set_visible)
WIN_B_SET(arrows_visible, js_window_set_arrows_visible)
WIN_B_SET(pause,          js_window_set_pause)
WIN_I_SET(x,              js_window_set_x)
WIN_I_SET(y,              js_window_set_y)
WIN_I_SET(width,          js_window_set_width)
WIN_I_SET(height,         js_window_set_height)
WIN_I_SET(z,              js_window_set_z)
WIN_I_SET(ox,             js_window_set_ox)
WIN_I_SET(oy,             js_window_set_oy)
WIN_I_SET(padding,          js_window_set_padding)
WIN_I_SET(padding_bottom,   js_window_set_padding_bottom)
WIN_I_SET(opacity,          js_window_set_opacity)
WIN_I_SET(back_opacity,     js_window_set_back_opacity)
WIN_I_SET(contents_opacity, js_window_set_contents_opacity)
WIN_I_SET(openness,         js_window_set_openness)
#undef WIN_I_SET
#undef WIN_B_SET

static mrb_value window_tone_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_TONE); }
static mrb_value
window_tone_set(mrb_state *mrb, mrb_value self)
{
  mrb_value t; mrb_get_args(mrb, "o", &t);
  int r = 0, g = 0, b = 0, gray = 0;
  if (!mrb_nil_p(t)) {
    r = wrgss_to_int(mrb, mrb_funcall(mrb, t, "red",   0));
    g = wrgss_to_int(mrb, mrb_funcall(mrb, t, "green", 0));
    b = wrgss_to_int(mrb, mrb_funcall(mrb, t, "blue",  0));
    gray = wrgss_to_int(mrb, mrb_funcall(mrb, t, "gray", 0));
  }
  js_window_set_tone(WIN_ID(mrb, self), r, g, b, gray);
  mrb_iv_set(mrb, self, SYM_TONE, t);
  return t;
}

static mrb_value window_x_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_window_get_x(WIN_ID(mrb, self))); }
static mrb_value window_y_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_window_get_y(WIN_ID(mrb, self))); }
static mrb_value window_w_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_window_get_width(WIN_ID(mrb, self))); }
static mrb_value window_h_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_window_get_height(WIN_ID(mrb, self))); }
static mrb_value window_openness_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_window_get_openness(WIN_ID(mrb, self))); }

void
wrgss_register_window(mrb_state *mrb)
{
  SYM_WINDOWSKIN  = mrb_intern_lit(mrb, "@windowskin");
  SYM_CONTENTS    = mrb_intern_lit(mrb, "@contents");
  SYM_TONE        = mrb_intern_lit(mrb, "@tone");
  SYM_DISPOSED    = mrb_intern_lit(mrb, "@__wrgss_disposed");
  SYM_CURSOR_RECT = mrb_intern_lit(mrb, "@cursor_rect");

  struct RClass *c = mrb_define_class(mrb, "Window", mrb->object_class);
  MRB_SET_INSTANCE_TT(c, MRB_TT_DATA);
  window_cls = c;

  mrb_define_class_method(mrb, c, "new", window_new, MRB_ARGS_OPT(4));
#define M(name, fn, args) mrb_define_method(mrb, c, name, fn, args)
  M("initialize", window_initialize, MRB_ARGS_OPT(4));
  M("dispose",    window_dispose,    MRB_ARGS_NONE());
  M("disposed?",  window_disposed,   MRB_ARGS_NONE());
  M("update",     window_update,     MRB_ARGS_NONE());
  M("move",       window_move,       MRB_ARGS_REQ(4));
  M("open?",      window_open_q,     MRB_ARGS_NONE());
  M("close?",     window_close_q,    MRB_ARGS_NONE());
  M("open",       window_do_open,    MRB_ARGS_NONE());
  M("close",      window_do_close,   MRB_ARGS_NONE());
  M("windowskin",  window_windowskin_get, MRB_ARGS_NONE());
  M("windowskin=", window_windowskin_set, MRB_ARGS_REQ(1));
  M("contents",    window_contents_get,   MRB_ARGS_NONE());
  M("contents=",   window_contents_set,   MRB_ARGS_REQ(1));
  M("cursor_rect",  window_cursor_rect_get, MRB_ARGS_NONE());
  M("cursor_rect=", window_cursor_rect_set, MRB_ARGS_REQ(1));
  M("active=",         window_active_set,         MRB_ARGS_REQ(1));
  M("visible=",        window_visible_set,        MRB_ARGS_REQ(1));
  M("arrows_visible=", window_arrows_visible_set, MRB_ARGS_REQ(1));
  M("pause=",          window_pause_set,          MRB_ARGS_REQ(1));
  M("x",               window_x_get,              MRB_ARGS_NONE());
  M("y",               window_y_get,              MRB_ARGS_NONE());
  M("width",           window_w_get,              MRB_ARGS_NONE());
  M("height",          window_h_get,              MRB_ARGS_NONE());
  M("openness",        window_openness_get,       MRB_ARGS_NONE());
  M("x=",              window_x_set,              MRB_ARGS_REQ(1));
  M("y=",              window_y_set,              MRB_ARGS_REQ(1));
  M("width=",          window_width_set,          MRB_ARGS_REQ(1));
  M("height=",         window_height_set,         MRB_ARGS_REQ(1));
  M("z=",              window_z_set,              MRB_ARGS_REQ(1));
  M("ox=",             window_ox_set,             MRB_ARGS_REQ(1));
  M("oy=",             window_oy_set,             MRB_ARGS_REQ(1));
  M("padding=",        window_padding_set,        MRB_ARGS_REQ(1));
  M("padding_bottom=", window_padding_bottom_set, MRB_ARGS_REQ(1));
  M("opacity=",        window_opacity_set,        MRB_ARGS_REQ(1));
  M("back_opacity=",   window_back_opacity_set,   MRB_ARGS_REQ(1));
  M("contents_opacity=", window_contents_opacity_set, MRB_ARGS_REQ(1));
  M("openness=",       window_openness_set,       MRB_ARGS_REQ(1));
  M("tone",            window_tone_get,           MRB_ARGS_NONE());
  M("tone=",           window_tone_set,           MRB_ARGS_REQ(1));
#undef M
  (void)window_cls;
}
