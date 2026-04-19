/*
 * rgss_audio.c — Audio module.
 *
 * Each method is a thin shim to the JS-side api/Audio. The prelude wraps
 * these again inside RPG::BGM/BGS/ME/SE classes so that legacy code using
 * RPG::BGM.new(...).play works without modification.
 */

#include <mruby.h>
#include <mruby/class.h>
#include <mruby/string.h>
#include <mruby/variable.h>

#include "webrgss.h"
#include "webrgss_imports.h"

static mrb_value
m_bgm_play(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value name; mrb_int volume = 100, pitch = 100, pos = 0;
  mrb_get_args(mrb, "S|iii", &name, &volume, &pitch, &pos);
  js_audio_bgm_play(mrb_string_cstr(mrb, name), (int32_t)volume, (int32_t)pitch, (int32_t)pos);
  return mrb_nil_value();
}
static mrb_value m_bgm_stop(mrb_state *mrb, mrb_value self) { (void)self; js_audio_bgm_stop(); return mrb_nil_value(); }
static mrb_value
m_bgm_fade(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int t = 0; mrb_get_args(mrb, "i", &t);
  js_audio_bgm_fade((int32_t)t); return mrb_nil_value();
}
static mrb_value m_bgm_pos(mrb_state *mrb, mrb_value self) { (void)self; return mrb_int_value(mrb, js_audio_bgm_pos()); }

static mrb_value
m_bgs_play(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value name; mrb_int volume = 100, pitch = 100, pos = 0;
  mrb_get_args(mrb, "S|iii", &name, &volume, &pitch, &pos);
  js_audio_bgs_play(mrb_string_cstr(mrb, name), (int32_t)volume, (int32_t)pitch, (int32_t)pos);
  return mrb_nil_value();
}
static mrb_value m_bgs_stop(mrb_state *mrb, mrb_value self) { (void)self; js_audio_bgs_stop(); return mrb_nil_value(); }
static mrb_value
m_bgs_fade(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int t = 0; mrb_get_args(mrb, "i", &t);
  js_audio_bgs_fade((int32_t)t); return mrb_nil_value();
}
static mrb_value m_bgs_pos(mrb_state *mrb, mrb_value self) { (void)self; return mrb_int_value(mrb, js_audio_bgs_pos()); }

static mrb_value
m_me_play(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value name; mrb_int volume = 100, pitch = 100;
  mrb_get_args(mrb, "S|ii", &name, &volume, &pitch);
  js_audio_me_play(mrb_string_cstr(mrb, name), (int32_t)volume, (int32_t)pitch);
  return mrb_nil_value();
}
static mrb_value m_me_stop(mrb_state *mrb, mrb_value self) { (void)self; js_audio_me_stop(); return mrb_nil_value(); }
static mrb_value
m_me_fade(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int t = 0; mrb_get_args(mrb, "i", &t);
  js_audio_me_fade((int32_t)t); return mrb_nil_value();
}

static mrb_value
m_se_play(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value name; mrb_int volume = 100, pitch = 100;
  mrb_get_args(mrb, "S|ii", &name, &volume, &pitch);
  js_audio_se_play(mrb_string_cstr(mrb, name), (int32_t)volume, (int32_t)pitch);
  return mrb_nil_value();
}
static mrb_value m_se_stop(mrb_state *mrb, mrb_value self) { (void)self; js_audio_se_stop(); return mrb_nil_value(); }

static mrb_value m_setup_midi(mrb_state *mrb, mrb_value self) { (void)mrb; (void)self; return mrb_nil_value(); }

void
wrgss_register_audio(mrb_state *mrb)
{
  struct RClass *m = mrb_define_module(mrb, "Audio");
#define F(n, fn, args) mrb_define_module_function(mrb, m, n, fn, args)
  F("bgm_play", m_bgm_play, MRB_ARGS_ARG(1, 3));
  F("bgm_stop", m_bgm_stop, MRB_ARGS_NONE());
  F("bgm_fade", m_bgm_fade, MRB_ARGS_REQ(1));
  F("bgm_pos",  m_bgm_pos,  MRB_ARGS_NONE());
  F("bgs_play", m_bgs_play, MRB_ARGS_ARG(1, 3));
  F("bgs_stop", m_bgs_stop, MRB_ARGS_NONE());
  F("bgs_fade", m_bgs_fade, MRB_ARGS_REQ(1));
  F("bgs_pos",  m_bgs_pos,  MRB_ARGS_NONE());
  F("me_play",  m_me_play,  MRB_ARGS_ARG(1, 2));
  F("me_stop",  m_me_stop,  MRB_ARGS_NONE());
  F("me_fade",  m_me_fade,  MRB_ARGS_REQ(1));
  F("se_play",  m_se_play,  MRB_ARGS_ARG(1, 2));
  F("se_stop",  m_se_stop,  MRB_ARGS_NONE());
  F("setup_midi", m_setup_midi, MRB_ARGS_NONE());
#undef F
}
