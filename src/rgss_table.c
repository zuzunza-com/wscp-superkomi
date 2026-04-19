/*
 * rgss_table.c — RGSS Table class. Stored JS-side via js_table_*.
 *
 * Table.new(xsize[, ysize[, zsize]]) creates a 1/2/3-dim integer array.
 * Tiles are 16-bit signed in canonical RGSS but we store as i32 via js_table_*.
 */

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>
#include <mruby/array.h>

#include "webrgss.h"
#include "webrgss_imports.h"

static mrb_value
m_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_int x = 0, y = 1, z = 1;
  mrb_int argc = mrb_get_args(mrb, "i|ii", &x, &y, &z);
  if (argc < 2) y = 1;
  if (argc < 3) z = 1;
  int id = js_table_create((int32_t)x, (int32_t)y, (int32_t)z);
  wrgss_set_id(mrb, self, id);
  return self;
}

static mrb_value
m_dispose(mrb_state *mrb, mrb_value self)
{
  int id = wrgss_get_id(mrb, self);
  if (id) { js_table_dispose(id); wrgss_set_id(mrb, self, 0); }
  return mrb_nil_value();
}

static mrb_value
m_resize(mrb_state *mrb, mrb_value self)
{
  mrb_int x = 0, y = 1, z = 1;
  mrb_int argc = mrb_get_args(mrb, "i|ii", &x, &y, &z);
  if (argc < 2) y = 1;
  if (argc < 3) z = 1;
  int id = wrgss_get_id(mrb, self);
  if (id) js_table_resize(id, (int32_t)x, (int32_t)y, (int32_t)z);
  return self;
}

static mrb_value
m_xsize(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_table_xsize(wrgss_get_id(mrb, self))); }
static mrb_value
m_ysize(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_table_ysize(wrgss_get_id(mrb, self))); }
static mrb_value
m_zsize(mrb_state *mrb, mrb_value self) { return mrb_int_value(mrb, js_table_zsize(wrgss_get_id(mrb, self))); }

static mrb_value
m_aref(mrb_state *mrb, mrb_value self)
{
  mrb_int x = 0, y = 0, z = 0;
  mrb_int argc = mrb_get_args(mrb, "i|ii", &x, &y, &z);
  if (argc < 2) y = 0;
  if (argc < 3) z = 0;
  int id = wrgss_get_id(mrb, self);
  return mrb_int_value(mrb, id ? js_table_get(id, (int32_t)x, (int32_t)y, (int32_t)z) : 0);
}

static mrb_value
m_aset(mrb_state *mrb, mrb_value self)
{
  /* Table supports []=(x, val), []=(x, y, val), []=(x, y, z, val) */
  mrb_value *argv; mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  if (argc < 2) return mrb_nil_value();

  mrb_int x = wrgss_to_int(mrb, argv[0]);
  mrb_int y = 0, z = 0;
  mrb_value valv;

  if (argc == 2) {
    valv = argv[1];
  } else if (argc == 3) {
    y = wrgss_to_int(mrb, argv[1]);
    valv = argv[2];
  } else {
    y = wrgss_to_int(mrb, argv[1]);
    z = wrgss_to_int(mrb, argv[2]);
    valv = argv[3];
  }
  int id = wrgss_get_id(mrb, self);
  if (id) js_table_set(id, (int32_t)x, (int32_t)y, (int32_t)z, wrgss_to_int(mrb, valv));
  return valv;
}

/* Serialization stubs. RGSS uses _dump_data/_load_data protocol, but mruby
 * doesn't have Marshal so Table is serialized via JSON deep_restore instead. */
static mrb_value
m_dump(mrb_state *mrb, mrb_value self)
{
  return mrb_str_new_cstr(mrb, ""); /* no-op */
}

void
wrgss_register_table(mrb_state *mrb)
{
  struct RClass *c = mrb_define_class(mrb, "Table", mrb->object_class);
  mrb_define_method(mrb, c, "initialize", m_initialize, MRB_ARGS_ARG(1, 2));
  mrb_define_method(mrb, c, "dispose",    m_dispose,    MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "resize",     m_resize,     MRB_ARGS_ARG(1, 2));
  mrb_define_method(mrb, c, "xsize",      m_xsize,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "ysize",      m_ysize,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "zsize",      m_zsize,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "[]",         m_aref,       MRB_ARGS_ARG(1, 2));
  mrb_define_method(mrb, c, "[]=",        m_aset,       MRB_ARGS_ANY());
  mrb_define_method(mrb, c, "_dump",      m_dump,       MRB_ARGS_OPT(1));
}
