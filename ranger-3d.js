import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';

// The Ranger ("Hooded Forest Archer", ringshark/shark-brando assets/ranger-rig): Meshy model rigged on the Mixamo
// template, with Walking + Running baked in. Its archery clips are standalone Mixamo FBXs whose rest pose differs a
// lot from this rig's, so they are retargeted onto it when the game loads (see retarget()). Death comes from the
// warrior's clip library (same skeleton naming). The bow is a placeholder prop until the real one is made.
const ARCHERY = { idle: 'Standing_Idle_01', aimIdle: 'Standing_Aim_Idle_01', draw: 'Standing_Aim_Overdraw', recoil: 'Standing_Aim_Recoil' };
const BORROWED = { death: 'Dying' };   // from the warrior's library

export async function loadRangerAssets(renderer, warriorAssets) {
  const url = (p) => new URL(`./assets/ranger/${p}`, import.meta.url).href;
  const fbx = new FBXLoader();
  const [body, ...sources] = await Promise.all([
    new GLTFLoader().loadAsync(url('ranger.glb')),
    ...Object.values(ARCHERY).map(name => fbx.loadAsync(url(`clips/${name}.fbx`))),
  ]);
  body.scene.traverse(node => {
    if (!node.isMesh) return;
    if (node.isSkinnedMesh) keepFourInfluences(node.geometry);
    node.castShadow = node.receiveShadow = true;
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      if (warriorAssets.environment) { mat.envMap = warriorAssets.environment; mat.envMapIntensity = 0.45; }
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (mat[key]) mat[key].anisotropy = 8;
    }
  });
  const clips = new Map(body.animations.map(c => [c.name, c]));   // Walking, Running (native)
  Object.keys(ARCHERY).forEach((key, i) => clips.set(key, retarget(sources[i], sources[i].animations[0], body.scene, key)));
  const warrior = clone(warriorAssets.body.scene);
  for (const [key, name] of Object.entries(BORROWED)) {
    const clip = warriorAssets.body.animations.find(c => c.name === name);
    if (clip) clips.set(key, retarget(warrior, clip, body.scene, key));
  }
  return { body, clips };
}

// Meshy exports up to 12 bone influences per vertex (JOINTS_0..2); three.js skins with the first four only.
// Keep each vertex's strongest four and normalise them (what tools/prepare-warrior-gltf.py does for the warrior).
function keepFourInfluences(geo) {
  const sets = [['skinIndex', 'skinWeight'], ['joints_1', 'weights_1'], ['joints_2', 'weights_2']].filter(([j, w]) => geo.attributes[j] && geo.attributes[w]);
  if (sets.length < 2) return;
  const n = geo.attributes.skinIndex.count, idx = geo.attributes.skinIndex, wt = geo.attributes.skinWeight, all = [];
  for (let v = 0; v < n; v++) {
    all.length = 0;
    for (const [j, w] of sets) for (let k = 0; k < 4; k++) { const ww = geo.attributes[w].getComponent(v, k); if (ww > 0) all.push([geo.attributes[j].getComponent(v, k), ww]); }
    all.sort((a, b) => b[1] - a[1]);
    const top = all.slice(0, 4), sum = top.reduce((s, x) => s + x[1], 0) || 1;
    for (let k = 0; k < 4; k++) { idx.setComponent(v, k, top[k] ? top[k][0] : 0); wt.setComponent(v, k, top[k] ? top[k][1] / sum : 0); }
  }
  idx.needsUpdate = wt.needsUpdate = true;
  for (const [j, w] of sets.slice(1)) { geo.deleteAttribute(j); geo.deleteAttribute(w); }
}

// ---- Retargeting -------------------------------------------------------------------------------------------
// For every frame: give each target bone the source bone's world rotation change from rest, then swing it so it
// points at its child the same way the source bone does (so differing rest poses — T vs A, bone roll — don't
// matter). Fingers keep their rest pose; the hips keep only the up/down motion (gameplay owns where you stand).
const boneKey = (name) => name.replace(/^mixamorig[:_]?/, '');
const FINGER = /Thumb|Index|Middle|Ring|Pinky/;
function bonesOf(root) { const list = []; root.traverse(n => { if (n.isBone) list.push(n); }); return list; }

function retarget(sourceRoot, clip, targetSource, name) {
  const target = clone(targetSource);
  const tBones = bonesOf(target), sBones = bonesOf(sourceRoot);
  const sByKey = new Map(sBones.map(b => [boneKey(b.name), b]));
  const restLocal = new Map(sBones.map(b => [b, { q: b.quaternion.clone(), p: b.position.clone(), s: b.scale.clone() }]));
  sourceRoot.updateMatrixWorld(true); target.updateMatrixWorld(true);
  const worldQ = (o) => o.getWorldQuaternion(new THREE.Quaternion()), worldP = (o) => o.getWorldPosition(new THREE.Vector3());
  const sRest = new Map(sBones.map(b => [b, worldQ(b)])), tRest = new Map(tBones.map(b => [b, worldQ(b)]));
  const sHips = sByKey.get('Hips'), tHips = tBones.find(b => boneKey(b.name) === 'Hips');
  const sHipsRestY = worldP(sHips).y, tHipsRest = tHips.position.clone();
  const driven = tBones.filter(b => sByKey.has(boneKey(b.name)) && !FINGER.test(b.name));
  const mixer = new THREE.AnimationMixer(sourceRoot), action = mixer.clipAction(clip); action.play();
  const fps = 30, frames = Math.max(2, Math.round(clip.duration * fps) + 1);
  const times = new Float32Array(frames), quats = new Map(driven.map(b => [b, new Float32Array(frames * 4)])), hipsPos = new Float32Array(frames * 3);
  const parentQ = new THREE.Quaternion(), want = new THREE.Quaternion(), fix = new THREE.Quaternion();
  for (let f = 0; f < frames; f++) {
    const t = Math.min(clip.duration, f / fps); times[f] = t;
    mixer.setTime(t); sourceRoot.updateMatrixWorld(true);
    for (const b of driven) {
      const s = sByKey.get(boneKey(b.name));
      want.copy(worldQ(s)).multiply(sRest.get(s).clone().invert()).multiply(tRest.get(b));
      b.quaternion.copy(parentQ.copy(worldQ(b.parent)).invert().multiply(want));
      b.updateMatrixWorld(true);
      const tc = b.children.find(c => c.isBone), sc = tc && sByKey.get(boneKey(tc.name));
      if (tc && sc && !FINGER.test(tc.name) && !/HeadTop|Toe_End/.test(tc.name)) {
        const sd = worldP(sc).sub(worldP(s)).normalize(), td = worldP(tc).sub(worldP(b)).normalize();
        if (sd.lengthSq() > 0.5 && td.lengthSq() > 0.5) {
          fix.setFromUnitVectors(td, sd);
          b.quaternion.copy(parentQ.copy(worldQ(b.parent)).invert().multiply(fix.multiply(worldQ(b))));
          b.updateMatrixWorld(true);
        }
      }
      b.quaternion.toArray(quats.get(b), f * 4);
    }
    const lift = worldP(sHips).y / sHipsRestY;   // crouching / rising in the source, as a fraction of its hip height
    hipsPos.set([tHipsRest.x, tHipsRest.y * lift, tHipsRest.z], f * 3);
  }
  mixer.stopAllAction(); mixer.uncacheRoot(sourceRoot);
  for (const [b, r] of restLocal) { b.quaternion.copy(r.q); b.position.copy(r.p); b.scale.copy(r.s); }
  const tracks = driven.map(b => new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, times, quats.get(b)));
  tracks.push(new THREE.VectorKeyframeTrack(`${tHips.name}.position`, times, hipsPos));
  return new THREE.AnimationClip(name, clip.duration, tracks);
}

// ---- Posing helpers (same approach as the warrior's) -------------------------------------------------------
function aimBone(bone, from, to, weight = 1) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  const old = bone.quaternion.clone();
  const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const world = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  bone.quaternion.copy(bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert().multiply(world));
  bone.quaternion.slerpQuaternions(old, bone.quaternion.clone(), weight);
  bone.updateWorldMatrix(false, true);
}
function reach(upper, lower, hand, target, pole) {
  const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = hand.getWorldPosition(new THREE.Vector3());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c), dir = target.clone().sub(a);
  if (l1 < 1e-5 || l2 < 1e-5 || dir.lengthSq() < 1e-8) return;
  const dist = THREE.MathUtils.clamp(dir.length(), Math.abs(l1 - l2) + 0.001, l1 + l2 - 0.001); dir.normalize();
  const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)); if (bend.lengthSq() < 1e-8) return; bend.normalize();
  const along = (l1 * l1 - l2 * l2 + dist * dist) / (2 * dist);
  const elbow = a.clone().addScaledVector(dir, along).addScaledVector(bend, Math.sqrt(Math.max(0, l1 * l1 - along * along)));
  aimBone(upper, b.sub(a), elbow.sub(a));
  const nb = lower.getWorldPosition(new THREE.Vector3()), nc = hand.getWorldPosition(new THREE.Vector3());
  aimBone(lower, nc.sub(nb), target.clone().sub(nb));
}

// Placeholder longbow: a wooden C-shaped stave (tips curving back toward the archer) and a string whose middle
// follows the drawing hand. Built in its own frame: +Y up the stave, +Z toward the target.
function makeBow() {
  const group = new THREE.Group();
  const R = 0.62, half = 0.62, pts = [];
  for (let i = 0; i <= 24; i++) { const a = -half + (2 * half) * i / 24; pts.push(new THREE.Vector3(0, Math.sin(a) * R, (Math.cos(a) - 1) * R * 0.55)); }
  const curve = new THREE.CatmullRomCurve3(pts);
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4423, roughness: 0.7 });
  const stave = new THREE.Mesh(new THREE.TubeGeometry(curve, 32, 0.016, 6, false), wood); stave.castShadow = true; group.add(stave);
  const grip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.12, 8), new THREE.MeshStandardMaterial({ color: 0x3a2414, roughness: 0.9 })); group.add(grip);
  const top = pts[pts.length - 1].clone(), bottom = pts[0].clone();
  const geo = new THREE.BufferGeometry().setFromPoints([top, top.clone().lerp(bottom, 0.5), bottom]);
  const string = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xe8e2d0 })); group.add(string);
  // an arrow resting on the string while drawn
  const arrow = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.8, 5), new THREE.MeshStandardMaterial({ color: 0x8a6a40 })); shaft.rotation.x = Math.PI / 2; shaft.position.z = 0.4; arrow.add(shaft);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.06, 6), new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.4 })); head.rotation.x = Math.PI / 2; head.position.z = 0.82; arrow.add(head);
  arrow.visible = false; group.add(arrow);
  return { group, string, top, bottom, arrow };
}

export class RangerAvatar {
  constructor(owner, assets) {
    this.owner = owner; this.assets = assets;
    this.root = new THREE.Group(); this.root.name = 'MeshyRanger3D'; owner.root.add(this.root);
    this.pivot = new THREE.Group(); this.pivot.position.y = 0.9; this.root.add(this.pivot);
    this.model = clone(assets.body.scene);
    this.model.traverse(n => { if (n.isMesh) n.material = Array.isArray(n.material) ? n.material.map(m => m.clone()) : n.material.clone(); });
    this.bones = {}; this.model.traverse(n => { if (n.isBone) this.bones[boneKey(n.name)] = n; });
    // size her by the skeleton (head top to toes, plus the hood) to the game's 1.8 figure height
    this.model.updateMatrixWorld(true);
    const y = (k) => this.bones[k].getWorldPosition(new THREE.Vector3()).y;
    const height = y('HeadTop_End') + 0.1 - Math.min(y('LeftToe_End'), y('RightToe_End'));
    this.model.scale.setScalar(1.8 / height); this.model.rotation.y = Math.PI;
    this.model.position.y = -0.9; this.pivot.add(this.model);
    this.mixer = new THREE.AnimationMixer(this.model);
    this.hips = this.bones.Hips; this.restHips = this.hips.position.clone();
    // bow in the left hand: set it upright, facing the target, in the full-draw pose, then let the hand carry it
    this.bow = makeBow();
    const draw = this.mixer.clipAction(assets.clips.get('draw')); draw.play(); this.mixer.setTime(0.2);
    this.model.updateMatrixWorld(true);
    const hand = this.bones.LeftHand, grip = hand.getWorldPosition(new THREE.Vector3());
    const aim = grip.clone().sub(this.bones.LeftShoulder.getWorldPosition(new THREE.Vector3())).setY(0).normalize();
    const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), aim.clone().negate(), new THREE.Vector3(0, 1, 0));
    // place it in world space (grip + facing the shot, real size), then hand it to the bone keeping that transform
    owner.root.updateMatrixWorld(true);
    this.bow.group.quaternion.setFromRotationMatrix(m).premultiply(owner.root.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.bow.group.position.copy(owner.root.worldToLocal(grip.clone()));
    this.bow.group.scale.setScalar(1 / owner.root.getWorldScale(new THREE.Vector3()).x);
    owner.root.add(this.bow.group); this.bow.group.updateMatrixWorld(true); hand.attach(this.bow.group);
    draw.stop(); this.mixer.uncacheAction(assets.clips.get('draw'));
    // arrows leave from just in front of the bow grip
    this.tip = new THREE.Object3D(); this.tip.position.set(0, 0, 0.12); this.bow.group.add(this.tip);
    this.materials = []; this.root.traverse(n => { if (n.isMesh) for (const mt of Array.isArray(n.material) ? n.material : [n.material]) this.materials.push([mt, mt.color.clone()]); });
    this.reset();
  }
  reset() { this.mixer.stopAllAction(); this.current = null; this.shotSerial = 0; this.lastShot = -1; this.pivot.rotation.set(0, 0, 0); }
  play(name, token, once = false, fade = 0.15) {
    const clip = this.assets.clips.get(name); if (!clip) throw new Error(`Missing 3D ranger animation: ${name}`);
    if (this.current?.token === token) return this.current.action;
    const previous = this.current?.action, action = this.mixer.clipAction(clip);
    action.reset(); action.enabled = true; action.setEffectiveWeight(1); action.setEffectiveTimeScale(1);
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity); action.clampWhenFinished = once; action.play();
    if (previous && previous !== action) { previous.fadeOut(fade); action.fadeIn(fade); }
    this.current = { token, action, clip }; return action;
  }
  update(dt, cfg) {
    const c = this.owner, speed = Math.hypot(c.vel.x, c.vel.z);
    const shot = c.skill?.id === 'quickShot' ? c.skill : null, disengage = c.skill?.id === 'disengage';
    if ((c.shotT ?? -1) > this.lastShot + 0.001 || (shot && !this.lastShotSkill)) this.shotSerial++;
    this.lastShot = c.shotT ?? -1; this.lastShotSkill = !!shot;
    let name = 'idle', token = 'idle', once = false, scale = 1, drawn = false;
    if (c.dead) { name = 'death'; token = 'death'; once = true; }
    else if (shot && shot.t < cfg.quickShot.releaseAt) { name = 'draw'; token = 'shot-draw:' + this.shotSerial; drawn = true; }
    else if (shot || (c.recoilT ?? 0) > 0) { name = 'recoil'; token = 'recoil:' + this.shotSerial; once = true; }
    else if (c.charged === 'aimedShot' || c.casting?.spell === 'aimedShot') { name = 'draw'; token = 'aim'; drawn = true; }
    else if (speed > 0.3 && !disengage) {
      const back = c.vel.dot(c.forward()) < -0.1;
      name = speed > 6.2 ? 'Running' : 'Walking'; token = 'move:' + name;
      scale = name === 'Walking' ? (back ? -1 : 1) * Math.max(0.65, speed / 3.2) : Math.max(0.75, speed / 6);
    }
    const action = this.play(name, token, once, name === 'draw' ? 0.1 : 0.15);
    if (!once) action.setEffectiveTimeScale(scale);
    this.mixer.update(dt);
    this.hips.position.x = this.restHips.x; this.hips.position.z = this.restHips.z;   // gameplay owns where she stands
    this.pivot.rotation.set(0, 0, 0);
    if (c.rolling) this.pivot.rotation.x = -Math.PI * 2 * Math.min(1, c.rollT / cfg.rollTime);
    if (disengage) { const p = Math.min(1, c.skill.t / cfg.disengage.time); this.pivot.rotation.x = Math.sin(p * Math.PI) * 0.45; }   // leaning back into the leap
    this.root.updateWorldMatrix(true, true);
    if (c.crouchK > 0.001 && !c.dead) {   // knees bend, feet stay planted
      const feet = ['Left', 'Right'].map(s => this.bones[`${s}Foot`].getWorldPosition(new THREE.Vector3()));
      this.hips.position.y -= 0.65 * c.crouchK / this.model.scale.x;
      this.root.updateWorldMatrix(true, true);
      const fwd = c.forward().clone();
      ['Left', 'Right'].forEach((s, i) => reach(this.bones[`${s}UpLeg`], this.bones[`${s}Leg`], this.bones[`${s}Foot`], feet[i], fwd));
    }
    // bowstring: its middle follows the drawing hand while drawn, otherwise it hangs straight
    const bow = this.bow, mid = bow.top.clone().lerp(bow.bottom, 0.5);
    if (drawn && !c.dead) {
      const pull = bow.group.worldToLocal(this.bones.RightHand.getWorldPosition(new THREE.Vector3()));
      if (pull.length() < 1.2) mid.copy(pull);
    }
    const pos = bow.string.geometry.attributes.position; pos.setXYZ(1, mid.x, mid.y, mid.z); pos.needsUpdate = true;
    bow.arrow.visible = drawn && !c.dead;
    if (bow.arrow.visible) bow.arrow.position.copy(mid);
    const f = THREE.MathUtils.clamp(c.flashT / 0.18, 0, 1);
    for (const [mt, color] of this.materials) mt.color.copy(color).multiply(new THREE.Color(1, 1 - f * 0.65, 1 - f * 0.65));
    this.root.updateWorldMatrix(true, true);
  }
  dispose() {
    this.root.removeFromParent(); this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model);
    for (const [m] of this.materials) m.dispose();
  }
}
