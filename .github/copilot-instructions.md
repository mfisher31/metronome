# Copilot Instructions

This is a professional-grade browser metronome. Audio quality and timing precision are non-negotiable. Write code accordingly.

## Architecture

- **Rust (`crates/core`)** — DSP engine. Zero-allocation, `no_std`-compatible. Phase accumulator scheduling, per-sample click synthesis.
- **WASM (`crates/web`)** — C ABI bridge. Exports `engine_new`, `engine_process`, `engine_reset`, and parameter setters.
- **AudioWorklet (`public/worklet.js`)** — Runs on the audio thread. Calls into WASM once per 128-sample block. No allocations in `process()`.
- **Main thread (`src/main.js`)** — UI only. Communicates with the worklet via `postMessage`. Never touches audio scheduling.

## Non-negotiable constraints

- WASM is fetched once at page load and compiled once in the worklet. Do not re-fetch or re-instantiate on Stop/Start.
- The `AudioContext` and `AudioWorkletNode` are created once and kept alive. Stop/Start sends `stop`/`start` messages to the engine — the graph is never torn down.
- `process()` in the worklet must be allocation-free. No array creation, no closures, no object literals.
- All beat scheduling happens inside the Rust engine. The JS layer is passive.
- Cross-origin isolation headers (`COOP: same-origin`, `COEP: require-corp`) are required and must be preserved.

## Code style

- Rust: standard `rustfmt`, no `unsafe` without justification, prefer explicit types in public API.
- JS: ESM modules, no frameworks, no build-time transpilation of worklet code.
- No logging in `process()` or hot paths.
