#![allow(private_interfaces)]

use metronome_core::{BeatEngine, ClickSynth};

/// AudioWorklet process() always delivers exactly 128 frames.
const BLOCK_SIZE: usize = 128;

/// Sentinel returned by `engine_process` when no beat fired this block.
const NO_BEAT: u32 = 0xFF;

// ---------------------------------------------------------------------------
// Engine — heap-allocated so its address is stable across calls.
//
// The AudioWorklet on the JS side holds an opaque integer pointer to this
// struct. The type is intentionally private; callers only hold the raw pointer
// and call through the C ABI functions below (opaque pointer pattern).
// ---------------------------------------------------------------------------

struct Engine {
    beat_engine: BeatEngine,
    click: ClickSynth,
    gain: f32,
    accent: bool,
    /// Output buffer embedded in the struct. engine_output_ptr() returns a
    /// pointer into this field. Because the struct lives in a Box the address
    /// is stable for the lifetime of the engine — WASM memory never moves.
    output_buf: [f32; BLOCK_SIZE],
}

impl Engine {
    fn new(sample_rate: f32) -> Self {
        Self {
            beat_engine: BeatEngine::new(sample_rate),
            click: ClickSynth::new(),
            gain: 1.0,
            accent: true,
            output_buf: [0.0; BLOCK_SIZE],
        }
    }

    /// Fill `output_buf` with one block of audio.
    ///
    /// Returns the beat index (0-based) of any beat that fired this block,
    /// or `NO_BEAT` if the block was silent.
    fn process_block(&mut self) -> u32 {
        let mut fired = NO_BEAT;

        for i in 0..BLOCK_SIZE {
            if let Some(beat_idx) = self.beat_engine.advance() {
                let is_accent = self.accent && beat_idx == 0;
                self.click
                    .trigger(is_accent, self.beat_engine.sample_rate(), self.gain);
                fired = beat_idx;
            }
            self.output_buf[i] = self.click.next_sample();
        }

        fired
    }
}

// ---------------------------------------------------------------------------
// Public C ABI — called from the AudioWorkletProcessor via WASM exports.
// All functions are unsafe because they dereference raw pointers.
// ---------------------------------------------------------------------------

/// Allocate a new engine. Returns an opaque pointer the caller must store and
/// pass back to every other API function. Never returns null.
#[no_mangle]
pub extern "C" fn engine_new(sample_rate: f32) -> *mut Engine {
    Box::into_raw(Box::new(Engine::new(sample_rate)))
}

/// Free the engine. Must not be called more than once.
///
/// # Safety
/// `ptr` must be a live pointer previously returned by `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_free(ptr: *mut Engine) {
    drop(Box::from_raw(ptr));
}

/// Process one 128-sample block. Fills the internal output buffer and returns
/// the beat index that fired (0-based), or 0xFF if no beat this block.
///
/// # Safety
/// `ptr` must be a live pointer previously returned by `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_process(ptr: *mut Engine) -> u32 {
    (*ptr).process_block()
}

/// Return a byte offset into WASM linear memory pointing at the 128-float
/// output buffer. JS creates a Float32Array view over this once per block
/// after calling engine_process(). Memory is exported via --export-memory.
///
/// # Safety
/// `ptr` must be a live pointer previously returned by `engine_new`.
#[no_mangle]
pub unsafe extern "C" fn engine_output_ptr(ptr: *const Engine) -> *const f32 {
    (*ptr).output_buf.as_ptr()
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_bpm(ptr: *mut Engine, bpm: f64) {
    (*ptr).beat_engine.set_bpm(bpm);
}

#[no_mangle]
pub unsafe extern "C" fn engine_set_beats_per_bar(ptr: *mut Engine, n: u32) {
    (*ptr).beat_engine.set_beats_per_bar(n);
}

/// gain is a linear multiplier (0.0–1.0)
#[no_mangle]
pub unsafe extern "C" fn engine_set_gain(ptr: *mut Engine, gain: f32) {
    (*ptr).gain = gain.clamp(0.0, 1.0);
}

/// accent: non-zero = enabled
#[no_mangle]
pub unsafe extern "C" fn engine_set_accent(ptr: *mut Engine, accent: u32) {
    (*ptr).accent = accent != 0;
}

#[no_mangle]
pub unsafe extern "C" fn engine_reset(ptr: *mut Engine) {
    (*ptr).beat_engine.reset();
    (*ptr).click.reset();
}
