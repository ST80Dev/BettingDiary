# Modello line asiatica "Somma goal 1° tempo" (bet365)

Regole del mercato **"Somma goal asiatica nel 1° tempo"** su bet365, ricavate da
osservazione diretta di quote live. Riferimento: giocata **sempre sul lato Over**,
ingresso tipico intorno al **30-32'** (all'arrivo dell'alert, +1-2 min).

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
| 30 | 1 | 1.5 | 2.10 | floor, amichevole gol attesi bassi |
| 33 | 1 | 1.5 | 2.425 | stessa gara, deriva temporale |

**Ciclo completo osservato** su Adelaide (3 gol): sopra-floor con over cheap → deriva
in salita → gradino di ribasso al floor con reset dell'over. Tutti i regimi confermati.

> Manca ancora: casistiche **gol_segnati 0 e 2**, e coppie **1T+FT** per le altre gare
> (finora la line FT è stata rilevata solo per Adelaide).
