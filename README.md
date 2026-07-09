# BetDiary

Diario personale di scommesse: web app mobile-first (GitHub Pages) con inserimento rapido
basato su preset di strategia, saldo esiti a un tap e dashboard analitica (strike rate con
intervallo di Wilson, EV%, break-even e drawdown per fascia di quota e minuto d'ingresso).

Dati su **Firebase Firestore** (piano free). Vedi `BETDIARY_BOOTSTRAP.md` per il documento
di progetto completo.

## Setup una tantum

### 1. Progetto Firebase (~5 minuti)

1. Vai su [console.firebase.google.com](https://console.firebase.google.com) → **Aggiungi progetto** (nome es. `betdiary`, Analytics non necessario).
2. Nel progetto: **Firestore Database** → *Crea database* → modalità **production** → region `eur3` (o `europe-west1`).
3. **Authentication** → *Get started* → scheda **Sign-in method** → abilita **Anonimo**.
4. Firestore → scheda **Regole** → incolla e pubblica:

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

5. Impostazioni progetto (ingranaggio) → **Le tue app** → icona web `</>` → registra l'app
   (nessun hosting) → copia l'oggetto `firebaseConfig`.

### 2. Configura l'app

La config del progetto è inclusa nel codice (`FIREBASE_CONFIG` in `app.js`): l'app si
connette da sola, non serve incollare nulla. La config Firebase non è un secret — è
client-side per design e la protezione reale sono le regole Firestore.

Per puntare a un progetto diverso basta modificare `FIREBASE_CONFIG` in `app.js`.

### 3. GitHub Pages

Repo → **Settings → Pages** → *Deploy from a branch* → branch `main`, cartella `/ (root)`.
L'app sarà su `https://st80dev.github.io/BettingDiary/`.

## Uso quotidiano

1. **Impostazioni → Strategie**: crea i tuoi preset (sport, mercato, linea, stake, minuto tipico).
2. **Nuova**: tap sul preset → digiti evento, quota, stake, minuto reale e punteggio → *Salva*.
   Puoi anche segnare subito l'**Esito** nel form (Win / Void / Loss, più ½ Win / ½ Loss sulle
   giocate asiatiche): il profit si calcola da solo e la giocata parte già saldata. Lascia
   *Pending* per saldarla dopo.
3. **Pending**: a fine match, tap su W / ½W / V / ½L / L — il profit si calcola da solo.
4. **Dashboard**: filtri per periodo/strategia/sport/mercato; fasce di quota configurabili
   dalle Impostazioni. In cima, la **Cassa attuale** = versamenti netti + profit realizzato
   sul giocato (mostra anche quanto hai *in gioco* sulle pending).
5. **Impostazioni → Cassa**: registra i versamenti/prelievi fatti sul bookmaker, anche in date
   passate. Sono capitale: entrano nella cassa attuale ma **non** nei conteggi di ROI e vincite,
   che restano calcolati solo sulle giocate.
6. **Impostazioni → Backup**: export CSV di giocate e movimenti di cassa.
