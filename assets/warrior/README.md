# Meshy warrior browser assets

Source: the user-provided Meshy warrior and equipment from
`ringshark/shark-brando`, PR #3 / `feature/warrior-import`, source asset commit
`15c0c45cf5379b2ac3fd68ef92feea3b2629d9f5`.

`warrior.glb` was exported with Godot 4.5.1 after applying the torso-twist
retarget correction and regenerating `warrior_animation_library.tres`.
It includes all 26 clips. The correction aligns rest directions, preserves full
world-space rotation including axial twist, and bakes constant mapped bones.
Walking and Running use the original clips baked in the Meshy GLB.

The original rigged model's UV-matched PBR maps are embedded. The separate
source FBX atlas has different UVs and is not interchangeable with these maps.
Sword and shield are the textured one-handed/round GLBs from the same PR.

After any fresh Godot GLB export, run `python3 tools/prepare-warrior-gltf.py`
from the browser repository. Three.js r160's WebGL skinning uses four
influences per vertex: the tool retains the strongest four of the exported
eight and normalizes their weights, without changing animation tracks or
texture data. The operation is idempotent.

`strike-markers.json` contains normalized source-clip times at peak sampled
right-hand speed (120 Hz, searching the middle 15–80% of each attack). Playback
fits wind-up and recovery around the existing game's hit frame. These are
visual timing markers, not changes to damage or attack duration.
