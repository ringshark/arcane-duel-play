import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone } from 'three/addons/utils/SkeletonUtils.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

export async function loadWarriorAssets(renderer) {
  const loader = new GLTFLoader();
  const [body, sword, shield] = await Promise.all(['warrior', 'sword', 'shield'].map(name =>
    loader.loadAsync(new URL(`./assets/warrior/${name}.glb`, import.meta.url).href)));
  const generator = new THREE.PMREMGenerator(renderer), room = new RoomEnvironment();
  const environment = generator.fromScene(room, 0.04).texture;
  room.dispose(); generator.dispose();
  for (const asset of [body, sword, shield]) asset.scene.traverse(node => {
    if (!node.isMesh) return;
    node.castShadow = node.receiveShadow = true;
    for (const mat of Array.isArray(node.material) ? node.material : [node.material]) {
      mat.envMap = environment; mat.envMapIntensity = 0.45;
      for (const key of ['map', 'normalMap', 'roughnessMap', 'metalnessMap']) if (mat[key]) mat[key].anisotropy = 8;
    }
  });
  const response=await fetch(new URL("./assets/warrior/strike-markers.json",import.meta.url));
  if(!response.ok)throw new Error("Warrior strike markers could not load");
  const strikeMarkers=await response.json();
  return { body, sword, shield, strikeMarkers };
}

function copyModel(source) {
  const model = clone(source);
  model.traverse(node => {
    if (!node.isMesh) return;
    node.material = Array.isArray(node.material) ? node.material.map(m => m.clone()) : node.material.clone();
  });
  return model;
}

// Rotate a bone in world space without assuming Meshy's bone-roll convention.
function aimBone(bone, from, to, weight = 1) {
  if (from.lengthSq() < 1e-10 || to.lengthSq() < 1e-10) return;
  const old = bone.quaternion.clone();
  const delta = new THREE.Quaternion().setFromUnitVectors(from.normalize(), to.normalize());
  const world = delta.multiply(bone.getWorldQuaternion(new THREE.Quaternion()));
  const parent = bone.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  bone.quaternion.copy(parent.multiply(world));
  bone.quaternion.slerpQuaternions(old, bone.quaternion.clone(), weight);
  bone.updateWorldMatrix(false, true);
}

function reach(upper, lower, hand, target, pole, weight = 1) {
  if (!upper || !lower || !hand || weight <= 0) return;
  const a = upper.getWorldPosition(new THREE.Vector3()), b = lower.getWorldPosition(new THREE.Vector3()), c = hand.getWorldPosition(new THREE.Vector3());
  const l1 = a.distanceTo(b), l2 = b.distanceTo(c), direction = target.clone().sub(a);
  if (l1 < 1e-5 || l2 < 1e-5 || direction.lengthSq() < 1e-8) return;
  const distance = THREE.MathUtils.clamp(direction.length(), Math.abs(l1-l2)+0.001, l1+l2-0.001);
  direction.normalize();
  const bend = pole.clone().addScaledVector(direction, -pole.dot(direction));
  if (bend.lengthSq() < 1e-8) return;
  bend.normalize();
  const along = (l1*l1-l2*l2+distance*distance)/(2*distance);
  const elbow = a.clone().addScaledVector(direction, along).addScaledVector(bend, Math.sqrt(Math.max(0,l1*l1-along*along)));
  aimBone(upper, b.sub(a), elbow.sub(a), weight);
  const nextB=lower.getWorldPosition(new THREE.Vector3()), nextC=hand.getWorldPosition(new THREE.Vector3());
  aimBone(lower, nextC.sub(nextB), target.clone().sub(nextB), weight);
}

export class WarriorAvatar {
  constructor(owner, assets) {
    this.owner=owner; this.assets=assets;
    this.root=new THREE.Group(); this.root.name='MeshyWarrior3D'; owner.root.add(this.root);
    this.pivot=new THREE.Group(); this.pivot.position.y=0.9; this.root.add(this.pivot);
    this.model=copyModel(assets.body.scene);
    const height=new THREE.Box3().setFromObject(this.model).getSize(new THREE.Vector3()).y;
    this.model.scale.setScalar(1.8/height); this.model.rotation.y=Math.PI;
    this.model.position.y=-0.9; this.pivot.add(this.model);
    this.mixer=new THREE.AnimationMixer(this.model);
    this.clips=new Map(assets.body.animations.map(c=>[c.name,c]));
    this.bones={}; this.model.traverse(n=>{if(n.isBone)this.bones[n.name]=n;});
    this.hips=this.bones.mixamorig_Hips; this.restHips=this.hips.position.clone();
    this.swordGrip=new THREE.Group(); this.bones.mixamorig_RightHand.add(this.swordGrip);
    const sword=copyModel(assets.sword.scene), box=new THREE.Box3().setFromObject(sword), size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const scale=1.0/size.y, gripY=box.min.y+size.y*0.58; sword.scale.setScalar(scale);
    sword.position.set(-center.x*scale, -gripY*scale, -center.z*scale);
    this.swordGrip.rotation.z=Math.PI;
    this.swordGrip.add(sword);
    this.tip=new THREE.Object3D(); this.tip.position.y=(box.min.y-gripY)*scale; this.swordGrip.add(this.tip);
    this.backSword=new THREE.Group(); this.backSword.position.set(-0.18,1.05,0.23); this.backSword.rotation.z=-0.25;
    const stored=copyModel(assets.sword.scene); stored.scale.copy(sword.scale); stored.position.copy(sword.position); this.backSword.add(stored);
    this.root.add(this.backSword);
    this.materials=[]; this.root.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])this.materials.push([m,m.color.clone()]);});
    this.reset();
  }
  reset() { this.mixer.stopAllAction(); this.current=null; this.lastSwing=-1; this.lastSkill=null; this.pivot.rotation.set(0,0,0); }
  play(name, token, duration=null) {
    const clip=this.clips.get(name); if(!clip)throw new Error(`Missing 3D warrior animation: ${name}`);
    if(this.current?.token===token)return this.current.action;
    const previous=this.current?.action, action=this.mixer.clipAction(clip);
    action.reset(); action.enabled=true; action.setEffectiveWeight(1); action.setEffectiveTimeScale(1);
    action.setLoop(duration===null?THREE.LoopRepeat:THREE.LoopOnce, duration===null?Infinity:1);
    action.clampWhenFinished=duration!==null; action.paused=duration!==null; action.play();
    if(previous && previous!==action){previous.fadeOut(0.12);action.fadeIn(0.12);}
    this.current={token,action,clip,duration}; return action;
  }
  createShield() {
    const group=new THREE.Group(), model=copyModel(this.assets.shield.scene);
    const box=new THREE.Box3().setFromObject(model), size=box.getSize(new THREE.Vector3()), center=box.getCenter(new THREE.Vector3());
    const scale=0.76/Math.max(size.x,size.y); model.scale.setScalar(scale); model.position.copy(center).multiplyScalar(-scale); group.add(model);
    const mats=[]; model.traverse(n=>{if(n.isMesh)for(const m of Array.isArray(n.material)?n.material:[n.material])mats.push(m);});
    group.userData={art:this.owner.art,mats,meshy:true}; this.owner.root.add(group); return group;
  }
  update(dt, cfg) {
    const c=this.owner, speed=Math.hypot(c.vel.x,c.vel.z);
    let name='Idle', token='idle', progress=null, contact=null;
    if(c.dead){name='Dying';token='death';progress=Math.min(1,c.deathT/1.1);}
    else if(c.swingT>=0){
      name={over:'Sword_And_Shield_Slash_Cross',back:'Standing_Melee_Attack_Backhand',stab:'Sword_And_Shield_Attack_Low'}[c.swingType]||'Sword_And_Shield_Slash_Cross';
      if(c.swingT<this.lastSwing)this.swingSerial=(this.swingSerial||0)+1;
      token=`swing:${c.swingType}:${this.swingSerial||0}`;progress=Math.min(1,c.swingT/cfg.sword.time);contact=cfg.sword.hitAt/cfg.sword.time;
    } else if(c.skill){
      if(c.skill!==this.lastSkill)this.skillSerial=(this.skillSerial||0)+1;
      name={bash:'Standing_Block_React_Large',whirlwind:'Standing_Melee_Attack_360_High',throwAxe:'Sword_And_Shield_Attack_High',charge:'Running',warCry:'Idle'}[c.skill.id];
      token=`skill:${c.skill.id}:${this.skillSerial}`;
      if(!['charge','warCry'].includes(c.skill.id))progress=Math.min(1,c.skill.t/cfg[c.skill.id].time);
    } else if(c.blockType==='guard'){name='Great_Sword_Blocking';token='guard';}
    else if(speed>0.3){
      const forward=c.forward(), along=c.vel.dot(forward), side=c.vel.x*Math.cos(c.yaw)-c.vel.z*Math.sin(c.yaw);
      name=Math.abs(side)>Math.abs(along)*1.3 ? (side<0?'Great_Sword_Strafe_Left':'Great_Sword_Strafe_Right') : speed>6.2?'Running':'Walking';
      token='move:'+name;
    }
    this.lastSwing=c.swingT;this.lastSkill=c.skill;
    const action=this.play(name,token,progress===null?null:1);
    if(progress!==null){
      // Keep hit events in the existing controller. Fit the visual wind-up/strike/recovery to that timeline.
      const strike=this.assets.strikeMarkers[name] ?? 0.55;
      const phase=contact===null?progress:(progress<contact?progress/contact*strike:strike+(progress-contact)/(1-contact)*(1-strike));
      action.time=Math.min(this.current.clip.duration-1e-6,phase*this.current.clip.duration);
    } else {
      const backwards=name==='Walking' && c.vel.dot(c.forward()) < -0.1;
      action.setEffectiveTimeScale(name==='Walking'?(backwards?-1:1)*Math.max(0.65,speed/3.2):name==='Running'?Math.max(0.75,speed/6):1);
    }
    this.mixer.update(dt);
    // Gameplay owns translation. Clip root motion must not move the mesh away from its collision boxes.
    this.hips.position.x=this.restHips.x; this.hips.position.z=this.restHips.z;
    this.pivot.rotation.set(0,0,0);
    if(c.rolling)this.pivot.rotation.x=-Math.PI*2*Math.min(1,c.rollT/cfg.rollTime);
    this.root.updateWorldMatrix(true,true);
    if(c.crouchK>0.001 && !c.dead){
      const feet=['Left','Right'].map(side=>this.bones[`mixamorig_${side}Foot`].getWorldPosition(new THREE.Vector3()));
      this.hips.position.y-=0.65*c.crouchK;
      this.root.updateWorldMatrix(true,true);
      const forward=c.forward().clone();
      ['Left','Right'].forEach((side,i)=>reach(this.bones[`mixamorig_${side}UpLeg`],this.bones[`mixamorig_${side}Leg`],this.bones[`mixamorig_${side}Foot`],feet[i],forward));
    }
    this.swordGrip.visible=c.swordOut && !(c.gear?.item==='sword');
    this.backSword.visible=!this.swordGrip.visible;
    if(c.shield3D && c.hasShield && !c.dead){
      const target=c.shield3D.getWorldPosition(new THREE.Vector3()), pole=new THREE.Vector3(1,0,-0.3).applyQuaternion(c.root.getWorldQuaternion(new THREE.Quaternion()));
      reach(this.bones.mixamorig_LeftArm,this.bones.mixamorig_LeftForeArm,this.bones.mixamorig_LeftHand,target,pole);
    }
    const f=THREE.MathUtils.clamp(c.flashT/0.18,0,1);
    for(const [mat,color] of this.materials)mat.color.copy(color).multiply(new THREE.Color(1,1-f*0.65,1-f*0.65));
    this.root.updateWorldMatrix(true,true);
  }
  dispose(){
    this.root.removeFromParent();this.mixer.stopAllAction();this.mixer.uncacheRoot(this.model);
    for(const [m] of this.materials)m.dispose();
    if(this.owner.shield3D?.userData.meshy){
      for(const m of this.owner.shield3D.userData.mats)m.dispose();
      this.owner.shield3D.removeFromParent();this.owner.shield3D=null;
    }
  }
}
