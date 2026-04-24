/**
 * worklet.js — AudioWorkletProcessor
 *
 * The DSP runs entirely in Rust/WASM. engine_process() fills a 128-sample
 * buffer inside WASM linear memory — JS just copies the result into the
 * Web Audio output buffer. One WASM call per block, not per sample.
 */

const NO_BEAT = 0xFF;

class MetronomeProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._wasm    = null;
    this._ptr     = 0;
    this._running = false;
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  async _handleMessage(msg) {
    try {
      switch (msg.type) {
        case 'init': {
          // Compile + instantiate from raw bytes inside the AudioWorklet scope.
          // Sending a WebAssembly.Module across the postMessage boundary to an
          // AudioWorklet is unreliable — bytes are always transferable.
          const { instance } = await WebAssembly.instantiate(msg.wasmBuf);
          this._wasm = instance.exports;

          console.log('[worklet] exports:', Object.keys(this._wasm));
          console.log('[worklet] memory exported:', !!this._wasm.memory);
          console.log('[worklet] sampleRate:', sampleRate);

          this._ptr = this._wasm.engine_new(sampleRate);
          console.log('[worklet] ptr:', this._ptr);

          this.port.postMessage({ type: 'ready' });
          break;
        }
        case 'set_bpm':           this._wasm?.engine_set_bpm(this._ptr, msg.value); break;
        case 'set_beats_per_bar': this._wasm?.engine_set_beats_per_bar(this._ptr, msg.value); break;
        case 'set_gain':          this._wasm?.engine_set_gain(this._ptr, msg.value); break;
        case 'set_accent':        this._wasm?.engine_set_accent(this._ptr, msg.value ? 1 : 0); break;
        case 'start':             this._running = true; break;
        case 'stop':              this._running = false; this._wasm?.engine_reset(this._ptr); break;
        case 'reset':             this._running = false; this._wasm?.engine_reset(this._ptr); break;
      }
    } catch (err) {
      console.error('[worklet] init error:', err);
      this.port.postMessage({ type: 'error', message: String(err) });
    }
  }

  process(_inputs, outputs) {
    if (!this._wasm || !this._ptr) return true;

    const outL = outputs[0]?.[0];
    const outR = outputs[0]?.[1];
    if (!outL) return true;

    if (!this._running) {
      outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    // Run the full 128-sample block in WASM — phase accumulator + click synth.
    // Returns the beat index that fired this block, or 0xFF if none.
    const beatFired = this._wasm.engine_process(this._ptr);

    // Get byte offset of the output buffer inside WASM linear memory.
    // We create the Float32Array view each block because WASM memory.buffer
    // can be replaced if the heap grows (would detach a cached view).
    const outByteOffset = this._wasm.engine_output_ptr(this._ptr);
    const wasmOut = new Float32Array(this._wasm.memory.buffer, outByteOffset, 128);

    outL.set(wasmOut);
    if (outR) outR.set(wasmOut);

    if (beatFired !== NO_BEAT) {
      this.port.postMessage({ type: 'beat', beatIndex: beatFired });
    }

    return true;
  }
}

registerProcessor('metronome-processor', MetronomeProcessor);
