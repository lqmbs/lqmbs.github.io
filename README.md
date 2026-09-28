# Ashen Descent

A first-person, parry-driven dark fantasy dungeon crawler built with Three.js.

You descend through vast crystal-lit caverns, where gothic cathedrals and drowned towers hang over a bottomless abyss. The progression is Binding of Isaac-style: a grid of chambers, gates that seal until the chamber is purged, relic pedestals, and a guardian at the end of each floor. The combat is about reading the enemy and deflecting its blows at the last instant.

## Running

The game is plain ES modules with no build step. Three.js loads from a CDN through an import map, so serve the folder over HTTP and open it in a browser:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

GitHub Pages also works if you point it at the repository root. Clicking **Descend** captures the mouse (pointer lock). Press `Esc` to release it and pause.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` | Move |
| Mouse | Look |
| `Shift` | Sprint (drains stamina) |
| `Space` | Jump |
| Left click | Attack, or cast with a wand or staff (animation-locked; clicks chain) |
| Right click (hold) | Guard |
| `Q` | Class skill |
| `F` | Drink a Crimson Flask (heals 40%, refilled each floor) |
| `E` | Interact: take a weapon, rest at the table, ring the effigy, begin an expedition |
| `1 2 3` / mouse wheel | Switch weapon slots |
| `G` | Drop the weapon in hand |
| `Tab` | Inventory |
| `Esc` | Pause and show stats |
| `M` | Mute |

## The Roundtable Hold

Every run starts in the hub: a ruined cruciform hold on a misty island, under an overcast sky.

- **The Round Table** is the octagonal chamber at the crossing, where a column of grace rises through a stone table pierced with swords. Rest there to change class.
- **The chapel nave** runs north, with a red carpet, arcaded columns and candles. At its end is the fog-filled **Expedition Gate**.
- **The library** runs west: shelves of books, a reading desk and a globe.
- **The armory corridor** runs east to the **sparring grounds**, a ring with a tent, a campfire, three training dummies, a weapon rack holding every weapon type, and a **Summoning Effigy** that calls any enemy (or the guardian) into the ring.
- **The roofless courtyard** runs south, overgrown and ruined, out to a meadow, a grey beach, and a sea dotted with stacks and a drowned keep.

Dying in the sparring ground just sends you back to the table. On an expedition, death ends the run and returns you to the Hold.

## Classes

| Class | Kit | Passive | Skill (Q) |
| --- | --- | --- | --- |
| Vigil Knight | Longsword & kite shield | Wider parry window; the shield blocks almost everything | **Shield Bash**: lunges and staggers, and can hurl foes off ledges |
| Duelist | Twin daggers | Ripostes +40%; fastest on foot | **Sidestep**: a short dash in any direction with invincibility frames |
| Lantern Mage | Ember Wand & lantern | Mana well for spells; brighter lantern | **Lantern Flare**: blinds, staggers and ignites everything nearby |

## Weapons & inventory

Nightreign-style: three weapon slots, flasks and relics. Everything is lost when the run ends; each expedition starts from your class's kit.

- **Types:** Longsword, Twin Daggers, Greatsword, Winged Spear (thrusts), Morning Star, Ember Wand (burning bolts), Sapphire Staff (piercing lances).
- **Rarities:** Common, Fine, Rare and Legendary, each with a damage multiplier and a colored light beam where the weapon lies.
- **Affixes:** Keen, Crushing, of Leeching, of Embers, Tuned, Long.
- Enemies drop weapons: guardians always drop one, heavy knights often do, and others sometimes. The reliquary room holds one too. Walk up and press `E` to take it; if your slots are full, the weapon in your hand is left in its place.
- Floating damage numbers show every hit.

An expedition is three floors. Clearing the third guardian brings you home.

## Combat

- **Parry.** Raise your guard just before a blow lands (a window of about 180 ms). The attack is deflected with a clang and sparks, a normal enemy staggers, and a red diamond marks the opening.
- **Riposte.** Strike a staggered enemy for heavy bonus damage. A clean parry into a riposte kills most enemies in one hit.
- **Block.** Holding the guard after the parry window only blocks. Blocking cuts damage but drains stamina, and an empty bar means a guard break and a long stun.
- **Spam lockout.** Mashing guard forfeits the parry window, but a successful deflection lets you chain the next one.
- **Tells.** A white **gleam** on a weapon means the attack can be parried. A **red glow**, together with the *Perilous* warning and a low chime, means it can't: step out of the way instead.
- **Posture.** Heavy enemies and guardians have posture (the gold bar under a boss's health). Parries and hits fill it, and a full bar breaks them open for a devastating riposte.
- **Enemy blocks.** Skeletons and knights sometimes block your swings, which knocks your sword back.
- **The abyss.** Knockback can throw enemies off ledges. You can fall too, which costs 20% of your health and returns you to the gate you came in by.

### Enemies

| Enemy | Behaviour |
| --- | --- |
| Hollow | Sword skeleton with a telegraphed chop. From floor II it sometimes follows up with a second cut. |
| Shade | Circles you, then shrieks and lunges. |
| Lumen Acolyte | Keeps its distance and hurls crystal bolts. Parry a bolt to send it back at the caster. |
| Geode Knight | Heavy knight with posture, an overhead chop, and a perilous thrust. |
| Ember Hound | Fast pack hunter that circles and pounces, sometimes biting twice. |
| Drowned | Bloated giant with a crushing slam and a perilous grab. |
| Gargoyle | Hovers, rises with a screech, then dives. |
| Guardian | Floor boss with three-hit combos, a wide sweep, and a perilous ground slam that marks its landing zone. |

## Expeditions

An expedition is three floors, each drawn from a different biome:

| Biome | Abyss | Character | Signature foe |
| --- | --- | --- | --- |
| The Sapphire Undercroft | Bottomless void | Blue crystal, towers with lit windows, stalactites | Geode Knight |
| The Drowned Cathedral | Shallow flood you can wade through | Teal mist, glowing fungus, roots, vines, drowned spires | Drowned |
| The Ember Fortress | A lava sea (falling costs more) | Red keep, lava cracks, spikes, chains, lava falls | Ember Hound |
| The Sunlit Ruins | A sea of cloud under a sky | Daylight with sun shadows, grass, trees, mesas | Gargoyle |

**Floors are seamless.** A floor is an Isaac-style grid of chambers laid out as one continuous world. Neighbouring gatehouses are joined by real bridges and stairs, so you walk from chamber to chamber with no cut or fade. Neighbouring chambers stay visible through the fog, and the background, weather and abyss belong to the floor as a whole.

**Encounters wake as you arrive.** Some foes wait in plain sight, slumped and still, and others claw out of the floor when you step into their chamber. A strike on a sleeping foe is a sneak attack and lands like a riposte. If you leave a chamber and get far away, its foes walk home and wait for you. Clearing a chamber raises a relic pedestal.

**Only elite and guardian arenas seal.** A curtain of fog closes behind you there. An elite arena holds a *Champion* of the biome's signature breed (bigger, tougher, with a gold aura and a boss bar) and its retinue, and drops a rare weapon when cleared. The guardian's arena opens the descent to the next floor. Beating the third guardian ends the expedition and returns you to the Hold.

Chamber layouts are dealt from six procedural archetypes, each re-randomised every time:

- **Nave**: a colonnaded cathedral hall with pointed arcades and a raised altar dais.
- **Ring**: a circular walkway around a chasm, with spokes to a central island.
- **Terraces**: two or three tiers climbing to one side, joined by stairs.
- **Causeway**: tower-top islands at different heights, linked by bridges and stairs.
- **Grotto**: organic overlapping shelves beneath a stalactite-hung vault.
- **Spires**: the crowns of three drowned towers, bridged high over the dark.

Balustrades grow automatically along every open edge, except in the flood, where the edges drop into shallow water.

## Look

- Rendered at one-third resolution and upscaled with nearest sampling.
- Post pass: bloom on bright light, ACES tone mapping, a split-tone grade (cold shadows, warm highlights), Bayer dithering, posterisation, film grain and a vignette.
- Heavy blue `FogExp2` whose tint changes per floor.
- The hand lantern is the only shadow-casting light. A fixed pool of crystal and fire lights is re-aimed at each chamber's props, so shaders never recompile.
- All sound is synthesised live with WebAudio, including the metallic parry clang and a cavern reverb. There are no audio files.

## Code

```
index.html        HUD markup, overlays, import map
style.css         HUD, typography, CRT scanline overlay
game.js           Game: loop, floor/chamber flow, combat feedback (hitstop, slow-mo, shake, sparks)
src/config.js     Tunables, floor themes, directions, room states
src/util.js       Math helpers, gothic arch geometry, GeoBatch (static-geometry merging)
src/physics.js    World: walkable surfaces (rect/ramp/disc/ring/terrain), obstacles, slide-and-fall movement, per-chamber offsets
src/architecture.js  Builder: platforms, bridges, stairs, pillars, arcades, crystals, towers, parapets, vista
src/floor.js      Seamless floor: grid generation, passages between chambers, vista, abyss, visibility
src/chamber.js    A chamber of a floor: gateways, fog walls, decoration, dormant encounters
src/layouts.js    The six chamber archetypes plus shrine, reliquary and arena
src/sky.js        Painterly sky dome
src/player.js     First-person controller, loadout, guard/parry/block, attacks, spells, skills, flasks, viewmodel
src/enemies.js    Enemy base (posture, blocking, telegraphs, stun, burn), Hollow, Shade, Acolyte, Geode Knight, Warden, Training Dummy, Bolt
src/items.js      Relics, pedestals, the descent well
src/hub.js        The Roundtable Hold: island terrain, the hold, sparring grounds, sea and sky
src/classes.js    Class definitions
src/weapons.js    Weapon types, rarities, affixes, weapon/shield models
src/loot.js       Weapons lying in the world
src/menus.js      Class selection and summoning menus
src/hud.js        Bars, boss posture, perilous warning, crosshair, relic list, minimap
src/audio.js      Synthesised sound
src/input.js      Pointer lock, buffered actions
src/post.js       Low-res retro post-processing
src/particles.js  Instanced cube particles
src/textures.js   Procedural pixel textures
```

## Relics

Every purged chamber raises a pedestal with a random relic. Relics stack, and duplicates become less likely to appear.

Cursed Whetstone, Vampiric Ember, Ashen Greatblade Shard, Tuning Fork of the Deep (wider parry window), Warden's Aegis (cheaper blocking), Bloodied Chalice, Hollow Lung, Heart of the Unkindled, Grave Lantern, Executioner's Brand (stronger ripostes), Thorned Rosary (parries wound the attacker), Moth-Eaten Shroud, Sinner's Tithe, and the Crimson Tear (a heal, offered only when you are wounded).
