# BetDiary — Diario bet manuale con preset di strategia

> Nota deploy: si parte come **semplice web app su GitHub Pages**, aperta dal browser del
> telefono. Niente manifest/service worker in v1: la "PWA installabile" è un'aggiunta
> opzionale futura (vedi §5.5).

> Documento bootstrap per Claude Code. Leggere integralmente prima di scrivere codice.
> Workflow: procedere per fasi, chiedere conferma a Simone al termine di ogni fase prima di passare alla successiva.
> Questo documento sostituisce la versione precedente centrata sull'estrazione AI da screenshot:
> l'AI resta prevista, ma come **ultima fase opzionale** (vedi Appendice A).

---

## 1. Obiettivo

Web app personale (servita da GitHub Pages, usata dal browser del telefono) per registrare
~50 bet/giorno con **inserimento manuale velocissimo** basato su
preset di strategia: tap sulla strategia → form precompilato → si digitano solo i campi
variabili → salvataggio. Multi-sport e multi-tipo di giocata (solo **singole**, a quota fissa,
inclusi mercati asiatici con esiti half win/half loss e void).

Obiettivo analitico primario: verificare in quale **fascia di quota** (e per le strategie live,
in quale **minuto d'ingresso** / situazione di punteggio) una strategia ha edge reale.
KPI: strike rate, EV% realizzato, break-even, curva bankroll e max drawdown.

Principi di design (non negoziabili):
- **Inserimento sotto i 10 secondi**: il preset compila tutto il compilabile, l'utente tocca
  solo ciò che cambia per forza a ogni giocata.
- Vanilla JS, HTML, CSS. Nessun framework, nessun build step. File separati ammessi
  (index.html, app.js, style.css) ma niente bundler.
- Mobile-first: l'uso principale è da telefono, spesso durante il live.
- Interfaccia in italiano.
- Niente tracking del bookmaker: non interessa monitorare differenze tra conti.

## 2. Stack e architettura

```
[Web app su GitHub Pages]
   │  supabase-js (anon key + RLS)
   ▼
[Supabase Postgres]  ← tabelle: strategies, bets, app_settings
   ▲
[Dashboard: query client-side + aggregazioni in JS]
```

Nessuna Edge Function nelle fasi 1–4: tutto il flusso è web app ↔ Postgres.
L'Edge Function `extract-bet` (Claude vision) arriva solo nella fase opzionale 5 (Appendice A).

Con ~50 bet/giorno (~1.500/mese, ~18.000/anno) le aggregazioni della dashboard si fanno
tranquillamente client-side scaricando le righe filtrate; niente viste materializzate in v1.

## 3. Schema database (SQL)

```sql
-- Strategie: template di precompilazione + etichetta analitica
create table strategies (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null,                     -- es. "TuttoHT 2.1 HFav_30' +0.5HT"
  description text,
  sport_default text,                     -- es. "calcio"; null = strategia trasversale
  market_code_default text,               -- vocabolario controllato, vedi sotto
  market_default text,                    -- testo libero mercato, es. "Over 0.5 1T (asiatico)"
  line_default numeric(4,2),              -- es. 0.5
  stake_default numeric(10,2),            -- stake abituale
  entry_minute_default smallint,          -- minuto d'ingresso tipico (strategie live), es. 30
  sort_order int not null default 0,      -- ordinamento dei pulsanti in home
  active boolean not null default true
);

-- Bet: una riga per giocata (solo singole)
create table bets (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  placed_at timestamptz not null default now(),  -- editabile per inserimenti a posteriori
  strategy_id uuid references strategies(id),
  sport text not null default 'calcio',
  event text not null,                    -- es. "Ajax - Heerenveen", "Sinner - Alcaraz"
  competition text,
  market text not null,                   -- descrizione mercato leggibile
  market_code text,                       -- vocabolario controllato, vedi sotto
  line numeric(4,2),                      -- linea numerica: gol/game/punti a seconda dello sport
  odds numeric(6,3) not null,
  stake numeric(10,2) not null,
  entry_minute smallint,                  -- minuto reale d'ingresso (live), null se pre-match
  score_at_entry text,                    -- punteggio al momento della giocata, es. "0-0"
  result text not null default 'pending'
    check (result in ('pending','win','loss','void','half_win','half_loss')),
  profit numeric(10,2),                   -- calcolato al saldo (vedi formule §4)
  raw_json jsonb,                         -- riservato alla futura fase AI (Appendice A)
  image_hash text,                        -- riservato alla futura fase AI (dedup screenshot)
  notes text
);

create index idx_bets_result on bets(result);
create index idx_bets_strategy on bets(strategy_id);
create index idx_bets_placed on bets(placed_at);
create unique index idx_bets_dedup on bets(image_hash) where image_hash is not null;

-- Impostazioni applicative condivise tra dispositivi
create table app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

-- Soglie fasce di quota: configurabili, la fascia si calcola in query/client.
-- NON è una colonna generata: cambiare le soglie ricalcola retroattivamente tutte le analisi.
insert into app_settings (key, value) values
  ('odds_bands', '{"bassa_max": 1.75, "media_max": 1.95}');

-- RLS: tool personale, accesso via anon key.
-- Policy permissive (uso privato). Se servirà auth vera: Supabase Auth + policy per user_id.
alter table bets enable row level security;
alter table strategies enable row level security;
alter table app_settings enable row level security;
create policy "anon full access bets" on bets for all using (true) with check (true);
create policy "anon full access strategies" on strategies for all using (true) with check (true);
create policy "anon full access settings" on app_settings for all using (true) with check (true);
```

### Vocabolario `market_code`

Testo libero nel DB (niente enum → niente migration per estenderlo), ma l'app propone e usa
solo questo vocabolario:

`over_under` · `handicap_asiatico` · `handicap_europeo` · `1x2` · `testa_a_testa` ·
`gg_ng` · `doppia_chance` · `dnb` · `vincente_torneo` · `altro`

Serve alla dashboard per aggregare tra sport diversi ("come rendono gli over rispetto agli
handicap"); il campo `market` testuale resta la descrizione leggibile della giocata.

### Sport

Testo libero nel DB; l'app propone un vocabolario italiano fisso (`calcio`, `tennis`,
`basket`, `volley`, `hockey`, `altro`) tramite select/chips, così i filtri restano puliti
senza una tabella dedicata.

### Esiti asiatici

`void` copre il push (linea intera centrata esattamente → rimborso). `half_win`/`half_loss`
servono per le quarter-line (+0.25, +0.75, +1.25…): metà stake vinta/persa, metà rimborsata.
`line` memorizza la linea numerica unica (es. "+0.5/+1" → 0.75) per segmentare le analisi
anche per linea.

## 4. Calcolo profit (al saldo)

- win: `stake * (odds - 1)`
- loss: `-stake`
- void: `0`
- half_win: `stake * (odds - 1) / 2`
- half_loss: `-stake / 2`

Il profit si scrive nella riga al momento del saldo (non è una colonna generata) così i
totali di dashboard sono una semplice somma.

## 5. Web app — schermate

### 5.1 Inserimento rapido (home)

- Griglia di pulsanti grandi con le strategie attive (ordinate per `sort_order`); in evidenza
  l'ultima usata.
- Tap su una strategia → form precompilato con tutti i default del preset
  (sport, market_code, market, line, stake, minuto tipico).
- Campi **sempre manuali** a ogni giocata: **evento, quota, stake, minuto reale d'ingresso,
  punteggio al momento** (input ottimizzati mobile: numpad decimale per quota/stake, stepper
  per il minuto pre-valorizzato col default del preset, input compatto "0-0" per il punteggio).
- Tutti gli altri campi restano editabili inline per i ritocchi occasionali (linea, mercato…).
- `placed_at` = adesso di default, modificabile per inserimenti a posteriori.
- "Salva" → insert → toast di conferma → form pronto per la giocata successiva con lo stesso
  preset selezionato.
- Inserimento libero senza preset (tutti i campi a mano) come percorso secondario.

### 5.2 Pending e saldo

- Lista delle bet `pending` (più recenti in alto) con bottoni di esito a un tap:
  **win / loss / void / half win / half loss**. Il tap calcola il profit e salva.
- Undo immediato sull'ultimo saldo (ripristina `pending` e azzera il profit).
- Edit completo della bet da un tap sulla riga.

### 5.3 Dashboard

Aggregazioni client-side sulle righe filtrate. KPI:

- Strike rate complessivo e **per fascia di quota** — soglie lette da `app_settings.odds_bands`
  (default: bassa ≤1.75 / media 1.76–1.95 / alta >1.95) — con intervallo di confidenza al 95%
  (Wilson score: i campioni per fascia possono essere piccoli).
  Per gli esiti asiatici lo strike rate usa il conteggio pesato (half_win = 0.5 vinta,
  half_loss = 0.5 persa, void esclusa).
- EV% realizzato per fascia = profit totale / stake totale della fascia.
- Break-even per fascia = 1 / quota media di fascia, confrontato con lo SR di fascia.
- **Analisi per minuto d'ingresso** (strategie live): SR ed EV% per bucket di `entry_minute`
  (es. ≤25' / 26–30' / 31–35' / 36–40' / >40') e per `score_at_entry`.
- Curva bankroll cumulativa unica (profit progressivo su tutte le giocate) e **max drawdown**.
- Filtri combinabili: strategia, periodo, sport, market_code.
- Tabella ultime bet con edit rapido.

Grafici: Chart.js da CDN.

### 5.4 Impostazioni

- URL progetto Supabase + anon key (localStorage).
- Gestione strategie (CRUD completo dei preset, incluso l'ordinamento dei pulsanti).
- Soglie fasce di quota (scrive su `app_settings`).
- Export CSV completo (backup).

### 5.5 PWA shell (opzionale, rimandata)

In v1 l'app si usa dal browser all'URL di GitHub Pages (eventualmente aggiunta alla home
screen come semplice segnalibro). Solo se in futuro servirà l'esperienza installata:

- `manifest.json` (nome BetDiary, tema scuro, icone 192/512 generate come SVG→PNG).
- `sw.js` minimale: cache-first per gli asset statici, network-only per le chiamate Supabase.
  Niente sync offline.

## 6. Fasi di lavoro per Claude Code

1. **Fase 1 — Supabase**: creare tabelle + seed + policy con lo SQL sopra (via MCP Supabase
   o dashboard). Verifica con qualche insert/select di prova.
2. **Fase 2 — Inserimento**: home con preset, form rapido, salvataggio, CRUD strategie
   in impostazioni. Test end-to-end da mobile (browser, via GitHub Pages).
3. **Fase 3 — Pending e saldo**: lista pending, tap di esito, calcolo profit, undo.
4. **Fase 4 — Dashboard**: KPI, fasce configurabili, analisi per minuto, grafici, filtri,
   export CSV.
5. **Fase 5 (opzionale)** — PWA shell installabile (§5.5) ed estrazione AI da screenshot
   (Appendice A). Da valutare solo a diario e dashboard consolidati.

Deploy: repo GitHub dedicato + GitHub Pages. Nessun server proprio necessario.

## 7. Vincoli e attenzioni

- Quota e stake sempre con punto decimale nel DB; gli input devono accettare la virgola
  italiana e normalizzarla.
- Mai committare chiavi nel repo (la anon key vive in localStorage, inserita da Simone).
- Le soglie delle fasce sono configurazione, non schema: nessuna migration per cambiarle.
- I campi `raw_json` e `image_hash` restano vuoti fino alla fase 5: sono già nello schema per
  evitare una migration futura.

---

## Appendice A — Fase 5 opzionale: estrazione AI da screenshot

Architettura prevista (invariata rispetto al progetto originale, adattata al nuovo schema):

```
[Web app] → upload/paste screenshot (base64)
      → [Supabase Edge Function "extract-bet"]  ← ANTHROPIC_API_KEY come secret
      → Claude API (vision, modello claude-haiku-4-5 come costante configurabile)
      → JSON strutturato → schermata di conferma dell'app → insert in bets
```

- La key resta server-side come secret; l'app può stare pubblica su GitHub Pages.
- NON salvare le immagini su Storage: solo JSON estratto + SHA-256 dell'immagine in
  `image_hash` per dedup (l'indice unico esiste già).
- Due modalità: `single` (una schedina → precompila il form di conferma) e `settlement`
  (screenshot dello storico saldato → matching fuzzy con le pending su evento normalizzato
  + quota ±0.02 + data; le non matchate si risolvono a mano).
- Il prompt di estrazione deve produrre i campi del nuovo schema (inclusi `sport` e
  `market_code` dal vocabolario §3) e normalizzare le notazioni asiatiche
  ("+0/+0.5"→0.25, "+0.5/+1"→0.75, "+1/+1.5"→1.25) e la virgola decimale italiana.
- Se lo screenshot è una **multipla**: avvisare e lasciar scegliere se scartare o salvare
  come riga unica con `market_code = 'altro'` e quota totale (gambe leggibili in `raw_json`),
  per non inquinare le analisi per mercato.
- Gestione errori: strip dei code fence prima del parse, retry singolo su parse fallito,
  retry dopo 2s su HTTP 429. Se confidence bassa, evidenziare i campi in giallo in conferma.
- Prima di scrivere la Edge Function verificare su https://docs.claude.com/en/api/overview
  eventuali aggiornamenti del formato messages/vision.
