const assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path');
const {chromium}=require('playwright');
const root=path.resolve(__dirname,'..');
const hook=`const _warriorOriginalCamera=updateCamera;window.__warriorTest={player,bot,scene,camera,renderer,CFG,update,updateCamera,applyClass,setDummyMode,dealDamage,blockReduction,
 setClass:id=>{selectedClass=id;applyClass()},
 reset:()=>{paused=true;state='playing';time=0;camYaw=0;camPitch=-0.08;botEnabled=false;testMode=true;hideOverlay();document.getElementById('banner').style.opacity=0;player.reset(new V3(0,0,18),0);bot.reset(new V3(0,0,10),Math.PI);setDummyMode(true);updateCamera()},
 input:(x,z,options={})=>({move:new V3(x,0,z),jump:false,roll:false,...options}),
 tick:(seconds,input=NO_INPUT)=>{for(let left=seconds;left>1e-8;){const dt=Math.min(1/120,left);time+=dt;player.step(dt,input);player.animate(dt,time);left-=dt}},
 inspect:()=>{updateCamera=()=>{camera.fov=50;camera.updateProjectionMatrix();const p=player.root.position;camera.position.set(p.x+3,p.y+2.4,p.z-4.5);camera.lookAt(p.x,p.y+1.5,p.z)}},
 control:(code,on)=>{locked=true;if(on)onPress(code);else onRelease(code)},
 normalCamera:()=>{updateCamera=_warriorOriginalCamera;camera.fov=70;camera.updateProjectionMatrix()},
 renderStep:dt=>{update(dt);updateCamera();updateHUD();renderer.render(scene,camera)}
};\n`;
async function withGame(callback,{viewport={width:1280,height:720}}={}){
 const server=http.createServer(async(req,res)=>{try{if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return}const file=path.resolve(root,'.'+decodeURIComponent(req.url.split('?')[0]));if(!file.startsWith(root+path.sep))throw Error('Invalid path');const data=await fs.readFile(file);res.setHeader('Content-Type',({'.html':'text/html','.js':'text/javascript','.glb':'model/gltf-binary','.png':'image/png'})[path.extname(file)]||'application/octet-stream');res.end(data)}catch{res.writeHead(404);res.end()}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const b=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',...(process.env.HTTPS_PROXY?{proxy:{server:process.env.HTTPS_PROXY,bypass:'127.0.0.1,localhost'}}:{}),args:['--no-sandbox','--disable-dev-shm-usage','--enable-unsafe-swiftshader',...(process.env.CHROMIUM_ANGLE_BACKEND?['--use-gl=angle','--use-angle='+process.env.CHROMIUM_ANGLE_BACKEND]:[])]});
 try{const p=await b.newPage({viewport});const errors=[];p.on('pageerror',e=>errors.push(e.message));
 await p.route('**/index.html',async route=>{let html=await fs.readFile(path.join(root,'index.html'),'utf8');const marker='player.reset(new V3(0, 0, 11), 0);\nbot.reset';assert(html.includes(marker),'Test hook insertion point exists');html=html.replace(marker,hook+marker);await route.fulfill({contentType:'text/html',body:html})});
 await p.goto(`http://127.0.0.1:${server.address().port}/index.html`);await p.waitForFunction(()=>!!window.__warriorTest,{timeout:90000});await callback(p,errors);
 }finally{await b.close();await new Promise(resolve=>server.close(resolve))}
}
async function run(){await withGame(async(p,errors)=>{
 const results=await p.evaluate(()=>{
  const g=__warriorTest,f=g.player,checks=[];
  const check=(ok,message)=>{if(!ok)throw Error(message);checks.push(message)};
  g.setClass('warrior');g.reset();g.tick(.2);
  check(!!f.avatar3D&&!f.billboard.visible,'3D skinned warrior replaces billboard');
  check(f.avatar3D.clips.size===26,'all 26 corrected clips load');
  check(f.shield3D.userData.meshy,'textured 3D shield replaces image-derived shield');
  const y=f.root.position.y,z=f.root.position.z;
  g.tick(.5,g.input(0,-1));check(f.root.position.z<z-.1&&f.avatar3D.current.clip.name==='Walking','forward input moves physics and plays locomotion');
  g.reset();g.tick(.5,g.input(-1,0));check(f.avatar3D.current.clip.name==='Great_Sword_Strafe_Left','sideways movement uses a strafe clip');
  g.reset();g.tick(.5,g.input(0,1));check(f.avatar3D.current.action.getEffectiveTimeScale()<0,'backpedal reverses the walking cycle');
  g.reset();g.tick(.2);
  for(const kind of ['over','back','stab']){
   check(f.swordSwing()&&f.swingType===kind,kind+' combo starts');g.tick(g.CFG.sword.hitAt-.01);check(!f.swingHit,kind+' does not hit early');g.tick(.02);check(f.swingHit,kind+' keeps existing hit timing');g.tick(g.CFG.sword.time-g.CFG.sword.hitAt+.01);
  }
  check(f.avatar3D.current.clip.name==='Idle','combo recovers to idle');
  g.reset();g.tick(.4,g.input(0,0,{block:'staff'}));check(f.blockType==='guard'&&f.shieldUpK>.9,'guard raises the 3D shield');
  const before=f.shield3D.getWorldDirection(f.forward().clone());f.shieldAim.x=.8;g.tick(.3,g.input(0,0,{block:'staff'}));
  const after=f.shield3D.getWorldDirection(f.forward().clone());check(before.distanceTo(after)>.1,'shield steering turns the real blocking surface');
  g.bot.root.position.copy(f.root.position).addScaledVector(after,2);g.bot.root.position.y=f.root.position.y;
  check(g.blockReduction(f,g.bot)?.type==='guard','directional shield blocking remains active');
  const hp=f.hp,sh=f.shieldHP;g.dealDamage(f,20,false,f.chestPos(),g.bot);check(f.hp===hp-g.CFG.warShield.damageTaken&&f.shieldHP===sh-g.CFG.warShield.costPerBlock,'guard retains damage and shield durability rules');
  g.reset();g.tick(.1);check(f.toggleGear('sword')===null,'sword sheathing starts');g.tick(g.CFG.gear.time+.1);check(!f.swordOut&&!f.avatar3D.swordGrip.visible&&f.avatar3D.backSword.visible,'sheathed sword appears on the back');
  check(f.toggleGear('sword')===null,'drawing sword starts');g.tick(g.CFG.gear.time+.1);check(f.swordReady&&f.avatar3D.swordGrip.visible,'drawing restores the hand weapon');
  check(f.toggleGear('shield')===null,'shield stowing starts');g.tick(g.CFG.gear.time+.1);check(!f.hasShield,'stowed shield no longer blocks');
  g.reset();g.tick(.3,g.input(0,0,{jump:true}));check(f.root.position.y>y+.2,'jump retains physical height');g.tick(1.5);check(f.onGround,'jump lands');
  g.reset();g.tick(.2);const standing=f.avatar3D.hips.position.y;g.tick(.6,g.input(0,0,{crouch:true}));check(f.avatar3D.hips.position.y<standing-.4&&f.avatar3D.root.scale.y===1,'crouch bends the skeleton without flattening the model');
  g.reset();g.tick(.15,g.input(0,-1,{roll:true}));check(f.rolling&&Math.abs(f.avatar3D.pivot.rotation.x)>.1,'roll retains motion and a full-body rotation');g.tick(.6);check(!f.rolling&&f.avatar3D.pivot.rotation.x===0,'roll recovers cleanly');
  for(const skill of ['bash','charge','warCry','whirlwind','throwAxe']){g.reset();g.tick(.1);check(f.useSkill(skill)===null,skill+' activates');g.tick(Math.min(.15,g.CFG[skill].time*.3));check(!!f.skill&&!!f.avatar3D.current,skill+' has a 3D pose');}
  g.reset();g.tick(.1);f.dead=true;g.tick(.5);check(f.avatar3D.current.clip.name==='Dying','death uses the skinned death clip');g.reset();g.tick(.2);check(f.avatar3D.current.clip.name==='Idle'&&!f.dead,'restart resets the animation mixer');
  g.setClass('sorceress');g.reset();g.tick(.2);check(!f.avatar3D&&f.billboard.visible,'sorceress keeps her existing appearance');g.setClass('warrior');g.reset();g.tick(.2);check(!!f.avatar3D&&!f.billboard.visible,'class switching restores one 3D warrior');
  g.bot.setArt(f.art);g.bot.animate(.1,0);check(!!g.bot.avatar3D&&g.bot.avatar3D.bones.mixamorig_Hips!==f.avatar3D.bones.mixamorig_Hips,'opponent warrior uses an independent skeleton');g.setDummyMode(false);check(g.bot.avatar3D.root.visible,'opponent mesh visible outside training');g.setDummyMode(true);check(!g.bot.avatar3D.root.visible,'training dummy hides the opponent avatar');
  const finite=Object.values(f.avatar3D.bones).every(b=>[...b.position.toArray(),...b.quaternion.toArray()].every(Number.isFinite));check(finite,'all bone transforms remain finite after the exercised states');
  return checks;
 });for(const result of results)console.log('PASS:',result);assert.deepEqual(errors,[],'No browser page errors');console.log(`PASS: ${results.length} integration checks, no browser errors`);
 await p.evaluate(()=>{__warriorTest.reset();__warriorTest.tick(.2);__warriorTest.inspect()});await p.waitForTimeout(300);await p.screenshot({path:process.env.WARRIOR_SCREENSHOT||'/tmp/warrior-integration.png'});
 });}
module.exports={withGame};if(require.main===module)run().catch(e=>{console.error(e);process.exitCode=1});
