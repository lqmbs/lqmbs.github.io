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
| Left click | Slash (animation-locked; consecutive clicks chain alternating cuts) |
| Right click (hold) | Guard |
| `Esc` | Pause and show stats |
| `M` | Mute |
| `R` | Rise again after death |

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
| Guardian | Floor boss with three-hit combos, a wide sweep, and a perilous ground slam that marks its landing zone. |

## World

Each floor is an Isaac-style grid: a starting shrine, combat chambers, a reliquary with a free relic, and the guardian's arena on the farthest dead end. Combat chambers are dealt from six procedural archetypes, each re-randomised every time:

- **Nave** – a colonnaded cathedral hall with pointed arcades and a raised altar dais.
- **Ring** – a circular walkway around a chasm, with spokes (bridges or stairs) to a central island.
- **Terraces** – two or three tiers climbing to one side, joined by stairs.
- **Causeway** – tower-top islands at different heights, linked as a tree of bridges and stairs.
- **Grotto** – organic overlapping shelves beneath a stalactite-hung vault, choked with crystals.
- **Spires** – the crowns of three drowned towers, bridged high over the dark.

Gates sit on landings at the chamber's edges. They connect to the hub by bridges, and sometimes by stairs up or down, with a balcony on longer spans. Balustrades grow automatically along every open edge, with the occasional broken gap. Every chamber gets its own background: ranks of lit gothic towers, far-off arched bridges, crystal spires rising from the abyss, and drifting mist.

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
src/physics.js    World: walkable surfaces (rect/ramp/disc/ring), obstacles, slide-and-fall movement
src/architecture.js  Builder: platforms, bridges, stairs, pillars, arcades, crystals, towers, parapets, vista
src/chamber.js    Chamber state machine, gates, layout archetypes, decoration, DungeonFloor generation
src/player.js     First-person controller, guard/parry/block, attacks, viewmodel (sword, lantern, slash trail)
src/enemies.js    Enemy base (posture, blocking, telegraphs), Hollow, Shade, Acolyte, Geode Knight, Warden, Bolt
src/items.js      Relics, pedestals, the descent well
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
