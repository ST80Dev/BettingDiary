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

const MARKET_CODES = [
  ['over_under', 'Over/Under'],
  ['handicap_asiatico', 'Handicap asiatico'],
  ['handicap_europeo', 'Handicap europeo'],
  ['1x2', '1X2'],
  ['testa_a_testa', 'Testa a testa'],
  ['gg_ng', 'Gol/NoGol'],
  ['doppia_chance', 'Doppia chance'],
  ['dnb', 'Draw no bet'],
  ['vincente_torneo', 'Vincente torneo'],
  ['altro', 'Altro'],
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

function getFirebaseConfig() {
  try { return JSON.parse(localStorage.getItem('bd_firebase_config')); }
  catch { return null; }
}

async function initFirebase() {
  const cfg = getFirebaseConfig();
  const status = $('conn-status');
  if (!cfg || !cfg.projectId) {
    status.className = 'conn-status err';
    status.title = 'Firebase non configurato';
    return false;
  }
  try {
    const app = initializeApp(cfg);
    const auth = getAuth(app);
    await signInAnonymously(auth);
    db = getFirestore(app);
    status.className = 'conn-status ok';
    status.title = 'Connesso';
    return true;
  } catch (err) {
    console.error('Init Firebase fallito', err);
    status.className = 'conn-status err';
    status.title = 'Errore: ' + err.message;
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
  fillSelect($('f-marketcode'), MARKET_CODES, { empty: '—' });
  fillSelect($('s-sport'), sportEntries, { empty: '—' });
  fillSelect($('s-marketcode'), MARKET_CODES, { empty: '—' });
  fillSelect($('fl-sport'), sportEntries, { empty: 'Tutti gli sport' });
  fillSelect($('fl-marketcode'), MARKET_CODES, { empty: 'Tutti i mercati' });
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
  $('f-marketcode').value = s.market_code_default || '';
  $('f-market').value = s.market_default || '';
  $('f-line').value = s.line_default ?? '';
  $('f-stake').value = s.stake_default ?? '';
  $('f-minute').value = s.entry_minute_default ?? '';
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
  $('s-marketcode').value = s.market_code_default || '';
  $('s-market').value = s.market_default || '';
  $('s-line').value = s.line_default ?? '';
  $('s-stake').value = s.stake_default ?? '';
  $('s-minute').value = s.entry_minute_default ?? '';
  $('s-order').value = s.sort_order ?? 0;
  $('s-active').checked = s.active !== false;
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
  const data = {
    name: $('s-name').value.trim(),
    description: $('s-description').value.trim(),
    sport_default: $('s-sport').value || null,
    market_code_default: $('s-marketcode').value || null,
    market_default: $('s-market').value.trim() || null,
    line_default: parseNum($('s-line').value),
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
  if (keepPreset) applyPreset();
}

$('btn-cancel-edit').addEventListener('click', () => resetBetForm());

$('bet-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!requireDb()) return;

  const odds = parseNum($('f-odds').value);
  const stake = parseNum($('f-stake').value);
  const event = $('f-event').value.trim();
  if (!event) { toast('Inserisci l\'evento'); return; }
  if (!odds || odds <= 1) { toast('Quota non valida'); return; }
  if (!stake || stake <= 0) { toast('Stake non valido'); return; }

  const strategy = strategies.find((x) => x.id === selectedStrategyId) || null;
  const placed = $('f-placed').value ? new Date($('f-placed').value) : new Date();

  const data = {
    placed_at: Timestamp.fromDate(placed),
    sport: $('f-sport').value || 'calcio',
    event,
    competition: $('f-competition').value.trim() || null,
    market: $('f-market').value.trim() || $('f-marketcode').selectedOptions[0]?.textContent || 'n.d.',
    market_code: $('f-marketcode').value || null,
    line: parseNum($('f-line').value),
    odds: Math.round(odds * 1000) / 1000,
    stake: Math.round(stake * 100) / 100,
    entry_minute: parseNum($('f-minute').value),
    score_at_entry: $('f-score').value.trim() || null,
    notes: $('f-notes').value.trim() || null,
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
  $('form-details').open = true;
  $('f-event').value = bet.event || '';
  $('f-competition').value = bet.competition || '';
  $('f-odds').value = bet.odds ?? '';
  $('f-stake').value = bet.stake ?? '';
  $('f-minute').value = bet.entry_minute ?? '';
  $('f-score').value = bet.score_at_entry || '';
  $('f-sport').value = bet.sport || 'calcio';
  $('f-marketcode').value = bet.market_code || '';
  $('f-market').value = bet.market || '';
  $('f-line').value = bet.line ?? '';
  $('f-notes').value = bet.notes || '';
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
  const info = [
    b.strategy_name, b.sport, b.market,
    b.entry_minute != null ? `${b.entry_minute}'` : null,
    b.score_at_entry ? `[${b.score_at_entry}]` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="row1">
      <span class="event">${escapeHtml(b.event)}</span>
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
        borderColor: '#4f8cff',
        backgroundColor: 'rgba(79,140,255,0.12)',
        fill: true,
        pointRadius: 0,
        tension: 0.15,
        borderWidth: 2,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#8b96ad', boxWidth: 12 } } },
      scales: {
        x: { ticks: { color: '#8b96ad', maxTicksLimit: 8 }, grid: { color: '#1f2940' } },
        y: { ticks: { color: '#8b96ad' }, grid: { color: '#1f2940' } },
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

// Accetta sia JSON puro sia il frammento JS copiato dalla console Firebase
// ("const firebaseConfig = { apiKey: '...', ... };").
function parseFirebaseConfigInput(raw) {
  let s = raw.trim();
  const m = s.match(/\{[\s\S]*\}/);
  if (m) s = m[0];
  try { return JSON.parse(s); } catch { /* prova come snippet JS */ }
  s = s.replace(/'/g, '"')
    .replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, '$1"$2":')
    .replace(/,\s*}/g, '}');
  try { return JSON.parse(s); } catch { return null; }
}

$('btn-save-config').addEventListener('click', async () => {
  const cfg = parseFirebaseConfigInput($('cfg-firebase').value);
  if (!cfg) { $('cfg-status').textContent = 'Config non riconosciuta: incolla il frammento firebaseConfig copiato dalla console.'; return; }
  if (!cfg.projectId || !cfg.apiKey) {
    $('cfg-status').textContent = 'Config incompleta: servono almeno apiKey e projectId.';
    return;
  }
  localStorage.setItem('bd_firebase_config', JSON.stringify(cfg));
  $('cfg-status').textContent = 'Salvata. Ricarico…';
  location.reload();
});

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
      'market_code', 'line', 'odds', 'stake', 'entry_minute', 'score_at_entry',
      'result', 'profit', 'notes'];
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
  const cfg = getFirebaseConfig();
  if (cfg) $('cfg-firebase').value = JSON.stringify(cfg, null, 2);

  const ok = await initFirebase();
  if (!ok) {
    $('cfg-status').textContent = 'Non connesso: incolla la config e salva.';
    switchView('impostazioni');
    return;
  }
  $('cfg-status').textContent = `Connesso al progetto "${cfg.projectId}".`;
  await loadBands();
  await loadStrategies();
  applyPreset();
}

main();
