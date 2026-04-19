/*
 * rgss_input.c — Input module.
 *
 * Converts Ruby button symbols (:A, :B, :DOWN, …) into the numeric codes
 * that the JS bridge understands, and exposes the press/trigger/repeat/dir
 * APIs used by every RGSS game.
 */

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>
#include <string.h>

#include "webrgss.h"
#include "webrgss_imports.h"

/* Symbol → code: MUST match WasmRgssBridge.ts codeToSym() and
 * the JS InputState key names. */
static int32_t
sym_to_code(const char *s)
{
  if (!s) return 0;
  if (!strcmp(s, "DOWN"))  return 2;
  if (!strcmp(s, "LEFT"))  return 4;
  if (!strcmp(s, "RIGHT")) return 6;
  if (!strcmp(s, "UP"))    return 8;
  if (!strcmp(s, "A")) return 11;
  if (!strcmp(s, "B")) return 12;
  if (!strcmp(s, "C")) return 13;
  if (!strcmp(s, "X")) return 14;
  if (!strcmp(s, "Y")) return 15;
  if (!strcmp(s, "Z")) return 16;
  if (!strcmp(s, "L")) return 17;
  if (!strcmp(s, "R")) return 18;
  if (!strcmp(s, "SHIFT")) return 21;
  if (!strcmp(s, "CTRL"))  return 22;
  if (!strcmp(s, "ALT"))   return 23;
  if (!strcmp(s, "F5")) return 25;
  if (!strcmp(s, "F6")) return 26;
  if (!strcmp(s, "F7")) return 27;
  if (!strcmp(s, "F8")) return 28;
  if (!strcmp(s, "F9")) return 29;
  return 0;
}

static int32_t
arg_to_code(mrb_state *mrb, mrb_value v)
{
  if (mrb_symbol_p(v))       return sym_to_code(mrb_sym_name(mrb, mrb_symbol(v)));
  if (mrb_string_p(v))       return sym_to_code(mrb_string_cstr(mrb, v));
  if (mrb_fixnum_p(v))       return (int32_t)mrb_fixnum(v);
  if (mrb_integer_p(v))      return (int32_t)mrb_integer(v);
  return 0;
}

static mrb_value
m_update(mrb_state *mrb, mrb_value self)
{
  (void)mrb; (void)self;
  /* js_graphics_update bumps InputState.update; Input.update is a no-op
   * on our side because the JS side flushes state every frame. */
  return mrb_nil_value();
}

static mrb_value
m_press(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value v; mrb_get_args(mrb, "o", &v);
  return js_input_press(arg_to_code(mrb, v)) ? mrb_true_value() : mrb_false_value();
}

static mrb_value
m_trigger(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value v; mrb_get_args(mrb, "o", &v);
  return js_input_trigger(arg_to_code(mrb, v)) ? mrb_true_value() : mrb_false_value();
}

static mrb_value
m_repeat(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value v; mrb_get_args(mrb, "o", &v);
  return js_input_repeat(arg_to_code(mrb, v)) ? mrb_true_value() : mrb_false_value();
}

static mrb_value m_dir4(mrb_state *mrb, mrb_value self) { (void)self; return mrb_int_value(mrb, js_input_dir4()); }
static mrb_value m_dir8(mrb_state *mrb, mrb_value self) { (void)self; return mrb_int_value(mrb, js_input_dir8()); }

void
wrgss_register_input(mrb_state *mrb)
{
  struct RClass *m = mrb_define_module(mrb, "Input");
  mrb_define_module_function(mrb, m, "update",   m_update,  MRB_ARGS_NONE());
  mrb_define_module_function(mrb, m, "press?",   m_press,   MRB_ARGS_REQ(1));
  mrb_define_module_function(mrb, m, "trigger?", m_trigger, MRB_ARGS_REQ(1));
  mrb_define_module_function(mrb, m, "repeat?",  m_repeat,  MRB_ARGS_REQ(1));
  mrb_define_module_function(mrb, m, "dir4",     m_dir4,    MRB_ARGS_NONE());
  mrb_define_module_function(mrb, m, "dir8",     m_dir8,    MRB_ARGS_NONE());
}
