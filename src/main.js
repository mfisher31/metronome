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
// AudioWorklet setup (called once on first Start press)
// ---------------------------------------------------------------------------

async function startAudio() {
  try {
    audioCtx = new AudioContext();

    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
    console.log('[metro] AudioContext state:', audioCtx.state, 'sampleRate:', audioCtx.sampleRate);

    console.log('[metro] loading worklet module...');
    await audioCtx.audioWorklet.addModule('/worklet.js');
    console.log('[metro] worklet module loaded');

    console.log('[metro] fetching WASM...');
    const wasmResp = await fetch('/metronome_web.wasm');
    if (!wasmResp.ok) throw new Error(`WASM fetch failed: ${wasmResp.status}`);
    const wasmBuf = await wasmResp.arrayBuffer();
    console.log('[metro] WASM fetched, sending bytes to worklet');

    workletNode = new AudioWorkletNode(audioCtx, 'metronome-processor', {
      numberOfOutputs: 1,
      outputChannelCount: [2],
    });

    workletNode.port.onmessage = (e) => {
      if (e.data.type === 'ready') {
        console.log('[metro] worklet ready — sending params');
        sendAll();
      }
      if (e.data.type === 'beat') {
        flashBeat(e.data.beatIndex);
      }
      if (e.data.type === 'error') {
        console.error('[metro] worklet error:', e.data.message);
      }
    };

    // Transfer the ArrayBuffer (zero-copy move) to the worklet.
    // Sending a compiled WebAssembly.Module to an AudioWorklet is unreliable
    // across browsers — raw bytes are always safe.
    workletNode.port.postMessage({ type: 'init', wasmBuf }, [wasmBuf]);
    workletNode.connect(audioCtx.destination);
    console.log('[metro] workletNode connected');
  } catch (err) {
    console.error('[metro] startAudio FAILED:', err);
  }
}

async function stopAudio() {
  if (workletNode) {
    workletNode.port.postMessage({ type: 'reset' });
    workletNode.disconnect();
    workletNode = null;
  }
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = null;
  }
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
    dot.className = 'dot' + (i === 0 ? ' accent' : '');
    container.appendChild(dot);
    beatDots.push(dot);
  }
}

let flashTimeout = null;

function flashBeat(index) {
  beatDots.forEach((d, i) => d.classList.toggle('active', i === index));
  clearTimeout(flashTimeout);
  // Auto-clear after ~100 ms so the flash is visible even at fast tempos
  flashTimeout = setTimeout(() => {
    beatDots.forEach((d) => d.classList.remove('active'));
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
    if (running) {
      await stopAudio();
      running = false;
      document.getElementById('btn-start').textContent = 'Start';
      beatDots.forEach((d) => d.classList.remove('active'));
    } else {
      await startAudio();
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
