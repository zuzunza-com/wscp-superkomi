/*
 * rgss_font.c — RGSS Font class.
 *
 * The real per-bitmap font state lives JS-side via js_bitmap_set_font_*.
 * This class is a tiny Ruby-only record whose attributes are stored as
 * instance variables and copied onto Bitmap.font= via the prelude logic.
 *
 * The prelude (scripts/webrgss_prelude.rb) defines a richer Font proxy on
 * top of this that adds "attach_bitmap" and sync!. Here we only provide
 * the minimum native constructor + accessors so that `Font.new` from Ruby
 * doesn't crash before the prelude loads. If the prelude decides to replace
 * the class with a pure-Ruby one, that's fine: mruby allows redefinition.
 */

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"

static mrb_value
m_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_value name = mrb_nil_value();
  mrb_int size = 24;
  mrb_get_args(mrb, "|Si", &name, &size);
  mrb_iv_set(mrb, self, mrb_intern_lit(mrb, "@name"),
             mrb_nil_p(name) ? mrb_str_new_cstr(mrb, "VL Gothic") : name);
  mrb_iv_set(mrb, self, mrb_intern_lit(mrb, "@size"),    mrb_int_value(mrb, size));
  mrb_iv_set(mrb, self, mrb_intern_lit(mrb, "@bold"),    mrb_false_value());
  mrb_iv_set(mrb, self, mrb_intern_lit(mrb, "@italic"),  mrb_false_value());
  mrb_iv_set(mrb, self, mrb_intern_lit(mrb, "@shadow"),  mrb_false_value());
  mrb_iv_set(mrb, self, mrb_intern_lit(mrb, "@outline"), mrb_true_value());
  return self;
}

#define IV_ACCESSOR(field, SYM_LIT)                                          \
static mrb_value m_##field##_get(mrb_state *mrb, mrb_value self) {           \
  return mrb_iv_get(mrb, self, mrb_intern_lit(mrb, SYM_LIT));                \
}                                                                            \
static mrb_value m_##field##_set(mrb_state *mrb, mrb_value self) {           \
  mrb_value v; mrb_get_args(mrb, "o", &v);                                   \
  mrb_iv_set(mrb, self, mrb_intern_lit(mrb, SYM_LIT), v);                    \
  return v;                                                                  \
}
IV_ACCESSOR(name,    "@name")
IV_ACCESSOR(size,    "@size")
IV_ACCESSOR(bold,    "@bold")
IV_ACCESSOR(italic,  "@italic")
IV_ACCESSOR(shadow,  "@shadow")
IV_ACCESSOR(outline, "@outline")
IV_ACCESSOR(color,   "@color")
IV_ACCESSOR(out_color, "@out_color")

void
wrgss_register_font(mrb_state *mrb)
{
  struct RClass *c = mrb_define_class(mrb, "Font", mrb->object_class);
  mrb_define_method(mrb, c, "initialize", m_initialize,    MRB_ARGS_OPT(2));
  mrb_define_method(mrb, c, "name",       m_name_get,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "name=",      m_name_set,      MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "size",       m_size_get,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "size=",      m_size_set,      MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "bold",       m_bold_get,      MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "bold=",      m_bold_set,      MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "italic",     m_italic_get,    MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "italic=",    m_italic_set,    MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "shadow",     m_shadow_get,    MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "shadow=",    m_shadow_set,    MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "outline",    m_outline_get,   MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "outline=",   m_outline_set,   MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "color",      m_color_get,     MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "color=",     m_color_set,     MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "out_color",  m_out_color_get, MRB_ARGS_NONE());
  mrb_define_method(mrb, c, "out_color=", m_out_color_set, MRB_ARGS_REQ(1));
}
