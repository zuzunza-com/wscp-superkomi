/*
 * rgss_bitmap.c — RGSS Bitmap class.
 *
 * Bitmap is a thin handle around a JS-side HTMLCanvasElement: the native id
 * is stored both in the MRB_TT_DATA payload and the `@__wrgss_id` ivar so
 * that the rest of the runtime can use `wrgss_get_id()` transparently. We
 * use MRB_TT_DATA to keep subclass support (e.g. the engine's own
 * `Cache::Bitmap` refinements) while letting the prelude attach a
 * WrgssAttachedFont proxy on top of `#font` / `#font=`.
 *
 * Factory helpers (`rect`, `get_pixel`, `text_size`) construct Color/Rect
 * instances by calling `<Class>.new` through `mrb_funcall_argv`, so user
 * subclasses and registered aliases resolve correctly. This matches the
 * contract exercised by the WasmBindingsSource test suite.
 */

#include <string.h>

#include <mruby.h>
#include <mruby/array.h>
#include <mruby/class.h>
#include <mruby/data.h>
#include <mruby/numeric.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"
#include "webrgss_imports.h"

struct rgss_bitmap_data {
  int32_t id;
};

static void
rgss_bitmap_data_free(mrb_state *mrb, void *p)
{
  mrb_free(mrb, p);
}

const struct mrb_data_type rgss_bitmap_type = {
  "Bitmap", rgss_bitmap_data_free,
};

static struct RClass *bitmap_cls;

static mrb_sym SYM_FONT;
static mrb_sym SYM_DISPOSED;

static mrb_value
make_rect(mrb_state *mrb, int32_t x, int32_t y, int32_t w, int32_t h)
{
  mrb_value argv[4] = {
    mrb_int_value(mrb, x),
    mrb_int_value(mrb, y),
    mrb_int_value(mrb, w),
    mrb_int_value(mrb, h),
  };
  return mrb_funcall_argv(mrb, mrb_obj_value(mrb_class_get(mrb, "Rect")),
                          mrb_intern_lit(mrb, "new"), 4, argv);
}

static mrb_value
make_color(mrb_state *mrb, int32_t r, int32_t g, int32_t b, int32_t a)
{
  mrb_value argv[4] = {
    mrb_int_value(mrb, r),
    mrb_int_value(mrb, g),
    mrb_int_value(mrb, b),
    mrb_int_value(mrb, a),
  };
  return mrb_funcall_argv(mrb, mrb_obj_value(mrb_class_get(mrb, "Color")),
                          mrb_intern_lit(mrb, "new"), 4, argv);
}

static void
color_components(mrb_state *mrb, mrb_value c, int *r, int *g, int *b, int *a)
{
  *r = wrgss_to_int(mrb, mrb_funcall(mrb, c, "red",   0));
  *g = wrgss_to_int(mrb, mrb_funcall(mrb, c, "green", 0));
  *b = wrgss_to_int(mrb, mrb_funcall(mrb, c, "blue",  0));
  *a = wrgss_to_int(mrb, mrb_funcall(mrb, c, "alpha", 0));
}

static mrb_value
bitmap_new(mrb_state *mrb, mrb_value klass)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);

  struct rgss_bitmap_data *d = (struct rgss_bitmap_data *)mrb_malloc(mrb, sizeof(*d));
  memset(d, 0, sizeof(*d));
  struct RData *r = mrb_data_object_alloc(mrb, mrb_class_ptr(klass), d, &rgss_bitmap_type);
  mrb_value obj = mrb_obj_value(r);
  mrb_funcall_argv(mrb, obj, mrb_intern_lit(mrb, "initialize"), argc, argv);
  return obj;
}

static mrb_value
bitmap_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_value a = mrb_nil_value(), b = mrb_nil_value();
  mrb_int argc = mrb_get_args(mrb, "o|o", &a, &b);
  int id = 0;
  if (argc == 1 && mrb_string_p(a)) {
    id = js_bitmap_load(mrb_string_cstr(mrb, a));
  } else if (argc >= 2) {
    id = js_bitmap_create((int32_t)wrgss_to_int(mrb, a), (int32_t)wrgss_to_int(mrb, b));
  }
  if (!id) mrb_raise(mrb, E_RUNTIME_ERROR, "Bitmap: allocation failed");
  wrgss_set_id(mrb, self, id);
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_false_value());
  return self;
}

static mrb_value
bitmap_dispose(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  if (id) { js_bitmap_dispose(id); wrgss_set_id(mrb, self, 0); }
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_true_value());
  return mrb_nil_value();
}

static mrb_value
bitmap_disposed(mrb_state *mrb, mrb_value self)
{
  return mrb_iv_get(mrb, self, SYM_DISPOSED);
}

static mrb_value
bitmap_clone(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  int nid = id ? js_bitmap_clone(id) : 0;
  if (!nid) return mrb_nil_value();
  struct RClass *klass = mrb_obj_class(mrb, self);
  struct rgss_bitmap_data *d = (struct rgss_bitmap_data *)mrb_malloc(mrb, sizeof(*d));
  d->id = 0;
  struct RData *r = mrb_data_object_alloc(mrb, klass, d, &rgss_bitmap_type);
  mrb_value dup = mrb_obj_value(r);
  wrgss_set_id(mrb, dup, nid);
  mrb_iv_set(mrb, dup, SYM_DISPOSED, mrb_false_value());
  return dup;
}

static mrb_value bitmap_width(mrb_state *mrb, mrb_value self)  { return mrb_int_value(mrb, js_bitmap_width(wrgss_get_id(mrb, self))); }
static mrb_value bitmap_height(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_bitmap_height(wrgss_get_id(mrb, self))); }

static mrb_value
bitmap_rect(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  int w = js_bitmap_width(id), h = js_bitmap_height(id);
  return make_rect(mrb, 0, 0, w, h);
}

static mrb_value
bitmap_blt(mrb_state *mrb, mrb_value self)
{
  mrb_int dx, dy; mrb_value src, rect; mrb_int opacity = 255;
  mrb_get_args(mrb, "iioo|i", &dx, &dy, &src, &rect, &opacity);
  int dst_id = wrgss_get_id(mrb, self);
  int src_id = wrgss_get_id(mrb, src);
  int sx = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "x", 0));
  int sy = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "y", 0));
  int sw = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "width", 0));
  int sh = wrgss_to_int(mrb, mrb_funcall(mrb, rect, "height", 0));
  js_bitmap_blt(dst_id, (int32_t)dx, (int32_t)dy, src_id, sx, sy, sw, sh, (int32_t)opacity);
  return mrb_nil_value();
}

static mrb_value
bitmap_stretch_blt(mrb_state *mrb, mrb_value self)
{
  mrb_value drect, src, srect; mrb_int opacity = 255;
  mrb_get_args(mrb, "ooo|i", &drect, &src, &srect, &opacity);
  int dst_id = wrgss_get_id(mrb, self);
  int src_id = wrgss_get_id(mrb, src);
  int dx = wrgss_to_int(mrb, mrb_funcall(mrb, drect, "x", 0));
  int dy = wrgss_to_int(mrb, mrb_funcall(mrb, drect, "y", 0));
  int dw = wrgss_to_int(mrb, mrb_funcall(mrb, drect, "width", 0));
  int dh = wrgss_to_int(mrb, mrb_funcall(mrb, drect, "height", 0));
  int sx = wrgss_to_int(mrb, mrb_funcall(mrb, srect, "x", 0));
  int sy = wrgss_to_int(mrb, mrb_funcall(mrb, srect, "y", 0));
  int sw = wrgss_to_int(mrb, mrb_funcall(mrb, srect, "width", 0));
  int sh = wrgss_to_int(mrb, mrb_funcall(mrb, srect, "height", 0));
  js_bitmap_stretch_blt(dst_id, dx, dy, dw, dh, src_id, sx, sy, sw, sh, (int32_t)opacity);
  return mrb_nil_value();
}

static mrb_value
bitmap_fill_rect(mrb_state *mrb, mrb_value self)
{
  const mrb_value *argv; mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  int x = 0, y = 0, w = 0, h = 0; mrb_value color;
  if (argc == 5) {
    x = wrgss_to_int(mrb, argv[0]); y = wrgss_to_int(mrb, argv[1]);
    w = wrgss_to_int(mrb, argv[2]); h = wrgss_to_int(mrb, argv[3]);
    color = argv[4];
  } else if (argc == 2) {
    x = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "x", 0));
    y = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "y", 0));
    w = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "width", 0));
    h = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "height", 0));
    color = argv[1];
  } else {
    return mrb_nil_value();
  }
  int r, g, b, a; color_components(mrb, color, &r, &g, &b, &a);
  js_bitmap_fill_rect(wrgss_get_id(mrb, self), x, y, w, h, r, g, b, a);
  return mrb_nil_value();
}

static mrb_value
bitmap_gradient_fill_rect(mrb_state *mrb, mrb_value self)
{
  const mrb_value *argv; mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  int x = 0, y = 0, w = 0, h = 0;
  mrb_value c1 = mrb_nil_value(), c2 = mrb_nil_value();
  mrb_bool vertical = FALSE;
  if (argc >= 6) {
    x = wrgss_to_int(mrb, argv[0]); y = wrgss_to_int(mrb, argv[1]);
    w = wrgss_to_int(mrb, argv[2]); h = wrgss_to_int(mrb, argv[3]);
    c1 = argv[4]; c2 = argv[5];
    if (argc >= 7) vertical = mrb_test(argv[6]);
  } else if (argc >= 3) {
    x = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "x", 0));
    y = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "y", 0));
    w = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "width", 0));
    h = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "height", 0));
    c1 = argv[1]; c2 = argv[2];
    if (argc >= 4) vertical = mrb_test(argv[3]);
  } else {
    return mrb_nil_value();
  }
  int r1, g1, b1, a1, r2, g2, b2, a2;
  color_components(mrb, c1, &r1, &g1, &b1, &a1);
  color_components(mrb, c2, &r2, &g2, &b2, &a2);
  js_bitmap_gradient_fill_rect(wrgss_get_id(mrb, self), x, y, w, h,
                               r1, g1, b1, a1, r2, g2, b2, a2, vertical ? 1 : 0);
  return mrb_nil_value();
}

static mrb_value
bitmap_clear(mrb_state *mrb, mrb_value self)
{
  js_bitmap_clear(wrgss_get_id(mrb, self));
  return mrb_nil_value();
}

static mrb_value
bitmap_clear_rect(mrb_state *mrb, mrb_value self)
{
  const mrb_value *argv; mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  int x = 0, y = 0, w = 0, h = 0;
  if (argc == 4) {
    x = wrgss_to_int(mrb, argv[0]); y = wrgss_to_int(mrb, argv[1]);
    w = wrgss_to_int(mrb, argv[2]); h = wrgss_to_int(mrb, argv[3]);
  } else if (argc == 1) {
    x = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "x", 0));
    y = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "y", 0));
    w = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "width", 0));
    h = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "height", 0));
  }
  js_bitmap_clear_rect(wrgss_get_id(mrb, self), x, y, w, h);
  return mrb_nil_value();
}

static mrb_value
bitmap_get_pixel(mrb_state *mrb, mrb_value self)
{
  mrb_int x, y; mrb_get_args(mrb, "ii", &x, &y);
  int32_t rgba = js_bitmap_get_pixel(wrgss_get_id(mrb, self), (int32_t)x, (int32_t)y);
  return make_color(mrb,
                    (rgba >> 24) & 0xff,
                    (rgba >> 16) & 0xff,
                    (rgba >>  8) & 0xff,
                     rgba        & 0xff);
}

static mrb_value
bitmap_set_pixel(mrb_state *mrb, mrb_value self)
{
  mrb_int x, y; mrb_value color;
  mrb_get_args(mrb, "iio", &x, &y, &color);
  int r, g, b, a; color_components(mrb, color, &r, &g, &b, &a);
  js_bitmap_set_pixel(wrgss_get_id(mrb, self), (int32_t)x, (int32_t)y, r, g, b, a);
  return mrb_nil_value();
}

static mrb_value
bitmap_hue_change(mrb_state *mrb, mrb_value self)
{
  mrb_int hue; mrb_get_args(mrb, "i", &hue);
  js_bitmap_hue_change(wrgss_get_id(mrb, self), (int32_t)hue);
  return mrb_nil_value();
}

static mrb_value
bitmap_blur(mrb_state *mrb, mrb_value self)
{
  js_bitmap_blur(wrgss_get_id(mrb, self));
  return mrb_nil_value();
}

static mrb_value
bitmap_radial_blur(mrb_state *mrb, mrb_value self)
{
  mrb_int angle, div; mrb_get_args(mrb, "ii", &angle, &div);
  js_bitmap_radial_blur(wrgss_get_id(mrb, self), (int32_t)angle, (int32_t)div);
  return mrb_nil_value();
}

static mrb_value
bitmap_draw_text(mrb_state *mrb, mrb_value self)
{
  const mrb_value *argv; mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  int id = wrgss_get_id(mrb, self);
  int x = 0, y = 0, w = 0, h = 0, align = 0;
  mrb_value str;
  if (argc >= 5) {
    x = wrgss_to_int(mrb, argv[0]); y = wrgss_to_int(mrb, argv[1]);
    w = wrgss_to_int(mrb, argv[2]); h = wrgss_to_int(mrb, argv[3]);
    str = argv[4];
    if (argc >= 6) align = wrgss_to_int(mrb, argv[5]);
  } else if (argc >= 2) {
    x = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "x", 0));
    y = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "y", 0));
    w = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "width", 0));
    h = wrgss_to_int(mrb, mrb_funcall(mrb, argv[0], "height", 0));
    str = argv[1];
    if (argc >= 3) align = wrgss_to_int(mrb, argv[2]);
  } else {
    return mrb_nil_value();
  }
  mrb_value s = mrb_string_p(str) ? str : mrb_funcall(mrb, str, "to_s", 0);
  js_bitmap_draw_text(id, x, y, w, h, mrb_string_cstr(mrb, s), (int32_t)align);
  return mrb_nil_value();
}

static mrb_value
bitmap_text_size(mrb_state *mrb, mrb_value self)
{
  mrb_value str; mrb_get_args(mrb, "S", &str);
  int32_t w = 0, h = 0;
  js_bitmap_text_size(wrgss_get_id(mrb, self), mrb_string_cstr(mrb, str), &w, &h);
  return make_rect(mrb, 0, 0, w, h);
}

static mrb_value bitmap_font_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_FONT); }
static mrb_value
bitmap_font_set(mrb_state *mrb, mrb_value self)
{
  mrb_value f; mrb_get_args(mrb, "o", &f);
  mrb_iv_set(mrb, self, SYM_FONT, f);
  return f;
}

static mrb_value
bitmap_wrgss_font_name_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  if (mrb_string_p(v)) js_bitmap_set_font_name(wrgss_get_id(mrb, self), mrb_string_cstr(mrb, v));
  return v;
}
static mrb_value
bitmap_wrgss_font_size_set(mrb_state *mrb, mrb_value self)
{
  mrb_int v; mrb_get_args(mrb, "i", &v);
  js_bitmap_set_font_size(wrgss_get_id(mrb, self), (int32_t)v);
  return mrb_int_value(mrb, v);
}

#define BOOL_FONT_SETTER(name, js_fn)                                        \
static mrb_value                                                             \
bitmap_wrgss_font_##name##_set(mrb_state *mrb, mrb_value self) {             \
  mrb_value v; mrb_get_args(mrb, "o", &v);                                   \
  int truthy = mrb_true_p(v) || (!mrb_nil_p(v) && !mrb_false_p(v));          \
  js_fn(wrgss_get_id(mrb, self), truthy ? 1 : 0);                            \
  return v;                                                                  \
}
BOOL_FONT_SETTER(bold,    js_bitmap_set_font_bold)
BOOL_FONT_SETTER(italic,  js_bitmap_set_font_italic)
BOOL_FONT_SETTER(shadow,  js_bitmap_set_font_shadow)
BOOL_FONT_SETTER(outline, js_bitmap_set_font_outline)
#undef BOOL_FONT_SETTER

static mrb_value
bitmap_wrgss_font_color_set(mrb_state *mrb, mrb_value self)
{
  mrb_value c; mrb_get_args(mrb, "o", &c);
  int r, g, b, a; color_components(mrb, c, &r, &g, &b, &a);
  js_bitmap_set_font_color(wrgss_get_id(mrb, self), r, g, b, a);
  return c;
}
static mrb_value
bitmap_wrgss_font_out_color_set(mrb_state *mrb, mrb_value self)
{
  mrb_value c; mrb_get_args(mrb, "o", &c);
  int r, g, b, a; color_components(mrb, c, &r, &g, &b, &a);
  js_bitmap_set_font_out_color(wrgss_get_id(mrb, self), r, g, b, a);
  return c;
}

void
wrgss_register_bitmap(mrb_state *mrb)
{
  SYM_FONT     = mrb_intern_lit(mrb, "@font");
  SYM_DISPOSED = mrb_intern_lit(mrb, "@__wrgss_disposed");

  struct RClass *c = mrb_define_class(mrb, "Bitmap", mrb->object_class);
  MRB_SET_INSTANCE_TT(c, MRB_TT_DATA);
  bitmap_cls = c;

  mrb_define_class_method(mrb, c, "new", bitmap_new, MRB_ARGS_ARG(1, 1));
#define M(name, fn, args) mrb_define_method(mrb, c, name, fn, args)
  M("initialize",       bitmap_initialize,  MRB_ARGS_ARG(1, 1));
  M("dispose",          bitmap_dispose,     MRB_ARGS_NONE());
  M("disposed?",        bitmap_disposed,    MRB_ARGS_NONE());
  M("clone",            bitmap_clone,       MRB_ARGS_NONE());
  M("dup",              bitmap_clone,       MRB_ARGS_NONE());
  M("width",            bitmap_width,       MRB_ARGS_NONE());
  M("height",           bitmap_height,      MRB_ARGS_NONE());
  M("rect",             bitmap_rect,        MRB_ARGS_NONE());
  M("blt",              bitmap_blt,         MRB_ARGS_ARG(4, 1));
  M("stretch_blt",      bitmap_stretch_blt, MRB_ARGS_ARG(3, 1));
  M("fill_rect",        bitmap_fill_rect,   MRB_ARGS_ANY());
  M("gradient_fill_rect", bitmap_gradient_fill_rect, MRB_ARGS_ANY());
  M("clear",            bitmap_clear,       MRB_ARGS_NONE());
  M("clear_rect",       bitmap_clear_rect,  MRB_ARGS_ANY());
  M("get_pixel",        bitmap_get_pixel,   MRB_ARGS_REQ(2));
  M("set_pixel",        bitmap_set_pixel,   MRB_ARGS_REQ(3));
  M("hue_change",       bitmap_hue_change,  MRB_ARGS_REQ(1));
  M("blur",             bitmap_blur,        MRB_ARGS_NONE());
  M("radial_blur",      bitmap_radial_blur, MRB_ARGS_REQ(2));
  M("draw_text",        bitmap_draw_text,   MRB_ARGS_ANY());
  M("text_size",        bitmap_text_size,   MRB_ARGS_REQ(1));
  M("font",             bitmap_font_get,    MRB_ARGS_NONE());
  M("font=",            bitmap_font_set,    MRB_ARGS_REQ(1));
  M("__wrgss_font_name=",    bitmap_wrgss_font_name_set,    MRB_ARGS_REQ(1));
  M("__wrgss_font_size=",    bitmap_wrgss_font_size_set,    MRB_ARGS_REQ(1));
  M("__wrgss_font_bold=",    bitmap_wrgss_font_bold_set,    MRB_ARGS_REQ(1));
  M("__wrgss_font_italic=",  bitmap_wrgss_font_italic_set,  MRB_ARGS_REQ(1));
  M("__wrgss_font_shadow=",  bitmap_wrgss_font_shadow_set,  MRB_ARGS_REQ(1));
  M("__wrgss_font_outline=", bitmap_wrgss_font_outline_set, MRB_ARGS_REQ(1));
  M("__wrgss_font_color=",     bitmap_wrgss_font_color_set,     MRB_ARGS_REQ(1));
  M("__wrgss_font_out_color=", bitmap_wrgss_font_out_color_set, MRB_ARGS_REQ(1));
#undef M
  (void)bitmap_cls;
}
