# Arcane Duel (browser prototype)

A 1v1 third-person arena duel built by Brando as a browser prototype (HTML + three.js). It's separate from the Godot project. The `.gdignore` file here keeps Godot from importing anything in this folder.

## Run it

Serve this folder over HTTP, then open `index.html` in Chrome or Edge. For
example, run `python3 -m http.server 8000` from this directory. The 3D warrior
loads GLB assets, so opening the HTML directly with `file://` is no longer
supported. No application build step is needed. Click **Class → Warrior**,
then **Test** for the training dummy or **Fight** for the AI sorceress.

## What's in it

- **Classes** (Class screen): Sorceress and Warrior are playable. Archmage and Ranger show as "coming soon". Each class has its own skills; potions are shared by everyone.
- **Sorceress**: Fireball, Lightning, Heal, Teleport, Water Shield, Clone, staff swing and staff block, with charge-up and ready-hum sounds.
- **Warrior**:
  - Sword combo on left-click: overhand, then backhand, then stab.
  - Steerable 3D shield on right-click: 100 HP, 1 damage taken per block.
  - Sheathe the sword and stow the shield for extra speed.
  - Skills: Shield Bash, Charge, War Cry, Whirlwind, Throw Axe.
- **Potions** (keys 5–8): Healing, Mana, Refresh, Explosion.
- **Modes**: Fight against an AI rival, or Test against a dummy that can't die and resets itself.
- **Settings**: every key can be rebound, and mouse sensitivity is adjustable.

## Files

- `index.html`: game rules, controls, arena and HUD.
- `warrior-3d.js`: the skinned Meshy warrior, animation playback, equipment and pose adaptation.
- `assets/warrior/`: the corrected rig, 26 clips, textured sword/shield and strike markers.
- `sorceress-art.js`, `warrior-art.js`, `class-art.js`: character renders as embedded data URIs.
- `art/`: the source renders those were made from.
- `sorceress.webp`: the original sorceress concept art (no longer used in-game).

## 3D warrior integration

The warrior uses the Meshy model from `ringshark/shark-brando` PR #3 with the
corrected pelvis/spine twist retargeting, replacing the rendered 2D warrior.
The sorceress and class-selection portraits retain their existing art. The
body is a real skinned mesh facing with the controller, not a camera billboard.
The rig's UV-matched PBR textures, shadows and material reflections are used.

The original controller still owns movement, hitboxes, attack hit times,
damage, stamina, blocking direction, equipment state and skills. Clip root
translation in X/Z is removed visually so it cannot detach the character from
its collider. Sword animation strike phases are fitted to the existing hit
frame using measured right-hand-speed markers; gameplay attack speed is not
changed. Forward/backward/sideways locomotion, three sword combo poses, guard,
skills and death are mapped onto the corrected library. Crouching uses leg IK;
rolling is procedural because there is no authored roll clip in the supplied
library. The shield's existing aiming/blocking logic is retained, with arm IK
to reach the 3D shield. Sheathed equipment is shown on the character's back.

The shield sits on the rig's left side, with a rear grip target and an outward
elbow bend. Its steering position is limited to the arm's reach. Guard uses an
upright base pose and shield-arm IK; the supplied two-handed greatsword block
does not fit this sword-and-shield loadout.

The new GLB assets total approximately 28 MB and load once at startup. Serve
all files in `assets/warrior/` with the app. The current Three.js/CDN setup
requires Internet access, as before.

Browser integration checks (requires Playwright and Chromium):

```sh
CHROMIUM_PATH=/usr/bin/chromium node tests/warrior-3d.cjs
```

The tests start their own local HTTP server. They expose controller access only
in an intercepted test response; the shipped page has no test/debug globals.
