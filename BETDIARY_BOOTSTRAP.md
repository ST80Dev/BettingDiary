# BetDiary — Diario bet manuale con preset di strategia

> Nota deploy: **web app su GitHub Pages**, aperta dal browser del telefono. Niente
> manifest/service worker in v1: la "PWA installabile" è un'aggiunta opzionale futura (§5.5).
> Dati su **Firebase Firestore** (il piano free di Supabase non consente un terzo progetto
> attivo; Firestore non ha limiti di progetti né auto-pausa).

> Documento bootstrap per Claude Code. Leggere integralmente prima di scrivere codice.
> Workflow: procedere per fasi, chiedere conferma a Simone al termine di ogni fase prima
> di passare alla successiva.

---

## 1. Obiettivo

Web app personale (servita da GitHub Pages, usata dal browser del telefono) per registrare
~50 bet/giorno con **inserimento manuale velocissimo** basato su preset di strategia: tap
sulla strategia → form precompilato → si digitano solo i campi variabili → salvataggio.
Multi-sport (principalmente **calcio**, un po' di **tennis** e **basket**) e multi-tipo di
giocata (solo **singole**, a quota fissa, inclusi mercati asiatici con esiti half win/half
loss e void).

Obiettivo analitico primario: verificare in quale **fascia di quota** (e per le strategie
live, in quale **minuto d'ingresso** / situazione di punteggio) una strategia ha edge reale.
KPI: strike rate, EV% realizzato, break-even, curva bankroll e max drawdown.

Principi di design (non negoziabili):
- **Inserimento sotto i 10 secondi**: il preset compila tutto il compilabile, l'utente tocca
  solo ciò che cambia per forza a ogni giocata.
- Vanilla JS, HTML, CSS. Nessun framework, nessun build step. File separati ammessi
  (index.html, app.js, style.css) ma niente bundler.
- Mobile-first: l'uso principale è da telefono, spesso durante il live.
- Interfaccia in italiano.
- Niente tracking del bookmaker.

## 2. Stack e architettura

```
[Web app su GitHub Pages]
   │  Firebase JS SDK (modular, da CDN gstatic) + Anonymous Auth
   ▼
[Firebase Firestore]  ← collezioni: strategies, bets, settings
   ▲
[Dashboard: query per intervallo di date + aggregazioni client-side in JS]
```

- **Firestore free (Spark)**: 1 GB storage, 50k letture/20k scritture al giorno — ampiamente
  sufficienti (~50 bet/giorno, dashboard che carica qualche migliaio di documenti).
- **Sicurezza**: Anonymous Authentication abilitata nel progetto Firebase; le security rules
  richiedono `request.auth != null`. Non è auth "vera" (chiunque abbia la config può
  autenticarsi anonimamente) ma evita il DB completamente aperto e i blocchi automatici di
  Google sulle rules permissive. La config Firebase è pubblicabile per design; la si tiene
  comunque in localStorage (schermata Impostazioni) e fuori dal repo.
- Le aggregazioni della dashboard si fanno client-side; le query Firestore restano semplici
  (range su `placed_at`, uguaglianza su `result`) per **non richiedere indici compositi**.
- Setup manuale una tantum (Simone, da console.firebase.google.com): creare progetto →
  abilitare Firestore (production mode) → abilitare Anonymous Auth → incollare le security
  rules → registrare una web app e copiare la config nella schermata Impostazioni.
  Istruzioni passo-passo nel README.

## 3. Modello dati (Firestore)

### Collezione `strategies` — template di precompilazione + etichetta analitica

```
{
  name: "TuttoHT 2.1 HFav_30' +0.5HT",   // string, obbligatorio
  description: "",                        // string
  sport_default: "calcio",                // string | null (null = trasversale)
  market_code_default: "over_under",      // string | null (vocabolario sotto)
  market_default: "Over 0.5 1T (asiatico)", // string | null, testo libero
  line_default: 0.5,                      // number | null
  stake_default: 10,                      // number | null
  entry_minute_default: 30,               // number | null (strategie live)
  sort_order: 0,                          // number, ordinamento pulsanti in home
  active: true,                           // boolean
  created_at: Timestamp
}
```

### Collezione `bets` — un documento per giocata (solo singole)

```
{
  created_at: Timestamp,
  placed_at: Timestamp,          // editabile per inserimenti a posteriori
  strategy_id: "abc123" | null,  // id documento strategia
  strategy_name: "TuttoHT 2.1",  // denormalizzato per dashboard/CSV senza join
  sport: "calcio",               // obbligatorio
  event: "Ajax - Heerenveen",    // obbligatorio
  competition: "Eredivisie" | null,
  market: "Over 0.5 1T (asiatico)", // obbligatorio, descrizione leggibile
  market_code: "over_under" | null, // vocabolario sotto
  line: 0.5 | null,              // linea numerica (gol/game/punti secondo lo sport)
  odds: 1.88,                    // obbligatorio, punto decimale
  stake: 10,                     // obbligatorio
  entry_minute: 32 | null,       // minuto reale d'ingresso (live)
  score_at_entry: "0-0" | null,  // punteggio al momento della giocata
  result: "pending",             // pending|win|loss|void|half_win|half_loss
  profit: null | number,         // calcolato al saldo (formule §4)
  notes: "" 
}
```

Niente campo fascia di quota nel documento: la fascia si calcola client-side dalle soglie
in `settings`, così cambiarle ricalcola retroattivamente tutte le analisi.
I campi per la futura fase AI (`raw_json`, `image_hash`) si aggiungeranno ai documenti solo
quando servirà: Firestore è schemaless, nessuna migration.

### Collezione `settings`

```
settings/odds_bands → { bassa_max: 1.75, media_max: 1.95 }
```

(Seed creato dall'app al primo avvio se assente.)

### Security rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

### Vocabolario `market_code`

Testo libero nel DB, ma l'app propone e usa solo questo vocabolario:

`over_under` · `handicap_asiatico` · `handicap_europeo` · `1x2` · `testa_a_testa` ·
`gg_ng` · `doppia_chance` · `dnb` · `vincente_torneo` · `altro`

Serve alla dashboard per aggregare tra sport diversi; il campo `market` testuale resta la
descrizione leggibile della giocata.

### Sport

Testo libero nel DB; l'app propone un vocabolario fisso e volutamente corto:
`calcio` · `tennis` · `basket` · `altro`.

### Esiti asiatici

`void` copre il push (linea intera centrata esattamente → rimborso). `half_win`/`half_loss`
servono per le quarter-line (+0.25, +0.75, +1.25…): metà stake vinta/persa, metà rimborsata.
`line` memorizza la linea numerica unica (es. "+0.5/+1" → 0.75).

## 4. Calcolo profit (al saldo)

- win: `stake * (odds - 1)`
- loss: `-stake`
- void: `0`
- half_win: `stake * (odds - 1) / 2`
- half_loss: `-stake / 2`

Il profit si scrive nel documento al momento del saldo, così i totali di dashboard sono una
semplice somma. Strike rate con conteggio pesato: half_win = 0.5 vinta su peso 0.5,
half_loss = 0 vinte su peso 0.5, void esclusa.

## 5. Web app — schermate

### 5.1 Inserimento rapido (home)

- Griglia di pulsanti grandi con le strategie attive (ordinate per `sort_order`); in evidenza
  l'ultima usata (ricordata in localStorage).
- Tap su una strategia → form precompilato con tutti i default del preset.
- Campi **sempre manuali** a ogni giocata: **evento, quota, stake, minuto reale d'ingresso,
  punteggio al momento** (numpad decimale per quota/stake, minuto pre-valorizzato col
  default del preset).
- Tutti gli altri campi restano editabili inline per i ritocchi occasionali.
- `placed_at` = adesso di default, modificabile per inserimenti a posteriori.
- "Salva" → insert → toast di conferma → form pronto per la giocata successiva con lo stesso
  preset selezionato.
- Inserimento libero senza preset come percorso secondario.

### 5.2 Pending e saldo

- Lista delle bet `pending` (più recenti in alto) con bottoni di esito a un tap:
  **win / loss / void / half win / half loss**. Il tap calcola il profit e salva.
- Undo immediato sull'ultimo saldo; sezione "saldate di recente" con possibilità di
  riportare a pending.
- Edit completo della bet da un tap sulla riga (inclusa eliminazione).

### 5.3 Dashboard

Aggregazioni client-side sui documenti filtrati. KPI:

- Strike rate complessivo e **per fascia di quota** — soglie lette da `settings/odds_bands`
  (default: bassa ≤1.75 / media 1.76–1.95 / alta >1.95) — con intervallo di confidenza al
  95% (Wilson score: i campioni per fascia possono essere piccoli).
- EV% realizzato per fascia = profit totale / stake totale della fascia.
- Break-even per fascia = 1 / quota media di fascia, confrontato con lo SR di fascia.
- **Analisi per minuto d'ingresso** (live): SR ed EV% per bucket di `entry_minute`
  (≤25' / 26–30' / 31–35' / 36–40' / >40' / senza minuto).
- Curva bankroll cumulativa unica (profit progressivo) e **max drawdown**.
- Filtri combinabili: periodo, strategia, sport, market_code.
- Tabella ultime bet con edit rapido.

Grafici: Chart.js da CDN.

### 5.4 Impostazioni

- Config Firebase (JSON incollato → localStorage) con stato connessione.
- Gestione strategie (CRUD completo dei preset, incluso l'ordinamento).
- Soglie fasce di quota (scrive su `settings/odds_bands`).
- Export CSV completo (backup).

### 5.5 PWA shell (opzionale, rimandata)

In v1 l'app si usa dal browser all'URL di GitHub Pages (eventualmente aggiunta alla home
screen come segnalibro). Solo se in futuro servirà l'esperienza installata: `manifest.json`
+ `sw.js` minimale (cache-first asset statici, network-only per Firestore).

## 6. Fasi di lavoro per Claude Code

1. **Fase 1 — Dati**: modello Firestore come sopra; setup progetto Firebase manuale di
   Simone guidato dal README; l'app crea il seed di `settings` al primo avvio.
2. **Fase 2 — Inserimento**: home con preset, form rapido, salvataggio, CRUD strategie in
   impostazioni. Test end-to-end da mobile (browser, via GitHub Pages).
3. **Fase 3 — Pending e saldo**: lista pending, tap di esito, calcolo profit, undo.
4. **Fase 4 — Dashboard**: KPI, fasce configurabili, analisi per minuto, grafici, filtri,
   export CSV.
5. **Fase 5 (opzionale)** — PWA shell installabile (§5.5) ed estrazione AI da screenshot
   (Appendice A). Da valutare solo a diario e dashboard consolidati.

Deploy: questo repo + GitHub Pages (Settings → Pages → deploy from branch `main`).

## 7. Vincoli e attenzioni

- Quota e stake sempre con punto decimale nei dati; gli input devono accettare la virgola
  italiana e normalizzarla.
- La config Firebase è client-side per design (non è un secret): è inclusa come default nel
  codice (`DEFAULT_FIREBASE_CONFIG`), con override da localStorage per puntare a un altro
  progetto. La protezione reale sono le regole Firestore; per sicurezza vera serve la fase 5
  (auth con utenti). Non pubblicizzare l'URL dell'app.
- Le soglie delle fasce sono configurazione, non schema.
- Query Firestore senza indici compositi: range su un solo campo (`placed_at`) o uguaglianza
  singola (`result == "pending"`), ordinamento e filtri aggiuntivi client-side.

---

## Appendice A — Fase 5 opzionale: estrazione AI da screenshot

Architettura prevista (adattata: Firebase Functions richiede il piano a pagamento per le
chiamate esterne, quindi il proxy serverless per la Claude API sarà un **Cloudflare Worker
free** o equivalente):

```
[Web app] → upload/paste screenshot (base64)
      → [Worker serverless "extract-bet"]  ← ANTHROPIC_API_KEY come secret
      → Claude API (vision, modello claude-haiku-4-5 come costante configurabile)
      → JSON strutturato → schermata di conferma dell'app → insert in bets
```

- La key resta server-side come secret; l'app può stare pubblica su GitHub Pages.
- NON salvare le immagini: solo JSON estratto (`raw_json`) + SHA-256 (`image_hash`) per
  dedup, aggiunti ai documenti `bets` (schemaless, nessuna migration).
- Due modalità: `single` (una schedina → precompila il form di conferma) e `settlement`
  (screenshot dello storico saldato → matching fuzzy con le pending su evento normalizzato
  + quota ±0.02 + data; le non matchate si risolvono a mano).
- Il prompt di estrazione deve produrre i campi del modello §3 (inclusi `sport` e
  `market_code`) e normalizzare le notazioni asiatiche ("+0/+0.5"→0.25, "+0.5/+1"→0.75,
  "+1/+1.5"→1.25) e la virgola decimale italiana.
- Se lo screenshot è una **multipla**: avvisare e lasciar scegliere se scartare o salvare
  come documento unico con `market_code = 'altro'` e quota totale (gambe in `raw_json`).
- Gestione errori: strip dei code fence prima del parse, retry singolo su parse fallito,
  retry dopo 2s su HTTP 429. Se confidence bassa, evidenziare i campi in giallo in conferma.
- Prima di scrivere il worker verificare su https://docs.claude.com/en/api/overview
  eventuali aggiornamenti del formato messages/vision.
