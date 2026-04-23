use std::f64::consts::TAU;

// ---------------------------------------------------------------------------
// ClickSynth
// ---------------------------------------------------------------------------

/// Single-voice click synthesizer.
///
/// Sine burst with an exponential decay envelope. All state is plain scalar —
/// zero allocation, safe to live on any audio thread (CLAP or AudioWorklet).
pub struct ClickSynth {
    envelope: f64,
    decay_coeff: f64,
    osc_phase: f64,
    osc_increment: f64,
    active: bool,
}

impl ClickSynth {
    pub const fn new() -> Self {
        Self {
            envelope: 0.0,
            decay_coeff: 0.0,
            osc_phase: 0.0,
            osc_increment: 0.0,
            active: false,
        }
    }

    /// Trigger a click.
    ///
    /// - `accent`      : beat-1 accent — higher pitch and amplitude
    /// - `sample_rate` : current audio sample rate in Hz
    /// - `gain`        : linear output gain applied to peak amplitude
    pub fn trigger(&mut self, accent: bool, sample_rate: f32, gain: f32) {
        let freq = if accent { 1500.0_f64 } else { 1000.0_f64 };
        let peak = if accent { 1.0_f64 } else { 0.8_f64 } * gain as f64;
        let decay_ms = if accent { 60.0_f64 } else { 40.0_f64 };
        let decay_samples = decay_ms * 0.001 * sample_rate as f64;

        // 0.001^(1/N) — envelope falls to -60 dB in exactly decay_samples
        self.decay_coeff = 0.001_f64.powf(1.0 / decay_samples);
        self.osc_increment = TAU * freq / sample_rate as f64;
        self.osc_phase = 0.0;
        self.envelope = peak;
        self.active = true;
    }

    /// Advance one sample and return the output value. Hot path.
    #[inline(always)]
    pub fn next_sample(&mut self) -> f32 {
        if !self.active {
            return 0.0;
        }

        let out = (self.osc_phase.sin() * self.envelope) as f32;

        self.osc_phase += self.osc_increment;
        if self.osc_phase >= TAU {
            self.osc_phase -= TAU;
        }

        self.envelope *= self.decay_coeff;

        if self.envelope < 1.0e-6 {
            self.active = false;
            self.envelope = 0.0;
        }

        out
    }

    pub fn reset(&mut self) {
        self.envelope = 0.0;
        self.osc_phase = 0.0;
        self.active = false;
    }
}

// ---------------------------------------------------------------------------
// BeatEngine
// ---------------------------------------------------------------------------

/// Phase-accumulator beat engine.
///
/// Advances `bpm / (60 * sample_rate)` per sample. When the phase crosses
/// 1.0 a beat fires at that exact sample. The fractional overshoot carries
/// forward so long-run accuracy is perfect regardless of buffer size.
pub struct BeatEngine {
    beat_phase: f64,
    pub beat_index: u32,
    beats_per_bar: u32,
    phase_inc: f64,
    sample_rate: f32,
}

impl BeatEngine {
    pub fn new(sample_rate: f32) -> Self {
        let bpm = 120.0_f64;
        Self {
            beat_phase: 0.0,
            beat_index: 0,
            beats_per_bar: 4,
            phase_inc: bpm / (60.0 * sample_rate as f64),
            sample_rate,
        }
    }

    pub fn sample_rate(&self) -> f32 {
        self.sample_rate
    }

    pub fn set_bpm(&mut self, bpm: f64) {
        self.phase_inc = bpm / (60.0 * self.sample_rate as f64);
    }

    pub fn set_beats_per_bar(&mut self, n: u32) {
        self.beats_per_bar = n.max(1);
    }

    /// Advance one sample. Returns `Some(beat_index)` when a beat fires.
    #[inline(always)]
    pub fn advance(&mut self) -> Option<u32> {
        self.beat_phase += self.phase_inc;
        if self.beat_phase >= 1.0 {
            self.beat_phase -= 1.0;
            let idx = self.beat_index;
            self.beat_index = (self.beat_index + 1) % self.beats_per_bar;
            Some(idx)
        } else {
            None
        }
    }

    pub fn reset(&mut self) {
        self.beat_phase = 0.0;
        self.beat_index = 0;
    }
}
