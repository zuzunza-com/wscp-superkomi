/*
 * rgss_sprite.c — RGSS Sprite + Viewport classes.
 *
 * Both classes are tightly coupled (every sprite optionally belongs to a
 * viewport and viewports share the same "JS-side handle + mrb data object"
 * layout as sprites), so they live together in one translation unit. Each
 * class uses MRB_TT_DATA so subclasses preserve their type tag and their
 * custom `initialize` is dispatched by our `new` class method.
 *
 * The on-heap data struct is intentionally tiny (just the native id) — all
 * Ruby-visible attributes (bitmap, viewport, color, tone, src_rect, etc.)
 * continue to live as instance variables so user scripts can inspect them
 * with `instance_variables` / `instance_variable_get` the usual way.
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

struct rgss_native_handle {
  int32_t id;
};

static void
rgss_native_handle_free(mrb_state *mrb, void *p)
{
  mrb_free(mrb, p);
}

const struct mrb_data_type rgss_sprite_type = {
  "Sprite", rgss_native_handle_free,
};

const struct mrb_data_type rgss_viewport_type = {
  "Viewport", rgss_native_handle_free,
};

static struct RClass *sprite_cls;
static struct RClass *viewport_cls;

/* -------------------------------------------------------------------------
 * Viewport
 * ------------------------------------------------------------------------- */

static mrb_sym SYM_VP_RECT, SYM_VP_COLOR, SYM_VP_TONE, SYM_VP_DISPOSED;

static mrb_value
viewport_new(mrb_state *mrb, mrb_value klass)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);

  struct rgss_native_handle *d = (struct rgss_native_handle *)mrb_malloc(mrb, sizeof(*d));
  memset(d, 0, sizeof(*d));
  struct RData *r = mrb_data_object_alloc(mrb, mrb_class_ptr(klass), d, &rgss_viewport_type);
  mrb_value obj = mrb_obj_value(r);
  mrb_funcall_argv(mrb, obj, mrb_intern_lit(mrb, "initialize"), argc, argv);
  return obj;
}

static mrb_value
viewport_initialize(mrb_state *mrb, mrb_value self)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  int x = 0, y = 0, w = 0, h = 0;
  if (argc == 1) {
    x = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "x", 0));
    y = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "y", 0));
    w = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "width", 0));
    h = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "height", 0));
  } else if (argc >= 4) {
    x = wrgss_to_int(mrb, argv[0]);
    y = wrgss_to_int(mrb, argv[1]);
    w = wrgss_to_int(mrb, argv[2]);
    h = wrgss_to_int(mrb, argv[3]);
  }
  int id = js_viewport_create(x, y, w, h);
  if (!id) mrb_raise(mrb, E_RUNTIME_ERROR, "Viewport: allocation failed");
  wrgss_set_id(mrb, self, id);
  mrb_iv_set(mrb, self, SYM_VP_DISPOSED, mrb_false_value());
  return self;
}

static mrb_value
viewport_dispose(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  if (id) { js_viewport_dispose(id); wrgss_set_id(mrb, self, 0); }
  mrb_iv_set(mrb, self, SYM_VP_DISPOSED, mrb_true_value());
  return mrb_nil_value();
}
static mrb_value viewport_disposed(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_VP_DISPOSED); }

static mrb_value
viewport_update(mrb_state *mrb, mrb_value self)
{
  js_viewport_update(wrgss_get_id(mrb, self));
  return mrb_nil_value();
}

static mrb_value
viewport_flash(mrb_state *mrb, mrb_value self)
{
  mrb_value color; mrb_int duration = 0;
  mrb_get_args(mrb, "oi", &color, &duration);
  int r = 0, g = 0, b = 0, a = 0;
  if (!mrb_nil_p(color)) {
    r = wrgss_to_int(mrb, mrb_funcall(mrb, color, "red",   0));
    g = wrgss_to_int(mrb, mrb_funcall(mrb, color, "green", 0));
    b = wrgss_to_int(mrb, mrb_funcall(mrb, color, "blue",  0));
    a = wrgss_to_int(mrb, mrb_funcall(mrb, color, "alpha", 0));
  }
  js_viewport_flash(wrgss_get_id(mrb, self), r, g, b, a, (int32_t)duration);
  return mrb_nil_value();
}

static mrb_value viewport_rect_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_VP_RECT); }
static mrb_value
viewport_rect_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int x = wrgss_to_int(mrb, mrb_funcall(mrb, v, "x", 0));
  int y = wrgss_to_int(mrb, mrb_funcall(mrb, v, "y", 0));
  int w = wrgss_to_int(mrb, mrb_funcall(mrb, v, "width", 0));
  int h = wrgss_to_int(mrb, mrb_funcall(mrb, v, "height", 0));
  js_viewport_set_rect(wrgss_get_id(mrb, self), x, y, w, h);
  mrb_iv_set(mrb, self, SYM_VP_RECT, v);
  return v;
}

#define VP_I_SET(name, js_fn)                                               \
static mrb_value                                                            \
viewport_##name##_set(mrb_state *mrb, mrb_value self) {                     \
  mrb_int v; mrb_get_args(mrb, "i", &v);                                    \
  js_fn(wrgss_get_id(mrb, self), (int32_t)v);                               \
  return mrb_int_value(mrb, v);                                             \
}
#define VP_B_SET(name, js_fn)                                               \
static mrb_value                                                            \
viewport_##name##_set(mrb_state *mrb, mrb_value self) {                     \
  mrb_value v; mrb_get_args(mrb, "o", &v);                                  \
  int truthy = mrb_true_p(v) || (!mrb_nil_p(v) && !mrb_false_p(v));         \
  js_fn(wrgss_get_id(mrb, self), truthy ? 1 : 0);                           \
  return v;                                                                 \
}
VP_B_SET(visible, js_viewport_set_visible)
VP_I_SET(z,  js_viewport_set_z)
VP_I_SET(ox, js_viewport_set_ox)
VP_I_SET(oy, js_viewport_set_oy)
#undef VP_I_SET
#undef VP_B_SET

static mrb_value viewport_color_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_VP_COLOR); }
static mrb_value
viewport_color_set(mrb_state *mrb, mrb_value self)
{
  mrb_value c; mrb_get_args(mrb, "o", &c);
  int r = 0, g = 0, b = 0, a = 0;
  if (!mrb_nil_p(c)) {
    r = wrgss_to_int(mrb, mrb_funcall(mrb, c, "red",   0));
    g = wrgss_to_int(mrb, mrb_funcall(mrb, c, "green", 0));
    b = wrgss_to_int(mrb, mrb_funcall(mrb, c, "blue",  0));
    a = wrgss_to_int(mrb, mrb_funcall(mrb, c, "alpha", 0));
  }
  js_viewport_set_color(wrgss_get_id(mrb, self), r, g, b, a);
  mrb_iv_set(mrb, self, SYM_VP_COLOR, c);
  return c;
}

static mrb_value viewport_tone_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_VP_TONE); }
static mrb_value
viewport_tone_set(mrb_state *mrb, mrb_value self)
{
  mrb_value t; mrb_get_args(mrb, "o", &t);
  int r = 0, g = 0, b = 0, gray = 0;
  if (!mrb_nil_p(t)) {
    r = wrgss_to_int(mrb, mrb_funcall(mrb, t, "red",   0));
    g = wrgss_to_int(mrb, mrb_funcall(mrb, t, "green", 0));
    b = wrgss_to_int(mrb, mrb_funcall(mrb, t, "blue",  0));
    gray = wrgss_to_int(mrb, mrb_funcall(mrb, t, "gray", 0));
  }
  js_viewport_set_tone(wrgss_get_id(mrb, self), r, g, b, gray);
  mrb_iv_set(mrb, self, SYM_VP_TONE, t);
  return t;
}

void
wrgss_register_viewport(mrb_state *mrb)
{
  SYM_VP_RECT     = mrb_intern_lit(mrb, "@rect");
  SYM_VP_COLOR    = mrb_intern_lit(mrb, "@color");
  SYM_VP_TONE     = mrb_intern_lit(mrb, "@tone");
  SYM_VP_DISPOSED = mrb_intern_lit(mrb, "@__wrgss_disposed");

  struct RClass *c = mrb_define_class(mrb, "Viewport", mrb->object_class);
  MRB_SET_INSTANCE_TT(c, MRB_TT_DATA);
  viewport_cls = c;

  mrb_define_class_method(mrb, c, "new", viewport_new, MRB_ARGS_OPT(4));
#define M(name, fn, args) mrb_define_method(mrb, c, name, fn, args)
  M("initialize", viewport_initialize, MRB_ARGS_OPT(4));
  M("dispose",    viewport_dispose,    MRB_ARGS_NONE());
  M("disposed?",  viewport_disposed,   MRB_ARGS_NONE());
  M("update",     viewport_update,     MRB_ARGS_NONE());
  M("flash",      viewport_flash,      MRB_ARGS_REQ(2));
  M("rect",       viewport_rect_get,   MRB_ARGS_NONE());
  M("rect=",      viewport_rect_set,   MRB_ARGS_REQ(1));
  M("visible=",   viewport_visible_set, MRB_ARGS_REQ(1));
  M("z=",         viewport_z_set,      MRB_ARGS_REQ(1));
  M("ox=",        viewport_ox_set,     MRB_ARGS_REQ(1));
  M("oy=",        viewport_oy_set,     MRB_ARGS_REQ(1));
  M("color",      viewport_color_get,  MRB_ARGS_NONE());
  M("color=",     viewport_color_set,  MRB_ARGS_REQ(1));
  M("tone",       viewport_tone_get,   MRB_ARGS_NONE());
  M("tone=",      viewport_tone_set,   MRB_ARGS_REQ(1));
#undef M
  (void)viewport_cls;
}

/* -------------------------------------------------------------------------
 * Sprite
 * ------------------------------------------------------------------------- */

static mrb_sym SYM_BITMAP, SYM_SRC_RECT, SYM_VIEWPORT, SYM_COLOR, SYM_TONE, SYM_DISPOSED;

static mrb_value
sprite_new(mrb_state *mrb, mrb_value klass)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);

  struct rgss_native_handle *d = (struct rgss_native_handle *)mrb_malloc(mrb, sizeof(*d));
  memset(d, 0, sizeof(*d));
  struct RData *r = mrb_data_object_alloc(mrb, mrb_class_ptr(klass), d, &rgss_sprite_type);
  mrb_value obj = mrb_obj_value(r);
  mrb_funcall_argv(mrb, obj, mrb_intern_lit(mrb, "initialize"), argc, argv);
  return obj;
}

static mrb_value
sprite_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_value vp = mrb_nil_value();
  mrb_get_args(mrb, "|o", &vp);
  int vp_id = mrb_nil_p(vp) ? 0 : wrgss_get_id(mrb, vp);
  int id = js_sprite_create(vp_id);
  if (!id) mrb_raise(mrb, E_RUNTIME_ERROR, "Sprite: allocation failed");
  wrgss_set_id(mrb, self, id);
  mrb_iv_set(mrb, self, SYM_VIEWPORT, vp);
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_false_value());
  return self;
}

static mrb_value
sprite_dispose(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  if (id) { js_sprite_dispose(id); wrgss_set_id(mrb, self, 0); }
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_true_value());
  return mrb_nil_value();
}
static mrb_value sprite_disposed(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_DISPOSED); }

static mrb_value
sprite_update(mrb_state *mrb, mrb_value self)
{
  js_sprite_update(wrgss_get_id(mrb, self));
  return mrb_nil_value();
}

static mrb_value
sprite_flash(mrb_state *mrb, mrb_value self)
{
  mrb_value color; mrb_int duration = 0;
  mrb_get_args(mrb, "oi", &color, &duration);
  int r = 0, g = 0, b = 0, a = 0;
  if (!mrb_nil_p(color)) {
    r = wrgss_to_int(mrb, mrb_funcall(mrb, color, "red",   0));
    g = wrgss_to_int(mrb, mrb_funcall(mrb, color, "green", 0));
    b = wrgss_to_int(mrb, mrb_funcall(mrb, color, "blue",  0));
    a = wrgss_to_int(mrb, mrb_funcall(mrb, color, "alpha", 0));
  }
  js_sprite_flash(wrgss_get_id(mrb, self), r, g, b, a, (int32_t)duration);
  return mrb_nil_value();
}

static mrb_value sprite_bitmap_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_BITMAP); }
static mrb_value
sprite_bitmap_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int bid = mrb_nil_p(v) ? 0 : wrgss_get_id(mrb, v);
  js_sprite_set_bitmap(wrgss_get_id(mrb, self), bid);
  mrb_iv_set(mrb, self, SYM_BITMAP, v);
  return v;
}

static mrb_value sprite_src_rect_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_SRC_RECT); }
static mrb_value
sprite_src_rect_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  if (mrb_nil_p(v)) { mrb_iv_set(mrb, self, SYM_SRC_RECT, mrb_nil_value()); return v; }
  int x = wrgss_to_int(mrb, mrb_funcall(mrb, v, "x", 0));
  int y = wrgss_to_int(mrb, mrb_funcall(mrb, v, "y", 0));
  int w = wrgss_to_int(mrb, mrb_funcall(mrb, v, "width", 0));
  int h = wrgss_to_int(mrb, mrb_funcall(mrb, v, "height", 0));
  js_sprite_set_src_rect(wrgss_get_id(mrb, self), x, y, w, h);
  mrb_iv_set(mrb, self, SYM_SRC_RECT, v);
  return v;
}

static mrb_value sprite_viewport_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_VIEWPORT); }

static mrb_value sprite_width_get(mrb_state *mrb, mrb_value self)  { return mrb_int_value(mrb, js_sprite_width(wrgss_get_id(mrb, self))); }
static mrb_value sprite_height_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_sprite_height(wrgss_get_id(mrb, self))); }
static mrb_value sprite_x_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_sprite_get_x(wrgss_get_id(mrb, self))); }
static mrb_value sprite_y_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_sprite_get_y(wrgss_get_id(mrb, self))); }
static mrb_value sprite_z_get(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_sprite_get_z(wrgss_get_id(mrb, self))); }

#define SP_I_SETTER(name, js_fn)                                             \
static mrb_value                                                             \
sprite_##name##_set(mrb_state *mrb, mrb_value self) {                        \
  mrb_int v; mrb_get_args(mrb, "i", &v);                                     \
  js_fn(wrgss_get_id(mrb, self), (int32_t)v);                                \
  return mrb_int_value(mrb, v);                                              \
}
#define SP_F_SETTER(name, js_fn)                                             \
static mrb_value                                                             \
sprite_##name##_set(mrb_state *mrb, mrb_value self) {                        \
  mrb_float v; mrb_get_args(mrb, "f", &v);                                   \
  js_fn(wrgss_get_id(mrb, self), (double)v);                                 \
  return mrb_float_value(mrb, v);                                            \
}
#define SP_B_SETTER(name, js_fn)                                             \
static mrb_value                                                             \
sprite_##name##_set(mrb_state *mrb, mrb_value self) {                        \
  mrb_value v; mrb_get_args(mrb, "o", &v);                                   \
  int truthy = mrb_true_p(v) || (!mrb_nil_p(v) && !mrb_false_p(v));          \
  js_fn(wrgss_get_id(mrb, self), truthy ? 1 : 0);                            \
  return v;                                                                  \
}

SP_I_SETTER(x,  js_sprite_set_x)
SP_I_SETTER(y,  js_sprite_set_y)
SP_I_SETTER(z,  js_sprite_set_z)
SP_I_SETTER(ox, js_sprite_set_ox)
SP_I_SETTER(oy, js_sprite_set_oy)
SP_F_SETTER(zoom_x, js_sprite_set_zoom_x)
SP_F_SETTER(zoom_y, js_sprite_set_zoom_y)
SP_F_SETTER(angle,  js_sprite_set_angle)
SP_B_SETTER(mirror,  js_sprite_set_mirror)
SP_B_SETTER(visible, js_sprite_set_visible)
SP_I_SETTER(opacity,       js_sprite_set_opacity)
SP_I_SETTER(blend_type,    js_sprite_set_blend_type)
SP_I_SETTER(bush_depth,    js_sprite_set_bush_depth)
SP_I_SETTER(bush_opacity,  js_sprite_set_bush_opacity)
#undef SP_I_SETTER
#undef SP_F_SETTER
#undef SP_B_SETTER

static mrb_value sprite_color_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_COLOR); }
static mrb_value
sprite_color_set(mrb_state *mrb, mrb_value self)
{
  mrb_value c; mrb_get_args(mrb, "o", &c);
  int r = 0, g = 0, b = 0, a = 0;
  if (!mrb_nil_p(c)) {
    r = wrgss_to_int(mrb, mrb_funcall(mrb, c, "red",   0));
    g = wrgss_to_int(mrb, mrb_funcall(mrb, c, "green", 0));
    b = wrgss_to_int(mrb, mrb_funcall(mrb, c, "blue",  0));
    a = wrgss_to_int(mrb, mrb_funcall(mrb, c, "alpha", 0));
  }
  js_sprite_set_color(wrgss_get_id(mrb, self), r, g, b, a);
  mrb_iv_set(mrb, self, SYM_COLOR, c);
  return c;
}

static mrb_value sprite_tone_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_TONE); }
static mrb_value
sprite_tone_set(mrb_state *mrb, mrb_value self)
{
  mrb_value t; mrb_get_args(mrb, "o", &t);
  int r = 0, g = 0, b = 0, gray = 0;
  if (!mrb_nil_p(t)) {
    r = wrgss_to_int(mrb, mrb_funcall(mrb, t, "red",   0));
    g = wrgss_to_int(mrb, mrb_funcall(mrb, t, "green", 0));
    b = wrgss_to_int(mrb, mrb_funcall(mrb, t, "blue",  0));
    gray = wrgss_to_int(mrb, mrb_funcall(mrb, t, "gray", 0));
  }
  js_sprite_set_tone(wrgss_get_id(mrb, self), r, g, b, gray);
  mrb_iv_set(mrb, self, SYM_TONE, t);
  return t;
}

void
wrgss_register_sprite(mrb_state *mrb)
{
  SYM_BITMAP   = mrb_intern_lit(mrb, "@bitmap");
  SYM_SRC_RECT = mrb_intern_lit(mrb, "@src_rect");
  SYM_VIEWPORT = mrb_intern_lit(mrb, "@viewport");
  SYM_COLOR    = mrb_intern_lit(mrb, "@color");
  SYM_TONE     = mrb_intern_lit(mrb, "@tone");
  SYM_DISPOSED = mrb_intern_lit(mrb, "@__wrgss_disposed");

  struct RClass *c = mrb_define_class(mrb, "Sprite", mrb->object_class);
  MRB_SET_INSTANCE_TT(c, MRB_TT_DATA);
  sprite_cls = c;

  mrb_define_class_method(mrb, c, "new", sprite_new, MRB_ARGS_OPT(1));
#define M(name, fn, args) mrb_define_method(mrb, c, name, fn, args)
  M("initialize", sprite_initialize, MRB_ARGS_OPT(1));
  M("dispose",    sprite_dispose,    MRB_ARGS_NONE());
  M("disposed?",  sprite_disposed,   MRB_ARGS_NONE());
  M("update",     sprite_update,     MRB_ARGS_NONE());
  M("flash",      sprite_flash,      MRB_ARGS_REQ(2));
  M("bitmap",     sprite_bitmap_get, MRB_ARGS_NONE());
  M("bitmap=",    sprite_bitmap_set, MRB_ARGS_REQ(1));
  M("src_rect",   sprite_src_rect_get, MRB_ARGS_NONE());
  M("src_rect=",  sprite_src_rect_set, MRB_ARGS_REQ(1));
  M("viewport",   sprite_viewport_get, MRB_ARGS_NONE());
  M("width",      sprite_width_get,  MRB_ARGS_NONE());
  M("height",     sprite_height_get, MRB_ARGS_NONE());
  M("x",          sprite_x_get,      MRB_ARGS_NONE());
  M("y",          sprite_y_get,      MRB_ARGS_NONE());
  M("z",          sprite_z_get,      MRB_ARGS_NONE());
  M("x=",         sprite_x_set,      MRB_ARGS_REQ(1));
  M("y=",         sprite_y_set,      MRB_ARGS_REQ(1));
  M("z=",         sprite_z_set,      MRB_ARGS_REQ(1));
  M("ox=",        sprite_ox_set,     MRB_ARGS_REQ(1));
  M("oy=",        sprite_oy_set,     MRB_ARGS_REQ(1));
  M("zoom_x=",    sprite_zoom_x_set, MRB_ARGS_REQ(1));
  M("zoom_y=",    sprite_zoom_y_set, MRB_ARGS_REQ(1));
  M("angle=",     sprite_angle_set,  MRB_ARGS_REQ(1));
  M("mirror=",    sprite_mirror_set, MRB_ARGS_REQ(1));
  M("visible=",   sprite_visible_set, MRB_ARGS_REQ(1));
  M("opacity=",   sprite_opacity_set, MRB_ARGS_REQ(1));
  M("blend_type=", sprite_blend_type_set, MRB_ARGS_REQ(1));
  M("bush_depth=", sprite_bush_depth_set, MRB_ARGS_REQ(1));
  M("bush_opacity=", sprite_bush_opacity_set, MRB_ARGS_REQ(1));
  M("color",      sprite_color_get,  MRB_ARGS_NONE());
  M("color=",     sprite_color_set,  MRB_ARGS_REQ(1));
  M("tone",       sprite_tone_get,   MRB_ARGS_NONE());
  M("tone=",      sprite_tone_set,   MRB_ARGS_REQ(1));
#undef M
  (void)sprite_cls;
}
