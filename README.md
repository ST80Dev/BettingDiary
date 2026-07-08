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

La config del progetto è già inclusa nel codice (`DEFAULT_FIREBASE_CONFIG` in `app.js`):
l'app si connette da sola, non serve incollare nulla. La config Firebase non è un secret —
è client-side per design e la protezione reale sono le regole Firestore.

Per puntare a un progetto diverso (es. da un altro dispositivo) apri **Impostazioni** →
incolla il `firebaseConfig` → *Salva e connetti*: quel valore, salvato in localStorage,
ha la precedenza sul default. Puoi incollare il frammento JavaScript copiato dalla console
così com'è, incluse le righe di `import`: l'app estrae da solo l'oggetto `firebaseConfig`.

### 3. GitHub Pages

Repo → **Settings → Pages** → *Deploy from a branch* → branch `main`, cartella `/ (root)`.
L'app sarà su `https://st80dev.github.io/BettingDiary/`.

## Uso quotidiano

1. **Impostazioni → Strategie**: crea i tuoi preset (sport, mercato, linea, stake, minuto tipico).
2. **Nuova**: tap sul preset → digiti evento, quota, stake, minuto reale e punteggio → *Salva*.
3. **Pending**: a fine match, tap su W / ½W / V / ½L / L — il profit si calcola da solo.
4. **Dashboard**: filtri per periodo/strategia/sport/mercato; fasce di quota configurabili
   dalle Impostazioni.
5. **Impostazioni → Backup**: export CSV completo.
