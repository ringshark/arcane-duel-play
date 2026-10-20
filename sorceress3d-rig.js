// Sorceress 3D: the Tripo model (DuelPits/Sorceress3D) comes unrigged — one static mesh with the staff fused to her
// left hand. This builds a skeleton for it, skins the mesh to it, and poses the bones every frame from the game state
// (walk / back-pedal / strafe / jump / crouch / roll / staff swing / staff block / casting / drinking / stun / death).
// Classic script (not a module) so the game still runs from file://; THREE is passed in by the game.
window.SorceressRig = (() => {
  // Joints measured on the model (model units: soles at y = 0, hood top 0.93, facing +Z, her left hand / staff at +X)
  const J = {
    hips: [-0.065, 0.47, 0], spine: [-0.065, 0.56, 0], chest: [-0.065, 0.65, 0], neck: [-0.065, 0.75, -0.005], head: [-0.067, 0.80, 0], headTop: [-0.07, 0.93, 0],
    thighR: [-0.11, 0.45, 0], kneeR: [-0.155, 0.24, 0], ankleR: [-0.18, 0.07, 0], toeR: [-0.205, 0.0, 0.06],
    thighL: [-0.02, 0.45, 0], kneeL: [-0.012, 0.24, 0], ankleL: [-0.01, 0.07, -0.01], toeL: [-0.005, 0.0, 0.03],
    shoulderR: [-0.14, 0.725, -0.005], elbowR: [-0.2, 0.555, 0], wristR: [-0.215, 0.445, 0.02], fingersR: [-0.222, 0.36, 0.04],
    shoulderL: [0.015, 0.725, -0.01], elbowL: [0.07, 0.585, -0.04], wristL: [0.14, 0.64, 0.035], fingersL: [0.178, 0.668, 0.05],
  };
  const HOOD_TOP = 0.93;                                       // she is scaled so this is FIGURE_H tall
  const STAFF = { bottom: [0.100, 0.0, -0.014], top: [0.205, 0.97, 0.05], tip: [0.205, 0.90, 0.075] };   // tip = where the spell glow sits
  // [bone, parent, joint it pivots on, weighting segment from → to]
  const BONES = [
    ['hips', null, 'hips', [-0.065, 0.42, 0], J.spine],
    ['spine', 'hips', 'spine', J.spine, J.chest],
    ['chest', 'spine', 'chest', J.chest, J.neck],
    ['neck', 'chest', 'neck', J.neck, J.head],
    ['head', 'neck', 'head', J.head, J.headTop],
    ['thighR', 'hips', 'thighR', J.thighR, J.kneeR], ['shinR', 'thighR', 'kneeR', J.kneeR, J.ankleR], ['footR', 'shinR', 'ankleR', J.ankleR, J.toeR],
    ['thighL', 'hips', 'thighL', J.thighL, J.kneeL], ['shinL', 'thighL', 'kneeL', J.kneeL, J.ankleL], ['footL', 'shinL', 'ankleL', J.ankleL, J.toeL],
    ['upperArmR', 'chest', 'shoulderR', J.shoulderR, J.elbowR], ['foreArmR', 'upperArmR', 'elbowR', J.elbowR, J.wristR], ['handR', 'foreArmR', 'wristR', J.wristR, J.fingersR],
    ['upperArmL', 'chest', 'shoulderL', J.shoulderL, J.elbowL], ['foreArmL', 'upperArmL', 'elbowL', J.elbowL, J.wristL], ['handL', 'foreArmL', 'wristL', J.wristL, J.fingersL],
  ];
  const BI = Object.fromEntries(BONES.map((b, i) => [b[0], i]));
  const TORSO = ['hips', 'spine', 'chest', 'neck', 'head'].map(n => BI[n]);
  const LEGS = ['thighR', 'shinR', 'thighL', 'shinL'].map(n => BI[n]);
  const LEG_LEN = { thigh: 0.215, shin: 0.17 };

  const segDist = (p, a, b) => {
    const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy + (p[2] - a[2]) * vz) / (vx * vx + vy * vy + vz * vz)));
    return Math.hypot(p[0] - a[0] - vx * t, p[1] - a[1] - vy * t, p[2] - a[2] - vz * t);
  };

  // Base colour lookup (to find her red hood / scarf / cape, which hang off the torso rather than the limbs)
  function colourSampler(tex) {
    const img = tex && tex.image; if (!img) return () => [0, 0, 0];
    const N = 512, c = document.createElement('canvas'); c.width = c.height = N;
    const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(img, 0, 0, N, N);
    const d = g.getImageData(0, 0, N, N).data;
    return (u, v) => {
      const x = Math.min(N - 1, Math.max(0, Math.floor((u - Math.floor(u)) * N))), y = Math.min(N - 1, Math.max(0, Math.floor((v - Math.floor(v)) * N)));
      const i = (y * N + x) * 4; return [d[i], d[i + 1], d[i + 2]];
    };
  }

  // Skin weights for every vertex (up to 4 bones each)
  function skin(THREE, geo, material) {
    const P = geo.attributes.position, UV = geo.attributes.uv, n = P.count, NB = BONES.length;
    const colour = colourSampler(material.map);
    // weld vertices that share a position (UV seams) so both sides of a seam bend together
    const ids = new Int32Array(n), keyOf = new Map(); let nc = 0;
    for (let i = 0; i < n; i++) {
      const key = `${Math.round(P.getX(i) * 1e4)},${Math.round(P.getY(i) * 1e4)},${Math.round(P.getZ(i) * 1e4)}`;
      let id = keyOf.get(key); if (id === undefined) { id = nc++; keyOf.set(key, id); } ids[i] = id;
    }
    const W = new Float32Array(nc * NB), rigid = new Uint8Array(nc), red = new Uint8Array(nc), done = new Uint8Array(nc);
    const p = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      const [r, g, b] = UV ? colour(UV.getX(i), UV.getY(i)) : [0, 0, 0];
      if (r > 30 && r - g > 16 && r >= b + 4) red[id] = 1;     // crimson hood, scarf, cape
      if (done[id]) continue; done[id] = 1;
      p[0] = P.getX(i); p[1] = P.getY(i); p[2] = P.getZ(i);
      // the staff (and its feathered head) rides rigidly in her left hand
      // (the shaft is crooked: anything out past her body at staff height counts, except where her hand and forearm are)
      const sd = segDist(p, STAFF.bottom, STAFF.top);
      if (sd < 0.024 || (p[1] > 0.565 && p[1] < 0.76 && sd < 0.042) || (p[0] > 0.088 && (p[1] < 0.565 || p[1] > 0.70)) || (p[1] > 0.76 && p[0] > 0.15)) { W[id * NB + BI.handL] = 1; rigid[id] = 1; continue; }
      const d = BONES.map(B => segDist(p, B[3], B[4]));
      // skirt: below the waist but outside the legs themselves → shared between the hips and the nearest thigh
      const legD = Math.min(...LEGS.map(k => d[k]));
      if (p[1] < 0.53 && p[1] > 0.12 && legD > 0.038 && d[BI.handR] > 0.05 && d[BI.foreArmR] > 0.05) {
        const leg = d[BI.thighR] < d[BI.thighL] ? BI.thighR : BI.thighL;
        const t = Math.max(0, Math.min(1, (0.5 - p[1]) / 0.3));   // the lower the hem, the more it follows the leg
        W[id * NB + BI.hips] = 1 - 0.65 * t; W[id * NB + leg] = 0.65 * t;
        continue;
      }
      const best = d.map((dk, k) => [k, 1 / (dk + 0.004) ** 4]).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const sum = best.reduce((s, b) => s + b[1], 0);
      for (const [k, w] of best) W[id * NB + k] = w / sum;
    }
    // cloth hangs off the torso (the hood off the head), never off an arm or leg
    const clothOnly = (id, y) => {
      const keep = y > 0.78 ? [BI.head, BI.neck] : TORSO;
      let s = 0; for (let k = 0; k < NB; k++) { if (!keep.includes(k)) W[id * NB + k] = 0; s += W[id * NB + k]; }
      if (s < 1e-6) { W[id * NB + (y > 0.78 ? BI.head : y > 0.65 ? BI.chest : y > 0.56 ? BI.spine : BI.hips)] = 1; s = 1; }
      for (const k of keep) W[id * NB + k] /= s;
    };
    const cy = new Float32Array(nc); for (let i = 0; i < n; i++) cy[ids[i]] = P.getY(i);
    for (let id = 0; id < nc; id++) if (red[id] && !rigid[id]) clothOnly(id, cy[id]);
    // smooth the weights over the surface so joints bend instead of tearing
    const idx = geo.index.array, nbr = Array.from({ length: nc }, () => []);
    for (let t = 0; t < idx.length; t += 3) {
      const a = ids[idx[t]], b = ids[idx[t + 1]], c = ids[idx[t + 2]];
      nbr[a].push(b, c); nbr[b].push(a, c); nbr[c].push(a, b);
    }
    const tmp = new Float32Array(nc * NB);
    for (let pass = 0; pass < 2; pass++) {
      tmp.set(W);
      for (let id = 0; id < nc; id++) {
        if (rigid[id] || !nbr[id].length) continue;
        const nb = nbr[id], f = 0.5 / nb.length;
        for (let k = 0; k < NB; k++) {
          let s = 0; for (const j of nb) s += tmp[j * NB + k];
          W[id * NB + k] = tmp[id * NB + k] * 0.5 + s * f;
        }
      }
      for (let id = 0; id < nc; id++) if (red[id] && !rigid[id]) clothOnly(id, cy[id]);
    }
    // keep the 4 strongest bones per vertex
    const si = new Uint16Array(n * 4), sw = new Float32Array(n * 4);
    const top = new Array(NB);
    for (let i = 0; i < n; i++) {
      const id = ids[i];
      for (let k = 0; k < NB; k++) top[k] = [k, W[id * NB + k]];
      top.sort((a, b) => b[1] - a[1]);
      const s = top[0][1] + top[1][1] + top[2][1] + top[3][1] || 1;
      for (let j = 0; j < 4; j++) { si[i * 4 + j] = top[j][0]; sw[i * 4 + j] = top[j][1] / s; }
    }
    geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
    geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
  }

  // Parse the embedded GLB once and skin it: the result is the class's "art" (shared by every figure using it)
  async function prepare(THREE, GLTFLoader, b64, figureH) {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
    const gltf = await new Promise((res, rej) => new GLTFLoader().parse(bin, '', res, rej));
    let src; gltf.scene.traverse(o => { if (o.isMesh && !src) src = o; });
    const geo = src.geometry, material = src.material;
    skin(THREE, geo, material);
    material.metalness = Math.min(material.metalness, 0.4);   // no env map in the arena: keep metal bits from going black
    // the arena is dim and the other fighters are unlit pictures: let her texture glow a little so she reads as clearly
    material.emissiveMap = material.map; material.emissive = new THREE.Color(0xffffff); material.emissiveIntensity = 0.6;
    return { rig: true, geometry: geo, material, scale: figureH / HOOD_TOP };
  }

  // One posable figure: group (in the character's root) → fall (death, pivots at the feet) → roll (pivots at the waist) → skinned mesh
  function create(THREE, art) {
    const S = art.scale;
    const group = new THREE.Group(); group.rotation.y = Math.PI;   // the model faces +Z; characters face -Z
    const fall = new THREE.Group(); group.add(fall);
    const roll = new THREE.Group(); roll.position.y = J.hips[1] * S; fall.add(roll);
    const holder = new THREE.Group(); holder.position.set(-J.hips[0] * S, -J.hips[1] * S, 0); holder.scale.setScalar(S); roll.add(holder);
    const material = art.material.clone();
    const mesh = new THREE.SkinnedMesh(art.geometry, material);
    mesh.castShadow = true; mesh.frustumCulled = false;   // posed (rolling, falling) she leaves her bind-pose bounds
    holder.add(mesh);
    const bones = {}, list = [];
    for (const [name, parent, joint] of BONES) {
      const b = new THREE.Bone(); b.name = name;
      const jp = J[joint], pp = parent ? J[BONES[BI[parent]][2]] : [0, 0, 0];
      b.position.set(jp[0] - pp[0], jp[1] - pp[1], jp[2] - pp[2]);
      (parent ? bones[parent] : mesh).add(b);
      bones[name] = b; list.push(b);
    }
    mesh.updateMatrixWorld(true);
    mesh.bind(new THREE.Skeleton(list));
    const tip = new THREE.Object3D(); tip.position.set(STAFF.tip[0] - J.wristL[0], STAFF.tip[1] - J.wristL[1], STAFF.tip[2] - J.wristL[2]); bones.handL.add(tip);
    const rest = { hipsY: bones.hips.position.y };
    return { group, fall, roll, mesh, bones, tip, mats: [material], rest, cur: {}, S };
  }

  let STAFF_DIR = null;   // the staff's own direction in the bind pose (set once THREE is known)
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const lerp = (a, b, t) => a + (b - a) * t;

  // Pose the figure from the character's state. C = the game's CFG; c = the character.
  function pose(THREE, R, c, C, dt, time) {
    if (!STAFF_DIR) STAFF_DIR = new THREE.Vector3(STAFF.top[0] - STAFF.bottom[0], STAFF.top[1] - STAFF.bottom[1], STAFF.top[2] - STAFF.bottom[2]).normalize();
    const B = R.bones, T = {};   // T[bone] = [x, y, z] target rotation (radians, model axes: +X her left, +Y up, +Z forward)
    for (const k in B) T[k] = [0, 0, 0];
    const add = (k, x = 0, y = 0, z = 0) => { T[k][0] += x; T[k][1] += y; T[k][2] += z; };
    // movement relative to her facing
    const hs = Math.hypot(c.vel.x, c.vel.z);
    const fwd = -c.vel.x * Math.sin(c.yaw) - c.vel.z * Math.cos(c.yaw);
    const side = c.vel.x * Math.cos(c.yaw) - c.vel.z * Math.sin(c.yaw);
    let mode = 'idle';
    if (!c.dead && !c.rolling) {
      if (!c.onGround) mode = 'air';
      else if (hs > 0.3) mode = Math.abs(fwd) >= Math.abs(side) ? (fwd > 0 ? 'forward' : 'back') : 'strafe';
    }
    if (c.onGround && !c.rolling && hs > 0.3) c.walkPhase += dt * hs * 2.0;
    if (mode === 'forward') c.gait += dt * hs * 1.7;
    else if (mode === 'back') c.gait += dt * hs * 2.2;
    else if (mode === 'strafe') c.gait += dt * hs * 2.2;
    const amp = c.onGround ? Math.min(1, hs / 6) : 0;

    // Legs: [right, left] — swing (thigh), knee bend while the foot travels, foot kept roughly flat
    const legs = [['thighR', 'shinR', 'footR'], ['thighL', 'shinL', 'footL']];
    const thighX = [0, 0];
    legs.forEach(([th, sh, ft], i) => {
      const p = c.gait + i * Math.PI;
      let tx = 0, tz = 0, kx = 0;
      if (mode === 'forward') { tx = -0.45 * Math.sin(p); kx = 0.85 * Math.max(0, Math.cos(p)); }
      else if (mode === 'back') { tx = 0.42 * Math.sin(p); kx = 0.75 * Math.max(0, Math.cos(p)); }
      else if (mode === 'strafe') {
        const dir = Math.sign(side) || 1, lead = (dir > 0) === (i === 0);   // moving to her right: the right leg leads
        const out = lead ? Math.max(0, Math.sin(p)) : Math.max(0, -Math.sin(p));
        tz = -dir * (lead ? 0.38 : 0.2) * out; kx = 0.35 * out;
      } else if (mode === 'air') { tx = i ? -0.3 : -0.75; kx = i ? 0.7 : 1.2; }
      else if (!c.dead && !c.rolling) tz = Math.sin(time * 1.6 + i * 1.3) * 0.02;   // idle weight shift
      thighX[i] = tx;
      add(th, tx, 0, tz); add(sh, kx); add(ft, -(tx + kx) * 0.7);
    });
    // Crouch: thighs forward, shins back, feet flat — the hips drop by however much the legs fold
    const ck = c.crouchK, a = 1.15 * ck;
    for (const [th, sh, ft] of legs) { add(th, -a); add(sh, 2 * a); add(ft, -a); }
    T.thighR[2] += -0.08 * ck; T.thighL[2] += 0.08 * ck;   // knees splay a little
    add('spine', 0.3 * ck); add('chest', 0.12 * ck); add('neck', -0.25 * ck);
    let hipsY = R.rest.hipsY - (LEG_LEN.thigh + LEG_LEN.shin) * (1 - Math.cos(a));
    // body: walk bob and pelvis twist, leaning into the run
    hipsY += Math.abs(Math.sin(c.walkPhase)) * 0.012 * amp * (1 - 0.6 * ck);
    if (mode === 'forward' || mode === 'back') { add('hips', 0, 0.12 * Math.sin(c.gait) * amp); add('chest', 0, -0.16 * Math.sin(c.gait) * amp); }
    add('spine', 0.1 * clamp(fwd / 6, -1, 1));
    add('spine', 0, 0, -0.06 * clamp(side / 6, -1, 1));
    // idle breathing
    add('chest', Math.sin(time * 2.1) * 0.015); add('head', -Math.sin(time * 2.1) * 0.01);

    // Free (right) arm swings against the left leg; the staff arm just sways
    add('upperArmR', 0.55 * thighX[1], 0, -0.05); add('foreArmR', -0.18 - 0.2 * Math.abs(thighX[1]));
    add('upperArmL', 0.2 * thighX[0]);
    if (mode === 'air') { add('upperArmR', -0.4, 0, -0.5); add('foreArmR', -0.4); }

    // Staff: φ = where the staff points, as a forward rotation from upright (−: tipped back over her head, +: down in front)
    let shX = 0, shZ = 0, elX = 0, phi = null, staffDir = null, fast = false;
    if (c.swingT >= 0 && !c.swingType) {
      // big overhand chop: wind-up raising it back over her head, a tense pause, a fast strike, then recovery
      const S = C.staff, t = c.swingT, tStrike = S.windUp + S.hold, tEnd = tStrike + S.strike;
      const easeOut = x => 1 - (1 - x) ** 3, easeIn = x => x * x * x, easeIO = x => x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
      const UP = -1.6, OUT = -0.85, WIND = -0.85, STRIKE = 2.0;   // shoulder raised / out front, staff angle wound back / struck down
      let lean;
      if (t < S.windUp) { const e = easeOut(t / S.windUp); shX = UP * e; phi = WIND * e; lean = -0.18 * e; }
      else if (t < tStrike) { shX = UP; phi = WIND + Math.sin(t * 70) * 0.03; lean = -0.18; }
      else if (t < tEnd) { const e = easeIn((t - tStrike) / S.strike); shX = lerp(UP, OUT, e); phi = lerp(WIND, STRIKE, e); lean = lerp(-0.18, 0.35, e); fast = true; }
      else { const e = easeIO(Math.min(1, (t - tEnd) / (S.swingTime - tEnd))); shX = OUT * (1 - e); phi = STRIKE * (1 - e); lean = 0.35 * (1 - e); }
      const k = Math.min(1, Math.abs(shX) / 1.6);
      shZ = -0.25 * k; elX = -0.6 * k;
      add('spine', lean * 0.6); add('chest', lean * 0.5, -0.35 * k * Math.sign(lean || 1));
      add('upperArmR', -0.3 * k, 0, -0.25 * k); add('foreArmR', -0.3 * k);   // free arm out for balance
    } else if (c.blockType === 'staff') {
      // staff held level across her body, both hands on it
      shX = -1.05; shZ = -0.45; elX = -0.65; staffDir = new THREE.Vector3(-1, 0.06, -0.12).normalize();
      add('upperArmR', -0.8, 0, 0.3); add('foreArmR', -0.6);
      add('spine', 0.08); add('chest', 0, 0.15);
    } else if (c.casting && c.casting.spell === 'heal') {
      // staff raised high overhead while the heal gathers
      const e = Math.min(1, c.casting.t / 0.35);
      shX = -1.7 * e; shZ = -0.15 * e; elX = -0.7 * e; phi = -0.05 * e;
      add('head', -0.25 * e);
    } else if (c.casting || c.charged) {
      // staff levelled at the enemy, free hand pushed out in front
      const e = c.casting ? Math.min(1, c.casting.t / 0.3) : 1;
      shX = -1.05 * e; shZ = -0.25 * e; elX = -0.45 * e; phi = 0.95 * e;
      add('upperArmR', -0.6 * e, 0, 0.1 * e); add('foreArmR', -0.4 * e);
      add('spine', 0.06 * e);
    }
    add('upperArmL', shX, 0, shZ); add('foreArmL', elX);
    if (phi !== null) staffDir = new THREE.Vector3(0, Math.cos(phi), Math.sin(phi));
    if (staffDir) {
      // turn the hand so the staff points along staffDir (in model space), whatever the arm above it is doing
      const q = new THREE.Quaternion(), e = new THREE.Euler();
      for (const n of ['hips', 'spine', 'chest', 'upperArmL', 'foreArmL']) q.multiply(new THREE.Quaternion().setFromEuler(e.set(...T[n])));
      const want = new THREE.Quaternion().setFromUnitVectors(STAFF_DIR, staffDir);
      e.setFromQuaternion(q.invert().multiply(want));
      T.handL = [e.x, e.y, e.z];
    }

    // Drinking a potion: the free hand comes up to her mouth, head tipped back (an Explosion potion gets shaken)
    if (c.drinking) {
      const thrown = c.drinking.kind === 'explosive' || c.drinking.kind === 'flash', shake = thrown ? Math.sin(time * 55) * 0.25 : 0;
      T.upperArmR = [-0.75 + shake, 0, 0.3]; T.foreArmR = [-1.9, 0, 0]; add('head', thrown ? 0 : -0.3);
    }
    if (c.stunT > 0) { add('spine', 0, 0, Math.sin(time * 9) * 0.08); add('head', 0.2, Math.sin(time * 7) * 0.2); }
    // Roll: tucked tight
    if (c.rolling) {
      for (const [th, sh] of legs) { T[th][0] = -1.1; T[sh][0] = 1.6; }
      add('spine', 0.5); add('chest', 0.3); add('neck', 0.4);
      T.upperArmR = [-0.9, 0, 0.3]; T.foreArmR = [-1.2, 0, 0];
    }
    // Dead: limp, arms flung out
    if (c.dead) {
      const e = Math.min(1, c.deathT / 0.6);
      T.upperArmR = [-0.4 * e, 0, -1.0 * e]; T.upperArmL = [-0.5 * e, 0, 0.9 * e]; T.foreArmL = [0, 0, 0]; T.handL = [0.6 * e, 0, 0];
      add('head', -0.4 * e); add('thighL', -0.3 * e); add('shinL', 0.5 * e);
    }

    // ease every bone toward its target (snappy through the strike)
    const k = Math.min(1, dt * (fast ? 40 : 14));
    for (const name in B) {
      const r = B[name].rotation, t = T[name];
      r.x += (t[0] - r.x) * k; r.y += (t[1] - r.y) * k; r.z += (t[2] - r.z) * k;
    }
    B.hips.position.y += (hipsY - B.hips.position.y) * Math.min(1, dt * 18);

    // whole-body moves: roll (somersault the way she's rolling) and the death fall (backwards, from the feet)
    if (c.rolling) {
      const p = c.rollT / C.rollTime;
      const f = c.rollDir.x * -Math.sin(c.yaw) + c.rollDir.z * -Math.cos(c.yaw), s = c.rollDir.x * Math.cos(c.yaw) - c.rollDir.z * Math.sin(c.yaw);
      const dx = -s, dz = f, L = Math.hypot(dx, dz) || 1;   // roll direction in model space (her right = −X)
      R.roll.quaternion.setFromAxisAngle(new THREE.Vector3(dz / L, 0, -dx / L), p * Math.PI * 2);
    } else R.roll.quaternion.identity();
    R.fall.rotation.x = c.dead ? -Math.min(1, c.deathT / 0.6) * Math.PI / 2 * 0.95 : 0;
    // hit flash (red tint)
    const fl = c.flashT / 0.18;
    for (const m of R.mats) { m.color.setRGB(1, 1 - fl * 0.65, 1 - fl * 0.65); m.emissive.copy(m.color); }
  }

  // A still portrait for the class-select card
  function portrait(THREE, art, w = 240, h = 470) {
    const r = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    r.setSize(w, h); r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping;
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xd8dcff, 0x40303a, 2.2));
    const sun = new THREE.DirectionalLight(0xffeedd, 2.4); sun.position.set(1.5, 2.5, 3); scene.add(sun);
    const fig = create(THREE, art); fig.group.rotation.y = 0.35; scene.add(fig.group);
    const H = art.scale * 0.98, cam = new THREE.PerspectiveCamera(22, w / h, 0.1, 50);
    cam.position.set(0, H * 0.55, H * 3.0); cam.lookAt(0, H * 0.5, 0);
    r.render(scene, cam);
    const url = r.domElement.toDataURL('image/png');
    r.dispose(); r.forceContextLoss();
    return url;
  }

  return { prepare, create, pose, portrait, J, BONES };
})();
