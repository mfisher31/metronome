/**
 * main.js — UI controller
 *
 * Owns the AudioContext and AudioWorkletNode. All DSP runs inside the
 * AudioWorklet (audio thread). Communication is one-way parameter messages —
 * the main thread never touches audio scheduling.
 */

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

// Pre-fetch WASM once at page load — no user gesture required for fetch.
// Compile + instantiate happens inside the AudioWorklet on first Start.
const wasmReady = fetch('/metronome_web.wasm').then((r) => {
  if (!r.ok) throw new Error(`WASM fetch failed: ${r.status}`);
  return r.arrayBuffer();
});

let audioCtx   = null;
let workletNode = null;
let running    = false;

let bpm         = 120;
let beatsPerBar = 4;
let gain        = 1.0;
let accentBeat1 = true;

// Tap tempo
const tapTimes = [];
const TAP_WINDOW_MS = 3000; // reset tap buffer after 3 s of silence

// ---------------------------------------------------------------------------
// AudioWorklet setup — called once on first Start press
// ---------------------------------------------------------------------------

async function initAudio() {
  audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') await audioCtx.resume();

  await audioCtx.audioWorklet.addModule('/worklet.js');

  workletNode = new AudioWorkletNode(audioCtx, 'metronome-processor', {
    numberOfOutputs: 1,
    outputChannelCount: [2],
  });

  workletNode.port.onmessage = (e) => {
    if (e.data.type === 'ready') {
      // Engine compiled and running — send params then start ticking.
      sendAll();
      send({ type: 'start' });
      running = true;
      document.getElementById('btn-start').textContent = 'Stop';
    }
    if (e.data.type === 'beat') flashBeat(e.data.beatIndex);
    if (e.data.type === 'error') console.error('[metro] worklet error:', e.data.message);
  };

  // WASM was pre-fetched — transfer the already-downloaded bytes (zero-copy).
  const wasmBuf = await wasmReady;
  workletNode.port.postMessage({ type: 'init', wasmBuf }, [wasmBuf]);
  workletNode.connect(audioCtx.destination);
}

// ---------------------------------------------------------------------------
// Param helpers
// ---------------------------------------------------------------------------

function send(msg) {
  workletNode?.port.postMessage(msg);
}

function sendAll() {
  send({ type: 'set_bpm',          value: bpm });
  send({ type: 'set_beats_per_bar', value: beatsPerBar });
  send({ type: 'set_gain',         value: gain });
  send({ type: 'set_accent',       value: accentBeat1 });
}

// ---------------------------------------------------------------------------
// Beat indicator
// ---------------------------------------------------------------------------

let beatDots = [];

function buildBeatDots(n) {
  const container = document.getElementById('beat-dots');
  container.innerHTML = '';
  beatDots = [];
  for (let i = 0; i < n; i++) {
    const dot = document.createElement('div');
    dot.className = 'metro-dot' + (i === 0 ? ' metro-accent' : '');
    container.appendChild(dot);
    beatDots.push(dot);
  }
}

let flashTimeout = null;

function flashBeat(index) {
  beatDots.forEach((d, i) => d.classList.toggle('metro-active', i === index));
  clearTimeout(flashTimeout);
  // Auto-clear after ~100 ms so the flash is visible even at fast tempos
  flashTimeout = setTimeout(() => {
    beatDots.forEach((d) => d.classList.remove('metro-active'));
  }, 100);
}

// ---------------------------------------------------------------------------
// Tap tempo
// ---------------------------------------------------------------------------

function handleTap() {
  const now = performance.now();

  // Flush old taps
  while (tapTimes.length && now - tapTimes[0] > TAP_WINDOW_MS) {
    tapTimes.shift();
  }

  tapTimes.push(now);

  if (tapTimes.length < 2) return;

  // Average the intervals between consecutive taps
  let totalInterval = 0;
  for (let i = 1; i < tapTimes.length; i++) {
    totalInterval += tapTimes[i] - tapTimes[i - 1];
  }
  const avgInterval = totalInterval / (tapTimes.length - 1);
  const tapped = Math.round(60000 / avgInterval);

  bpm = Math.min(300, Math.max(20, tapped));
  updateBpmUI();
  send({ type: 'set_bpm', value: bpm });
}

// ---------------------------------------------------------------------------
// UI wiring
// ---------------------------------------------------------------------------

function updateBpmUI() {
  document.getElementById('bpm-number').value = bpm;
  document.getElementById('bpm-slider').value = bpm;
}

document.addEventListener('DOMContentLoaded', () => {
  buildBeatDots(beatsPerBar);

  // Start / Stop
  document.getElementById('btn-start').addEventListener('click', async () => {
    if (!workletNode) {
      // First press — initialize the audio graph and load WASM.
      // UI update happens in the 'ready' message handler.
      await initAudio();
    } else if (running) {
      send({ type: 'stop' });
      running = false;
      document.getElementById('btn-start').textContent = 'Start';
      beatDots.forEach((d) => d.classList.remove('metro-active'));
    } else {
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      sendAll();
      send({ type: 'start' });
      running = true;
      document.getElementById('btn-start').textContent = 'Stop';
    }
  });

  // BPM slider
  document.getElementById('bpm-slider').addEventListener('input', (e) => {
    bpm = Number(e.target.value);
    document.getElementById('bpm-number').value = bpm;
    send({ type: 'set_bpm', value: bpm });
  });

  // BPM number input
  document.getElementById('bpm-number').addEventListener('change', (e) => {
    bpm = Math.min(300, Math.max(20, Number(e.target.value)));
    updateBpmUI();
    send({ type: 'set_bpm', value: bpm });
  });

  // Tap tempo
  document.getElementById('btn-tap').addEventListener('click', handleTap);
  // Space bar also taps
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && e.target.tagName !== 'INPUT') {
      e.preventDefault();
      handleTap();
    }
  });

  // Beats per bar
  document.getElementById('beats-per-bar').addEventListener('change', (e) => {
    beatsPerBar = Number(e.target.value);
    buildBeatDots(beatsPerBar);
    send({ type: 'set_beats_per_bar', value: beatsPerBar });
  });

  // Gain
  document.getElementById('gain-slider').addEventListener('input', (e) => {
    gain = Number(e.target.value);
    send({ type: 'set_gain', value: gain });
  });

  // Accent
  document.getElementById('accent-toggle').addEventListener('change', (e) => {
    accentBeat1 = e.target.checked;
    send({ type: 'set_accent', value: accentBeat1 });
  });
});
