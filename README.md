# HSR Tools

A small collection of Honkai: Star Rail tools. It's a static site with no build step: open `index.html` in a browser, or host it on GitHub Pages.

## Tools

### AV Calculator
Pick up to 4 characters and set their eidolon, light cone (with superimposition), relic sets, planar ornament and SPD substats. You then get:

- the SPD on the character screen and the base AV for each character
- a **timeline** of every action, ultimate, summon and countdown, with cycle boundaries
- an **AV-per-action table** (1st, 2nd, 3rd... action with the cumulative AV and cycle)
- the full **action order**, grouped by cycle

Game modes: Memory of Chaos, Pure Fiction, Apocalyptic Shadow, Anomaly Arbitration (300 AV first cycle), Simulated/Divergent Universe, and Custom.

#### Mechanics
- `AV = 10000 / SPD`. Each unit has a 10,000-length track, and remaining distance ÷ SPD is its AV until its next turn.
- `SPD = base × (1 + SPD%) + flat SPD`. Base includes "base SPD" light cones such as Time Woven Into Gold. Flat SPD includes traces, boots (25.032 at +15) and substats.
- Action advance X% removes `10000 × X` distance. A SPD change keeps the distance, so the remaining AV scales by old ÷ new SPD.
- Cycles: the first is 150 AV (300 in Anomaly Arbitration), and each one after that is 100 AV.
- Buffs lasting "N turns" count down at the end of the holder's turn. The turn a buff is applied in doesn't count.

Speed and turn-order effects are written by hand in `tools/av-calculator/effects.js`. In the dropdowns, ⚡ marks the gear that the simulator models. For anything not modeled, use the manual SPD adjustments or the Final SPD override.

## Project layout
```
index.html                  site shell (tabs for each tool)
css/styles.css
js/app.js                   tool registry + hash router
data/hsr-data.js            generated game data (don't edit by hand)
scripts/build_data.py       regenerates data from Mar-7th/StarRailRes
tools/av-calculator/
  engine.js                 turn/AV simulation engine
  effects.js                character / light cone / relic speed effects
  calc.js                   UI state -> simulation
  ui.js                     team builder, timeline chart, tables
```

## Updating game data
After a patch, run:
```
python3 scripts/build_data.py
```
New characters show up automatically with the right base SPD and traces. To simulate their special speed effects, add them to `effects.js`.

## Adding a tool
Create `tools/<name>/`, call `HSRTools.register({ id, title, mount })`, and add its script tag to `index.html`.

Game data and images come from [Mar-7th/StarRailRes](https://github.com/Mar-7th/StarRailRes). Honkai: Star Rail belongs to HoYoverse.
