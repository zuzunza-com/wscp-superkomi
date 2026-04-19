# webrgss Makefile — runs inside the builder Docker image.
#
# Prereqs (provided by Dockerfile.build):
#   - /src/mruby holds a mruby 3.3 checkout
#   - emsdk activated (emcc, em++, emar on PATH)
#   - /src/build_config.rb is the mruby build config
#
# Outputs (consumed by build.sh copy-out step):
#   build/webrgss.mjs
#   build/webrgss.wasm

MRUBY_DIR    ?= /src/mruby
BUILD_DIR    ?= build

MRUBY_HOST_LIB  := $(MRUBY_DIR)/build/host/lib/libmruby.a
MRUBY_CROSS_LIB := $(MRUBY_DIR)/build/emscripten/lib/libmruby.a
MRBC            := $(MRUBY_DIR)/build/host/bin/mrbc
MRUBY_INC       := -I $(MRUBY_DIR)/include -I $(MRUBY_DIR)/build/emscripten/include

EMCC := emcc
EMAR := emar

CFLAGS := \
  -Os \
  -fPIC \
  -DMRB_INT64 \
  -DMRB_USE_FLOAT32 \
  -DMRB_UTF8_STRING \
  -DWRGSS_BUILD \
  $(MRUBY_INC) \
  -I include \
  -Wno-unused-parameter \
  -Wno-unused-variable \
  -Wno-unused-function \
  -Wno-unused-but-set-variable \
  -Wno-pointer-sign

# --- Sources --------------------------------------------------------------
SRCS := $(wildcard src/*.c)
OBJS := $(SRCS:src/%.c=$(BUILD_DIR)/%.o)

PRELUDE_RB := scripts/webrgss_prelude.rb
PRELUDE_C  := $(BUILD_DIR)/webrgss_prelude.c
PRELUDE_O  := $(BUILD_DIR)/webrgss_prelude.o

# --- Emscripten link flags -----------------------------------------------
EXPORTED_FUNCS := \
  _wrgss_init,\
  _wrgss_exec_script,\
  _wrgss_exec_bytecode,\
  _wrgss_tick,\
  _wrgss_shutdown,\
  _wrgss_debug_tick_probe,\
  _wrgss_debug_game_running,\
  _wrgss_debug_is_fiber,\
  _wrgss_alloc,\
  _wrgss_free,\
  _malloc,\
  _free

EXPORTED_RUNTIME := \
  HEAP8,HEAPU8,HEAP16,HEAPU16,HEAP32,HEAPU32,HEAPF32,HEAPF64,\
  stringToUTF8,UTF8ToString,allocateUTF8,lengthBytesUTF8,\
  writeArrayToMemory,getValue,setValue

LDFLAGS := \
  -Os \
  -sWASM=1 \
  -sMODULARIZE=1 \
  -sEXPORT_ES6=1 \
  -sEXPORT_NAME=createWebRgssModule \
  -sALLOW_MEMORY_GROWTH=1 \
  -sINITIAL_MEMORY=67108864 \
  -sMAXIMUM_MEMORY=536870912 \
  -sASYNCIFY=1 \
  -sASYNCIFY_STACK_SIZE=16384 \
  -sASYNCIFY_IGNORE_INDIRECT=1 \
  -sNO_FILESYSTEM=0 \
  -sENVIRONMENT=web,worker \
  -sEXPORTED_FUNCTIONS='[$(EXPORTED_FUNCS)]' \
  -sEXPORTED_RUNTIME_METHODS='[$(EXPORTED_RUNTIME)]' \
  -sABORTING_MALLOC=0 \
  -sNODERAWFS=0 \
  -sSAFE_HEAP=0 \
  -sSTACK_SIZE=5242880 \
  -sDISABLE_EXCEPTION_CATCHING=0 \
  -sALLOW_TABLE_GROWTH=1 \
  -sDYNAMIC_EXECUTION=0 \
  -sERROR_ON_UNDEFINED_SYMBOLS=0 \
  -sWARN_ON_UNDEFINED_SYMBOLS=0 \
  -sINCOMING_MODULE_JS_API=instantiateWasm,print,printErr,locateFile,noInitialRun,noExitRuntime \
  -lexports.js \
  -Wl,--allow-undefined

# -lexports.js : Emscripten 빌드 시 wasm import/export 이름 minify 비활성화.
#   -Os 최적화에서 MINIFY_WASM_IMPORTS_AND_EXPORTS가 자동 활성화되어
#   `env.js_msgbox` → `a.j` 로 축약되고 JS glue는 `_js_msgbox` abort stub을 생성한다.
#   instantiateWasm 훅에서 풀네임으로 override해도 wasm은 minified 슬롯을 호출하여
#   "Aborted(missing function: js_msgbox)"가 발생하므로, 이 플래그로 minify를 끈다.
#   참고: https://github.com/emscripten-core/emscripten/issues/20762
#         https://github.com/emscripten-core/emscripten/issues/16695

# --- Targets --------------------------------------------------------------
.PHONY: all mruby clean help

all: $(BUILD_DIR)/webrgss.mjs

help:
	@echo "Targets:"
	@echo "  all   -- build webrgss.mjs + webrgss.wasm"
	@echo "  mruby -- build libmruby.a (host + emscripten)"
	@echo "  clean -- remove build/"

$(BUILD_DIR):
	@mkdir -p $@

mruby: $(MRUBY_HOST_LIB) $(MRUBY_CROSS_LIB)

$(MRUBY_HOST_LIB) $(MRUBY_CROSS_LIB) $(MRBC) &:
	@echo "[superkomi] building mruby (host + emscripten cross)"
	cd $(MRUBY_DIR) && MRUBY_CONFIG=/src/build_config.rb rake -j$$(nproc)

$(PRELUDE_C): $(PRELUDE_RB) $(MRBC) | $(BUILD_DIR)
	@echo "[superkomi] compiling prelude $< -> $@"
	$(MRBC) -B wrgss_prelude_irep -o $@ $<

$(PRELUDE_O): $(PRELUDE_C)
	$(EMCC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/%.o: src/%.c include/webrgss.h include/webrgss_imports.h | $(BUILD_DIR)
	$(EMCC) $(CFLAGS) -c $< -o $@

$(BUILD_DIR)/webrgss.mjs: $(OBJS) $(PRELUDE_O) $(MRUBY_CROSS_LIB)
	@echo "[superkomi] linking -> $@"
	$(EMCC) $(LDFLAGS) $(OBJS) $(PRELUDE_O) $(MRUBY_CROSS_LIB) -o $@
	@ls -la $(BUILD_DIR)/webrgss.mjs $(BUILD_DIR)/webrgss.wasm

clean:
	rm -rf $(BUILD_DIR)
