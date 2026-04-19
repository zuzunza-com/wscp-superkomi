/*
 * rgss_regexp.c — Native Regexp shim delegating to JS RegExp.
 *
 * mruby 3.3 does not bundle the regexp gem, so we expose a minimal native
 * Regexp class that routes through the JS side. This is only used when
 * Ruby-level `/pattern/` literals compile (mrbc does not always support
 * that), so the prelude provides a `WrgssRegexp` helper class too.
 */

#include <mruby.h>
#include <mruby/array.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"
#include "webrgss_imports.h"

static mrb_sym SYM_SRC, SYM_FLAGS;

static mrb_value
m_initialize(mrb_state *mrb, mrb_value self)
{
  mrb_value src; mrb_int flags = 0;
  mrb_get_args(mrb, "S|i", &src, &flags);
  int id = js_regexp_create(mrb_string_cstr(mrb, src), (int32_t)flags);
  if (!id) mrb_raise(mrb, E_ARGUMENT_ERROR, "Invalid Regexp");
  wrgss_set_id(mrb, self, id);
  mrb_iv_set(mrb, self, SYM_SRC, src);
  mrb_iv_set(mrb, self, SYM_FLAGS, mrb_int_value(mrb, flags));
  return self;
}

static mrb_value
m_match(mrb_state *mrb, mrb_value self)
{
  mrb_value str;
  mrb_get_args(mrb, "S", &str);
  int hit = js_regexp_exec(wrgss_get_id(mrb, self), mrb_string_cstr(mrb, str));
  if (!hit) return mrb_nil_value();
  /* Return the matched substring as a String (MatchData stub). */
  int s = js_regexp_match_start();
  int e = js_regexp_match_end();
  const char *c = mrb_string_cstr(mrb, str);
  if (s < 0 || e < s) return mrb_nil_value();
  return mrb_str_new(mrb, c + s, e - s);
}

static mrb_value
m_source(mrb_state *mrb, mrb_value self) { return mrb_iv_get(mrb, self, SYM_SRC); }

void
wrgss_register_regexp(mrb_state *mrb)
{
  SYM_SRC   = mrb_intern_lit(mrb, "@source");
  SYM_FLAGS = mrb_intern_lit(mrb, "@options");
  struct RClass *c = mrb_define_class(mrb, "Regexp", mrb->object_class);
  mrb_define_method(mrb, c, "initialize", m_initialize, MRB_ARGS_ARG(1, 1));
  mrb_define_method(mrb, c, "match",      m_match,      MRB_ARGS_REQ(1));
  mrb_define_method(mrb, c, "source",     m_source,     MRB_ARGS_NONE());
  mrb_define_const(mrb,  c, "IGNORECASE", mrb_int_value(mrb, 1));
  mrb_define_const(mrb,  c, "MULTILINE",  mrb_int_value(mrb, 4));
}
