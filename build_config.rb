# mruby build_config.rb — used by `rake` inside the builder Docker image.
#
# Two targets:
#   - host       : native build of mrbc and libmruby.a (so we can compile
#                  scripts/webrgss_prelude.rb to embed in the WASM).
#   - emscripten : cross build of libmruby.a compiled with emcc/em++ so
#                  we can link it into webrgss.wasm.
#
# Environment assumed:
#   - Debian 12 host with gcc/clang
#   - emsdk activated (emcc, em++, emar on PATH)

MRuby::Build.new do |conf|
  toolchain :gcc
  conf.enable_debug

  # Essential core gems. The host binary only needs mruby-bin-mrbc so we can
  # pre-compile .rb files into the WASM build.
  conf.gembox 'default'
end

MRuby::CrossBuild.new('emscripten') do |conf|
  toolchain :clang
  conf.cc.command     = 'emcc'
  conf.cxx.command    = 'em++'
  conf.linker.command = 'emcc'
  conf.archiver.command = 'emar'

  # -fPIC keeps relocatable object; final link applies asyncify.
  # mruby 3.3 moved UTF-8 string support from `mruby-string-utf8` core gem to
  # the MRB_UTF8_STRING macro. RGSS3 scripts assume UTF-8-aware String#length.
  common = %w[
    -Os
    -fPIC
    -DMRB_INT64
    -DMRB_USE_FLOAT32
    -DMRB_UTF8_STRING
    -DMRB_USE_DEBUG_HOOK
  ]
  conf.cc.flags  = common
  conf.cxx.flags = common
  conf.linker.flags = %w[-Os]

  # We link libmruby.a into our own emcc command line, so we don't need the
  # cross build to produce an executable. The `build_mrbtest_lib_only`
  # pattern was in old configs; the current way is to simply not list any
  # `mruby-bin-*` gems here.
  conf.gem core: 'mruby-array-ext'
  conf.gem core: 'mruby-class-ext'
  conf.gem core: 'mruby-compiler'
  conf.gem core: 'mruby-data'
  conf.gem core: 'mruby-enum-ext'
  conf.gem core: 'mruby-enum-lazy'
  conf.gem core: 'mruby-enumerator'
  conf.gem core: 'mruby-error'
  conf.gem core: 'mruby-eval'
  conf.gem core: 'mruby-exit'
  conf.gem core: 'mruby-fiber'
  conf.gem core: 'mruby-hash-ext'
  conf.gem core: 'mruby-kernel-ext'
  conf.gem core: 'mruby-math'
  conf.gem core: 'mruby-metaprog'
  conf.gem core: 'mruby-method'
  conf.gem core: 'mruby-numeric-ext'
  conf.gem core: 'mruby-object-ext'
  conf.gem core: 'mruby-objectspace'
  conf.gem core: 'mruby-pack'
  conf.gem core: 'mruby-print'
  conf.gem core: 'mruby-proc-ext'
  conf.gem core: 'mruby-random'
  conf.gem core: 'mruby-range-ext'
  conf.gem core: 'mruby-rational'
  conf.gem core: 'mruby-sleep'
  conf.gem core: 'mruby-sprintf'
  conf.gem core: 'mruby-string-ext'
  conf.gem core: 'mruby-struct'
  conf.gem core: 'mruby-symbol-ext'
  conf.gem core: 'mruby-time'
  conf.gem core: 'mruby-toplevel-ext'
end
