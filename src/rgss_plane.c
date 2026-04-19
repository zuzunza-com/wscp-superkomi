/*
 * rgss_plane.c — RGSS Plane class (tiled background).
 */

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>
#include <mruby/numeric.h>

#include "webrgss.h"
#include "webrgss_imports.h"

static mrb_sym SYM_BITMAP, SYM_VIEWPORT, SYM_DISPOSED;

static mrb_value
m_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_value vp = mrb_nil_value();
  mrb_get_args(mrb, "|o", &vp);
  int vp_id = mrb_nil_p(vp) ? 0 : wrgss_get_id(mrb, vp);
  int id = js_plane_create(vp_id);
  if (!id) mrb_raise(mrb, E_RUNTIME_ERROR, "Plane: allocation failed");
  wrgss_set_id(mrb, self, id);
  mrb_iv_set(mrb, self, SYM_VIEWPORT, vp);
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_false_value());
  return self;
}

static mrb_value
m_dispose(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  if (id) { js_plane_dispose(id); wrgss_set_id(mrb, self, 0); }
  mrb_iv_set(mrb, self, SYM_DISPOSED, mrb_true_value());
  return mrb_nil_value();
}
static mrb_value m_disposed(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_DISPOSED); }

static mrb_value m_update(mrb_state *mrb, mrb_value self)
{ js_plane_update(wrgss_get_id(mrb, self)); return mrb_nil_value(); }

static mrb_value m_bitmap_get(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_BITMAP); }
static mrb_value
m_bitmap_set(mrb_state *mrb, mrb_value self)
{
  mrb_value v; mrb_get_args(mrb, "o", &v);
  int bid = mrb_nil_p(v) ? 0 : wrgss_get_id(mrb, v);
  js_plane_set_bitmap(wrgss_get_id(mrb, self), bid);
  mrb_iv_set(mrb, self, SYM_BITMAP, v);
  return v;
}

#define I_SET(name, js_fn)                                                   \
static mrb_value                                                             \
m_##name##_set(mrb_state *mrb, mrb_value self) {                             \
  mrb_int v; mrb_get_args(mrb, "i", &v);                                     \
  js_fn(wrgss_get_id(mrb, self), (int32_t)v);                                \
  return mrb_int_value(mrb, v);                                              \
}
I_SET(ox, js_plane_set_ox)
I_SET(oy, js_plane_set_oy)
I_SET(z,  js_plane_set_z)

void
wrgss_register_plane(mrb_state *mrb)
{
  SYM_BITMAP   = mrb_intern_lit(mrb, "@bitmap");
  SYM_VIEWPORT = mrb_intern_lit(mrb, "@viewport");
  SYM_DISPOSED = mrb_intern_lit(mrb, "@__wrgss_disposed");

  struct RClass *c = mrb_define_class(mrb, "Plane", mrb->object_class);
#define M(name, fn, args) mrb_define_method(mrb, c, name, fn, args)
  M("initialize", m_initialize, MRB_ARGS_OPT(1));
  M("dispose",    m_dispose,    MRB_ARGS_NONE());
  M("disposed?",  m_disposed,   MRB_ARGS_NONE());
  M("update",     m_update,     MRB_ARGS_NONE());
  M("bitmap",     m_bitmap_get, MRB_ARGS_NONE());
  M("bitmap=",    m_bitmap_set, MRB_ARGS_REQ(1));
  M("ox=",        m_ox_set,     MRB_ARGS_REQ(1));
  M("oy=",        m_oy_set,     MRB_ARGS_REQ(1));
  M("z=",         m_z_set,      MRB_ARGS_REQ(1));
#undef M
}
