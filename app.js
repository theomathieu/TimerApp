/* ============================================================
   TIMER APP — app.js
   Complete logic: Storage, Audio, Timer Engine, All Tabs
   ============================================================ */

'use strict';

/* ============================================================
   STORAGE
   ============================================================ */
const DB = {
  _key: 'timerapp_v1',

  _load() {
    try {
      return JSON.parse(localStorage.getItem(this._key)) || {};
    } catch { return {}; }
  },

  _save(data) {
    try { localStorage.setItem(this._key, JSON.stringify(data)); } catch {}
  },

  getWorkouts() {
    return (this._load().workouts || []);
  },

  saveWorkout(workout) {
    const data = this._load();
    if (!data.workouts) data.workouts = [];
    workout.id = Date.now().toString();
    workout.savedAt = new Date().toLocaleDateString('fr-FR');
    data.workouts.unshift(workout);
    this._save(data);
    return workout;
  },

  deleteWorkout(id) {
    const data = this._load();
    data.workouts = (data.workouts || []).filter(w => w.id !== id);
    this._save(data);
  },

  getConfig(type) {
    return (this._load().configs || {})[type] || null;
  },

  saveConfig(type, config) {
    const data = this._load();
    if (!data.configs) data.configs = {};
    data.configs[type] = config;
    this._save(data);
  }
};

/* ============================================================
   AUDIO ENGINE  (Web Audio API)
   ============================================================ */
const AudioEngine = {
  ctx: null,
  _frVoice: null,
  _voicesReady: false,

  _init() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch {}
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();

    // Charger les voix TTS (asynchrone sur certains navigateurs)
    if (window.speechSynthesis && !this._voicesReady) {
      this._loadVoices();
      window.speechSynthesis.addEventListener('voiceschanged', () => this._loadVoices());
    }
  },

  _loadVoices() {
    const voices = window.speechSynthesis.getVoices();
    this._frVoice = voices.find(v => v.lang === 'fr-FR')
                 || voices.find(v => v.lang.startsWith('fr'))
                 || null;
    this._voicesReady = true;
  },

  /* ---- Synthèse vocale ---- */
  speak(text, delay = 0) {
    if (!window.speechSynthesis) return;
    const say = () => {
      window.speechSynthesis.cancel();
      const utt = new SpeechSynthesisUtterance(text);
      utt.lang = 'fr-FR';
      utt.rate = 1.05;
      utt.pitch = 1.0;
      utt.volume = 1.0;
      if (this._frVoice) utt.voice = this._frVoice;
      window.speechSynthesis.speak(utt);
    };
    delay > 0 ? setTimeout(say, delay) : say();
  },

  /* ---- Texte d'annonce par type de phase ---- */
  _phaseText(phase) {
    // Si le bloc a un label custom (MIX), on l'annonce
    if (phase.label && phase.label.trim()) return phase.label;
    const map = {
      prepare:  'Préparez-vous',
      work:     'Travail',
      rest:     'Repos',
      cooldown: 'Récupération',
    };
    return map[phase.type] || phase.name;
  },

  /* ---- Sons + voix au démarrage d'une phase ---- */
  announcePhase(phase) {
    const text = this._phaseText(phase);

    if (phase.type === 'prepare') {
      this._beep(660, 0.18, 0.35);
      setTimeout(() => this.speak(text), 150);

    } else if (phase.type === 'work') {
      // 3 bips montants énergiques (tous async pour ne pas bloquer)
      setTimeout(() => this._beep(523, 0.10, 0.4, 'square'), 0);
      setTimeout(() => this._beep(659, 0.10, 0.45, 'square'), 120);
      setTimeout(() => this._beep(880, 0.20, 0.55, 'square'), 240);
      setTimeout(() => this.speak(text), 400);

    } else if (phase.type === 'rest') {
      // 2 bips descendants doux
      setTimeout(() => this._beep(660, 0.18, 0.35, 'sine'), 0);
      setTimeout(() => this._beep(440, 0.25, 0.28, 'sine'), 220);
      setTimeout(() => this.speak(text), 200);

    } else if (phase.type === 'cooldown') {
      setTimeout(() => this._beep(440, 0.3, 0.3, 'sine'), 0);
      setTimeout(() => this.speak(text), 200);

    } else {
      // Phase MIX custom sans type standard
      setTimeout(() => this._beep(600, 0.12, 0.35), 0);
      setTimeout(() => this._beep(800, 0.18, 0.45), 140);
      setTimeout(() => this.speak(text), 320);
    }
  },

  /* ---- Décompte 3-2-1 (géré directement dans TimerEngine._tick) ---- */
  countdown(n) {
    this._beep(n === 1 ? 1200 : 900, 0.12, 0.35, 'sine');
    setTimeout(() => this.speak(String(n)), 0);
  },

  /* ---- Fin de phase (transition) ---- */
  phaseEnd() {
    this._beep(880, 0.08, 0.3);
    setTimeout(() => this._beep(1100, 0.15, 0.4), 100);
  },

  /* ---- Fin de séance ---- */
  workoutEnd() {
    const notes = [523, 659, 784, 1047];
    notes.forEach((f, i) => setTimeout(() => this._beep(f, 0.22, 0.45, 'sine'), i * 160));
    this.speak('Séance terminée, bravo !', 700);
  },

  /* ---- Bip générique ---- */
  _beep(freq, dur, vol = 0.4, type = 'sine') {
    if (!this.ctx) return;
    try {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.connect(gain);
      gain.connect(this.ctx.destination);
      osc.frequency.value = freq;
      osc.type = type;
      gain.gain.setValueAtTime(vol, this.ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + dur);
      osc.start(this.ctx.currentTime);
      osc.stop(this.ctx.currentTime + dur);
    } catch {}
  }
};

/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */
function formatTime(seconds) {
  if (seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `:${String(s).padStart(2, '0')}`;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function formatTimeMs(ms) {
  const total = Math.floor(ms / 100);
  const d = total % 10;
  const s = Math.floor(total / 10) % 60;
  const m = Math.floor(total / 600);
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${d}`;
}

function formatDuration(seconds) {
  if (seconds === 0) return '0s';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}min`;
  return `${m}min ${s}s`;
}

function genId() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

/* ============================================================
   PHASE BUILDERS
   Converts config objects into flat arrays of timed phases
   ============================================================ */

function buildTabataPhases(cfg) {
  const phases = [];
  if (cfg.prepare > 0) {
    phases.push({ name: 'PRÉPARATION', label: '', duration: cfg.prepare, color: 'yellow', type: 'prepare' });
  }
  for (let c = 1; c <= cfg.cycles; c++) {
    for (let r = 1; r <= cfg.rounds; r++) {
      phases.push({ name: 'TRAVAIL', label: '', duration: cfg.work, color: 'green', type: 'work',
        counter: `Round ${r}/${cfg.rounds}${cfg.cycles > 1 ? ` · Cycle ${c}/${cfg.cycles}` : ''}` });
      if (cfg.rest > 0) {
        phases.push({ name: 'REPOS', label: '', duration: cfg.rest, color: 'red', type: 'rest',
          counter: `Round ${r}/${cfg.rounds}${cfg.cycles > 1 ? ` · Cycle ${c}/${cfg.cycles}` : ''}` });
      }
    }
    if (c < cfg.cycles && cfg.restbc > 0) {
      phases.push({ name: 'REPOS ENTRE CYCLES', label: '', duration: cfg.restbc, color: 'yellow', type: 'rest',
        counter: `Cycle ${c}/${cfg.cycles}` });
    }
  }
  if (cfg.cooldown > 0) {
    phases.push({ name: 'RÉCUPÉRATION', label: '', duration: cfg.cooldown, color: 'blue', type: 'cooldown' });
  }
  return phases;
}

function buildRoundsPhases(cfg) {
  const phases = [];
  if (cfg.prepare > 0) {
    phases.push({ name: 'PRÉPARATION', label: '', duration: cfg.prepare, color: 'yellow', type: 'prepare' });
  }
  for (let r = 1; r <= cfg.rounds; r++) {
    phases.push({ name: 'TRAVAIL', label: '', duration: cfg.work, color: 'green', type: 'work',
      counter: `Round ${r}/${cfg.rounds}` });
    if (cfg.rest > 0) {
      phases.push({ name: 'REPOS', label: '', duration: cfg.rest, color: 'red', type: 'rest',
        counter: `Round ${r}/${cfg.rounds}` });
    }
  }
  if (cfg.cooldown > 0) {
    phases.push({ name: 'RÉCUPÉRATION', label: '', duration: cfg.cooldown, color: 'blue', type: 'cooldown' });
  }
  return phases;
}

function buildMixPhases(cfg) {
  const phases = [];
  const blocks = cfg.blocks || [];
  if (blocks.length === 0) return phases;
  const totalRounds = cfg.rounds || 1;
  const restbr = cfg.restbr || 0;
  for (let r = 1; r <= totalRounds; r++) {
    for (const block of blocks) {
      phases.push({
        name: block.name.toUpperCase(),
        label: block.name,
        duration: block.duration,
        color: block.type === 'work' ? 'purple' : 'red',
        type: block.type,
        counter: totalRounds > 1 ? `Tour ${r}/${totalRounds}` : ''
      });
    }
    if (r < totalRounds && restbr > 0) {
      phases.push({ name: 'REPOS', label: 'Repos entre tours', duration: restbr, color: 'red', type: 'rest',
        counter: `Tour ${r}/${totalRounds}` });
    }
  }
  return phases;
}

function totalSeconds(phases) {
  return phases.reduce((acc, p) => acc + p.duration, 0);
}

/* ============================================================
   TIMER ENGINE
   ============================================================ */
class TimerEngine {
  constructor(phases, callbacks) {
    this.phases = phases;
    this.cb = callbacks;
    this.idx = 0;
    this.state = 'idle';
    this._timer = null;      // setTimeout handle (plus fiable que rAF sur iOS avec speech)
    this._phaseStart = null;
    this._pauseElapsed = 0;
    this._lastRemainSec = -1; // pour détecter les changements de seconde
  }

  get currentPhase() { return this.phases[this.idx]; }
  get nextPhase()    { return this.phases[this.idx + 1] || null; }

  start() {
    this.state = 'running';
    this._phaseStart = performance.now();
    this._pauseElapsed = 0;
    this._lastRemainSec = -1;
    AudioEngine._init();
    this.cb.onPhaseStart && this.cb.onPhaseStart(this.currentPhase, this.nextPhase);
    this._scheduleTick();
  }

  pause() {
    if (this.state !== 'running') return;
    this.state = 'paused';
    this._pauseElapsed += performance.now() - this._phaseStart;
    clearTimeout(this._timer);
  }

  resume() {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this._phaseStart = performance.now();
    this._scheduleTick();
  }

  stop() {
    this.state = 'stopped';
    clearTimeout(this._timer);
  }

  // Planifie le prochain tick (toutes les 100ms — indépendant de rAF et du speech)
  _scheduleTick() {
    this._timer = setTimeout(() => this._tick(), 100);
  }

  _tick() {
    if (this.state !== 'running') return;

    const elapsed    = (performance.now() - this._phaseStart) + this._pauseElapsed;
    const duration   = this.currentPhase.duration * 1000;
    const remaining  = Math.max(0, duration - elapsed);
    const remainSec  = Math.ceil(remaining / 1000);
    const progress   = 1 - remaining / duration;

    // Mise à jour de l'affichage
    this.cb.onTick && this.cb.onTick(remainSec, progress);

    // Décompte 3-2-1 : déclenché exactement une fois par seconde
    if (remainSec !== this._lastRemainSec) {
      this._lastRemainSec = remainSec;
      if (remainSec <= 3 && remainSec > 0) {
        // Bip immédiat, voix en async pour ne pas bloquer le timer
        AudioEngine._beep(remainSec === 1 ? 1200 : 900, 0.12, 0.35, 'sine');
        setTimeout(() => AudioEngine.speak(String(remainSec)), 0);
      }
    }

    if (remaining <= 0) {
      this._nextPhase();
    } else {
      this._scheduleTick();
    }
  }

  _nextPhase() {
    clearTimeout(this._timer);
    AudioEngine.phaseEnd();
    this.idx++;
    if (this.idx >= this.phases.length) {
      this.state = 'finished';
      setTimeout(() => AudioEngine.workoutEnd(), 200);
      this.cb.onFinish && this.cb.onFinish();
      return;
    }
    this._phaseStart = performance.now();
    this._pauseElapsed = 0;
    this._lastRemainSec = -1;
    this.cb.onPhaseStart && this.cb.onPhaseStart(this.currentPhase, this.nextPhase);
    // Léger délai avant de reprendre le tick (laisse le temps aux sons de démarrer)
    this._timer = setTimeout(() => this._scheduleTick(), 50);
  }
}

/* ============================================================
   TIMER DISPLAY (fullscreen overlay)
   ============================================================ */
const CIRCUMFERENCE = 2 * Math.PI * 140; // ≈ 879.6

const TimerDisplay = {
  engine: null,
  startTime: null,
  workoutName: '',

  show(phases, name) {
    if (!phases || phases.length === 0) {
      alert('Aucune phase à jouer. Vérifie ta configuration.');
      return;
    }
    this.workoutName = name || '';
    this.startTime = Date.now();

    const overlay = document.getElementById('timer-overlay');
    overlay.classList.remove('hidden');
    document.getElementById('t-workout-name').textContent = name || '';

    this.engine = new TimerEngine(phases, {
      onPhaseStart: (phase, next) => this._onPhaseStart(phase, next),
      onTick: (rem, prog) => this._onTick(rem, prog),
      onFinish: () => this._onFinish()
    });
    this.engine.start();
  },

  _onPhaseStart(phase, next) {
    document.getElementById('t-phase-label').textContent = phase.name + (phase.label ? ` · ${phase.label}` : '');
    document.getElementById('t-counter-label').textContent = phase.counter || '';
    document.getElementById('t-next').textContent = next
      ? `Prochain : ${next.name}${next.label ? ' · ' + next.label : ''} ${formatTime(next.duration)}`
      : 'Dernière phase';

    // Ring color
    const ring = document.getElementById('t-ring');
    ring.className = `ring-fg ring-${phase.color}`;

    // Background tint
    const overlay = document.getElementById('timer-overlay');
    const tints = { yellow: '#1a1600', green: '#001a0a', red: '#1a0000', blue: '#001220', purple: '#100820' };
    overlay.style.background = tints[phase.color] || '#0a0a0a';

    // Sons + voix selon la phase
    AudioEngine.announcePhase(phase);
  },

  _onTick(rem, prog) {
    document.getElementById('t-time').textContent = formatTime(rem);
    const offset = CIRCUMFERENCE * (1 - prog);
    document.getElementById('t-ring').style.strokeDashoffset = offset;
  },

  _onFinish() {
    const elapsed = Math.round((Date.now() - this.startTime) / 1000);
    document.getElementById('timer-overlay').classList.add('hidden');
    document.getElementById('timer-overlay').style.background = '';
    document.getElementById('end-stats').innerHTML =
      `Durée : ${formatDuration(elapsed)}${this.workoutName ? '<br/>' + this.workoutName : ''}`;
    openModal('modal-end');
  },

  togglePause() {
    if (!this.engine) return;
    const btn = document.getElementById('t-pause-btn');
    if (this.engine.state === 'running') {
      this.engine.pause();
      btn.textContent = 'REPRENDRE';
      btn.style.background = 'var(--green)';
    } else if (this.engine.state === 'paused') {
      this.engine.resume();
      btn.textContent = 'PAUSE';
      btn.style.background = 'var(--yellow)';
    }
  },

  stop() {
    if (this.engine) this.engine.stop();
    document.getElementById('timer-overlay').classList.add('hidden');
    document.getElementById('timer-overlay').style.background = '';
    document.getElementById('t-pause-btn').textContent = 'PAUSE';
    document.getElementById('t-pause-btn').style.background = '';
  }
};

/* ============================================================
   PICKER SYSTEM  (time + number pickers)
   ============================================================ */
let _pickerCtx = null; // { tabType, fieldName }

function openTimePicker(tabType, fieldName) {
  AudioEngine._init();
  _pickerCtx = { tabType, fieldName, kind: 'time' };
  const titles = {
    prepare: 'Préparation', work: 'Travail', rest: 'Repos',
    restbc: 'Repos entre cycles', cooldown: 'Récupération',
    restbr: 'Repos entre tours'
  };
  document.getElementById('modal-time-title').textContent = titles[fieldName] || 'Durée';

  // Get current value
  const currentVal = _getConfigValue(tabType, fieldName);
  const mins = Math.floor(currentVal / 60);
  const secs = currentVal % 60;

  // Build minute picker (0-59)
  buildPickerScroll('picker-min-scroll', 0, 59, mins, 'min');
  // Build second picker (increments of 5: 0,5,10,...,55)
  const secOptions = [0,5,10,15,20,25,30,35,40,45,50,55];
  const nearestSec = secOptions.reduce((a, b) => Math.abs(b - secs) < Math.abs(a - secs) ? b : a);
  buildPickerScrollItems('picker-sec-scroll', secOptions.map(s => String(s).padStart(2,'0')), nearestSec, 'sec');

  openModal('modal-time');
  // Scroll to selected after render
  setTimeout(() => {
    scrollPickerToSelected('picker-min-scroll');
    scrollPickerToSelected('picker-sec-scroll');
  }, 50);
}

/* ---- Picker : stockage explicite des valeurs sélectionnées ---- */
const _pickerValues = new Map(); // scrollId -> valeur numérique courante

function buildPickerScroll(scrollId, min, max, selected, type) {
  const items = [];
  for (let i = min; i <= max; i++) {
    items.push({ label: String(i).padStart(2, '0'), value: i });
  }
  _buildPicker(scrollId, items, selected);
}

function buildPickerScrollItems(scrollId, labels, selected, type) {
  const items = labels.map(l => ({ label: l, value: parseInt(l) }));
  _buildPicker(scrollId, items, selected);
}

function _buildPicker(scrollId, items, selected) {
  // Stocker la valeur initiale
  _pickerValues.set(scrollId, selected);

  const container = document.getElementById(scrollId);
  const col = container.parentElement;

  // Détacher l'ancien handler AVANT de toucher scrollTop
  col.onscroll = null;
  container.innerHTML = '';

  container.appendChild(pickerPad());
  container.appendChild(pickerPad());
  items.forEach(({ label, value }) => {
    const div = document.createElement('div');
    div.className = 'picker-item' + (value === selected ? ' selected' : '');
    div.textContent = label;
    div.dataset.value = value;
    // Clic direct sur un item
    div.addEventListener('click', () => {
      _pickerValues.set(scrollId, value);
      container.querySelectorAll('.picker-item').forEach(i => i.classList.remove('selected'));
      div.classList.add('selected');
    });
    container.appendChild(div);
  });
  container.appendChild(pickerPad());
  container.appendChild(pickerPad());

  // Scroll initial sans déclencher le handler
  col.scrollTop = 0;

  // Handler de scroll : met à jour la valeur stockée
  col.onscroll = () => {
    const updated = _computePickerValue(scrollId);
    if (updated !== null) {
      _pickerValues.set(scrollId, updated);
      // Mise à jour visuelle
      container.querySelectorAll('.picker-item[data-value]').forEach(item => {
        item.classList.toggle('selected', parseInt(item.dataset.value) === updated);
      });
    }
  };
}

function _computePickerValue(scrollId) {
  const container = document.getElementById(scrollId);
  const col = container.parentElement;
  const itemH = 44;
  const colMid = col.scrollTop + col.clientHeight / 2;
  const items = [...container.querySelectorAll('.picker-item[data-value]')];
  if (!items.length) return null;
  let closest = items[0], minDist = Infinity;
  items.forEach(item => {
    const dist = Math.abs((item.offsetTop + itemH / 2) - colMid);
    if (dist < minDist) { minDist = dist; closest = item; }
  });
  return parseInt(closest.dataset.value);
}

function pickerPad() {
  const div = document.createElement('div');
  div.className = 'picker-item';
  div.style.visibility = 'hidden';
  return div;
}

function updatePickerSelection(col) {
  // Conservé pour compatibilité — non utilisé dans le nouveau système
}

function scrollPickerToSelected(scrollId) {
  const container = document.getElementById(scrollId);
  const col = container.parentElement;
  const selected = container.querySelector('.selected');
  if (selected) {
    // Scroll sans déclencher le handler (on le retire temporairement)
    const handler = col.onscroll;
    col.onscroll = null;
    col.scrollTop = selected.offsetTop - col.clientHeight / 2 + 22;
    requestAnimationFrame(() => { col.onscroll = handler; });
  }
}

function getPickerValue(scrollId) {
  // Lire depuis la Map — fiable indépendamment du DOM
  return _pickerValues.get(scrollId) ?? 0;
}

function confirmTimePicker() {
  if (!_pickerCtx) return;
  const mins = getPickerValue('picker-min-scroll');
  const secs = getPickerValue('picker-sec-scroll');
  const total = mins * 60 + secs;
  _setConfigValue(_pickerCtx.tabType, _pickerCtx.fieldName, total);
  closeModal('modal-time');
}

// Number picker
let _numberPickerCtx = null;

function openNumberPicker(tabType, fieldName) {
  AudioEngine._init();
  _numberPickerCtx = { tabType, fieldName };
  const titles = { rounds: 'Rounds', cycles: 'Cycles' };
  document.getElementById('modal-number-title').textContent = titles[fieldName] || fieldName;

  const currentVal = _getConfigValue(tabType, fieldName);
  buildPickerScroll('picker-num-scroll', 1, 99, currentVal, 'num');
  openModal('modal-number');
  setTimeout(() => scrollPickerToSelected('picker-num-scroll'), 50);
}

function confirmNumberPicker() {
  if (!_numberPickerCtx) return;
  const val = getPickerValue('picker-num-scroll');
  _setConfigValue(_numberPickerCtx.tabType, _numberPickerCtx.fieldName, val);
  closeModal('modal-number');
}

/* ============================================================
   CONFIG VALUE GET/SET
   ============================================================ */
function _getConfigValue(tabType, field) {
  if (tabType === 'tabata') return TabataTab.config[field] || 0;
  if (tabType === 'rounds') return RoundsTab.config[field] || 0;
  if (tabType === 'mix') return MixTab.meta[field] || 0;
  return 0;
}

function _setConfigValue(tabType, field, val) {
  if (tabType === 'tabata') {
    TabataTab.config[field] = val;
    TabataTab.render();
  } else if (tabType === 'rounds') {
    RoundsTab.config[field] = val;
    RoundsTab.render();
  } else if (tabType === 'mix') {
    MixTab.meta[field] = val;
    MixTab.render();
  }
}

/* ============================================================
   MODAL HELPERS
   ============================================================ */
function openModal(id) {
  document.getElementById(id).classList.remove('hidden');
}
function closeModal(id) {
  document.getElementById(id).classList.add('hidden');
}

// SAVE PRESET
let _savePresetCallback = null;

function openSaveModal(cb) {
  _savePresetCallback = cb;
  document.getElementById('preset-name-input').value = '';
  openModal('modal-save');
  setTimeout(() => document.getElementById('preset-name-input').focus(), 100);
}

function confirmSavePreset() {
  const name = document.getElementById('preset-name-input').value.trim();
  if (!name) { document.getElementById('preset-name-input').focus(); return; }
  closeModal('modal-save');
  if (_savePresetCallback) _savePresetCallback(name);
}

/* ============================================================
   TABATA TAB
   ============================================================ */
const TabataTab = {
  config: {
    prepare: 5, work: 20, rest: 10, rounds: 8, cycles: 1, restbc: 0, cooldown: 0
  },

  init() {
    const saved = DB.getConfig('tabata');
    if (saved) this.config = { ...this.config, ...saved };
    this.render();
  },

  render() {
    const c = this.config;
    document.getElementById('tabata-prepare-val').textContent = formatTime(c.prepare);
    document.getElementById('tabata-work-val').textContent = formatTime(c.work);
    document.getElementById('tabata-rest-val').textContent = formatTime(c.rest);
    document.getElementById('tabata-rounds-val').textContent = c.rounds;
    document.getElementById('tabata-cycles-val').textContent = c.cycles;
    document.getElementById('tabata-restbc-val').textContent = formatTime(c.restbc);
    document.getElementById('tabata-cooldown-val').textContent = formatTime(c.cooldown);

    const phases = buildTabataPhases(c);
    const total = totalSeconds(phases);
    document.getElementById('tabata-total').textContent = `Durée totale : ${formatDuration(total)}`;
    DB.saveConfig('tabata', c);
  },

  start() {
    AudioEngine._init();
    const phases = buildTabataPhases(this.config);
    if (!phases.length) return alert('Configure au moins une phase.');
    TimerDisplay.show(phases, 'TABATA');
  },

  savePreset() {
    openSaveModal(name => {
      const phases = buildTabataPhases(this.config);
      DB.saveWorkout({
        type: 'tabata',
        name,
        config: { ...this.config },
        meta: `${this.config.rounds} rounds · ${formatTime(this.config.work)} travail / ${formatTime(this.config.rest)} repos`,
        totalSec: totalSeconds(phases)
      });
      SeancesTab.render();
      _toast('Séance sauvegardée !');
    });
  },

  openPresets() {
    const workouts = DB.getWorkouts().filter(w => w.type === 'tabata');
    renderPresetsModal(workouts, (w) => {
      this.config = { ...this.config, ...w.config };
      this.render();
      closeModal('modal-presets');
      _toast('Séance chargée !');
    });
  }
};

/* ============================================================
   ROUNDS TAB
   ============================================================ */
const RoundsTab = {
  config: {
    prepare: 5, work: 30, rest: 15, rounds: 4, cooldown: 30
  },

  init() {
    const saved = DB.getConfig('rounds');
    if (saved) this.config = { ...this.config, ...saved };
    this.render();
  },

  render() {
    const c = this.config;
    document.getElementById('rounds-prepare-val').textContent = formatTime(c.prepare);
    document.getElementById('rounds-work-val').textContent = formatTime(c.work);
    document.getElementById('rounds-rest-val').textContent = formatTime(c.rest);
    document.getElementById('rounds-rounds-val').textContent = c.rounds;
    document.getElementById('rounds-cooldown-val').textContent = formatTime(c.cooldown);

    const phases = buildRoundsPhases(c);
    const total = totalSeconds(phases);
    document.getElementById('rounds-total').textContent = `Durée totale : ${formatDuration(total)}`;
    DB.saveConfig('rounds', c);
  },

  start() {
    AudioEngine._init();
    const phases = buildRoundsPhases(this.config);
    if (!phases.length) return alert('Configure au moins une phase.');
    TimerDisplay.show(phases, 'ROUNDS');
  },

  savePreset() {
    openSaveModal(name => {
      const phases = buildRoundsPhases(this.config);
      DB.saveWorkout({
        type: 'rounds',
        name,
        config: { ...this.config },
        meta: `${this.config.rounds} rounds · ${formatTime(this.config.work)} / ${formatTime(this.config.rest)}`,
        totalSec: totalSeconds(phases)
      });
      SeancesTab.render();
      _toast('Séance sauvegardée !');
    });
  },

  openPresets() {
    const workouts = DB.getWorkouts().filter(w => w.type === 'rounds');
    renderPresetsModal(workouts, (w) => {
      this.config = { ...this.config, ...w.config };
      this.render();
      closeModal('modal-presets');
      _toast('Séance chargée !');
    });
  }
};

/* ============================================================
   STOPWATCH TAB
   ============================================================ */
const StopwatchTab = {
  running: false,
  startTime: null,
  elapsed: 0,
  laps: [],
  _raf: null,
  _lapStart: null,

  init() {},

  toggle() {
    AudioEngine._init();
    if (!this.running) {
      this.startTime = performance.now() - this.elapsed;
      if (this._lapStart === null) this._lapStart = this.startTime;
      this.running = true;
      document.getElementById('sw-start-btn').textContent = 'ARRÊT';
      document.getElementById('sw-start-btn').style.background = 'var(--red)';
      document.getElementById('sw-lap-btn').disabled = false;
      document.getElementById('sw-reset-btn').disabled = false;
      this._tick();
    } else {
      this.running = false;
      this.elapsed = performance.now() - this.startTime;
      cancelAnimationFrame(this._raf);
      document.getElementById('sw-start-btn').textContent = 'CONTINUER';
      document.getElementById('sw-start-btn').style.background = 'var(--green)';
    }
  },

  lap() {
    if (!this.running) return;
    const now = performance.now();
    const lapMs = now - this._lapStart;
    this._lapStart = now;
    this.laps.push(lapMs);
    this._renderLaps();
  },

  reset() {
    if (this.running) return;
    this.elapsed = 0;
    this.laps = [];
    this._lapStart = null;
    document.getElementById('sw-display').textContent = '00:00.0';
    document.getElementById('sw-start-btn').textContent = 'DÉMARRER';
    document.getElementById('sw-start-btn').style.background = '';
    document.getElementById('sw-lap-btn').disabled = true;
    document.getElementById('sw-reset-btn').disabled = true;
    document.getElementById('laps-list').innerHTML = '';
    document.getElementById('sw-ring').style.strokeDashoffset = '0';
  },

  _tick() {
    if (!this.running) return;
    const now = performance.now();
    const total = now - this.startTime;
    document.getElementById('sw-display').textContent = formatTimeMs(total);

    // Rotate ring every 60 seconds
    const rot = (total / 60000) % 1;
    document.getElementById('sw-ring').style.strokeDashoffset = CIRCUMFERENCE * rot;

    this._raf = requestAnimationFrame(() => this._tick());
  },

  _renderLaps() {
    const list = document.getElementById('laps-list');
    list.innerHTML = '';
    [...this.laps].reverse().forEach((ms, i) => {
      const idx = this.laps.length - i;
      const div = document.createElement('div');
      div.className = 'lap-item';
      div.innerHTML = `<span class="lap-num">Tour ${idx}</span><span class="lap-time">${formatTimeMs(ms)}</span>`;
      list.appendChild(div);
    });
  }
};

/* ============================================================
   MIX — DRAG & DROP (touch + mouse)
   ============================================================ */
function initMixDrag() {
  const list = document.getElementById('mix-blocks-list');
  if (!list) return;

  let dragging = null;   // ligne originale (cachée)
  let ghost    = null;   // copie flottante qui suit le doigt
  let ph       = null;   // placeholder qui montre la destination
  let offsetY  = 0;      // décalage doigt/coin supérieur du ghost
  let srcIdx   = -1;

  function getRows() {
    return [...list.querySelectorAll('.mix-block-row')].filter(r => r !== dragging);
  }

  function movePlaceholder(clientY) {
    const rows = getRows();
    let insertBefore = null;
    for (const r of rows) {
      const rect = r.getBoundingClientRect();
      if (clientY < rect.top + rect.height / 2) { insertBefore = r; break; }
    }
    insertBefore ? list.insertBefore(ph, insertBefore) : list.appendChild(ph);
  }

  function startDrag(handle, clientY) {
    const row = handle.closest('.mix-block-row');
    if (!row) return;
    srcIdx = parseInt(row.dataset.idx);
    const rect = row.getBoundingClientRect();
    offsetY = clientY - rect.top;

    // Créer le ghost flottant
    ghost = row.cloneNode(true);
    Object.assign(ghost.style, {
      position: 'fixed', left: rect.left + 'px', top: rect.top + 'px',
      width: rect.width + 'px', zIndex: '999', opacity: '0.92',
      pointerEvents: 'none', boxShadow: '0 8px 28px rgba(0,0,0,0.55)',
      borderRadius: '12px', margin: '0', transition: 'none'
    });
    document.body.appendChild(ghost);

    // Placeholder
    ph = document.createElement('div');
    Object.assign(ph.style, {
      height: rect.height + 'px', marginBottom: '8px',
      borderRadius: '12px', background: 'rgba(155,127,232,0.12)',
      border: '2px dashed rgba(155,127,232,0.45)', flexShrink: '0'
    });
    row.parentNode.insertBefore(ph, row);
    row.style.opacity = '0';
    dragging = row;
  }

  function moveDrag(clientY) {
    if (!ghost) return;
    ghost.style.top = (clientY - offsetY) + 'px';
    movePlaceholder(clientY);
  }

  function endDrag() {
    if (!ghost) return;

    // Trouver l'index de destination (nombre de rows avant le placeholder)
    const allItems = [...list.children];
    const phPos = allItems.indexOf(ph);
    let dstIdx = 0;
    for (let i = 0; i < phPos; i++) {
      if (allItems[i].classList.contains('mix-block-row') && allItems[i] !== dragging) dstIdx++;
    }

    ghost.remove(); ph.remove();
    dragging.style.opacity = '';
    ghost = null; ph = null; dragging = null;

    if (dstIdx !== srcIdx) {
      const [moved] = MixTab.blocks.splice(srcIdx, 1);
      MixTab.blocks.splice(dstIdx, 0, moved);
      MixTab.render();
    }
  }

  // Attacher les handlers sur chaque poignée
  list.querySelectorAll('.mix-block-drag').forEach(handle => {
    // ---- TOUCH ----
    handle.addEventListener('touchstart', e => {
      e.preventDefault();
      startDrag(handle, e.touches[0].clientY);
    }, { passive: false });

    handle.addEventListener('touchmove', e => {
      e.preventDefault();
      moveDrag(e.touches[0].clientY);
    }, { passive: false });

    handle.addEventListener('touchend', () => endDrag(), { passive: true });
    handle.addEventListener('touchcancel', () => endDrag(), { passive: true });

    // ---- MOUSE (desktop) ----
    handle.addEventListener('mousedown', e => {
      e.preventDefault();
      startDrag(handle, e.clientY);
      const onMove = ev => moveDrag(ev.clientY);
      const onUp   = () => { endDrag(); window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
    });
  });
}

/* ============================================================
   MIX TAB
   ============================================================ */
const MixTab = {
  blocks: [],   // [{id, type: 'work'|'rest', name, duration}]
  meta: { rounds: 1, restbr: 0 },
  _editingBlockId: null,
  _editingBlockType: null,
  _dragSrcIdx: null,

  init() {
    const saved = DB.getConfig('mix');
    if (saved) {
      this.blocks = saved.blocks || [];
      this.meta = { rounds: saved.rounds || 1, restbr: saved.restbr || 0 };
    }
    this.render();
  },

  render() {
    document.getElementById('mix-rounds-val').textContent = this.meta.rounds;
    document.getElementById('mix-restbr-val').textContent = formatTime(this.meta.restbr);

    const list = document.getElementById('mix-blocks-list');

    // Reconstruire entièrement — sans aucune dépendance à des références DOM
    list.innerHTML = '';

    if (this.blocks.length === 0) {
      list.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:40px 20px;color:#666;text-align:center;font-size:14px;line-height:1.5;">
          <div style="font-size:48px">⏱</div>
          <p>Construis ta séance en ajoutant des blocs ci-dessous.</p>
        </div>`;
    } else {
      this.blocks.forEach((block, idx) => {
        list.appendChild(this._createBlockRow(block, idx));
      });
    }

    // Total
    const phases = buildMixPhases({ blocks: this.blocks, rounds: this.meta.rounds, restbr: this.meta.restbr });
    const total = totalSeconds(phases);
    document.getElementById('mix-total').textContent = `Durée totale : ${formatDuration(total)}`;

    // Save config
    DB.saveConfig('mix', { blocks: this.blocks, ...this.meta });

    // Init touch drag after DOM is ready
    if (this.blocks.length > 0) requestAnimationFrame(() => initMixDrag());
  },

  _createBlockRow(block, idx) {
    const row = document.createElement('div');
    row.className = `mix-block-row ${block.type}`;
    row.dataset.idx = idx;

    row.innerHTML = `
      <span class="mix-block-drag" title="Glisser pour déplacer">≡</span>
      <div class="mix-block-info">
        <div class="mix-block-name">${block.name || (block.type === 'work' ? 'Travail' : 'Repos')}</div>
        <div class="mix-block-duration">${formatDuration(block.duration)}</div>
      </div>
      <div class="mix-block-actions">
        <button class="mix-block-btn dup-btn" title="Dupliquer"></button>
        <button class="mix-block-btn del-btn" title="Supprimer"></button>
      </div>
    `;

    // Éditer en cliquant sur le contenu
    row.querySelector('.mix-block-info').addEventListener('click', () => this.editBlock(block.id));

    // Dupliquer — ajoute une copie en fin de liste
    row.querySelector('.dup-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.blocks.push({ ...block, id: genId() });
      this.render();
    });

    // Supprimer
    row.querySelector('.del-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      this.blocks.splice(idx, 1);
      this.render();
    });

    return row;
  },

  addBlock(type) {
    AudioEngine._init();
    this._editingBlockId = null;
    this._editingBlockType = type;
    document.getElementById('modal-block-title').textContent = type === 'work' ? 'Bloc Travail' : 'Bloc Repos';
    document.getElementById('block-name-input').value = '';
    document.getElementById('block-name-input').placeholder = type === 'work' ? 'Ex : Facile, Sprint, Rapide...' : 'Ex : Repos, Marche...';

    // Default duration
    const defaultDur = type === 'work' ? 60 : 30;
    buildPickerScroll('block-picker-min-scroll', 0, 59, Math.floor(defaultDur / 60), 'min');
    buildPickerScrollItems('block-picker-sec-scroll', ['00','05','10','15','20','25','30','35','40','45','50','55'],
      defaultDur % 60, 'sec');

    openModal('modal-block');
    setTimeout(() => {
      scrollPickerToSelected('block-picker-min-scroll');
      scrollPickerToSelected('block-picker-sec-scroll');
      document.getElementById('block-name-input').focus();
    }, 80);
  },

  editBlock(blockId) {
    const block = this.blocks.find(b => b.id === blockId);
    if (!block) return;
    this._editingBlockId = blockId;
    this._editingBlockType = block.type;
    document.getElementById('modal-block-title').textContent = block.type === 'work' ? 'Bloc Travail' : 'Bloc Repos';
    document.getElementById('block-name-input').value = block.name || '';
    document.getElementById('block-name-input').placeholder = 'Nom du bloc';

    const mins = Math.floor(block.duration / 60);
    const secs = block.duration % 60;
    const secOptions = [0,5,10,15,20,25,30,35,40,45,50,55];
    const nearestSec = secOptions.reduce((a, b) => Math.abs(b - secs) < Math.abs(a - secs) ? b : a);

    buildPickerScroll('block-picker-min-scroll', 0, 59, mins, 'min');
    buildPickerScrollItems('block-picker-sec-scroll', secOptions.map(s => String(s).padStart(2,'0')), nearestSec, 'sec');

    openModal('modal-block');
    setTimeout(() => {
      scrollPickerToSelected('block-picker-min-scroll');
      scrollPickerToSelected('block-picker-sec-scroll');
    }, 80);
  },

  start() {
    AudioEngine._init();
    if (this.blocks.length === 0) return alert('Ajoute au moins un bloc.');
    const phases = buildMixPhases({ blocks: this.blocks, rounds: this.meta.rounds, restbr: this.meta.restbr });
    TimerDisplay.show(phases, 'MIX');
  },

  savePreset() {
    if (this.blocks.length === 0) return alert('Ajoute au moins un bloc avant de sauvegarder.');
    openSaveModal(name => {
      const phases = buildMixPhases({ blocks: this.blocks, rounds: this.meta.rounds, restbr: this.meta.restbr });
      DB.saveWorkout({
        type: 'mix',
        name,
        config: { blocks: JSON.parse(JSON.stringify(this.blocks)), ...this.meta },
        meta: `${this.blocks.length} blocs · ${this.meta.rounds} tour(s)`,
        totalSec: totalSeconds(phases)
      });
      SeancesTab.render();
      _toast('Séance sauvegardée !');
    });
  },

  openPresets() {
    const workouts = DB.getWorkouts().filter(w => w.type === 'mix');
    renderPresetsModal(workouts, (w) => {
      this.blocks = JSON.parse(JSON.stringify(w.config.blocks || []));
      this.meta = { rounds: w.config.rounds || 1, restbr: w.config.restbr || 0 };
      this.render();
      closeModal('modal-presets');
      _toast('Séance chargée !');
    });
  }
};

// Called from HTML modal confirm button
function confirmBlockEdit() {
  const name = document.getElementById('block-name-input').value.trim();
  const mins = getPickerValue('block-picker-min-scroll');
  const secs = getPickerValue('block-picker-sec-scroll');
  const duration = mins * 60 + secs;

  if (duration === 0) { alert('Durée doit être > 0'); return; }

  if (MixTab._editingBlockId) {
    // Edit existing
    const block = MixTab.blocks.find(b => b.id === MixTab._editingBlockId);
    if (block) {
      block.name = name || (block.type === 'work' ? 'Travail' : 'Repos');
      block.duration = duration;
    }
  } else {
    // Add new
    MixTab.blocks.push({
      id: genId(),
      type: MixTab._editingBlockType,
      name: name || (MixTab._editingBlockType === 'work' ? 'Travail' : 'Repos'),
      duration
    });
  }

  closeModal('modal-block');
  MixTab.render();
}

/* ============================================================
   SÉANCES TAB
   ============================================================ */
const SeancesTab = {
  _filter: 'all',

  init() { this.render(); },

  filter(type) {
    this._filter = type;
    document.querySelectorAll('.filter-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.filter === type);
    });
    this.render();
  },

  render() {
    const all = DB.getWorkouts();
    const filtered = this._filter === 'all' ? all : all.filter(w => w.type === this._filter);
    const list = document.getElementById('seances-list');

    if (filtered.length === 0) {
      list.innerHTML = `<div class="seances-empty">Aucune séance sauvegardée.<br/>Crée ta première séance et clique sur <strong>SAUV.</strong></div>`;
      return;
    }

    list.innerHTML = '';
    filtered.forEach(w => {
      const card = document.createElement('div');
      card.className = 'seance-card';
      const typeLabels = { tabata: 'TABATA', rounds: 'ROUNDS', mix: 'MIX' };
      card.innerHTML = `
        <span class="seance-type-badge ${w.type}">${typeLabels[w.type] || w.type.toUpperCase()}</span>
        <div class="seance-info">
          <div class="seance-name">${w.name}</div>
          <div class="seance-meta">${w.meta || ''} · ${w.savedAt || ''}</div>
        </div>
        <div class="seance-card-actions">
          <button class="seance-play-btn" title="Démarrer">▶</button>
          <button class="seance-del-btn" title="Supprimer">✕</button>
        </div>
      `;

      card.querySelector('.seance-play-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        this._launch(w);
      });
      card.querySelector('.seance-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Supprimer "${w.name}" ?`)) {
          DB.deleteWorkout(w.id);
          this.render();
        }
      });
      card.addEventListener('click', () => this._launch(w));
      list.appendChild(card);
    });
  },

  _launch(w) {
    AudioEngine._init();
    let phases = [];
    if (w.type === 'tabata') phases = buildTabataPhases(w.config);
    else if (w.type === 'rounds') phases = buildRoundsPhases(w.config);
    else if (w.type === 'mix') phases = buildMixPhases(w.config);
    TimerDisplay.show(phases, w.name);
  }
};

/* ============================================================
   PRESETS MODAL RENDERER
   ============================================================ */
function renderPresetsModal(workouts, onLoad) {
  const list = document.getElementById('modal-presets-list');
  list.innerHTML = '';

  if (workouts.length === 0) {
    list.innerHTML = `<div class="presets-empty">Aucune séance sauvegardée pour ce type.</div>`;
  } else {
    workouts.forEach(w => {
      const item = document.createElement('div');
      item.className = 'preset-item';
      item.innerHTML = `
        <div style="flex:1">
          <div class="preset-name">${w.name}</div>
          <div class="preset-meta">${w.meta || ''} · ${w.savedAt || ''}</div>
        </div>
        <button class="preset-load-btn">CHARGER</button>
        <button class="preset-del-btn" title="Supprimer">✕</button>
      `;
      item.querySelector('.preset-load-btn').addEventListener('click', () => onLoad(w));
      item.querySelector('.preset-del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Supprimer "${w.name}" ?`)) {
          DB.deleteWorkout(w.id);
          item.remove();
          SeancesTab.render();
          if (list.children.length === 0) {
            list.innerHTML = `<div class="presets-empty">Aucune séance sauvegardée.</div>`;
          }
        }
      });
      list.appendChild(item);
    });
  }

  openModal('modal-presets');
}

/* ============================================================
   TOAST NOTIFICATION
   ============================================================ */
function _toast(msg) {
  let t = document.getElementById('toast-msg');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast-msg';
    t.style.cssText = `
      position:fixed; bottom:calc(var(--nav-h) + 20px + env(safe-area-inset-bottom));
      left:50%; transform:translateX(-50%);
      background:var(--green); color:#000;
      padding:10px 20px; border-radius:20px;
      font-size:13px; font-weight:700; letter-spacing:0.5px;
      z-index:300; opacity:0; transition:opacity 0.2s;
      pointer-events:none; white-space:nowrap;
    `;
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.style.opacity = '1';
  clearTimeout(t._tid);
  t._tid = setTimeout(() => { t.style.opacity = '0'; }, 2000);
}

/* ============================================================
   APP CONTROLLER
   ============================================================ */
const App = {
  init() {
    TabataTab.init();
    RoundsTab.init();
    StopwatchTab.init();
    MixTab.init();
    SeancesTab.init();

    // Service worker registration
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    }

    // Unlock audio on first tap
    document.addEventListener('touchstart', () => AudioEngine._init(), { once: true });
    document.addEventListener('click', () => AudioEngine._init(), { once: true });

    // Enter key for modals
    document.getElementById('preset-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') confirmSavePreset();
    });
    document.getElementById('block-name-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        e.target.blur();
        confirmBlockEdit();
      }
    });
  },

  switchTab(name) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.nav-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${name}`).classList.add('active');
    document.querySelector(`.nav-btn[data-tab="${name}"]`).classList.add('active');
    if (name === 'seances') SeancesTab.render();
  }
};

document.addEventListener('DOMContentLoaded', () => App.init());
