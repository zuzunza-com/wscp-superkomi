/*
 * rgss_color.c — RGSS Color + Tone classes.
 *
 * Both are immutable-ish value types backed by MRB_TT_DATA so that user
 * subclasses preserve their class tag and every `<Class>.new` invocation
 * goes through the Ruby initialize dispatcher. They share a file because
 * the `set` method on each accepts duck-typed arguments with overlapping
 * channel names, and putting them side by side keeps that contract obvious.
 *
 * Channel clamps:
 *   Color  r/g/b/alpha   [0, 255]
 *   Tone   r/g/b         [-255, 255], gray [0, 255]
 */

#include <math.h>
#include <stdio.h>
#include <string.h>

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/data.h>
#include <mruby/numeric.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"

/* -------------------------------------------------------------------------
 * Shared helpers
 * ------------------------------------------------------------------------- */

static double
clampd(double v, double lo, double hi)
{
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

static double
read_channel(mrb_state *mrb, mrb_value arg1, const char *name)
{
  return wrgss_to_f(mrb, mrb_funcall(mrb, arg1, name, 0));
}

/* -------------------------------------------------------------------------
 * Color
 * ------------------------------------------------------------------------- */

struct rgss_color {
  mrb_float r, g, b, a;
};

static void
rgss_color_free(mrb_state *mrb, void *p)
{
  mrb_free(mrb, p);
}

const struct mrb_data_type rgss_color_type = {
  "Color", rgss_color_free,
};

static struct RClass *color_cls;

static struct rgss_color *
color_ptr(mrb_state *mrb, mrb_value self)
{
  void *p = mrb_data_check_get_ptr(mrb, self, &rgss_color_type);
  if (!p) mrb_raise(mrb, E_RUNTIME_ERROR, "Color: uninitialized");
  return (struct rgss_color *)p;
}

static void
color_store(struct rgss_color *c, double r, double g, double b, double a)
{
  c->r = clampd(r, 0, 255);
  c->g = clampd(g, 0, 255);
  c->b = clampd(b, 0, 255);
  c->a = clampd(a, 0, 255);
}

mrb_value
rgss_color_new(mrb_state *mrb, double r, double g, double b, double a)
{
  mrb_value argv[4] = {
    mrb_float_value(mrb, r),
    mrb_float_value(mrb, g),
    mrb_float_value(mrb, b),
    mrb_float_value(mrb, a),
  };
  return mrb_funcall_argv(mrb, mrb_obj_value(color_cls), mrb_intern_lit(mrb, "new"), 4, argv);
}

static mrb_value
color_new(mrb_state *mrb, mrb_value klass)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);

  struct rgss_color *c = (struct rgss_color *)mrb_malloc(mrb, sizeof(*c));
  memset(c, 0, sizeof(*c));
  struct RData *d = mrb_data_object_alloc(mrb, mrb_class_ptr(klass), c, &rgss_color_type);
  mrb_value obj = mrb_obj_value(d);
  if (mrb_class_ptr(klass) == color_cls) {
    double vals[4] = {0, 0, 0, 0};
    if (argc >= 3) vals[3] = 255.0;
    for (mrb_int i = 0; i < argc && i < 4; i++) vals[i] = wrgss_to_f(mrb, argv[i]);
    color_store(c, vals[0], vals[1], vals[2], vals[3]);
    return obj;
  }
  mrb_funcall_argv(mrb, obj, mrb_intern_lit(mrb, "initialize"), argc, argv);
  return obj;
}

static mrb_value
color_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_float r = 0, g = 0, b = 0, a = 255;
  mrb_int argc = mrb_get_args(mrb, "|ffff", &r, &g, &b, &a);
  struct rgss_color *c = (struct rgss_color *)DATA_PTR(self);
  if (!c) {
    c = (struct rgss_color *)mrb_malloc(mrb, sizeof(*c));
    mrb_data_init(self, c, &rgss_color_type);
  }
  if (argc == 0) { r = g = b = 0; a = 0; }
  color_store(c, r, g, b, a);
  return self;
}

static mrb_value
color_set(mrb_state *mrb, mrb_value self)
{
  mrb_value arg1 = mrb_nil_value(), arg2 = mrb_nil_value(), arg3 = mrb_nil_value(), arg4 = mrb_nil_value();
  mrb_int argc = mrb_get_args(mrb, "o|ooo", &arg1, &arg2, &arg3, &arg4);
  struct rgss_color *c = color_ptr(mrb, self);

  if (argc == 1) {
    if (mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "red"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "green"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "blue"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "alpha"))) {
      color_store(c,
                  read_channel(mrb, arg1, "red"),
                  read_channel(mrb, arg1, "green"),
                  read_channel(mrb, arg1, "blue"),
                  read_channel(mrb, arg1, "alpha"));
      return self;
    }
    mrb_raise(mrb, E_ARGUMENT_ERROR, "Color#set: need 3..4 numbers or a Color-like object");
  }
  double r = wrgss_to_f(mrb, arg1);
  double g = wrgss_to_f(mrb, arg2);
  double b = wrgss_to_f(mrb, arg3);
  double a = argc >= 4 ? wrgss_to_f(mrb, arg4) : 255.0;
  color_store(c, r, g, b, a);
  return self;
}

#define COLOR_ACCESSOR(name, field)                                        \
static mrb_value                                                           \
color_##name##_get(mrb_state *mrb, mrb_value self)                         \
{                                                                          \
  return mrb_float_value(mrb, color_ptr(mrb, self)->field);                \
}                                                                          \
static mrb_value                                                           \
color_##name##_set(mrb_state *mrb, mrb_value self)                         \
{                                                                          \
  mrb_float v;                                                             \
  mrb_get_args(mrb, "f", &v);                                              \
  struct rgss_color *c = color_ptr(mrb, self);                             \
  c->field = clampd(v, 0, 255);                                            \
  return mrb_float_value(mrb, c->field);                                   \
}

COLOR_ACCESSOR(red,   r)
COLOR_ACCESSOR(green, g)
COLOR_ACCESSOR(blue,  b)
COLOR_ACCESSOR(alpha, a)
#undef COLOR_ACCESSOR

static mrb_value
color_to_s(mrb_state *mrb, mrb_value self)
{
  struct rgss_color *c = color_ptr(mrb, self);
  char buf[96];
  snprintf(buf, sizeof(buf), "(%.0f, %.0f, %.0f, %.0f)", c->r, c->g, c->b, c->a);
  return mrb_str_new_cstr(mrb, buf);
}

static mrb_value
color_equal(mrb_state *mrb, mrb_value self)
{
  mrb_value other;
  mrb_get_args(mrb, "o", &other);
  if (!mrb_obj_is_kind_of(mrb, other, color_cls)) return mrb_false_value();
  struct rgss_color *a = color_ptr(mrb, self);
  struct rgss_color *b = color_ptr(mrb, other);
  if (a->r != b->r || a->g != b->g || a->b != b->b || a->a != b->a) return mrb_false_value();
  return mrb_true_value();
}

/* -------------------------------------------------------------------------
 * Tone
 * ------------------------------------------------------------------------- */

struct rgss_tone {
  mrb_float r, g, b, gray;
};

static void
rgss_tone_free(mrb_state *mrb, void *p)
{
  mrb_free(mrb, p);
}

const struct mrb_data_type rgss_tone_type = {
  "Tone", rgss_tone_free,
};

static struct RClass *tone_cls;

static struct rgss_tone *
tone_ptr(mrb_state *mrb, mrb_value self)
{
  void *p = mrb_data_check_get_ptr(mrb, self, &rgss_tone_type);
  if (!p) mrb_raise(mrb, E_RUNTIME_ERROR, "Tone: uninitialized");
  return (struct rgss_tone *)p;
}

static void
tone_store(struct rgss_tone *t, double r, double g, double b, double gr)
{
  t->r = clampd(r, -255, 255);
  t->g = clampd(g, -255, 255);
  t->b = clampd(b, -255, 255);
  t->gray = clampd(gr, 0, 255);
}

mrb_value
rgss_tone_new(mrb_state *mrb, double r, double g, double b, double gr)
{
  mrb_value argv[4] = {
    mrb_float_value(mrb, r),
    mrb_float_value(mrb, g),
    mrb_float_value(mrb, b),
    mrb_float_value(mrb, gr),
  };
  return mrb_funcall_argv(mrb, mrb_obj_value(tone_cls), mrb_intern_lit(mrb, "new"), 4, argv);
}

static mrb_value
tone_new(mrb_state *mrb, mrb_value klass)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);

  struct rgss_tone *t = (struct rgss_tone *)mrb_malloc(mrb, sizeof(*t));
  memset(t, 0, sizeof(*t));
  struct RData *d = mrb_data_object_alloc(mrb, mrb_class_ptr(klass), t, &rgss_tone_type);
  mrb_value obj = mrb_obj_value(d);
  if (mrb_class_ptr(klass) == tone_cls) {
    double vals[4] = {0, 0, 0, 0};
    for (mrb_int i = 0; i < argc && i < 4; i++) vals[i] = wrgss_to_f(mrb, argv[i]);
    tone_store(t, vals[0], vals[1], vals[2], vals[3]);
    return obj;
  }
  mrb_funcall_argv(mrb, obj, mrb_intern_lit(mrb, "initialize"), argc, argv);
  return obj;
}

static mrb_value
tone_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_float r = 0, g = 0, b = 0, gr = 0;
  mrb_get_args(mrb, "|ffff", &r, &g, &b, &gr);
  struct rgss_tone *t = (struct rgss_tone *)DATA_PTR(self);
  if (!t) {
    t = (struct rgss_tone *)mrb_malloc(mrb, sizeof(*t));
    mrb_data_init(self, t, &rgss_tone_type);
  }
  tone_store(t, r, g, b, gr);
  return self;
}

static mrb_value
tone_set(mrb_state *mrb, mrb_value self)
{
  mrb_value arg1 = mrb_nil_value(), arg2 = mrb_nil_value(), arg3 = mrb_nil_value(), arg4 = mrb_nil_value();
  mrb_int argc = mrb_get_args(mrb, "o|ooo", &arg1, &arg2, &arg3, &arg4);
  struct rgss_tone *t = tone_ptr(mrb, self);

  if (argc == 1) {
    if (mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "red"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "green"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "blue"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "gray"))) {
      tone_store(t,
                 read_channel(mrb, arg1, "red"),
                 read_channel(mrb, arg1, "green"),
                 read_channel(mrb, arg1, "blue"),
                 read_channel(mrb, arg1, "gray"));
      return self;
    }
    mrb_raise(mrb, E_ARGUMENT_ERROR, "Tone#set: need 3..4 numbers or a Tone-like object");
  }
  double r = wrgss_to_f(mrb, arg1);
  double g = wrgss_to_f(mrb, arg2);
  double b = wrgss_to_f(mrb, arg3);
  double gr = argc >= 4 ? wrgss_to_f(mrb, arg4) : 0.0;
  tone_store(t, r, g, b, gr);
  return self;
}

#define TONE_ACCESSOR(name, field, lo, hi)                                 \
static mrb_value                                                           \
tone_##name##_get(mrb_state *mrb, mrb_value self)                          \
{                                                                          \
  return mrb_float_value(mrb, tone_ptr(mrb, self)->field);                 \
}                                                                          \
static mrb_value                                                           \
tone_##name##_set(mrb_state *mrb, mrb_value self)                          \
{                                                                          \
  mrb_float v;                                                             \
  mrb_get_args(mrb, "f", &v);                                              \
  struct rgss_tone *t = tone_ptr(mrb, self);                               \
  t->field = clampd(v, (lo), (hi));                                        \
  return mrb_float_value(mrb, t->field);                                   \
}

TONE_ACCESSOR(red,   r,    -255, 255)
TONE_ACCESSOR(green, g,    -255, 255)
TONE_ACCESSOR(blue,  b,    -255, 255)
TONE_ACCESSOR(gray,  gray,    0, 255)
#undef TONE_ACCESSOR

static mrb_value
tone_to_s(mrb_state *mrb, mrb_value self)
{
  struct rgss_tone *t = tone_ptr(mrb, self);
  char buf[96];
  snprintf(buf, sizeof(buf), "(%.0f, %.0f, %.0f, %.0f)", t->r, t->g, t->b, t->gray);
  return mrb_str_new_cstr(mrb, buf);
}

static mrb_value
tone_equal(mrb_state *mrb, mrb_value self)
{
  mrb_value other;
  mrb_get_args(mrb, "o", &other);
  if (!mrb_obj_is_kind_of(mrb, other, tone_cls)) return mrb_false_value();
  struct rgss_tone *a = tone_ptr(mrb, self);
  struct rgss_tone *b = tone_ptr(mrb, other);
  if (a->r != b->r || a->g != b->g || a->b != b->b || a->gray != b->gray) return mrb_false_value();
  return mrb_true_value();
}

/* -------------------------------------------------------------------------
 * Registration
 * ------------------------------------------------------------------------- */

void
wrgss_register_color(mrb_state *mrb)
{
  struct RClass *c = mrb_define_class(mrb, "Color", mrb->object_class);
  MRB_SET_INSTANCE_TT(c, MRB_TT_DATA);
  color_cls = c;

  mrb_define_class_method(mrb, c, "new", color_new, MRB_ARGS_OPT(4));
  mrb_define_method(mrb, c, "initialize", color_initialize, MRB_ARGS_OPT(4));
  mrb_define_method(mrb, c, "set",        color_set,        MRB_ARGS_ARG(1, 3));
  mrb_define_method(mrb, c, "red",        color_red_get,    MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "red=",       color_red_set,    MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "green",      color_green_get,  MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "green=",     color_green_set,  MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "blue",       color_blue_get,   MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "blue=",      color_blue_set,   MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "alpha",      color_alpha_get,  MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "alpha=",     color_alpha_set,  MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "to_s",       color_to_s,       MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "==",         color_equal,      MRB_ARGS_REQ(1));
}

void
wrgss_register_tone(mrb_state *mrb)
{
  struct RClass *c = mrb_define_class(mrb, "Tone", mrb->object_class);
  MRB_SET_INSTANCE_TT(c, MRB_TT_DATA);
  tone_cls = c;

  mrb_define_class_method(mrb, c, "new", tone_new, MRB_ARGS_OPT(4));
  mrb_define_method(mrb, c, "initialize", tone_initialize, MRB_ARGS_OPT(4));
  mrb_define_method(mrb, c, "set",        tone_set,        MRB_ARGS_ARG(1, 3));
  mrb_define_method(mrb, c, "red",        tone_red_get,    MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "red=",       tone_red_set,    MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "green",      tone_green_get,  MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "green=",     tone_green_set,  MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "blue",       tone_blue_get,   MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "blue=",      tone_blue_set,   MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "gray",       tone_gray_get,   MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "gray=",      tone_gray_set,   MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "to_s",       tone_to_s,       MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "==",         tone_equal,      MRB_ARGS_REQ(1));
}
