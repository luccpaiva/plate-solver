# Build Mindlin plate solver to WebAssembly via Emscripten
# Requires: emsdk (emcc on PATH). Run: source emsdk_env.sh

EMCC ?= emcc
BUILD_DIR = ../public/wasm
OUT_JS = $(BUILD_DIR)/solver.js
OUT_WASM = $(BUILD_DIR)/solver.wasm

CXXFLAGS = -O3 -msimd128 -std=c++17 -Wall -Wextra
EMFLAGS = -s EXPORTED_FUNCTIONS='["_solver_solve","_malloc","_free"]' \
          -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPF64","HEAP32"]' \
          -s MODULARIZE=1 -s EXPORT_NAME='createSolverModule' \
          -s WASM=1 -s INITIAL_MEMORY=256MB \
          -s ENVIRONMENT='web,worker' \
          -s EXPORT_ES6=1

.PHONY: all clean dir

all: dir $(OUT_JS)

dir:
	@mkdir -p $(BUILD_DIR)

$(OUT_JS): solver.cpp solver.h
	$(EMCC) $(CXXFLAGS) solver.cpp -o $(OUT_JS) $(EMFLAGS)
	@echo "Built $(OUT_JS) and $(OUT_WASM)"

clean:
	rm -f $(OUT_JS) $(OUT_WASM)
