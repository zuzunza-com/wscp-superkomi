/*
 * webrgss_class.c — shared helpers used by every RGSS class that maps to a
 *                   JavaScript-side registry entry (Bitmap, Sprite, …).
 */

#include <mruby.h>
#include <mruby/variable.h>
#include <mruby/numeric.h>
#include <string.h>

#include "webrgss.h"
#include "webrgss_imports.h"

static mrb_sym s_id_sym_cached = 0;

static mrb_sym
id_sym(mrb_state *mrb)
{
  if (s_id_sym_cached) return s_id_sym_cached;
  s_id_sym_cached = mrb_intern_lit(mrb, "@__wrgss_id");
  return s_id_sym_cached;
}

int32_t
wrgss_get_id(mrb_state *mrb, mrb_value self)
{
  mrb_value v = mrb_iv_get(mrb, self, id_sym(mrb));
  if (mrb_nil_p(v)) return 0;
  if (mrb_fixnum_p(v)) return (int32_t)mrb_fixnum(v);
  if (mrb_integer_p(v)) return (int32_t)mrb_integer(v);
  return 0;
}

void
wrgss_set_id(mrb_state *mrb, mrb_value self, int32_t id)
{
  mrb_iv_set(mrb, self, id_sym(mrb), mrb_int_value(mrb, id));
}

int32_t
wrgss_optint(mrb_state *mrb, mrb_value v, int32_t def)
{
  if (mrb_nil_p(v)) return def;
  if (mrb_fixnum_p(v)) return (int32_t)mrb_fixnum(v);
  if (mrb_integer_p(v)) return (int32_t)mrb_integer(v);
  if (mrb_float_p(v))   return (int32_t)mrb_float(v);
  if (mrb_true_p(v))    return 1;
  if (mrb_false_p(v))   return 0;
  return def;
}

int32_t
wrgss_to_int(mrb_state *mrb, mrb_value v)
{
  if (mrb_fixnum_p(v)) return (int32_t)mrb_fixnum(v);
  if (mrb_integer_p(v)) return (int32_t)mrb_integer(v);
  if (mrb_float_p(v))   return (int32_t)mrb_float(v);
  if (mrb_true_p(v))    return 1;
  if (mrb_false_p(v))   return 0;
  return 0;
}

double
wrgss_to_f(mrb_state *mrb, mrb_value v)
{
  if (mrb_fixnum_p(v)) return (double)mrb_fixnum(v);
  if (mrb_integer_p(v)) return (double)mrb_integer(v);
  if (mrb_float_p(v))   return (double)mrb_float(v);
  return 0.0;
}

/* Master registrar that runs all sub-registrars. */
void
wrgss_register_classes(mrb_state *mrb)
{
  wrgss_register_color(mrb);
  wrgss_register_tone(mrb);
  wrgss_register_rect(mrb);
  wrgss_register_table(mrb);
  wrgss_register_font(mrb);
  wrgss_register_graphics(mrb);
  wrgss_register_input(mrb);
  wrgss_register_audio(mrb);
  wrgss_register_bitmap(mrb);
  wrgss_register_sprite(mrb);
  wrgss_register_viewport(mrb);
  wrgss_register_window(mrb);
  wrgss_register_plane(mrb);
  wrgss_register_tilemap(mrb);
  wrgss_register_regexp(mrb);
  wrgss_register_data(mrb);
}
