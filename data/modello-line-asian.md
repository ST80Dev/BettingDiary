# Modello line asiatica "Somma goal 1° tempo" (bet365)

Regole del mercato **"Somma goal asiatica nel 1° tempo"** su bet365, ricavate da
osservazione diretta di quote live. Riferimento: giocata **sempre sul lato Over**,
ingresso tipico intorno al **30-32'** (all'arrivo dell'alert, +1-2 min).

**Finestra di gioco:** dal minuto d'ingresso alla **fine del 1° tempo ≈ 47'**
(45' + **almeno 2 min di recupero** medio). Va sempre usato ~47' come estremo nelle
stime: allunga la finestra e alza P(≥1 gol entro HT) di ~2-3 punti (Over ~0.05 piu cheap).
Le quote reali bet365 hanno gia il recupero incorporato.

## 1. Regola del pavimento (floor)

Con **X gol già segnati**, la line **non può mai includere gli X gol già fatti**,
altrimenti nel caso peggiore (nessun altro gol) si avrebbe un rimborso implicito:

| Line (es. X = 1 gol) | Se resta a X gol (caso peggiore) | Ammessa |
|---|---|---|
| X.0 (1.0) | push → rimborso pieno | ❌ |
| X.25 (1.25 = 1.0/1.5) | metà fa push → mezzo rimborso | ❌ |
| **X+0.5 (1.5)** | perde piena, nessun rimborso | ✅ **FLOOR** |
| X+0.75, X+1.0, … | perde piena | ✅ |

➡️ **Line minima possibile = `gol_segnati + 0.5`.** Mai sotto.

## 2. Posizione della line

- La line **parte** a `floor` oppure **sopra** (X+0.75, X+1.0, …) a seconda di
  quanti gol totali si aspetta il mercato (aspettativa gol del match).
- Gara prolifica / molti gol attesi → line può partire sopra il floor.
- Al floor la line non può più scendere.

## 3. Meccanismo della quota Over (ratchet)

La quota Over sulla line **non è fissa**: oscilla per due effetti sovrapposti.

1. **Aspettativa gol (base):** al minuto d'ingresso, la quota Over sul floor misura
   quanto è probabile un altro gol entro il 45'.
   - Prolifica → Over basso (~1.75-1.90).
   - Scarsa → Over alto (~2.10+).
   - Equilibrio pieno bet365 ≈ **1.90** (overround ~5%).
2. **Deriva temporale:** finché **non si segna**, l'Over **sale** (meno tempo → gol
   meno probabile), accelerando verso il 45' (~+0.07/0.10 al minuto in zona 30-38').

## 4. Il gradino di ribasso

Quando l'Over diventa troppo caro **e la line è sopra il floor**:
- la line **scende di un quarto** (es. 2.0 → 1.75),
- l'Over **resetta in basso** (es. da ~2.20 a ~1.70),
- poi ricomincia a salire, e può riscendere di gradino in gradino **fino al floor**.

**Sequenza reale osservata (Adelaide 2-1, 3 gol, floor = 3.5):**
- 24:33 → line 3.75 (floor+0.25) @ Over 1.80
- 28:03 → line 3.75 @ Over 1.925 (deriva)
- 30:02 → line 3.75 @ Over 2.025 (over caro)
- 30:40 → **line 3.5 (floor) @ Over 1.80** ⚡ gradino: line -0.25, over reset da 2.025 a 1.80

➡️ **Trigger del gradino:** scatta quando l'Over sulla quarto-line raggiunge **~2.02-2.05**
(non ~2.10-2.20). Il ribasso di 0.25 sulla line fa scendere l'Over di ~0.22 (2.025 → 1.80).

Al floor invece **non c'è ribasso**: l'Over lievita e basta fino al 45'.
Un gol → X aumenta → il floor risale → nuova line più alta.

## 6. Ancora di aspettativa: la line FT

La **line "Somma goal asiatica" FT** (tutto il match) è l'ancora migliore per stimare
l'aspettativa gol, meglio del longshot 1X2. La sua mediana ≈ gol totali attesi a fine gara.

- Es. Adelaide 3 gol al 30' → line FT **5.75** → ~5.7 gol totali attesi → **~2.7 gol residui**
  su ~65 min → ritmo ~0.042/min → **P(≥1 gol entro HT) ≈ 48%**.
- Da questo ritmo si stima direttamente l'Over 1T atteso, senza indovinare dal longshot.

**La quota Over sul floor scala con l'aspettativa FT:** più gol attesi → floor-over più cheap.
Confronto al floor intorno al 30-31':
- Adelaide (FT 5.75, prolifica) → floor 3.5 @ Over **1.80**
- Vietnam (molto prolifica) → floor 4.5 @ Over **1.90**
- Regensburg (amichevole, pochi gol) → floor 1.5 @ Over **2.10**

## 7. Calibrazione alert-app vs bet365 reale (correzione dominio)

Quando la sorgente è l'**alert app** (non bet365), l'ancora è la sua riga O/U — spesso un
**longshot spennato** (es. O/U 1.5 @ 1.04/9.00). Confronto sullo **stesso match** (Box Hill W
1-0, ~30', DA 40-4):

| | da alert (O/U 1.5 @1.04/9.00) | bet365 reale |
|---|---|---|
| λ residuo | 2.26 | ~2.55 (FT 3.5) |
| P(≥1 gol entro HT) | ~45% | ~51% |
| Over floor 1.5 | stima ~2.10 | reale **1.85-1.95** |

→ La stima da solo-alert è **troppo alta di ~0.15-0.20**, per due motivi: (a) il longshot
O/U sottostima λ; (b) **front-loading** nelle gare a forte dominio (ritmo attuale > media match).

**Correzione da applicare quando si ha solo l'alert** (in base al rapporto Attacchi Pericolosi):

| Dominio (rapporto DA) | Correzione Over |
|---|---|
| Forte (>5:1) | −0.15 / −0.20 |
| Moderato (~2:1) | −0.05 / −0.10 |
| Equilibrato | nessuna |

Se invece si ha la **line FT reale di bet365**, usarla direttamente come ancora: è già corretta
(niente aggiustamento dominio necessario, vedi validazione Box Hill in §case).

**⚠️ La line FT batte le statistiche di dominio.** Il predominio territoriale NON implica
alta aspettativa gol. Esempio (Than KSVN W, 0-0, 36'): dominio estremo (attacchi 60-8,
possesso 71-29) ma FT line solo **2** e Over floor 0.5 @ **3.00**. Il modello con ancora FT
prevede P~31% = reale ~31%. Se avessi guardato il dominio avrei sovrastimato di molto.
→ **Regola: quando c'è la line FT, ignora le stat di dominio; la correzione-dominio è solo
un ripiego per il caso solo-alert, e può ingannare.**

## 5. Cosa registriamo (data/storico-quote-asian.csv)

Colonne: `minuto, gol_segnati, line, quota, line_ft, quota_ft, fonte, note`.
- `quota` = sempre quota **Over** 1T (unico lato giocato).
- `line_ft`, `quota_ft` = line e quota Over del mercato FT quando disponibili (ancora
  di aspettativa gol); vuote se non rilevate.
- `fonte` = `reale` (screenshot bet365) o `stimata` (derivata dal modello).
- Lo sbilanciamento della quota è già insito nel valore stesso: non si registra a parte.

Obiettivo: accumulare casi per costruire, **per casistica di gol già segnati**, la
distribuzione di line e quota Over al minuto d'ingresso.

## Casi reali raccolti finora

| min | gol | line | Over | note |
|---|---|---|---|---|
| 24 | 3 | 3.75 | 1.80 | line SOPRA floor (+0.25), over cheap, precoce (Adelaide 2-1) |
| 28 | 3 | 3.75 | 1.925 | Adelaide, deriva su line sopra-floor |
| 30 | 3 | 3.75 | 2.025 | Adelaide, over caro (pronto al gradino); FT 5.75@1.95 |
| 31 | 3 | 3.5 | 1.80 | Adelaide, **GRADINO 3.75->3.5**, over reset 2.025->1.80; FT 5.75@1.90 |
| 31 | 4 | 4.5 | 1.90 | floor, gara prolifica (Vietnam 0-4) |
| 38 | 4 | 4.5 | 2.425 | stessa gara, deriva temporale |
| 30 | 1 | 1.5 | 2.10 | floor, amichevole gol attesi bassi (Regensburg) |
| 33 | 1 | 1.5 | 2.425 | stessa gara, deriva temporale |
| 29 | 1 | 1.5 | 1.85 | floor, gara a forte dominio (Box Hill W); FT 3.5; validazione modello |

**Validazione del modello (Box Hill W, 1 gol, 29'):** con l'ancora FT (line 3.5 →
~2.55 gol residui) e finestra a 47', il modello prevede **P(≥1 gol entro HT) ≈ 50%**;
l'Over floor reale 1.5 @ 1.85 implica **~51%**. Stima quasi perfetta.

**Spread della fascia "1 gol" (stessa line 1.5, Over diverso per aspettativa):**
- Box Hill (forte dominio, FT 3.5) → Over **1.85**
- Regensburg (amichevole, gol attesi bassi) → Over **2.10**
→ la line non cambia (resta il floor), ma l'Over ne codifica tutta l'aspettativa gol.

**Ciclo completo osservato** su Adelaide (3 gol): sopra-floor con over cheap → deriva
in salita → gradino di ribasso al floor con reset dell'over. Tutti i regimi confermati.

**Righe stimate (da alert app, non bet365):** aggiunte casistiche 0 e 2 gol via stima
dal modello (ancora = riga O/U FT dell'alert). A ~28-32' con ~14-18 min al 45',
P(≥1 gol entro HT) sta in fascia ~41-46% → Over floor ~2.05-2.15. Da verificare con
screenshot bet365 reali (possibile over piu cheap in gare a dominio front-loaded).

| min | gol | line | Over | fonte |
|---|---|---|---|---|
| 30 | 0 | 0.5 | ~2.05 | stimata (Marconi U20 0-0), finestra ->47' |
| 32 | 2 | 2.5 | ~2.10 | stimata (Project51O 2-0), finestra ->47' |
| 30 | 1 | 1.5 | ~2.05 | stimata (Spain U19W 1-0), finestra ->47' |
| 28 | 1 | 1.5 | ~2.00 | stimata (Halifax 0-1), finestra ->47' |

> Serve ancora: **screenshot bet365 reali** per 0 e 2 gol (per verificare le stime) e
> coppie **1T+FT** per gare diverse da Adelaide.
