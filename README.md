# Metronome

A browser-based metronome with DSP written in Rust and compiled to WebAssembly.

## Tech

- **Rust** — click synthesizer and beat engine (`metronome-core`). Zero-allocation, no_std-compatible audio code: sine burst with exponential decay envelope, phase accumulator-based beat scheduling.
- **WASM** — Rust compiled to `wasm32-unknown-unknown` via a C ABI. The AudioWorklet holds an opaque pointer to the engine and calls into WASM once per 128-sample block (the Web Audio fixed block size), keeping latency low and click timing sample-accurate.
- **Web Audio API / AudioWorklet** — DSP runs on the dedicated audio thread. The main thread only sends parameter messages (BPM, beats/bar, gain, accent).
- **Vite** — bundles the frontend.
- **nginx** — serves the static build with the `Cross-Origin-Opener-Policy` / `Cross-Origin-Embedder-Policy` headers required by `SharedArrayBuffer` and AudioWorklet cross-origin isolation.

## Build & run locally

**Prerequisites:** Docker

```bash
docker build -t metronome .
docker run --rm -p 8080:8080 metronome
```

Open http://localhost:8080.

## Dev (without Docker)

**Prerequisites:** Rust, `wasm32-unknown-unknown` target, Node 20+

```bash
rustup target add wasm32-unknown-unknown
npm install
npm run dev
```
