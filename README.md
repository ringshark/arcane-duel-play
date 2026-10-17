# Arcane Duel (browser prototype)

A 1v1 third-person arena duel built by Brando as a browser prototype (HTML + three.js). It's separate from the Godot project. The `.gdignore` file here keeps Godot from importing anything in this folder.

## Run it

Open `index.html` in a browser (Chrome or Edge). No build step or server is needed; the art is embedded in the `*-art.js` files so it works straight from disk. Click **Test** to practice on a training dummy, or **Fight** to duel the AI sorceress.

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

- `index.html`: the whole game (code and styles).
- `sorceress-art.js`, `warrior-art.js`, `class-art.js`: character renders as embedded data URIs.
- `art/`: the source renders those were made from.
- `sorceress.webp`: the original sorceress concept art (no longer used in-game).
