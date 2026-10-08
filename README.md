# HSR Tools

A small collection of Honkai: Star Rail tools. It's a static site with no build step: open `index.html` in a browser, or host it on GitHub Pages.

## Tools

### Combat Sim
Pick up to 4 characters and set their eidolon, light cone (with superimposition), relic sets, planar ornament and SPD substats. You then get:

- the SPD on the character screen and the base AV for each character
- a **timeline** of every action, ultimate, summon and countdown, with cycle boundaries
- an **AV-per-action table** (1st, 2nd, 3rd... action with the cumulative AV and cycle)
- the full **action order**, grouped by cycle

Game modes: Anomaly Arbitration (300 AV first cycle), MOC / PF / APOC (150 AV, then 100 AV per cycle), and Custom. The first 4 cycles are shown by default.

#### Mechanics
- `AV = 10000 / SPD`. Each unit has a 10,000-length track, and remaining distance ÷ SPD is its AV until its next turn.
- `SPD = base × (1 + SPD%) + flat SPD`. Base includes "base SPD" light cones such as Time Woven Into Gold. Flat SPD includes traces, boots (25.032 at +15) and substats.
- Action advance X% removes `10000 × X` distance. A SPD change keeps the distance, so the remaining AV scales by old ÷ new SPD.
- Cycles: the first is 150 AV (300 in Anomaly Arbitration), and each one after that is 100 AV.
- Buffs lasting "N turns" count down at the end of the holder's turn. The turn a buff is applied in doesn't count.
- Advancers have an **Always advances** teammate. Skill advancers (Sunday, Bronya, Sparkle) pull that teammate every time they use Skill; Sunday also pulls the target's summon or memosprite, and doesn't advance Harmony characters. Ultimate advancers (Pearl, Robin • Summeretto, Trailblazer • Elation) hold their Ultimate until the target has taken its turn, then fire. Any own turns taken while holding are flagged with ⚠ as energy overflow.
- 4★ characters and every Trailblazer start at E6.

Speed and turn-order effects are written by hand in `tools/av-calculator/effects.js`. Gear without a speed effect doesn't change the timeline, so the card's **Simulated effects** section lists only what is modeled for that build. For anything not modeled, use the manual SPD adjustments or the Final SPD override.

In the light cone picker, each character's signature cone is pinned to the top with a gold border. That mapping is kept by hand in `SIGNATURES` in `scripts/build_data.py`, so add new limited 5★ characters there each patch.

### Combat simulation
On top of turn order, the calculator runs a simplified combat sim (`tools/av-calculator/engine.js`):

- **Energy**: every character starts at 50%. Basic ATK / Skill / Ultimate / Elation Skill Energy comes from the game data and is scaled by Energy Regeneration Rate (traces, sets, light cone, ER rope). Kits add off-turn gains in `kits-energy.js`, such as Robin's +2 per ally attack, Tribbie's 1.5 per target hit, Evanescia's Energy ↔ Certified Banger mirror, and Energy given by Tingyun, Huohuo, Sunday and Robin • Summeretto. Ultimates fire as soon as they're ready, or are held for a target, or follow a manual schedule.
- **Skill Points**: a team pool (3 to start, 5 max, plus Sparkle / Archer / Rin bonuses). A Skill that can't be paid for becomes a Basic ATK. SP generators (Hanya, Sunday, Sparkle, Moze, Yao Guang...) are modeled.
- **Enemies** act at a set SPD and hit the team by taunt, giving Energy and triggering counters and follow-ups. They have Toughness: Weakness Break deals Break DMG, delays them, and enables Super Break until they recover.
- **Elation**: team Punchline; Aha acts on the timeline with SPD = 80 + (Elation characters' SPD sorted) /5 + /10 + /20 + /40. An Aha Instant runs every Elation Skill in Participant ID order (Pearl 104, Yao Guang 116, Trailblazer 120, Sparxie 144, Evanescia 146, Aventurine • Waveflair 156, Silver Wolf LV.999 999), then converts the Punchline into Certified Banger (2 turns per stack) and resets it to the number of Elation characters. Aha extra turns (Yao Guang) use a fixed Punchline.
- **Damage** (`damage.js`): multipliers are parsed from each ability's text at build time (97% of damaging abilities). Stats come from the Lv. 80 base, light cone, traces, set bonuses and relics (archiver or typed in). DMG uses the standard formula with average CRIT. Elation DMG uses the wiki formula (7535.107 × multiplier × CRIT × (1 + Elation) × Punchline × (1 + Merrymake) × DEF × RES × Vulnerability). Break / Super Break and DoT are included. The common supports' buffs and debuffs are modeled; most DPS self-buffs and conditional light cone / relic effects are not yet.
- Characters with a Novaflare (enhanced) kit always use it.

### Your account (Reliquary Archiver)
The site can load your real characters from [Reliquary Archiver](https://github.com/IceDynamix/reliquary-archiver). Run the archiver on the PC you play on (Windows/Linux) and log in to the game. The site finds the archiver's live server at `ws://localhost:23313/ws` by itself. It keeps retrying in the background and follows updates live as you change gear. You can also import the archiver's JSON export from the account button in the header.

The data is saved in the browser (IndexedDB), so it's still there after a reload or restart. When you pick one of your characters, the calculator fills in their eidolon, equipped light cone and superimposition, relic sets (4pc or 2+2), planar, SPD boots (exact value for its level) and SPD substats. Cards showing **Your build** follow live gear changes; editing a field detaches them.

If the archiver runs on another computer, set the host to that PC's LAN IP. Use the local server (`python3 -m http.server`) for that: a page served over HTTPS (like GitHub Pages) can only connect to `localhost`, not to other machines.

## Project layout
```
index.html                  site shell (tabs for each tool)
css/styles.css
js/app.js                   tool registry + hash router, shared modal, account window
js/account.js               Reliquary Archiver connection + saved account data
data/hsr-data.js            generated game data (don't edit by hand)
assets/relics/              relic and planar set icons (generated)
assets/light-cones/         light cone icons and card previews (generated)
assets/chibi/               chibi stickers used for small portraits (generated)
scripts/build_data.py       regenerates data from Mar-7th/StarRailRes
tools/av-calculator/
  engine.js                 turn/AV + combat simulation (Energy, SP, Elation, enemies, damage hooks)
  effects.js                character / light cone / relic speed and turn-order effects
  kits-energy.js            per-character Energy, Skill Point and Elation behaviour
  damage.js                 stats, damage formulas, support buffs
  calc.js                   UI state -> simulation
  ui.js                     team builder, timeline chart, tables
```

## Updating game data
After a patch, run:
```
python3 scripts/build_data.py
```
This also downloads any missing images into `assets/`. Relic and light cone art comes from StarRailRes, and chibis are the Pom-Pom Gallery stickers from the [HSR Fandom wiki](https://honkai-star-rail.fandom.com/). Pick a different sticker for a character with `CHIBI_OVERRIDES` in the script. Pass `--no-images` to skip downloads. New characters show up automatically with the right base SPD and traces. To simulate their special speed effects, add them to `effects.js`.

## Adding a tool
Create `tools/<name>/`, call `HSRTools.register({ id, title, mount })`, and add its script tag to `index.html`.

Game data and images come from [Mar-7th/StarRailRes](https://github.com/Mar-7th/StarRailRes). Honkai: Star Rail belongs to HoYoverse.
