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

Esempio (1 gol segnato):
- 30': line 2.0 (X+1.0) @ Over 1.95
- 34': line 2.0, Over salito @ 2.20 (deriva)
- 35': **scatta** a line 1.75 (X+0.75) @ Over 1.70 (reset)
- … fino al floor 1.5, poi solo salita.

Al floor invece **non c'è ribasso**: l'Over lievita e basta fino al 45'.
Un gol → X aumenta → il floor risale → nuova line più alta.

## 5. Cosa registriamo (data/storico-quote-asian.csv)

Colonne: `minuto, gol_segnati, line, quota, fonte, note`.
- `quota` = sempre quota **Over** (unico lato giocato).
- `fonte` = `reale` (screenshot bet365) o `stimata` (derivata dal modello).
- Lo sbilanciamento della quota è già insito nel valore stesso: non si registra a parte.

Obiettivo: accumulare casi per costruire, **per casistica di gol già segnati**, la
distribuzione di line e quota Over al minuto d'ingresso.

## Casi reali raccolti finora

| min | gol | line | Over | note |
|---|---|---|---|---|
| 31 | 4 | 4.5 | 1.90 | floor, gara prolifica (Vietnam 0-4) |
| 38 | 4 | 4.5 | 2.425 | stessa gara, deriva temporale |
| 30 | 1 | 1.5 | 2.10 | floor, amichevole gol attesi bassi |
| 33 | 1 | 1.5 | 2.425 | stessa gara, deriva temporale |

> Manca ancora: uno screen col **gradino di ribasso in atto** (line sopra il floor
> che scende) e casistiche **gol_segnati 0, 2, 3**.
