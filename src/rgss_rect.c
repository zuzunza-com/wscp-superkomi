/*
 * rgss_rect.c — RGSS Rect class.
 *
 * Value type with four integer fields (x, y, width, height). Backed by
 * MRB_TT_DATA so subclasses of Rect can be instantiated consistently and
 * `Rect#set(other_rect)` can accept any duck-typed object that exposes
 * `#x`, `#y`, `#width`, `#height`.
 */

#include <stdio.h>
#include <string.h>

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/data.h>
#include <mruby/numeric.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"

struct rgss_rect {
  mrb_int x, y, w, h;
};

static void
rgss_rect_free(mrb_state *mrb, void *p)
{
  mrb_free(mrb, p);
}

const struct mrb_data_type rgss_rect_type = {
  "Rect", rgss_rect_free,
};

static struct RClass *rect_cls;

static struct rgss_rect *
rect_ptr(mrb_state *mrb, mrb_value self)
{
  void *p = mrb_data_check_get_ptr(mrb, self, &rgss_rect_type);
  if (!p) mrb_raise(mrb, E_RUNTIME_ERROR, "Rect: uninitialized");
  return (struct rgss_rect *)p;
}

static void
rect_store(struct rgss_rect *r, mrb_int x, mrb_int y, mrb_int w, mrb_int h)
{
  r->x = x; r->y = y; r->w = w; r->h = h;
}

static mrb_int
read_coord(mrb_state *mrb, mrb_value obj, const char *name)
{
  return wrgss_to_int(mrb, mrb_funcall(mrb, obj, name, 0));
}

mrb_value
rgss_rect_new(mrb_state *mrb, mrb_int x, mrb_int y, mrb_int w, mrb_int h)
{
  mrb_value argv[4] = {
    mrb_int_value(mrb, x),
    mrb_int_value(mrb, y),
    mrb_int_value(mrb, w),
    mrb_int_value(mrb, h),
  };
  return mrb_funcall_argv(mrb, mrb_obj_value(rect_cls), mrb_intern_lit(mrb, "new"), 4, argv);
}

static mrb_value
m_new(mrb_state *mrb, mrb_value klass)
{
  const mrb_value *argv;
  mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);

  struct rgss_rect *r = (struct rgss_rect *)mrb_malloc(mrb, sizeof(*r));
  memset(r, 0, sizeof(*r));
  struct RData *d = mrb_data_object_alloc(mrb, mrb_class_ptr(klass), r, &rgss_rect_type);
  mrb_value obj = mrb_obj_value(d);
  if (mrb_class_ptr(klass) == rect_cls) {
    mrb_int vals[4] = {0, 0, 0, 0};
    for (mrb_int i = 0; i < argc && i < 4; i++) vals[i] = wrgss_to_int(mrb, argv[i]);
    rect_store(r, vals[0], vals[1], vals[2], vals[3]);
    return obj;
  }
  mrb_funcall_argv(mrb, obj, mrb_intern_lit(mrb, "initialize"), argc, argv);
  return obj;
}

static mrb_value
m_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_int x = 0, y = 0, w = 0, h = 0;
  mrb_get_args(mrb, "|iiii", &x, &y, &w, &h);
  struct rgss_rect *r = (struct rgss_rect *)DATA_PTR(self);
  if (!r) {
    r = (struct rgss_rect *)mrb_malloc(mrb, sizeof(*r));
    mrb_data_init(self, r, &rgss_rect_type);
  }
  rect_store(r, x, y, w, h);
  return self;
}

static mrb_value
m_set(mrb_state *mrb, mrb_value self)
{
  mrb_value arg1 = mrb_nil_value(), arg2 = mrb_nil_value(), arg3 = mrb_nil_value(), arg4 = mrb_nil_value();
  mrb_int argc = mrb_get_args(mrb, "o|ooo", &arg1, &arg2, &arg3, &arg4);
  struct rgss_rect *r = rect_ptr(mrb, self);

  if (argc == 1) {
    if (mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "x"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "y"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "width"))
        && mrb_respond_to(mrb, arg1, mrb_intern_lit(mrb, "height"))) {
      rect_store(r,
                 read_coord(mrb, arg1, "x"),
                 read_coord(mrb, arg1, "y"),
                 read_coord(mrb, arg1, "width"),
                 read_coord(mrb, arg1, "height"));
      return self;
    }
    mrb_raise(mrb, E_ARGUMENT_ERROR, "Rect#set: need 4 numbers or a Rect-like object");
  }
  if (argc < 4) {
    mrb_raise(mrb, E_ARGUMENT_ERROR, "Rect#set: need 4 numbers");
  }
  rect_store(r,
             wrgss_to_int(mrb, arg1),
             wrgss_to_int(mrb, arg2),
             wrgss_to_int(mrb, arg3),
             wrgss_to_int(mrb, arg4));
  return self;
}

static mrb_value
m_empty(mrb_state *mrb, mrb_value self)
{
  struct rgss_rect *r = rect_ptr(mrb, self);
  rect_store(r, 0, 0, 0, 0);
  return self;
}

#define RECT_ACCESSOR(name, field)                                         \
static mrb_value                                                           \
m_##name##_get(mrb_state *mrb, mrb_value self)                             \
{                                                                          \
  return mrb_int_value(mrb, rect_ptr(mrb, self)->field);                   \
}                                                                          \
static mrb_value                                                           \
m_##name##_set(mrb_state *mrb, mrb_value self)                             \
{                                                                          \
  mrb_int v;                                                               \
  mrb_get_args(mrb, "i", &v);                                              \
  struct rgss_rect *r = rect_ptr(mrb, self);                               \
  r->field = v;                                                            \
  return mrb_int_value(mrb, v);                                            \
}

RECT_ACCESSOR(x, x)
RECT_ACCESSOR(y, y)
RECT_ACCESSOR(width,  w)
RECT_ACCESSOR(height, h)
#undef RECT_ACCESSOR

static mrb_value
m_to_s(mrb_state *mrb, mrb_value self)
{
  struct rgss_rect *r = rect_ptr(mrb, self);
  char buf[96];
  snprintf(buf, sizeof(buf), "(%d, %d, %d, %d)", (int)r->x, (int)r->y, (int)r->w, (int)r->h);
  return mrb_str_new_cstr(mrb, buf);
}

static mrb_value
m_equal(mrb_state *mrb, mrb_value self)
{
  mrb_value other;
  mrb_get_args(mrb, "o", &other);
  if (!mrb_obj_is_kind_of(mrb, other, rect_cls)) return mrb_false_value();
  struct rgss_rect *a = rect_ptr(mrb, self);
  struct rgss_rect *b = rect_ptr(mrb, other);
  if (a->x != b->x || a->y != b->y || a->w != b->w || a->h != b->h) return mrb_false_value();
  return mrb_true_value();
}

void
wrgss_register_rect(mrb_state *mrb)
{
  struct RClass *c = mrb_define_class(mrb, "Rect", mrb->object_class);
  MRB_SET_INSTANCE_TT(c, MRB_TT_DATA);
  rect_cls = c;

  mrb_define_class_method(mrb, c, "new", m_new, MRB_ARGS_OPT(4));
  mrb_define_method(mrb, c, "initialize", m_initialize, MRB_ARGS_OPT(4));
  mrb_define_method(mrb, c, "set",        m_set,        MRB_ARGS_ARG(1, 3));
  mrb_define_method(mrb, c, "empty",      m_empty,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "x",          m_x_get,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "x=",         m_x_set,      MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "y",          m_y_get,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "y=",         m_y_set,      MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "width",      m_width_get,  MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "width=",     m_width_set,  MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "height",     m_height_get, MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "height=",    m_height_set, MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "to_s",       m_to_s,       MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "==",         m_equal,      MRB_ARGS_REQ(1));
}
