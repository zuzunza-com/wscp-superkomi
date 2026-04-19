/*
 * rgss_data.c — Global helpers: msgbox, exit, File, Dir, Time.at, Win32API.
 */

#include <mruby.h>
#include <mruby/array.h>
#include <mruby/class.h>
#include <mruby/error.h>
#include <mruby/hash.h>
#include <mruby/string.h>
#include <mruby/variable.h>
#include <mruby/numeric.h>

#include <emscripten.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

#include "webrgss.h"
#include "webrgss_imports.h"

/* Extern: Emscripten-style memory access for strings handed back by JS. */
EM_JS(int, wrgss_js_strlen, (int32_t ptr), {
  if (!ptr) return 0;
  var i = 0;
  while (HEAPU8[ptr + i] !== 0) i++;
  return i;
});

static mrb_value
m_msgbox(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value v = mrb_nil_value();
  mrb_get_args(mrb, "|o", &v);
  if (mrb_nil_p(v)) { js_msgbox(""); return mrb_nil_value(); }
  mrb_value s = mrb_string_p(v) ? v : mrb_funcall(mrb, v, "to_s", 0);
  js_msgbox(mrb_string_cstr(mrb, s));
  return mrb_nil_value();
}

static mrb_value
m_print_p(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value *argv; mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  mrb_value out = mrb_str_new_cstr(mrb, "");
  for (mrb_int i = 0; i < argc; i++) {
    mrb_value s = mrb_funcall(mrb, argv[i], "inspect", 0);
    if (i > 0) mrb_str_cat_lit(mrb, out, " ");
    mrb_str_cat_str(mrb, out, s);
  }
  js_msgbox(mrb_string_cstr(mrb, out));
  return mrb_nil_value();
}

static mrb_value
m_rgss_stop(mrb_state *mrb, mrb_value self) { (void)mrb; (void)self; js_rgss_stop(); return mrb_nil_value(); }

static mrb_value
m_exit(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_int code = 0;
  mrb_get_args(mrb, "|i", &code);
  (void)code;
  js_rgss_stop();
  return mrb_nil_value();
}

/* rgss_main — prelude redefines this to wrap the block in a Fiber. We only
 * need the C side to provide something so that the prelude's alias chain
 * starts from an existing method. */
static mrb_value
m_rgss_main_c(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value blk = mrb_nil_value();
  mrb_get_args(mrb, "&", &blk);
  if (mrb_proc_p(blk)) mrb_yield_argv(mrb, blk, 0, NULL);
  return mrb_nil_value();
}

/* ---------- File ---------- */

static mrb_value
m_file_open(mrb_state *mrb, mrb_value cls)
{
  /* File.open(path[, mode]) { |f| ... } — minimal: read raw bytes as String,
   * pass to the block, return block result; or return the String itself. */
  mrb_value path, mode = mrb_nil_value();
  mrb_value blk = mrb_nil_value();
  mrb_get_args(mrb, "S|o&", &path, &mode, &blk);
  const char *p = mrb_string_cstr(mrb, path);
  const char *m = mrb_string_p(mode) ? mrb_string_cstr(mrb, mode) : "rb";

  mrb_bool is_write = (m && (strchr(m, 'w') != NULL || strchr(m, 'a') != NULL));

  if (is_write) {
    /* Writer: accumulate into Ruby String via block, then js_file_write. */
    mrb_value accum = mrb_str_new_cstr(mrb, "");
    mrb_value ctx = mrb_hash_new(mrb);
    mrb_hash_set(mrb, ctx, mrb_symbol_value(mrb_intern_lit(mrb, "buffer")), accum);
    /* Without a full IO-like class, the block's argument is nil — games
     * that do File.open(path, "wb") { |f| f.write(data) } need f.write
     * behaviour. We emulate with a lightweight Object in Ruby prelude. */
    if (mrb_proc_p(blk)) {
      /* Invoke block with a writer proxy (defined in prelude). */
      mrb_value writer = mrb_funcall(mrb, mrb_obj_value(mrb_class_get(mrb, "WrgssWriter")), "new", 1, accum);
      mrb_yield_argv(mrb, blk, 1, &writer);
    }
    mrb_value str = mrb_iv_get(mrb, ctx, mrb_intern_lit(mrb, "@buffer")); /* unused */
    (void)str;
    /* Final state is in the accum String the block wrote to. */
    const char *data = RSTRING_PTR(accum);
    int len = (int)RSTRING_LEN(accum);
    js_file_write(p, (const uint8_t*)data, len);
    return accum;
  }

  /* Reader */
  int32_t ptr = 0, len = 0;
  int ok = js_file_read(p, &ptr, &len);
  mrb_value data = mrb_nil_value();
  if (ok && ptr) {
    data = mrb_str_new(mrb, (const char*)(intptr_t)ptr, len);
    js_file_free(ptr);
  } else {
    mrb_raise(mrb, E_RUNTIME_ERROR, "cannot open file");
  }

  if (mrb_proc_p(blk)) {
    /* Provide a minimal reader proxy (also defined in prelude). */
    mrb_value reader = mrb_funcall(mrb, mrb_obj_value(mrb_class_get(mrb, "WrgssReader")), "new", 1, data);
    return mrb_yield_argv(mrb, blk, 1, &reader);
  }
  return data;
}

static mrb_value
m_file_exists(mrb_state *mrb, mrb_value cls)
{
  (void)cls;
  mrb_value path; mrb_get_args(mrb, "S", &path);
  return js_file_exists(mrb_string_cstr(mrb, path)) ? mrb_true_value() : mrb_false_value();
}

static mrb_value
m_file_delete(mrb_state *mrb, mrb_value cls)
{
  (void)cls;
  mrb_value *argv; mrb_int argc;
  mrb_get_args(mrb, "*", &argv, &argc);
  for (mrb_int i = 0; i < argc; i++) {
    if (mrb_string_p(argv[i])) js_file_delete(mrb_string_cstr(mrb, argv[i]));
  }
  return mrb_int_value(mrb, argc);
}

static mrb_value
m_file_mtime(mrb_state *mrb, mrb_value cls)
{
  (void)cls;
  mrb_value path; mrb_get_args(mrb, "S", &path);
  int ms = js_file_mtime(mrb_string_cstr(mrb, path));
  /* Return a Time. We rely on Time.at (core gem). */
  struct RClass *time = mrb_class_get(mrb, "Time");
  mrb_value arg = mrb_float_value(mrb, (double)ms / 1000.0);
  return mrb_funcall(mrb, mrb_obj_value(time), "at", 1, arg);
}

/* load_data(path) — native implementation reads the raw bytes and
 * returns a String. The prelude's override performs JSON parsing. */
static mrb_value
m_load_data(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value path; mrb_get_args(mrb, "S", &path);
  int32_t ptr = 0, len = 0;
  int ok = js_file_read(mrb_string_cstr(mrb, path), &ptr, &len);
  if (!ok || !ptr) mrb_raise(mrb, E_RUNTIME_ERROR, "load_data: cannot open file");
  mrb_value data = mrb_str_new(mrb, (const char*)(intptr_t)ptr, len);
  js_file_free(ptr);
  return data;
}

/* save_data(obj, path) — Marshal.dump + js_file_write.
 * Prelude defines Marshal.dump via WRGSS_JSON; here we just write the result. */
static mrb_value
m_save_data(mrb_state *mrb, mrb_value self)
{
  (void)self;
  mrb_value obj, path;
  mrb_get_args(mrb, "oS", &obj, &path);
  struct RClass *marshal = mrb_module_get(mrb, "Marshal");
  mrb_value payload = mrb_funcall(mrb, mrb_obj_value(marshal), "dump", 1, obj);
  if (!mrb_string_p(payload)) return mrb_false_value();
  js_file_write(mrb_string_cstr(mrb, path),
                (const uint8_t*)RSTRING_PTR(payload),
                (int)RSTRING_LEN(payload));
  return mrb_true_value();
}

/* ---------- Dir ---------- */

static mrb_value
m_dir_glob(mrb_state *mrb, mrb_value cls)
{
  (void)cls;
  mrb_value pat; mrb_get_args(mrb, "S", &pat);
  int ptr = js_dir_glob(mrb_string_cstr(mrb, pat));
  mrb_value result = mrb_ary_new(mrb);
  if (!ptr) return result;
  /* The JS side returns a NUL-terminated, newline-joined list. */
  const char *s = (const char*)(intptr_t)ptr;
  const char *p = s;
  while (*p) {
    const char *nl = strchr(p, '\n');
    size_t seg = nl ? (size_t)(nl - p) : strlen(p);
    if (seg > 0) mrb_ary_push(mrb, result, mrb_str_new(mrb, p, seg));
    if (!nl) break;
    p = nl + 1;
  }
  /* NOTE: The pointer remains owned by the JS runtime's heap. We rely on
   * the fact that the JS side uses allocBytes which the caller (here)
   * should free via js_file_free. */
  js_file_free(ptr);
  return result;
}

/* ---------- Time.at passthrough ---------- */

static mrb_value
m_time_at_wrgss(mrb_state *mrb, mrb_value cls)
{
  /* For older RGSS games that explicitly call a native stub. */
  (void)cls;
  mrb_float sec = 0;
  mrb_get_args(mrb, "f", &sec);
  double ms = js_time_at(sec);
  struct RClass *time = mrb_class_get(mrb, "Time");
  return mrb_funcall(mrb, mrb_obj_value(time), "at", 1, mrb_float_value(mrb, ms / 1000.0));
}

/* ---------- Registration ---------- */

void
wrgss_register_data(mrb_state *mrb)
{
  /* Globals */
  mrb_define_method(mrb, mrb->kernel_module, "msgbox",      m_msgbox,      MRB_ARGS_OPT(1));
  mrb_define_method(mrb, mrb->kernel_module, "p",           m_print_p,     MRB_ARGS_ANY());
  mrb_define_method(mrb, mrb->kernel_module, "rgss_stop",   m_rgss_stop,   MRB_ARGS_NONE());
  mrb_define_method(mrb, mrb->kernel_module, "rgss_main",   m_rgss_main_c, MRB_ARGS_BLOCK());
  mrb_define_method(mrb, mrb->kernel_module, "exit",        m_exit,        MRB_ARGS_OPT(1));
  mrb_define_method(mrb, mrb->kernel_module, "load_data",   m_load_data,   MRB_ARGS_REQ(1));
  mrb_define_method(mrb, mrb->kernel_module, "save_data",   m_save_data,   MRB_ARGS_REQ(2));

  /* File (open/exists?/delete/mtime). mruby doesn't have a core File class;
   * we define a trivial one. */
  struct RClass *file = mrb_define_class(mrb, "File", mrb->object_class);
  mrb_define_class_method(mrb, file, "open",    m_file_open,   MRB_ARGS_ARG(1, 2) | MRB_ARGS_BLOCK());
  mrb_define_class_method(mrb, file, "exist?",  m_file_exists, MRB_ARGS_REQ(1));
  mrb_define_class_method(mrb, file, "exists?", m_file_exists, MRB_ARGS_REQ(1));
  mrb_define_class_method(mrb, file, "delete",  m_file_delete, MRB_ARGS_ANY());
  mrb_define_class_method(mrb, file, "mtime",   m_file_mtime,  MRB_ARGS_REQ(1));

  /* Dir.glob */
  struct RClass *dir = mrb_define_class(mrb, "Dir", mrb->object_class);
  mrb_define_class_method(mrb, dir, "glob", m_dir_glob, MRB_ARGS_REQ(1));

  /* Native Time.at is already provided by mruby-time. This is a fallback
   * hook for games that prefer to bypass Ruby semantics. */
  struct RClass *time = mrb_class_get(mrb, "Time");
  mrb_define_class_method(mrb, time, "__wrgss_at_native", m_time_at_wrgss, MRB_ARGS_REQ(1));
}
