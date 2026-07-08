// BetDiary — diario bet manuale con preset di strategia
// Vanilla JS + Firebase Firestore (SDK modular da CDN). Vedi BETDIARY_BOOTSTRAP.md.

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, getDocs, getDoc, setDoc,
  query, where, orderBy, limit, Timestamp,
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ---------------------------------------------------------------- costanti

const SPORTS = ['calcio', 'tennis', 'basket', 'altro'];

// Tipi di giocata: categorie realmente distinte, ognuna con le sue sotto-scelte a pulsanti.
const BET_TYPES = [
  ['1x2', '1X2'],
  ['doppia_chance', 'Doppia chance'],
  ['over_under', 'Over/Under'],
  ['gg_ng', 'GG/NG'],
  ['multigoal', 'Multigoal'],
  ['pari_dispari', 'Pari/Dispari'],
  ['altro', 'Altro'],
];
const BET_TYPE_LABELS = Object.fromEntries(BET_TYPES);
const SEL_TYPES = BET_TYPES.map(([v]) => v); // per mostrare/nascondere i blocchi

// Sotto-scelte coerenti per tipo (tutte a pulsanti)
const LIVE_OPTS = [['pre', 'Pre'], ['live', 'Live']];
const PERIOD_OPTS = [['ft', 'Tutta la gara'], ['ht', '1° tempo']];
const ONEX2_OPTS = [['1', '1'], ['X', 'X'], ['2', '2']];
const DC_OPTS = [['1X', '1X'], ['12', '12'], ['X2', 'X2']];
const GGNG_OPTS = [['GG', 'GG'], ['NG', 'NG']];
const PARI_OPTS = [['pari', 'Pari'], ['dispari', 'Dispari']];
const OUDIR_OPTS = [['over', 'Over +'], ['under', 'Under −']];

// Linee gol più comuni, incluse le asiatiche a quarto (0.75 = 0.5/1, 1.25 = 1/1.5, ...)
const OU_LINES = [
  0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75,
  3, 3.25, 3.5, 3.75, 4, 4.25, 4.5,
];

// Intervalli multigoal comuni
const MULTIGOAL_RANGES = [
  '1-2', '1-3', '1-4', '1-5', '1-6', '2-3', '2-4', '2-5', '2-6',
  '3-4', '3-5', '3-6', '2+', '3+', '4+',
];

const RESULT_LABELS = {
  pending: 'Pending', win: 'Win', loss: 'Loss', void: 'Void',
  half_win: 'Half win', half_loss: 'Half loss',
};

const MINUTE_BUCKETS = [
  { label: "≤25'", min: 0, max: 25 },
  { label: "26–30'", min: 26, max: 30 },
  { label: "31–35'", min: 31, max: 35 },
  { label: "36–40'", min: 36, max: 40 },
  { label: ">40'", min: 41, max: Infinity },
];

const DEFAULT_BANDS = { bassa_max: 1.75, media_max: 1.95 };

// ---------------------------------------------------------------- stato

let db = null;
let strategies = [];          // [{id, ...data}]
let bands = { ...DEFAULT_BANDS };
let selectedStrategyId = localStorage.getItem('bd_last_strategy') || '';
let editingBetId = null;
let editingStrategyId = null;
let dashboardBets = [];       // cache dei documenti del periodo corrente
let bankrollChart = null;

const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- utils

function parseNum(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function fmtMoney(n) {
  if (n === null || n === undefined) return '—';
  return (n >= 0 ? '+' : '') + n.toFixed(2) + ' €';
}

function fmtPct(n) {
  if (n === null || !Number.isFinite(n)) return '—';
  return (n * 100).toFixed(1) + '%';
}

function toDate(ts) {
  if (!ts) return null;
  return ts.toDate ? ts.toDate() : new Date(ts);
}

function toDatetimeLocal(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

function fmtDate(ts) {
  const d = toDate(ts);
  if (!d) return '—';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function computeProfit(result, odds, stake) {
  switch (result) {
    case 'win': return stake * (odds - 1);
    case 'loss': return -stake;
    case 'void': return 0;
    case 'half_win': return stake * (odds - 1) / 2;
    case 'half_loss': return -stake / 2;
    default: return null;
  }
}

// Strike rate pesato: half_win = 0.5 vinta su peso 0.5, half_loss = 0 su 0.5, void esclusa.
function weightedRecord(bets) {
  let wins = 0, weight = 0;
  for (const b of bets) {
    switch (b.result) {
      case 'win': wins += 1; weight += 1; break;
      case 'loss': weight += 1; break;
      case 'half_win': wins += 0.5; weight += 0.5; break;
      case 'half_loss': weight += 0.5; break;
      default: break; // pending e void escluse
    }
  }
  return { wins, weight };
}

// Intervallo di confidenza Wilson al 95%.
function wilson(p, n) {
  if (n <= 0) return null;
  const z = 1.96;
  const denom = 1 + z * z / n;
  const center = p + z * z / (2 * n);
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * n)) / n);
  return [Math.max(0, (center - margin) / denom), Math.min(1, (center + margin) / denom)];
}

function oddsBand(odds) {
  if (odds <= bands.bassa_max) return 'bassa';
  if (odds <= bands.media_max) return 'media';
  return 'alta';
}

let toastTimer = null;
function toast(msg, undoFn = null) {
  const el = $('toast');
  el.innerHTML = escapeHtml(msg);
  if (undoFn) {
    const btn = document.createElement('button');
    btn.className = 'undo-btn';
    btn.textContent = 'ANNULLA';
    btn.onclick = () => { el.classList.add('hidden'); undoFn(); };
    el.appendChild(btn);
  }
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), undoFn ? 6000 : 2500);
}

// ---------------------------------------------------------------- firebase

// Config del progetto BetDiary. Non è un secret: è client-side e la protezione
// reale sono le regole Firestore (accesso solo autenticato).
const FIREBASE_CONFIG = {
  apiKey: 'AIzaSyCmEITxoRAIHl49GikG12Ntez7Zgv3KZj4',
  authDomain: 'betdiary-aaa34.firebaseapp.com',
  projectId: 'betdiary-aaa34',
  storageBucket: 'betdiary-aaa34.firebasestorage.app',
  messagingSenderId: '947571323550',
  appId: '1:947571323550:web:06720c7d437420b5cc018f',
};

async function initFirebase() {
  const status = $('conn-status');
  try {
    const app = initializeApp(FIREBASE_CONFIG);
    const auth = getAuth(app);
    await signInAnonymously(auth);
    db = getFirestore(app);
    status.className = 'conn-status ok';
    status.title = 'Connesso';
    return true;
  } catch (err) {
    console.error('Init Firebase fallito', err);
    status.className = 'conn-status err';
    status.title = 'Errore: ' + (err.code || err.message);
    return false;
  }
}

function requireDb() {
  if (!db) {
    toast('Configura Firebase nelle Impostazioni');
    switchView('impostazioni');
    return false;
  }
  return true;
}

async function loadBands() {
  try {
    const snap = await getDoc(doc(db, 'settings', 'odds_bands'));
    if (snap.exists()) {
      bands = { ...DEFAULT_BANDS, ...snap.data() };
    } else {
      await setDoc(doc(db, 'settings', 'odds_bands'), DEFAULT_BANDS);
      bands = { ...DEFAULT_BANDS };
    }
  } catch (err) {
    console.error('Caricamento soglie fallito', err);
  }
  $('band-low').value = bands.bassa_max;
  $('band-mid').value = bands.media_max;
}

// ---------------------------------------------------------------- navigazione

function switchView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $(`view-${name}`).classList.remove('hidden');
  document.querySelectorAll('.tab').forEach((t) =>
    t.classList.toggle('active', t.dataset.view === name));
  if (name === 'pending') refreshPending();
  if (name === 'dashboard') refreshDashboard();
}

document.querySelectorAll('.tab').forEach((t) =>
  t.addEventListener('click', () => switchView(t.dataset.view)));

// ---------------------------------------------------------------- select helpers

function fillSelect(sel, entries, { empty = null } = {}) {
  sel.innerHTML = '';
  if (empty !== null) {
    const o = document.createElement('option');
    o.value = '';
    o.textContent = empty;
    sel.appendChild(o);
  }
  for (const [value, label] of entries) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    sel.appendChild(o);
  }
}

function initStaticSelects() {
  const sportEntries = SPORTS.map((s) => [s, s]);
  fillSelect($('f-sport'), sportEntries);
  fillSelect($('s-sport'), sportEntries, { empty: '—' });
  fillSelect($('fl-sport'), sportEntries, { empty: 'Tutti gli sport' });
  fillSelect($('fl-marketcode'), BET_TYPES, { empty: 'Tutti i tipi' });
  initMarketControls('f');
  initMarketControls('s');
}

// ---------------------------------------------------------------- gruppi di pulsanti

// Gruppo a selezione singola (segmented o chips). value '' = nessuno attivo.
function buttonGroup(el, options, value, onchange) {
  el.innerHTML = '';
  el.dataset.value = value ?? '';
  for (const [val, label] of options) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'seg-btn' + (val === el.dataset.value ? ' active' : '');
    b.dataset.val = val;
    b.textContent = label;
    b.onclick = () => {
      el.dataset.value = val;
      [...el.children].forEach((c) => c.classList.toggle('active', c === b));
      if (onchange) onchange(val);
    };
    el.appendChild(b);
  }
}

function groupValue(el) { return el.dataset.value || ''; }

function setGroupValue(el, value) {
  el.dataset.value = value ?? '';
  [...el.children].forEach((c) => c.classList.toggle('active', c.dataset.val === el.dataset.value));
}

// Etichetta linea gol con l'equivalente asiatico per i quarti
function lineLabel(l) {
  const q = Math.round((l % 0.5) * 100) / 100;
  if (q === 0.25) return `${l} (${l - 0.25}/${l + 0.25})`;
  return `${l}`;
}

// ---------------------------------------------------------------- controlli mercato (riusabili f- e s-)

function initMarketControls(p) {
  buttonGroup($(`${p}-live`), LIVE_OPTS, 'pre');
  buttonGroup($(`${p}-period`), PERIOD_OPTS, 'ft');
  buttonGroup($(`${p}-1x2`), ONEX2_OPTS, '');
  buttonGroup($(`${p}-dc`), DC_OPTS, '');
  buttonGroup($(`${p}-ggng`), GGNG_OPTS, '');
  buttonGroup($(`${p}-pari`), PARI_OPTS, '');
  buttonGroup($(`${p}-oudir`), OUDIR_OPTS, 'over');
  buttonGroup($(`${p}-ouline`), OU_LINES.map((l) => [String(l), lineLabel(l)]), '');
  buttonGroup($(`${p}-multigoal`), MULTIGOAL_RANGES.map((r) => [r, r]), '');
  buttonGroup($(`${p}-type`), BET_TYPES, '', (type) => showSelBlock(p, type));
  showSelBlock(p, '');
}

function showSelBlock(p, type) {
  for (const t of SEL_TYPES) {
    $(`${p}-sel-${t}`).classList.toggle('hidden', t !== type);
  }
}

// Legge il mercato composto dai controlli con prefisso p
function readMarket(p) {
  const type = groupValue($(`${p}-type`));
  const live = groupValue($(`${p}-live`)) === 'live';
  const period = groupValue($(`${p}-period`)) || 'ft';
  let selection = null;
  let line = null;
  let core = BET_TYPE_LABELS[type] || '';
  if (type === '1x2') { selection = groupValue($(`${p}-1x2`)) || null; core = selection ? `1X2 ${selection}` : '1X2'; }
  else if (type === 'doppia_chance') { selection = groupValue($(`${p}-dc`)) || null; core = selection ? `DC ${selection}` : 'Doppia chance'; }
  else if (type === 'over_under') {
    selection = groupValue($(`${p}-oudir`)) || 'over';
    line = parseNum(groupValue($(`${p}-ouline`)));
    core = `${selection === 'over' ? 'Over' : 'Under'}${line != null ? ' ' + line : ''}`;
  } else if (type === 'gg_ng') { selection = groupValue($(`${p}-ggng`)) || null; core = selection || 'GG/NG'; }
  else if (type === 'multigoal') { selection = groupValue($(`${p}-multigoal`)) || null; core = selection ? `Multigoal ${selection}` : 'Multigoal'; }
  else if (type === 'pari_dispari') { selection = groupValue($(`${p}-pari`)) || null; core = selection === 'dispari' ? 'Dispari' : selection === 'pari' ? 'Pari' : 'Pari/Dispari'; }
  else if (type === 'altro') { selection = $(`${p}-altro`).value.trim() || null; core = selection || 'Altro'; }

  const ctx = [period === 'ht' ? '1T' : null, live ? 'Live' : null].filter(Boolean).join(' · ');
  const market = type ? (ctx ? `${core} · ${ctx}` : core) : null;
  return { market_code: type || null, selection, line, live, period, market };
}

// Imposta i controlli con prefisso p dai valori m
function setMarket(p, m = {}) {
  setGroupValue($(`${p}-live`), m.live ? 'live' : 'pre');
  setGroupValue($(`${p}-period`), m.period || 'ft');
  const type = m.market_code || '';
  setGroupValue($(`${p}-type`), type);
  showSelBlock(p, type);
  setGroupValue($(`${p}-1x2`), type === '1x2' ? (m.selection || '') : '');
  setGroupValue($(`${p}-dc`), type === 'doppia_chance' ? (m.selection || '') : '');
  setGroupValue($(`${p}-ggng`), type === 'gg_ng' ? (m.selection || '') : '');
  setGroupValue($(`${p}-pari`), type === 'pari_dispari' ? (m.selection || '') : '');
  setGroupValue($(`${p}-oudir`), type === 'over_under' ? (m.selection || 'over') : 'over');
  setGroupValue($(`${p}-ouline`), type === 'over_under' && m.line != null ? String(m.line) : '');
  $(`${p}-altro`).value = type === 'altro' ? (m.selection || '') : '';
}

// ---------------------------------------------------------------- strategie

async function loadStrategies() {
  if (!db) return;
  try {
    const snap = await getDocs(collection(db, 'strategies'));
    strategies = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    strategies.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.name.localeCompare(b.name));
  } catch (err) {
    console.error('Caricamento strategie fallito', err);
    toast('Errore nel caricare le strategie');
    return;
  }
  renderStrategyGrid();
  renderStrategyList();
  fillSelect($('fl-strategy'),
    strategies.map((s) => [s.id, s.name]), { empty: 'Tutte le strategie' });
}

function renderStrategyGrid() {
  const grid = $('strategy-grid');
  grid.innerHTML = '';
  for (const s of strategies.filter((x) => x.active !== false)) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'strategy-btn' + (s.id === selectedStrategyId ? ' selected' : '');
    btn.innerHTML = `${escapeHtml(s.name)}<small>${escapeHtml([s.sport_default, s.market_default].filter(Boolean).join(' · ') || '—')}</small>`;
    btn.onclick = () => selectStrategy(s.id);
    grid.appendChild(btn);
  }
  const free = document.createElement('button');
  free.type = 'button';
  free.className = 'strategy-btn free' + (selectedStrategyId === '' ? ' selected' : '');
  free.innerHTML = 'Libera<small>senza preset</small>';
  free.onclick = () => selectStrategy('');
  grid.appendChild(free);
}

function selectStrategy(id) {
  selectedStrategyId = id;
  localStorage.setItem('bd_last_strategy', id);
  renderStrategyGrid();
  applyPreset();
}

function applyPreset() {
  const s = strategies.find((x) => x.id === selectedStrategyId);
  if (!s) return;
  if (s.sport_default) $('f-sport').value = s.sport_default;
  $('f-stake').value = s.stake_default ?? '';
  $('f-minute').value = s.entry_minute_default ?? '';
  setMarket('f', {
    market_code: s.market_code_default,
    selection: s.selection_default,
    line: s.line_default,
    live: s.live_default,
    period: s.period_default,
  });
}

// ---- CRUD strategie (impostazioni) ----

function renderStrategyList() {
  const list = $('strategy-list');
  list.innerHTML = '';
  if (!strategies.length) {
    list.innerHTML = '<p class="hint">Nessuna strategia: creane una per avere i pulsanti di precompilazione in home.</p>';
    return;
  }
  for (const s of strategies) {
    const item = document.createElement('div');
    item.className = 'strategy-item' + (s.active === false ? ' inactive' : '');
    item.innerHTML = `<div class="s-info">${escapeHtml(s.name)}<small>${escapeHtml([s.sport_default, s.market_default, s.stake_default != null ? s.stake_default + '€' : null].filter(Boolean).join(' · ') || '—')}</small></div><span>✏️</span>`;
    item.onclick = () => openStrategyForm(s.id);
    list.appendChild(item);
  }
}

function openStrategyForm(id = null) {
  editingStrategyId = id;
  const s = strategies.find((x) => x.id === id) || {};
  $('strategy-form-title').textContent = id ? 'Modifica strategia' : 'Nuova strategia';
  $('s-name').value = s.name || '';
  $('s-description').value = s.description || '';
  $('s-sport').value = s.sport_default || '';
  $('s-stake').value = s.stake_default ?? '';
  $('s-minute').value = s.entry_minute_default ?? '';
  $('s-order').value = s.sort_order ?? 0;
  $('s-active').checked = s.active !== false;
  setMarket('s', {
    market_code: s.market_code_default,
    selection: s.selection_default,
    line: s.line_default,
    live: s.live_default,
    period: s.period_default,
  });
  $('btn-delete-strategy').classList.toggle('hidden', !id);
  $('strategy-form').classList.remove('hidden');
  $('strategy-form').scrollIntoView({ behavior: 'smooth' });
}

function closeStrategyForm() {
  editingStrategyId = null;
  $('strategy-form').classList.add('hidden');
}

$('btn-new-strategy').addEventListener('click', () => openStrategyForm());
$('btn-cancel-strategy').addEventListener('click', closeStrategyForm);

$('strategy-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireDb()) return;
  const m = readMarket('s');
  const data = {
    name: $('s-name').value.trim(),
    description: $('s-description').value.trim(),
    sport_default: $('s-sport').value || null,
    market_code_default: m.market_code,
    selection_default: m.selection,
    line_default: m.line,
    live_default: m.live,
    period_default: m.period,
    market_default: m.market,           // testo composto, per l'etichetta del pulsante
    stake_default: parseNum($('s-stake').value),
    entry_minute_default: parseNum($('s-minute').value),
    sort_order: parseNum($('s-order').value) ?? 0,
    active: $('s-active').checked,
  };
  if (!data.name) return;
  try {
    if (editingStrategyId) {
      await updateDoc(doc(db, 'strategies', editingStrategyId), data);
    } else {
      await addDoc(collection(db, 'strategies'), { ...data, created_at: Timestamp.now() });
    }
    toast('Strategia salvata');
    closeStrategyForm();
    await loadStrategies();
  } catch (err) {
    console.error(err);
    toast('Errore nel salvataggio');
  }
});

$('btn-delete-strategy').addEventListener('click', async () => {
  if (!editingStrategyId || !requireDb()) return;
  if (!confirm('Eliminare questa strategia? Le giocate registrate restano.')) return;
  try {
    await deleteDoc(doc(db, 'strategies', editingStrategyId));
    toast('Strategia eliminata');
    closeStrategyForm();
    await loadStrategies();
  } catch (err) {
    console.error(err);
    toast('Errore nell\'eliminazione');
  }
});

// ---------------------------------------------------------------- form bet

function resetBetForm({ keepPreset = true } = {}) {
  editingBetId = null;
  $('form-title').textContent = 'Nuova giocata';
  $('btn-save').textContent = 'Salva giocata';
  $('btn-delete').classList.add('hidden');
  $('btn-cancel-edit').classList.add('hidden');
  $('bet-form').reset();
  $('f-placed').value = toDatetimeLocal(new Date());
  $('f-sport').value = 'calcio';
  setMarket('f', {}); // riporta interruttori e tipo allo stato neutro
  if (keepPreset) applyPreset();
}

$('btn-cancel-edit').addEventListener('click', () => resetBetForm());

// Stepper rapidi per lo stake: +/- 1 / 0.5 / 0.05 (arrotondato a 2 decimali, mai sotto zero)
$('stake-steppers').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-delta]');
  if (!btn) return;
  const delta = parseFloat(btn.dataset.delta);
  const cur = parseNum($('f-stake').value) || 0;
  const next = Math.max(0, Math.round((cur + delta) * 100) / 100);
  $('f-stake').value = next ? String(next) : '';
  $('f-stake').focus();
});

$('bet-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireDb()) return;

  const odds = parseNum($('f-odds').value);
  const stake = parseNum($('f-stake').value);
  if (!odds || odds <= 1) { toast('Quota non valida'); return; }
  if (!stake || stake <= 0) { toast('Stake non valido'); return; }

  const strategy = strategies.find((x) => x.id === selectedStrategyId) || null;
  const placed = $('f-placed').value ? new Date($('f-placed').value) : new Date();
  const m = readMarket('f');

  const data = {
    placed_at: Timestamp.fromDate(placed),
    sport: $('f-sport').value || 'calcio',
    event: $('f-event').value.trim() || null,
    competition: $('f-competition').value.trim() || null,
    market: m.market || 'n.d.',
    market_code: m.market_code,
    selection: m.selection,
    line: m.line,
    live: m.live,
    period: m.period,
    odds: Math.round(odds * 1000) / 1000,
    stake: Math.round(stake * 100) / 100,
    entry_minute: parseNum($('f-minute').value),
    score_at_entry: $('f-score').value.trim() || null,
  };

  try {
    if (editingBetId) {
      await updateDoc(doc(db, 'bets', editingBetId), data);
      toast('Giocata aggiornata');
    } else {
      await addDoc(collection(db, 'bets'), {
        ...data,
        strategy_id: strategy?.id || null,
        strategy_name: strategy?.name || null,
        result: 'pending',
        profit: null,
        created_at: Timestamp.now(),
      });
      toast('Giocata salvata ✓');
    }
    resetBetForm();
  } catch (err) {
    console.error(err);
    toast('Errore nel salvataggio');
  }
});

$('btn-delete').addEventListener('click', async () => {
  if (!editingBetId || !requireDb()) return;
  if (!confirm('Eliminare definitivamente questa giocata?')) return;
  try {
    await deleteDoc(doc(db, 'bets', editingBetId));
    toast('Giocata eliminata');
    resetBetForm();
  } catch (err) {
    console.error(err);
    toast('Errore nell\'eliminazione');
  }
});

function editBet(bet) {
  editingBetId = bet.id;
  switchView('nuova');
  $('form-title').textContent = 'Modifica giocata';
  $('btn-save').textContent = 'Aggiorna giocata';
  $('btn-delete').classList.remove('hidden');
  $('btn-cancel-edit').classList.remove('hidden');
  $('f-event').value = bet.event || '';
  $('f-competition').value = bet.competition || '';
  $('f-odds').value = bet.odds ?? '';
  $('f-stake').value = bet.stake ?? '';
  $('f-minute').value = bet.entry_minute ?? '';
  $('f-score').value = bet.score_at_entry || '';
  $('f-sport').value = bet.sport || 'calcio';
  setMarket('f', bet);
  const d = toDate(bet.placed_at);
  $('f-placed').value = d ? toDatetimeLocal(d) : toDatetimeLocal(new Date());
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------------------------------------------------------------- pending e saldo

async function refreshPending() {
  if (!db) return;
  try {
    const pendSnap = await getDocs(query(collection(db, 'bets'), where('result', '==', 'pending')));
    const pending = pendSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    // placed_at ha precisione al minuto: created_at come spareggio per un ordine stabile
    pending.sort((a, b) => (toDate(b.placed_at) || 0) - (toDate(a.placed_at) || 0)
      || (toDate(b.created_at) || 0) - (toDate(a.created_at) || 0));

    const recentSnap = await getDocs(query(collection(db, 'bets'), orderBy('placed_at', 'desc'), limit(40)));
    const settled = recentSnap.docs.map((d) => ({ id: d.id, ...d.data() }))
      .filter((b) => b.result !== 'pending').slice(0, 10);

    $('pending-count').textContent = pending.length;
    renderBetCards($('pending-list'), pending, { settleButtons: true });
    renderBetCards($('settled-list'), settled, { reopenButton: true });
  } catch (err) {
    console.error(err);
    toast('Errore nel caricare le pending');
  }
}

function betCardHtml(b) {
  const profitCls = b.profit > 0 ? 'pos' : b.profit < 0 ? 'neg' : 'zero';
  const hasEvent = b.event && b.event.trim();
  const title = hasEvent ? b.event : (b.market || 'Giocata');
  const info = [
    b.strategy_name, b.sport,
    title === b.market ? null : b.market,
    b.entry_minute != null ? `${b.entry_minute}'` : null,
    b.score_at_entry ? `[${b.score_at_entry}]` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="row1">
      <span class="event">${escapeHtml(title)}</span>
      <span>@${(b.odds ?? 0).toFixed(2)} × ${(b.stake ?? 0).toFixed(2)}€</span>
    </div>
    <div class="row2">
      <span>${escapeHtml(info)}</span>
      <span>${fmtDate(b.placed_at)}
        ${b.result !== 'pending'
          ? `<span class="result-chip ${b.result}">${RESULT_LABELS[b.result]}</span> <span class="profit ${profitCls}">${fmtMoney(b.profit)}</span>`
          : ''}
      </span>
    </div>`;
}

function renderBetCards(container, bets, { settleButtons = false, reopenButton = false } = {}) {
  container.innerHTML = '';
  if (!bets.length) {
    container.innerHTML = '<p class="hint">Niente qui.</p>';
    return;
  }
  for (const b of bets) {
    const card = document.createElement('div');
    card.className = 'bet-card';
    card.innerHTML = betCardHtml(b);
    card.querySelector('.event').onclick = () => editBet(b);

    if (settleButtons) {
      const row = document.createElement('div');
      row.className = 'settle-btns';
      const buttons = [
        ['win', 'W', 'sw'], ['half_win', '½W', 'sw'], ['void', 'V', 'sv'],
        ['half_loss', '½L', 'sl'], ['loss', 'L', 'sl'],
      ];
      for (const [result, label, cls] of buttons) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.textContent = label;
        btn.onclick = () => settleBet(b, result);
        row.appendChild(btn);
      }
      card.appendChild(row);
    }

    if (reopenButton) {
      const btn = document.createElement('button');
      btn.className = 'undo-btn';
      btn.textContent = 'Riporta a pending';
      btn.onclick = () => reopenBet(b);
      card.appendChild(btn);
    }
    container.appendChild(card);
  }
}

async function settleBet(bet, result) {
  const profit = Math.round(computeProfit(result, bet.odds, bet.stake) * 100) / 100;
  try {
    await updateDoc(doc(db, 'bets', bet.id), { result, profit });
    toast(`${bet.event}: ${RESULT_LABELS[result]} (${fmtMoney(profit)})`, async () => {
      await updateDoc(doc(db, 'bets', bet.id), { result: 'pending', profit: null });
      refreshPending();
    });
    refreshPending();
  } catch (err) {
    console.error(err);
    toast('Errore nel saldo');
  }
}

async function reopenBet(bet) {
  try {
    await updateDoc(doc(db, 'bets', bet.id), { result: 'pending', profit: null });
    toast('Riportata a pending');
    refreshPending();
  } catch (err) {
    console.error(err);
    toast('Errore');
  }
}

// ---------------------------------------------------------------- dashboard

async function loadDashboardBets() {
  const period = $('fl-period').value;
  let q;
  if (period === 'all') {
    q = query(collection(db, 'bets'), orderBy('placed_at', 'asc'));
  } else {
    const start = new Date();
    start.setDate(start.getDate() - Number(period));
    start.setHours(0, 0, 0, 0);
    q = query(collection(db, 'bets'),
      where('placed_at', '>=', Timestamp.fromDate(start)),
      orderBy('placed_at', 'asc'));
  }
  const snap = await getDocs(q);
  dashboardBets = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}

function filteredBets() {
  const st = $('fl-strategy').value;
  const sp = $('fl-sport').value;
  const mc = $('fl-marketcode').value;
  return dashboardBets.filter((b) =>
    (!st || b.strategy_id === st) &&
    (!sp || b.sport === sp) &&
    (!mc || b.market_code === mc));
}

async function refreshDashboard() {
  if (!db) return;
  try {
    await loadDashboardBets();
  } catch (err) {
    console.error(err);
    toast('Errore nel caricare i dati');
    return;
  }
  renderDashboard();
}

['fl-period', 'fl-strategy', 'fl-sport', 'fl-marketcode'].forEach((id) =>
  $(id).addEventListener('change', () =>
    id === 'fl-period' ? refreshDashboard() : renderDashboard()));

function renderDashboard() {
  const bets = filteredBets();
  const settled = bets.filter((b) => b.result !== 'pending' && b.profit !== null);

  // ---- KPI complessivi
  const totProfit = settled.reduce((s, b) => s + b.profit, 0);
  const totStake = settled.reduce((s, b) => s + b.stake, 0);
  const { wins, weight } = weightedRecord(settled);
  const sr = weight > 0 ? wins / weight : null;
  const ci = sr !== null ? wilson(sr, weight) : null;
  const ev = totStake > 0 ? totProfit / totStake : null;

  // ---- curva bankroll + max drawdown
  const curve = [];
  let cum = 0, peak = 0, maxDD = 0;
  for (const b of settled) {
    cum += b.profit;
    curve.push({ x: toDate(b.placed_at), y: Math.round(cum * 100) / 100 });
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
  }

  $('kpi-cards').innerHTML = `
    <div class="kpi"><div class="kpi-label">Profit</div>
      <div class="kpi-value ${totProfit > 0 ? 'pos' : totProfit < 0 ? 'neg' : ''}">${fmtMoney(totProfit)}</div>
      <div class="kpi-sub">${settled.length} saldate · ${bets.length - settled.length} pending</div></div>
    <div class="kpi"><div class="kpi-label">EV% realizzato</div>
      <div class="kpi-value ${ev > 0 ? 'pos' : ev < 0 ? 'neg' : ''}">${fmtPct(ev)}</div>
      <div class="kpi-sub">stake totale ${totStake.toFixed(0)}€</div></div>
    <div class="kpi"><div class="kpi-label">Strike rate</div>
      <div class="kpi-value">${fmtPct(sr)}</div>
      <div class="kpi-sub">${ci ? `IC95: ${fmtPct(ci[0])}–${fmtPct(ci[1])}` : '—'}</div></div>
    <div class="kpi"><div class="kpi-label">Max drawdown</div>
      <div class="kpi-value ${maxDD > 0 ? 'neg' : ''}">${maxDD > 0 ? '-' + maxDD.toFixed(2) + ' €' : '0.00 €'}</div>
      <div class="kpi-sub">dal picco della curva</div></div>`;

  renderBankrollChart(curve);
  renderBandsTable(settled);
  renderMinutesTable(settled);

  const recent = [...bets].reverse().slice(0, 15);
  renderBetCards($('recent-list'), recent);
}

function renderBankrollChart(curve) {
  const ctx = $('chart-bankroll');
  if (bankrollChart) bankrollChart.destroy();
  bankrollChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: curve.map((p) => `${p.x.getDate()}/${p.x.getMonth() + 1}`),
      datasets: [{
        label: 'Bankroll (profit cumulativo €)',
        data: curve.map((p) => p.y),
        borderColor: '#4f7cff',
        backgroundColor: 'rgba(79,124,255,0.14)',
        fill: true,
        pointRadius: 0,
        tension: 0.15,
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#64708c', boxWidth: 12, font: { weight: '600' } } } },
      scales: {
        x: { ticks: { color: '#64708c', maxTicksLimit: 8 }, grid: { color: '#e6ebf6' } },
        y: { ticks: { color: '#64708c' }, grid: { color: '#e6ebf6' } },
      },
    },
  });
}

function statsRow(label, group) {
  const { wins, weight } = weightedRecord(group);
  const sr = weight > 0 ? wins / weight : null;
  const ci = sr !== null ? wilson(sr, weight) : null;
  const stake = group.reduce((s, b) => s + b.stake, 0);
  const profit = group.reduce((s, b) => s + b.profit, 0);
  const ev = stake > 0 ? profit / stake : null;
  const avgOdds = group.length ? group.reduce((s, b) => s + b.odds, 0) / group.length : null;
  const be = avgOdds ? 1 / avgOdds : null;
  const evCls = ev > 0 ? 'pos' : ev < 0 ? 'neg' : '';
  return `<tr>
    <td>${escapeHtml(label)}</td>
    <td>${group.length}</td>
    <td>${fmtPct(sr)}</td>
    <td>${ci ? `${fmtPct(ci[0])}–${fmtPct(ci[1])}` : '—'}</td>
    <td>${avgOdds ? avgOdds.toFixed(2) : '—'}</td>
    <td>${fmtPct(be)}</td>
    <td class="${evCls}">${fmtPct(ev)}</td>
    <td class="${profit > 0 ? 'pos' : profit < 0 ? 'neg' : ''}">${fmtMoney(profit)}</td>
  </tr>`;
}

const STATS_HEADER = `<tr><th></th><th>N</th><th>SR</th><th>IC95</th><th>Q.media</th><th>BE</th><th>EV%</th><th>Profit</th></tr>`;

function renderBandsTable(settled) {
  const groups = {
    [`bassa ≤${bands.bassa_max}`]: settled.filter((b) => oddsBand(b.odds) === 'bassa'),
    [`media ≤${bands.media_max}`]: settled.filter((b) => oddsBand(b.odds) === 'media'),
    [`alta >${bands.media_max}`]: settled.filter((b) => oddsBand(b.odds) === 'alta'),
  };
  $('tbl-bands').innerHTML = STATS_HEADER +
    Object.entries(groups).map(([label, g]) => statsRow(label, g)).join('');
}

function renderMinutesTable(settled) {
  const rows = MINUTE_BUCKETS.map((bk) =>
    statsRow(bk.label, settled.filter((b) =>
      b.entry_minute != null && b.entry_minute >= bk.min && b.entry_minute <= bk.max)));
  const noMinute = settled.filter((b) => b.entry_minute == null);
  if (noMinute.length) rows.push(statsRow('senza minuto', noMinute));
  $('tbl-minutes').innerHTML = STATS_HEADER + rows.join('');
}

// ---------------------------------------------------------------- impostazioni

$('btn-save-bands').addEventListener('click', async () => {
  if (!requireDb()) return;
  const low = parseNum($('band-low').value);
  const mid = parseNum($('band-mid').value);
  if (!low || !mid || low >= mid) { toast('Soglie non valide (bassa < media)'); return; }
  try {
    await setDoc(doc(db, 'settings', 'odds_bands'), { bassa_max: low, media_max: mid });
    bands = { bassa_max: low, media_max: mid };
    toast('Soglie salvate');
  } catch (err) {
    console.error(err);
    toast('Errore nel salvataggio');
  }
});

$('btn-export-csv').addEventListener('click', async () => {
  if (!requireDb()) return;
  try {
    const snap = await getDocs(query(collection(db, 'bets'), orderBy('placed_at', 'asc')));
    const cols = ['placed_at', 'strategy_name', 'sport', 'event', 'competition', 'market',
      'market_code', 'selection', 'line', 'live', 'period', 'odds', 'stake',
      'entry_minute', 'score_at_entry', 'result', 'profit', 'notes'];
    const esc = (v) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      return /[",\n;]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.join(',')];
    for (const d of snap.docs) {
      const b = d.data();
      lines.push(cols.map((c) => {
        if (c === 'placed_at') {
          const dt = toDate(b.placed_at);
          return dt ? esc(dt.toISOString()) : '';
        }
        return esc(b[c]);
      }).join(','));
    }
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `betdiary_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
    toast(`Esportate ${snap.size} giocate`);
  } catch (err) {
    console.error(err);
    toast('Errore nell\'export');
  }
});

// ---------------------------------------------------------------- avvio

async function main() {
  initStaticSelects();
  resetBetForm({ keepPreset: false });

  const ok = await initFirebase();
  if (!ok) {
    toast('Connessione a Firebase fallita — riprova più tardi');
    return;
  }
  await loadBands();
  await loadStrategies();
  applyPreset();
}

main();
