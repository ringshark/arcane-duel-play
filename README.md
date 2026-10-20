# Arcane Duel (browser prototype)

A 1v1 third-person arena duel built by Brando as a browser prototype (HTML + three.js). It's separate from the Godot project. The `.gdignore` file here keeps Godot from importing anything in this folder.

## Run it

Serve this folder over HTTP and open `index.html` in Chrome or Edge, for example `python -m http.server 8000` here, then go to http://localhost:8000. The 3D Warrior and Ranger load GLB/FBX files, so opening the HTML straight from disk (`file://`) no longer works. No build step. It needs an internet connection: three.js loads from a CDN.

This is the combined version: Brando's game merged with Mark's 3D warrior from `ringshark/arcane-duel-play`, plus the playable Ranger.

- **Fight**: duel the AI sorceress.
- **Test**: practice on a training dummy that can't die and resets itself.
- **⚔ Multiplayer**: fight another person online (see below).

## What's in it

- **Classes** (Class screen): Sorceress, Sorceress 3D, Warrior and Ranger are playable. Archmage shows as "coming soon". Each class has its own skills; potions are shared by everyone.
- **Sorceress**: Fireball, Lightning, Heal, Teleport, Water Shield, Clone, staff swing and staff block, with charge-up and ready-hum sounds.
- **Sorceress 3D**: the same kit as the Sorceress, played by a rigged 3D model instead of flat renders. The model is a Tripo export with no skeleton; `sorceress3d-rig.js` builds one when the game loads (18 bones, skin weights, cape and hood kept on the torso) and poses it from the game state: walk, back-pedal, strafe, jump, crouch, roll, staff swing, staff block, casting, healing, drinking, stun and death.
- **Warrior**:
  - Sword combo on left-click: overhand, then backhand, then stab.
  - Steerable 3D shield on right-click: 100 HP, 1 damage taken per block.
  - Sheathe the sword and stow the shield for extra speed.
  - Skills: Shield Bash, Charge, War Cry, Whirlwind, Throw Axe.
- **Potions** (keys 5–9): Healing, Mana, Refresh, Explosion, Flash Bang. Flash Bang is thrown like the Explosion Potion and blinds anyone within 16 m who can see it, for up to 3.5 s (less when they're looking away; you too).
- **Crosshair** turns red while it's over the enemy.
- **Settings**: every key can be rebound, and mouse sensitivity is adjustable.

## Multiplayer (online)

Press **⚔ Multiplayer** on the menu. One player presses **Host a match** and reads out the 4-letter room code; the other types it and presses **Join**; the host presses **START MATCH**. It runs through Mark's Cloudflare relay (the URL is filled in already). The host's page runs the fight; the guest sends inputs and draws the host's snapshots. No accounts needed.

## Files

- `index.html`: the whole game (code and styles).
- `sorceress-art.js`, `warrior-art.js`, `class-art.js`: character renders as embedded data URIs.
- `sorceress3d-model.js`: the Sorceress 3D model (GLB with downscaled textures) as embedded base64.
- `sorceress3d-rig.js`: builds the skeleton and skin weights for that model and poses it every frame.
- `art/`: the source renders the flat art was made from.
- `sorceress.webp`: the original sorceress concept art (no longer used in-game).
- `warrior-3d.js`, `assets/warrior/`: Mark's 3D warrior (model, clips, sword, shield, strike markers).
- `ranger-3d.js`, `assets/ranger/`: the 3D Ranger (model, 4 archery clips) and its retargeting.

## 3D Warrior and Ranger

- **Warrior**: Mark's rigged Meshy warrior (`warrior-3d.js`, `assets/warrior/`, from PR #3) replaces the flat renders: 26 clips, textured sword and shield, leg IK for crouching, shield-arm IK. See `assets/warrior/README.md`.
- **Ranger**: the Hooded Forest Archer from PR #4 (`ranger-3d.js`, `assets/ranger/`). The Mixamo archery clips are retargeted onto the rig when the game loads; death borrows the warrior's `Dying` clip. The bow is a placeholder built in code until the real prop exists.
  - **Quick Shot**: LMB or F, 9–12 damage.
  - **Aimed Shot**: key 1 draws for 1.2 s, then LMB looses it for 24–32 damage.
  - **Disengage**: key 2 leaps backwards.
- **Online**: Mark's relay multiplayer (**⚔ Multiplayer** on the menu) carries the Ranger's skills, arrows, Flash Bang and blindness. Joining, starting, the Aimed Shot draw and Flash Bang blindness were tested online; an arrow or spell hit landing online is not yet confirmed.
