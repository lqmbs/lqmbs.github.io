# Ashen Descent

An atmospheric, grimdark dungeon crawler built with Three.js. The progression is Binding of Isaac-style: you move through a grid of rooms, doors lock until the room is cleared, and you pick up relics. The combat is Elden Ring-style: committed swings, i-frame dodge rolls, and stamina management.

## Running

The game is plain ES modules with no build step. Three.js loads from a CDN through an import map, so serve the folder over HTTP:

```sh
python3 -m http.server 8000
# then open http://localhost:8000
```

GitHub Pages also works if you point it at the repository root.

## Controls

| Input | Action |
| --- | --- |
| `W A S D` / arrows | Move |
| Mouse | Aim |
| Left click | Sword slash (animation-locked, costs stamina) |
| `Space` | Dodge roll with invincibility frames (costs stamina) |
| `Esc` | Pause and show stats |
| `M` | Mute |
| `R` | Rise again after death |

Attack and dodge presses are buffered for a short window. A press made during a swing fires as soon as the lock allows. You can roll out of the late part of a swing's recovery, and a buffered click chains into the next slash.

## Structure

- `index.html`: canvas host, HUD markup, title/pause/death overlays, import map.
- `style.css`: minimalist HUD, gothic typography, CRT scanline overlay.
- `game.js`: the whole engine, split into classes:
  - `Game`: main loop, run/floor/room flow, hitstop and slow-mo, combat hooks.
  - `RetroPass`: renders to a low-res target, then applies nearest upscale, Bayer dither, posterization, grain, vignette and a hurt tint.
  - `Player`: the knight, with its state machine (`idle / attack / dodge / hurt / dead`), stamina, stats and the flickering waist-lantern light that casts shadows.
  - `Enemy` → `Skeleton` (telegraphed lunge), `Shade` (circles you, then dashes), `Warden` (floor guardian with ground telegraphs and breakable poise).
  - `Room`: an explicit state machine (`dormant → sealing → combat → cleared`) that seals the doors, spawns enemies, reopens the doors and raises the relic pedestal.
  - `DungeonFloor`: Isaac-like grid generation with a start room, a treasure room on a dead end, and the guardian room on the farthest dead end.
  - `Pedestal`, `Descent`, `Door`, `SlashArc`, `GroundTelegraph`, `ParticleSystem`, `CameraRig`, `HUD`, `Input`, `AudioEngine` (all sound is synthesized with WebAudio).

## Relics

Every purged chamber raises a pedestal with a random relic. Relics stack, and duplicates become less likely to appear.

Cursed Whetstone, Vampiric Ember, Ashen Greatblade Shard, Wraith's Mantle, Bloodied Chalice, Hollow Lung, Heart of the Unkindled, Grave Lantern, Executioner's Brand, Thorned Rosary, Moth-Eaten Shroud, Sinner's Tithe, and the Crimson Tear (a heal, offered only when you are wounded).

Defeat the floor's guardian to open the descent. Each floor is larger and its enemies are tougher.
