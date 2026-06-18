import { deriveProfile, archetypeFor } from './profile-derive.js';

const STEPS = [
  {
    id: 'warmup', title: 'Warm-up', discard: true, compose: false, min: 40,
    instruction: 'Just to settle in — type this once. (We throw this one away.)',
    target: 'The quiet fox waits by the river as the morning light spills over the hills.',
  },
  {
    id: 'baseline', title: 'Your natural pace', compose: false, min: 120,
    instruction: 'Type this at a comfortable, normal speed.',
    target: 'It was clear by the time we got there that the others had already left. She told me not to worry about it, so I tried my best to relax and enjoy the rest of the afternoon.',
  },
  {
    id: 'bigram', title: 'Letter transitions', compose: false, min: 120,
    instruction: 'A bit of a tongue-twister — type it just as it reads.',
    target: 'The thing in the other room is that the singer is bringing in another string of songs, and then there is nothing in the thinking that things are interesting.',
  },
  {
    id: 'errors', title: 'Slips and fixes', compose: false, min: 70,
    instruction: 'Tricky words ahead — fix any mistakes however you normally would.',
    target: 'Worcestershire and mischievous rhythms are genuinely unwieldy; pronounce them anyway.',
  },
  {
    id: 'burst', title: 'In your own words', compose: true, min: 80,
    instruction: 'No copying here — write 2–3 sentences about what you did last weekend.',
    target: '',
  },
];

const $ = (id) => document.getElementById(id);
let stepIndex = 0;
let currentEvents = [];
const captured = [];

// ---- live waveform ----
let waveBars = [];
let lastKeyT = 0;

function pushWave(intervalMs) {
  const h = Math.max(0.08, Math.min(1, 1 - intervalMs / 700));
  waveBars.push(h);
  if (waveBars.length > 140) waveBars.shift();
}

function drawWave(canvas, bars) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width;
  const hgt = canvas.height;
  ctx.clearRect(0, 0, w, hgt);
  if (!bars.length) return;
  const grad = ctx.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, '#7c8cff');
  grad.addColorStop(1, '#4ad1c8');
  ctx.fillStyle = grad;
  const slot = w / Math.max(bars.length, 60);
  const bw = Math.max(2, slot * 0.6);
  bars.forEach((b, i) => {
    const bh = b * (hgt - 16);
    const x = i * slot;
    const y = (hgt - bh) / 2;
    ctx.fillRect(x, y, bw, bh);
  });
}

// ---- capture ----
function onKey(e) {
  const t = performance.now();
  currentEvents.push({
    key: e.key, code: e.code, type: e.type === 'keydown' ? 'down' : 'up',
    t, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
  });
  if (e.type === 'keydown') {
    const dt = lastKeyT ? t - lastKeyT : 300;
    lastKeyT = t;
    pushWave(dt);
    drawWave($('wave'), waveBars);
  }
  updateProgress();
}

function updateProgress() {
  const step = STEPS[stepIndex];
  const len = $('input').value.length;
  const pct = Math.min(100, Math.round((len / step.min) * 100));
  $('progress-bar').style.width = pct + '%';
  $('next').disabled = len < step.min;
}

// ---- flow ----
function showScreen(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  $(id).classList.add('active');
}

function loadStep() {
  const step = STEPS[stepIndex];
  $('ex-step').textContent = `Step ${stepIndex + 1} / ${STEPS.length}`;
  $('ex-title').textContent = step.title;
  $('ex-instruction').textContent = step.instruction;
  $('target').textContent = step.target;
  $('input').value = '';
  $('next').textContent = stepIndex === STEPS.length - 1 ? 'Finish' : 'Next';
  currentEvents = [];
  waveBars = [];
  lastKeyT = 0;
  drawWave($('wave'), waveBars);
  updateProgress();
  $('input').focus();
}

function nextStep() {
  const step = STEPS[stepIndex];
  captured.push({ id: step.id, compose: !!step.compose, discard: !!step.discard, events: currentEvents });
  if (stepIndex < STEPS.length - 1) {
    stepIndex++;
    loadStep();
  } else {
    finish();
  }
}

let builtProfile = null;

function finish() {
  builtProfile = deriveProfile(captured);
  renderResults(builtProfile);
  showScreen('screen-results');
}

function renderResults(profile) {
  $('archetype').textContent = archetypeFor(profile);
  const cs = profile.errors.correctionStyle;
  const topStyle = Object.entries(cs).sort((a, b) => b[1] - a[1])[0][0];
  const styleLabel = {
    singleBackspace: 'single backspace', backspaceSpam: 'backspace bursts',
    ctrlBackspaceWord: 'whole-word delete', selectRetype: 'select + retype',
  }[topStyle] || topStyle;

  const stats = [
    ['Typing speed', `${profile.speed.baseWpm} WPM`],
    ['Avg keystroke gap', `${profile.speed.meanInterKeyMs} ms`],
    ['Key hold time', `${profile.dwell.meanMs} ms`],
    ['Error rate', `${profile.errors.ratePer100}/100`],
    ['Fixes mistakes by', styleLabel],
    ['Typing bursts', `~${profile.rhythm.burstLengthWords.mean} words`],
  ];
  $('stats').innerHTML = stats
    .map(([k, v]) => `<div class="stat"><div class="k">${k}</div><div class="v">${v}</div></div>`)
    .join('');

  // signature waveform from all kept keystrokes
  const allIntervals = [];
  for (const s of captured) {
    if (s.discard) continue;
    const d = s.events.filter((e) => e.type === 'down').sort((a, b) => a.t - b.t);
    for (let i = 1; i < d.length; i++) {
      const dt = d[i].t - d[i - 1].t;
      if (dt > 0 && dt < 1500) allIntervals.push(dt);
    }
  }
  const step = Math.max(1, Math.floor(allIntervals.length / 140));
  const bars = [];
  for (let i = 0; i < allIntervals.length; i += step) bars.push(Math.max(0.08, Math.min(1, 1 - allIntervals[i] / 700)));
  drawWave($('sig-wave'), bars);
}

async function saveProfile() {
  if (!builtProfile) return;
  try {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      await chrome.storage.local.set({ cadenceProfile: builtProfile });
      $('save-status').textContent = '✓ Saved. The popup will now type in your cadence.';
    } else {
      $('save-status').textContent = 'Storage unavailable (open this from the extension, not as a file).';
    }
  } catch (e) {
    $('save-status').textContent = 'Save failed: ' + (e && e.message ? e.message : String(e));
  }
}

function downloadProfile() {
  if (!builtProfile) return;
  const blob = new Blob([JSON.stringify(builtProfile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cadence-profile-${builtProfile.meta.id}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function reset() {
  stepIndex = 0;
  captured.length = 0;
  builtProfile = null;
  $('save-status').textContent = '';
  showScreen('screen-intro');
}

// ---- wire up ----
$('input').addEventListener('keydown', onKey);
$('input').addEventListener('keyup', onKey);
$('input').addEventListener('input', updateProgress);
$('start').addEventListener('click', () => { showScreen('screen-exercise'); loadStep(); });
$('next').addEventListener('click', nextStep);
$('save').addEventListener('click', saveProfile);
$('download').addEventListener('click', downloadProfile);
$('redo').addEventListener('click', reset);
