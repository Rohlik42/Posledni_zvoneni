'use strict';
const $=s=>document.querySelector(s),B=BABYLON,canvas=$('#game');
const engine=new B.Engine(canvas,true,{preserveDrawingBuffer:true,stencil:true}),scene=new B.Scene(engine);
scene.clearColor=B.Color4.FromHexString('#aacddcff');scene.fogMode=B.Scene.FOGMODE_EXP;scene.fogDensity=.009;scene.fogColor=B.Color3.FromHexString('#b2cbd0');
const camera=new B.FreeCamera('eyes',new B.Vector3(13.75,1.65,16.25),scene);camera.inputs.clear();camera.upVector=B.Vector3.Up();camera.rotationQuaternion=B.Quaternion.Identity();camera.minZ=.035;camera.maxZ=120;camera.fov=1.25;
const ambient=new B.HemisphericLight('daylight',new B.Vector3(.3,1,.2),scene);ambient.intensity=.85;ambient.groundColor=B.Color3.FromHexString('#657e89');
const sun=new B.DirectionalLight('sun',new B.Vector3(-.4,-1,.3),scene);sun.position=new B.Vector3(18,18,-5);sun.intensity=.65;
const shadows=new B.ShadowGenerator(1024,sun);shadows.usePercentageCloserFiltering=true;shadows.bias=.001;
// Original procedural sound effects: no external audio files or network calls.
const sound={context:null,master:null,noise:null,muted:false,
 unlock(){try{if(!this.context){const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;this.context=new Audio();this.master=this.context.createGain();this.master.gain.value=.32;this.master.connect(this.context.destination);this.noise=this.context.createBuffer(1,this.context.sampleRate*.3,this.context.sampleRate);const data=this.noise.getChannelData(0);for(let i=0;i<data.length;i++)data[i]=Math.random()*2-1;}this.context.resume().catch(()=>{});}catch{this.context=null;}},
 tone(freq,end,duration,delay=0,type='sine',volume=.2){if(!this.context||this.muted)return;const c=this.context,t=c.currentTime+delay,o=c.createOscillator(),g=c.createGain();o.type=type;o.frequency.setValueAtTime(freq,t);o.frequency.exponentialRampToValueAtTime(Math.max(20,end),t+duration);g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(volume,t+.008);g.gain.exponentialRampToValueAtTime(.001,t+duration);o.connect(g);g.connect(this.master);o.start(t);o.stop(t+duration+.02);o.onended=()=>{o.disconnect();g.disconnect()};},
 whoosh(duration=.18,delay=0){if(!this.context||this.muted)return;const c=this.context,t=c.currentTime+delay,n=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();n.buffer=this.noise;f.type='bandpass';f.Q.value=.6;f.frequency.setValueAtTime(2800,t);f.frequency.exponentialRampToValueAtTime(380,t+duration);g.gain.setValueAtTime(.001,t);g.gain.linearRampToValueAtTime(.28,t+.025);g.gain.exponentialRampToValueAtTime(.001,t+duration);n.connect(f);f.connect(g);g.connect(this.master);n.start(t);n.stop(t+duration);n.onended=()=>{n.disconnect();f.disconnect();g.disconnect()};},
 crunch(delay=0){if(!this.context||this.muted)return;const c=this.context,t=c.currentTime+delay,n=c.createBufferSource(),f=c.createBiquadFilter(),g=c.createGain();n.buffer=this.noise;f.type='bandpass';f.frequency.value=1600+Math.random()*1800;f.Q.value=.7;g.gain.setValueAtTime(.7,t);g.gain.exponentialRampToValueAtTime(.001,t+.14);n.connect(f);f.connect(g);g.connect(this.master);n.start(t);n.stop(t+.15);n.onended=()=>{n.disconnect();f.disconnect();g.disconnect()};},
 play(kind){if(!this.context||this.muted)return;
 if(kind==='pencil'){this.whoosh(.12);this.tone(650,270,.07,0,'triangle',.06);}
 if(kind==='pen'){this.whoosh(.16);this.tone(1100,650,.05,0,'triangle',.06);}
 if(kind==='scissors'){this.tone(2200,800,.045,0,'triangle',.2);this.tone(1400,550,.04,.07,'triangle',.16);}
 if(kind==='compass'){this.whoosh(.24);this.tone(820,500,.12,0,'triangle',.08);}
 if(kind==='food'){for(let i=0;i<3;i++){this.crunch(i*.22);this.tone(130,90,.1,i*.22,'triangle',.15);}this.tone(105,55,.23,.77,'sawtooth',.11);}
 if(kind==='drink'){for(let i=0;i<5;i++){this.tone(180+i%2*90,500,.085,i*.13,'sine',.3);this.tone(420,120,.075,i*.13+.055,'sine',.25);}this.tone(90,48,.2,.78,'sawtooth',.1);}
 if(kind==='ghost'){this.tone(240,850,.35,0,'sine',.25);this.tone(850,280,.6,.3,'triangle',.16);}
 if(kind==='impact'){this.tone(220,80,.09,0,'triangle',.2);this.crunch();}
 if(kind==='hurt')this.tone(180,65,.12,0,'triangle',.18);
 if(kind==='bell')for(let i=0;i<3;i++)this.tone(1100,1000,.35,i*.18,'sine',.18);
 if(kind==='pickup')this.tone(600,1100,.15,0,'sine',.16);
 },toggle(){this.unlock();this.muted=!this.muted;if(this.master)this.master.gain.value=this.muted?0:.32;$('#sound-toggle').textContent=this.muted?'🔇 Zvuk vypnutý':'🔊 Zvuk zapnutý';$('#sound-toggle').setAttribute('aria-pressed',String(!this.muted));}
};
const map=['1111111111111111','1000000100000001','1000000000000001','1000000100000001','1110111111011101','1000000000000001','1000000000000001','1000000000000001','1110110111011101','1000000100000001','1000000000000001','1000000100000001','1111111111111111'].map((row,z)=>{
 const wing=['11111111','00010001','00010001','00010001','11011011','00000001','00000001','00000001','11011011','00010001','00010001','00010001','11111111'][z];
 return row.slice(0,-1)+(z===6||z===7?'0':'1')+wing;
});
const CELL=2.5,keys=new Set(),obstacles=[];
function material(name,color){const m=new B.StandardMaterial(name,scene);m.diffuseColor=B.Color3.FromHexString(color);m.specularColor=new B.Color3(.08,.08,.08);return m}
const mat={wall:material('plaster','#efe6c9'),lower:material('teal wall','#65a8a3'),trim:material('trim','#dfb857'),floor:material('floor','#a9b7ad'),ceiling:material('ceiling','#ece9da'),wood:material('wood','#cda36a'),metal:material('metal','#536975'),board:material('board','#234f49'),white:material('paper','#fff6dc'),skin:material('skin','#f2c59e'),hair:material('hair','#57433c'),pants:material('pants','#344c66'),shoe:material('shoe','#26313c'),red:material('red','#ed5564'),yellow:material('pencil','#f2bf48'),blue:material('pen','#65a8ee'),purple:material('compass','#b596e5'),silver:material('steel','#c9d6dd'),bread:material('bread','#e7b76b'),lettuce:material('lettuce','#8bb965'),water:material('water','#6bbad3')};
function box(name,size,pos,m,parent=null,pick=false){const mesh=B.MeshBuilder.CreateBox(name,{width:size[0],height:size[1],depth:size[2]},scene);mesh.position.set(...pos);mesh.material=m;mesh.parent=parent;mesh.isPickable=pick;if(['floor','ceiling','desk','staff door','bookshelf','backboard','locker'].includes(name)){mesh.isPickable=true;mesh.metadata={solid:true};}mesh.receiveShadows=true;return mesh}
function sphere(name,size,pos,m,parent=null){const mesh=B.MeshBuilder.CreateSphere(name,{diameter:size,segments:12},scene);mesh.position.set(...pos);mesh.material=m;mesh.parent=parent;mesh.isPickable=false;return mesh}
function cylinder(name,height,diameter,pos,m,parent=null,top=diameter){const mesh=B.MeshBuilder.CreateCylinder(name,{height,diameterBottom:diameter,diameterTop:top,tessellation:12},scene);mesh.position.set(...pos);mesh.material=m;mesh.parent=parent;mesh.isPickable=false;return mesh}
function textSign(text,w,h,pos,parent=null,color='#274d52',background='#fff3cf'){
 const texture=new B.DynamicTexture('sign '+text,{width:512,height:128},scene,false),c=texture.getContext();c.fillStyle=background;c.fillRect(0,0,512,128);c.fillStyle=color;c.textAlign='center';c.textBaseline='middle';c.font='bold '+(text.length>12?34:55)+'px Arial';c.fillText(text,256,64);texture.update();
 const m=new B.StandardMaterial('label '+text,scene);m.diffuseTexture=texture;m.emissiveColor=new B.Color3(.25,.25,.25);m.specularColor=B.Color3.Black();m.backFaceCulling=false;
 const mesh=B.MeshBuilder.CreatePlane('label',{width:w,height:h},scene);mesh.material=m;mesh.position.set(...pos);mesh.parent=parent;mesh.isPickable=false;return mesh;
}
const schoolWidth=map[0].length*CELL;box('floor',[schoolWidth,.15,32.5],[schoolWidth/2,-.075,16.25],mat.floor);box('ceiling',[schoolWidth,.15,32.5],[schoolWidth/2,3.85,16.25],mat.ceiling);
for(let z=0;z<map.length;z++)for(let x=0;x<map[z].length;x++){
 if(map[z][x]==='1'){
  const wall=box('wall',[CELL,3.8,CELL],[(x+.5)*CELL,1.9,(z+.5)*CELL],mat.wall,null,true);wall.metadata={wall:true};
  box('lower wall',[CELL+.006,1.1,CELL+.006],[(x+.5)*CELL,.55,(z+.5)*CELL],mat.lower);
  box('stripe',[CELL+.015,.09,CELL+.015],[(x+.5)*CELL,1.12,(z+.5)*CELL],mat.trim);
 }else if(x%3===1&&z%3===0)box('ceiling light',[1.25,.08,.45],[(x+.5)*CELL,3.72,(z+.5)*CELL],mat.white);
}
for(const [cx,cz] of [[3,2],[11,2],[3,10],[11,10],[21,2],[18,10]])for(let i=0;i<2;i++){
 const x=cx*CELL+i*3,z=cz*CELL;box('desk',[1.6,.12,.85],[x,.84,z],mat.wood);
 for(const dx of [-.65,.65])for(const dz of [-.3,.3])box('desk leg',[.08,.8,.08],[x+dx,.4,z+dz],mat.metal);
 box('chair',[.55,.09,.55],[x,.48,z+1],mat.blue);box('chair back',[.55,.55,.08],[x,.8,z+1.23],mat.blue);
 obstacles.push({x,z,rx:.85,rz:.48});box('notebook',[.35,.025,.26],[x,.92,z],mat.white);
}
box('blackboard',[3,1.25,.1],[7.5,2,2.57],mat.board);textSign('DNES: PŘEŽÍT!',2.7,.45,[7.5,2,2.64],null,'#e6e8c6','#234f49').rotation.y=Math.PI;
const staffDoor={x:26.25,z:11.1};
box('staff door',[1.8,2.65,.1],[staffDoor.x,1.325,10.2],mat.wood);
box('staff handle',[.12,.12,.15],[staffDoor.x+.6,1.15,10.3],mat.trim);
textSign('SBOROVNA',2.2,.4,[staffDoor.x,2.95,10.32],null).rotation.y=Math.PI;
for(const [name,x,z,top] of [['101 · ČEŠTINA',8.75,12.55,true],['102 · MATEMATIKA',26.25,12.55,true],['103 · PŘÍRODOPIS',8.75,19.95,false],['104 · VÝTVARKA',26.25,19.95,false],['201 · KNIHOVNA',46.25,12.55,true],['202 · INFORMATIKA',53.75,12.55,true],['203 · FYZIKA',46.25,19.95,false],['204 · TĚLOCVIČNA',53.75,19.95,false]]){
 const sign=textSign(name,2.15,.38,[x,2.9,z]);if(top)sign.rotation.y=Math.PI;
 for(const side of [-1,1])box('door jamb',[.1,2.6,.18],[x+side*1.06,1.3,z],mat.wood);
 box('door lintel',[2.22,.12,.18],[x,2.62,z],mat.wood);
}
textSign('NOVÉ KŘÍDLO →',2.8,.45,[36.1,2.6,17.5]).rotation.y=-Math.PI/2;
// Library shelves and colorful books.
for(let shelf=0;shelf<3;shelf++){
 const x=41.5+shelf*1.1,z=3.15;box('bookshelf',[.9,2,.35],[x,1,z],mat.wood);obstacles.push({x,z,rx:.5,rz:.23});
 for(let level=0;level<3;level++)for(let book=0;book<5;book++)box('book',[.12,.35,.4],[x-.32+book*.16,.35+level*.55,z+.09],[mat.red,mat.blue,mat.purple,mat.lettuce,mat.trim][book]);
}
textSign('TICHO, PROSÍM!',2.5,.4,[45,2.8,2.56],null).rotation.y=Math.PI;
// Gym court, wall-mounted hoop and benches.
box('gym floor',[7,.025,7],[53.75,.025,26.25],mat.wood);
for(const x of [50.65,56.85])box('court line',[.06,.008,6.2],[x,.044,26.25],mat.white);
for(const z of [23.15,26.25,29.35])box('court line',[6.2,.008,.06],[53.75,.044,z],mat.white);
box('backboard',[1.4,.85,.1],[53.75,2.7,29.8],mat.white);
const hoop=B.MeshBuilder.CreateTorus('basket hoop',{diameter:.6,thickness:.045,tessellation:24},scene);hoop.position.set(53.75,2.3,29.4);hoop.material=mat.red;hoop.isPickable=false;
for(const z of [24,27]){box('gym bench',[.55,.3,1.6],[56.9,.35,z],mat.blue);obstacles.push({x:56.9,z,rx:.3,rz:.8});}
box('computer',[.65,.45,.08],[52.5,1.16,5],mat.metal);box('screen',[.54,.32,.012],[52.5,1.17,5.05],mat.water);
textSign('ŠKOLNÍ SURVIVAL',2.6,.5,[20,2.7,19.97]);
for(let i=0;i<4;i++){box('locker',[.7,1.9,.6],[3.05,.95,14+i*.85],i%2?mat.blue:mat.lower);box('locker handle',[.05,.15,.08],[3.43,1.1,14+i*.85],mat.silver);}
const studentTypes={
 normal:{name:'Normální žák',damage:1,speed:1,color:'#65a8ee'},
 troublemaker:{name:'Školní zlobivec',damage:1.25,speed:.8,color:'#ed7864'},
 nerd:{name:'Šprt',damage:.8,speed:1.5,color:'#b596e5'}
};
let studentChoice='normal';
const studentClothes=material('student clothes',studentTypes.normal.color);
function currentStudent(){return studentTypes[started&&!dead?player.student:studentChoice]}
function weaponDamage(w){return Math.round(w.damage*currentStudent().damage)}
function updateStudentChoice(){ $('#student-choice').disabled=started&&!dead; }
for(const input of document.querySelectorAll('input[name="student"]'))input.addEventListener('change',()=>{if(started&&!dead)return;studentChoice=input.value;hud()});
const weapons=[{name:'Tužka',damage:18,delay:.25,range:25,desc:'HOD • 18 DMG'},{name:'Pero',damage:32,delay:.48,range:30,desc:'HOD • 32 DMG'},{name:'Nůžky',damage:55,delay:.65,range:3.1,desc:'ZBLÍZKA • 55 DMG'},{name:'Kružítko',damage:42,delay:.7,range:20,desc:'HOD • 42 DMG'}];
$('#weapons').innerHTML=weapons.map((w,i)=>`<div class="slot" id="slot${i}">${i+1}<strong>${w.name}</strong><small>${w.desc}</small></div>`).join('');
const hand=new B.TransformNode('hand',scene);hand.parent=camera;hand.position.set(.36,-.32,.65);
box('sleeve',[.18,.17,.45],[0,-.12,-.15],studentClothes,hand);sphere('hand',.21,[0,0,0],mat.skin,hand);
const scissorParts=[];
const weaponModels=weapons.map((w,i)=>{
 const root=new B.TransformNode(w.name,scene);root.parent=hand;root.rotation.x=.7;
 if(i<2){cylinder(w.name,.55,.035,[0,.2,0],i===0?mat.yellow:mat.blue,root);cylinder('tip',.09,.035,[0,.52,0],mat.silver,root,0);if(i===1)box('pen clip',[.013,.15,.014],[.027,.34,0],mat.silver,root);}
 else if(i===2){for(const side of [-1,1]){
 const pivot=new B.TransformNode('scissor half',scene);pivot.parent=root;pivot.position.y=.13;pivot.metadata={side};scissorParts.push(pivot);
 const ring=B.MeshBuilder.CreateTorus('handle',{diameter:.115,thickness:.028,tessellation:16},scene);ring.parent=pivot;ring.rotation.x=Math.PI/2;ring.position.set(side*.04,-.13,0);ring.material=mat.red;ring.isPickable=false;
 box('blade',[.032,.38,.012],[0,.19,side*.006],mat.silver,pivot);
 }sphere('hinge',.04,[0,.13,0],mat.metal,root);}
 else{for(const side of [-1,1]){const leg=box('compass leg',[.022,.48,.022],[side*.055,.25,0],side===1?mat.yellow:mat.silver,root);leg.rotation.z=side*.24;}cylinder('grip',.1,.045,[0,.53,0],mat.purple,root);}
 return root;
});
const body=new B.TransformNode('player body',scene),legs=[];box('your shirt',[.43,.58,.27],[0,1.05,-.16],studentClothes,body);
for(const side of [-1,1]){const leg=new B.TransformNode('your leg',scene);leg.parent=body;leg.position.set(side*.13,.75,-.1);box('trousers',[.18,.61,.18],[0,-.305,0],mat.pants,leg);box('shoe',[.21,.14,.36],[0,-.68,.09],mat.shoe,leg);legs.push(leg);}
let player,teachers=[],shots=[],pickups=[],hp=150,food=3,drink=2,day=1,kills=0,selected=0,active=false,started=false,fallback=false,dead=false,cooldown=0,swing=0,hit=0,flash=0,notice=0,nextDay=0,time=0;
function toast(text){$('#toast').textContent=text;notice=2.6}
function hud(){ updateStudentChoice();$('#student-active').textContent=currentStudent().name; $('#hpText').textContent=`${Math.ceil(hp)} / 150`;$('#hp').style.width=hp/150*100+'%';$('#hp').style.background=hp<50?'#ff7580':'#a5ed63';$('#food').textContent=food;$('#drink').textContent=drink;$('#day').textContent=String(day).padStart(2,'0');$('#wave').textContent=`UČITELÉ: ${teachers.filter(t=>t.hp>0).length} • PŘEŽIJ VYUČOVÁNÍ`;weapons.forEach((w,i)=>{$('#slot'+i).classList.toggle('active',i===selected);weaponModels[i].setEnabled(i===selected);$('#slot'+i+' small').textContent=w.desc.replace(/\d+ DMG/,weaponDamage(w)+' DMG')})}
function blocked(x,z,r=.28){for(const dx of [-r,r])for(const dz of [-r,r])if(map[Math.floor((z+dz)/CELL)]?.[Math.floor((x+dx)/CELL)]!=='0')return true;return obstacles.some(o=>Math.abs(x-o.x)<o.rx+r&&Math.abs(z-o.z)<o.rz+r)}
function move(o,dx,dz){if(!blocked(o.x+dx,o.z))o.x+=dx;if(!blocked(o.x,o.z+dz))o.z+=dz}
function visible(from,to){const delta=to.subtract(from),d=delta.length();return !scene.pickWithRay(new B.Ray(from,delta.normalize(),d),m=>m.metadata?.wall).hit}
function route(t){
 const sx=Math.floor(t.x/CELL),sz=Math.floor(t.z/CELL),ex=Math.floor(player.x/CELL),ez=Math.floor(player.z/CELL),queue=[[sx,sz]],seen=new Set([sx+','+sz]),prev=new Map();
 for(let i=0;i<queue.length;i++){const [x,z]=queue[i];if(x===ex&&z===ez){let p=[x,z];while(prev.has(p.join(','))){const before=prev.get(p.join(','));if(before[0]===sx&&before[1]===sz)return {x:(p[0]+.5)*CELL,z:(p[1]+.5)*CELL};p=before;}return {x:player.x,z:player.z}}
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,key=nx+','+nz;if(map[nz]?.[nx]==='0'&&!seen.has(key)){seen.add(key);prev.set(key,[x,z]);queue.push([nx,nz])}}
 }return {x:t.x,z:t.z};
}
function createTeacher(x,z,index){
 const root=new B.TransformNode('teacher',scene),jacket=material('jacket '+index,['#8373bc','#d38d64','#5b9990'][index%3]);root.position.set(x,0,z);
 const t={root,x,z,hp:65+day*10,max:65+day*10,cool:2+Math.random()*2,wind:0,grade:1,pathTime:0,walk:0};
 const target=mesh=>{mesh.isPickable=true;mesh.metadata={teacher:t};shadows.addShadowCaster(mesh);return mesh};
 target(box('jacket',[.65,.7,.34],[0,1.05,0],jacket,root));target(sphere('head',.48,[0,1.7,0],mat.skin,root));sphere('hair',.48,[0,1.8,-.035],mat.hair,root);
 box('shirt',[.19,.45,.025],[0,1.17,.182],mat.white,root);box('tie',[.07,.38,.03],[0,1.12,.2],mat.trim,root);
 for(const side of [-1,1]){target(box('arm',[.18,.65,.22],[side*.43,1.04,0],jacket,root));sphere('fist',.18,[side*.43,.69,0],mat.skin,root);target(box('leg',[.22,.64,.24],[side*.18,.38,0],mat.pants,root));box('shoe',[.25,.15,.38],[side*.18,.075,.06],mat.shoe,root);box('glasses',[.2,.1,.035],[side*.12,1.72,.225],mat.metal,root);box('lens',[.14,.055,.04],[side*.12,1.72,.248],mat.white,root);sphere('pupil',.032,[side*.12,1.72,.275],mat.metal,root);}
 box('mouth',[.14,.024,.025],[0,1.56,.23],mat.hair,root);box('book',[.24,.3,.07],[.43,.86,.14],mat.red,root);
 t.label=textSign('!',.35,.35,[0,2.35,0],root,'#d34251');t.label.billboardMode=B.Mesh.BILLBOARDMODE_ALL;t.label.setEnabled(false);
 t.bar=box('health',[.7,.06,.015],[0,2.06,0],mat.lettuce,root);return t;
}
const ghostMat=material('friendly ghost','#b1f5ed');ghostMat.alpha=.62;ghostMat.emissiveColor=new B.Color3(.2,.5,.46);ghostMat.backFaceCulling=false;
function becomeGhost(t){
 t.wind=0;t.ghost={age:0,step:0,waypoints:[{x:t.x,z:16.25},{x:staffDoor.x,z:16.25},{x:staffDoor.x,z:staffDoor.z}]};
 for(const mesh of t.root.getChildMeshes()){shadows.removeShadowCaster(mesh);mesh.dispose();}
 sphere('ghost head',.62,[0,1.4,0],ghostMat,t.root);cylinder('ghost sheet',.85,.75,[0,.95,0],ghostMat,t.root,.48);
 for(const side of [-1,1]){sphere('ghost eye',.11,[side*.14,1.45,.28],mat.metal,t.root);const arm=sphere('ghost arm',.23,[side*.4,1.08,0],ghostMat,t.root);arm.scaling.set(1.7,.65,.8);}
 sphere('ghost mouth',.12,[0,1.22,.29],mat.metal,t.root);
 for(let i=0;i<4;i++)sphere('sheet scallop',.24,[-.27+i*.18,.54,0],ghostMat,t.root);
 sound.play('ghost');
}
function updateGhost(t,dt){
 const g=t.ghost;g.age+=dt;const aim=g.waypoints[g.step],dx=aim.x-t.x,dz=aim.z-t.z,d=Math.hypot(dx,dz),speed=Math.min(d,6.5*dt);
 if(d>.01){t.x+=dx/d*speed;t.z+=dz/d*speed;t.root.rotation.y=Math.atan2(dx,dz);}
 t.root.position.set(t.x,.25+Math.sin(g.age*5)*.12,t.z);t.root.scaling.setAll(1+Math.sin(Math.min(g.age,1)*Math.PI)*.15);
 if(d<.2){if(g.step<g.waypoints.length-1)g.step++;else{t.root.setEnabled(false);t.ghost=null;}}
}
function spawnPickup(x,z,type){const root=new B.TransformNode('supply',scene);root.position.set(x,.5,z);if(type==='food'){box('bread',[.45,.12,.3],[0,0,0],mat.bread,root);box('filling',[.49,.04,.32],[0,.08,0],mat.lettuce,root);box('bread',[.45,.12,.3],[0,.15,0],mat.bread,root)}else{cylinder('bottle',.42,.2,[0,.15,0],mat.water,root);cylinder('cap',.06,.12,[0,.4,0],mat.blue,root)}return {root,x,z,type};}
function clearEntities(){for(const item of [...teachers,...shots,...pickups])item.root.dispose();teachers=[];shots=[];pickups=[];}
function spawnDay(){clearEntities();const spots=[[9,6],[12,3],[3,3],[12,11],[3,11],[18,3],[21,10],[21,3],[18,11],[13,6],[6,3],[9,11]];for(let i=0;i<Math.min(3+day,12);i++){const p=spots[i%spots.length];teachers.push(createTeacher((p[0]+.5)*CELL,(p[1]+.5)*CELL,i))}pickups=[spawnPickup(6.25,8.75,'food'),spawnPickup(33.75,28.75,'drink'),spawnPickup(43.75,8.75,'drink'),spawnPickup(53.75,28.75,'food')];toast(`DEN ${day} — hodina začíná!`);hud()}
function reset(){player={x:13.75,z:16.25,y:0,vy:0,yaw:Math.PI/2,pitch:0,student:studentChoice};studentClothes.diffuseColor=B.Color3.FromHexString(studentTypes[studentChoice].color);hp=150;food=3;drink=2;day=1;kills=0;selected=0;cooldown=swing=hit=flash=nextDay=0;dead=false;spawnDay();syncView()}
function hitTeacher(t,amount){
 if(t.hp<=0)return;t.hp-=amount;t.bar.scaling.x=Math.max(.001,t.hp/t.max);flash=.15;sound.play('impact');
 if(t.hp<=0){becomeGhost(t);kills++;toast('Duch učitele odlétá ke sborovně!');hud();}
}
function attackSurface(m){return !!m.metadata?.wall||!!m.metadata?.solid||m.metadata?.teacher?.hp>0}
function shoot(){
 if(!active||cooldown>0)return;const w=weapons[selected];cooldown=w.delay;swing=1;sound.play(['pencil','pen','scissors','compass'][selected]);
 const ray=camera.getForwardRay(w.range);
 if(selected===2){const hit=scene.pickWithRay(ray,attackSurface);if(hit.hit&&hit.pickedMesh.metadata?.teacher)hitTeacher(hit.pickedMesh.metadata.teacher,weaponDamage(w));return;}
 const root=weaponModels[selected].clone('thrown '+w.name,null,false);root.parent=null;root.setEnabled(true);root.scaling.setAll(1.65);root.position.copyFrom(ray.origin.add(ray.direction.scale(.38)));root.rotation.set(0,0,0);root.rotationQuaternion=B.Quaternion.Identity();
 for(const mesh of root.getChildMeshes()){mesh.isPickable=false;mesh.metadata=null;}
 const speed=[22,26,0,17][selected];
 shots.push({root,kind:'thrown',weapon:selected,velocity:ray.direction.scale(speed),damage:weaponDamage(w),distance:0,range:w.range,age:0,life:w.range/speed+.5});
 orientThrown(shots.at(-1));
}
function orientThrown(shot){
 const direction=shot.velocity.normalizeToNew();const up=Math.abs(direction.y)>.98?B.Axis.X:B.Axis.Y;
 const flight=B.Quaternion.FromLookDirectionLH(direction,up);
 const spin=shot.weapon===3?Math.PI/2+shot.age*12:Math.PI/2;
 shot.root.rotationQuaternion.copyFrom(flight.multiply(B.Quaternion.RotationAxis(B.Axis.X,spin)));
}
function useSupply(){if(!active)return;if(hp>=150){toast('Máš plné životy. Zásoby si schovej!');return}const type=150-hp>30?(food?'food':'drink'):(drink?'drink':'food');if((type==='food'?food:drink)<=0){toast('Zásoby došly! Prohledej školu.');return}const amount=Math.min(150-hp,type==='food'?50:30);if(type==='food')food--;else drink--;hp+=amount;sound.play(type);toast((type==='food'?'CHŘUP CHŘUP! Svačina':'GLO GLO GLO! Pití')+` +${amount} životů`);hud()}
function damage(amount){sound.play('hurt');hp=Math.max(0,hp-amount);hit=.45;hud();if(hp===0){dead=true;active=false;updateStudentChoice();document.exitPointerLock?.();$('#overlay').style.display='flex';$('#intro').textContent=`Dokončené dny: ${day-1}. Učitelé ve sborovně: ${kills}.`;$('#start').textContent='ZKUSIT ZNOVU →'}}
// One flat, camera-facing visual per projectile: no intersecting paper or spinning parent.
const gradeMaterials=new Map();
const gradeColors={2:'#ffe348',3:'#ff9e32',4:'#ff652e',5:'#ff3348'};
function gradeMaterial(grade){
 if(gradeMaterials.has(grade))return gradeMaterials.get(grade);
 const note=grade===100,texture=new B.DynamicTexture('attack '+grade,{width:note?768:512,height:512},scene,true),c=texture.getContext();
 c.clearRect(0,0,note?768:512,512);c.textAlign='center';c.textBaseline='middle';
 if(note){
  c.fillStyle='#681b45';c.strokeStyle='#ffe18a';c.lineWidth=16;c.beginPath();c.roundRect(14,30,740,452,42);c.fill();c.stroke();
  c.fillStyle='#ffe18a';c.font='900 170px Arial';c.fillText('!',384,140);
  c.fillStyle='#ffffff';c.font='900 76px Arial';c.fillText('POZNÁMKA',384,285);
  c.fillStyle='#ffe18a';c.font='bold 58px Arial';c.fillText('100 DMG',384,393);
 }else{
  c.font='900 420px Arial';c.lineJoin='round';c.lineWidth=28;c.strokeStyle='#392937';c.strokeText(String(grade),256,276);
  c.fillStyle=gradeColors[grade];c.fillText(String(grade),256,276);
 }
 texture.hasAlpha=true;texture.update();
 const m=new B.StandardMaterial('attack material '+grade,scene);m.diffuseTexture=texture;m.emissiveTexture=texture;m.diffuseColor=B.Color3.Black();m.emissiveColor=B.Color3.White();m.disableLighting=true;m.useAlphaFromDiffuseTexture=true;m.backFaceCulling=false;m.specularColor=B.Color3.Black();
 gradeMaterials.set(grade,m);return m;
}
function fireGrade(t){
 const origin=new B.Vector3(t.x,1.15,t.z),aim=new B.Vector3(player.x,1+player.y,player.z),dir=aim.subtract(origin).normalize(),note=t.grade===100;
 const root=B.MeshBuilder.CreatePlane(note?'POZNÁMKA 100 DMG':'Známka '+t.grade,{width:note?1.8:1.15,height:note?1.2:1.15},scene);
 root.material=gradeMaterial(t.grade);root.isPickable=false;root.position.copyFrom(origin);root.rotationQuaternion=camera.rotationQuaternion.clone();
 shots.push({root,velocity:dir.scale(note?5.8:7),damage:note?100:t.grade*10,life:8});
}
function update(dt){time+=dt;cooldown=Math.max(0,cooldown-dt);swing=Math.max(0,swing-dt*5);hit=Math.max(0,hit-dt);flash=Math.max(0,flash-dt);notice-=dt;if(notice<0)$('#toast').textContent='';
 if(player.y>0||player.vy>0){player.vy-=12*dt;player.y=Math.max(0,player.y+player.vy*dt);if(player.y===0)player.vy=0}
 const f=Number(keys.has('KeyW'))-Number(keys.has('KeyS')),s=Number(keys.has('KeyD'))-Number(keys.has('KeyA')),len=Math.hypot(f,s)||1,speed=(keys.has('ShiftLeft')||keys.has('ShiftRight')?6.5:4)*currentStudent().speed*dt;
 move(player,(Math.sin(player.yaw)*f+Math.cos(player.yaw)*s)/len*speed,(Math.cos(player.yaw)*f-Math.sin(player.yaw)*s)/len*speed);
 for(const t of teachers){if(t.hp<=0){if(t.ghost)updateGhost(t,dt);continue;}const d=Math.hypot(t.x-player.x,t.z-player.z),los=visible(new B.Vector3(t.x,1.4,t.z),new B.Vector3(player.x,1.4+player.y,player.z));t.pathTime-=dt;if(t.pathTime<=0){t.path=route(t);t.pathTime=.55}if(d>5){const aim=los?player:t.path,dx=aim.x-t.x,dz=aim.z-t.z,l=Math.hypot(dx,dz)||1,v=(1.3+Math.min(day,12)*.09)*dt;move(t,dx/l*v,dz/l*v);t.walk+=dt*6}t.root.position.set(t.x,Math.sin(t.walk)*.018,t.z);t.root.rotation.y=Math.atan2(player.x-t.x,player.z-t.z);t.cool-=dt;
  if(t.wind>0){t.wind-=dt;if(t.wind<=0){if(los)fireGrade(t);t.label.setEnabled(false);t.cool=2.2+Math.random()*1.8}}else if(t.cool<=0&&los&&d<28){t.grade=Math.random()<.16?100:2+Math.floor(Math.random()*4);t.wind=t.grade===100?1.4:.65;t.label.setEnabled(true);if(t.grade===100)toast('POZOR! Učitel píše poznámku!')}
 }
 for(const shot of shots){
 shot.life-=dt;const pos=shot.root.position;
 if(shot.kind==='thrown'){
  shot.age+=dt;shot.velocity.y-=1.2*dt;const step=shot.velocity.scale(dt),distance=step.length();
  const result=scene.pickWithRay(new B.Ray(pos,step.normalizeToNew(),Math.min(distance,shot.range-shot.distance)),attackSurface);
  if(result.hit){pos.copyFrom(result.pickedPoint);shot.life=0;if(result.pickedMesh.metadata?.teacher)hitTeacher(result.pickedMesh.metadata.teacher,shot.damage);else sound.play('impact');}
  else{pos.addInPlace(step);shot.distance+=distance;if(shot.distance>=shot.range||pos.y<0)shot.life=0;}
  orientThrown(shot);continue;
 }
 const step=shot.velocity.scale(dt);if(!visible(pos,pos.add(step))){shot.life=0;continue}pos.addInPlace(step);
 if(shot.life>0&&Math.hypot(pos.x-player.x,pos.z-player.z)<.36&&pos.y>player.y+.12&&pos.y<player.y+1.85){shot.life=0;damage(shot.damage);if(dead)break}
 }
 shots=shots.filter(s=>{if(s.life<=0){s.root.dispose();return false}return true});if(dead)return;
 pickups=pickups.filter(p=>{p.root.rotation.y+=dt;p.root.position.y=.5+Math.sin(time*3)*.08;if(Math.hypot(p.x-player.x,p.z-player.z)<.8){if(p.type==='food')food++;else drink++;p.root.dispose();sound.play('pickup');toast(p.type==='food'?'Našel jsi svačinu!':'Našel jsi pití!');hud();return false}return true});
 if(teachers.every(t=>t.hp<=0)){if(!nextDay){nextDay=4;sound.play('bell');toast('ZVONÍ! Den přežitý.')}nextDay-=dt;if(nextDay<=0){if(teachers.some(t=>t.ghost)){nextDay=.1;return}day++;food=Math.min(food+1,5);drink=Math.min(drink+1,4);nextDay=0;spawnDay()}}
}
function syncView(){
 // World-space yaw, then local pitch. Roll is always zero and world up stays fixed.
 const shake=hit>0?Math.sin(time*70)*hit*.035:0;
 camera.position.set(player.x+Math.cos(player.yaw)*shake,1.65+player.y,player.z-Math.sin(player.yaw)*shake);
 camera.rotation.set(0,0,0);camera.rotationQuaternion.copyFrom(B.Quaternion.RotationYawPitchRoll(player.yaw,player.pitch,0));camera.upVector.copyFromFloats(0,1,0);
 for(const shot of shots)if(shot.kind!=='thrown')shot.root.rotationQuaternion.copyFrom(camera.rotationQuaternion);
 body.position.set(player.x,player.y,player.z);body.rotation.y=player.yaw;
 const moving=active&&['KeyW','KeyS','KeyA','KeyD'].some(k=>keys.has(k));legs.forEach((l,i)=>l.rotation.x=moving?Math.sin(time*10+i*Math.PI)*.35:0);
 hand.position.y=-.32+(moving?Math.sin(time*10)*.012:0)-swing*.05;
 hand.position.z=.65+(selected===2?Math.sin(swing*Math.PI)*.12:Math.sin(swing*Math.PI)*.18);hand.rotation.x=selected===2?0:swing*.45;
 const closing=swing>0?Math.sin((1-swing)*Math.PI):0;for(const part of scissorParts)part.rotation.z=part.metadata.side*(.32-closing*.29);
 weaponModels.forEach((root,i)=>root.setEnabled(i===selected&&(i===2||cooldown<=weapons[i].delay*.3)));
 $('#hurt').style.opacity=hit*.65;$('#crosshair').style.color=flash>0?'#baff6c':'#ffffffaa';
}
$('#sound-toggle').onclick=e=>{e.stopPropagation();sound.toggle()};
$('#start').onclick=()=>{sound.unlock();if(!started||dead){reset();started=true;hud();sound.play('bell')}try{const promise=canvas.requestPointerLock();promise?.catch(()=>pointerError())}catch{pointerError()}};
function pointerError(){if(dead)return;fallback=true;active=true;keys.clear();$('#overlay').style.display='none';canvas.style.cursor='crosshair';toast('Myš bez uzamčení: rozhlížej se pohybem kurzoru. Esc = pauza.')}
function pause(){active=false;fallback=false;keys.clear();canvas.style.cursor='default';$('#overlay').style.display='flex';if(!dead){$('#intro').textContent='Přestávka. Tvoje hra je pozastavená.';$('#start').textContent='ZPÁTKY DO HRY →'}}
document.addEventListener('pointerlockerror',pointerError);document.addEventListener('pointerlockchange',()=>{active=document.pointerLockElement===canvas&&!dead;keys.clear();$('#overlay').style.display=active?'none':'flex';if(!active&&started&&!dead){$('#intro').textContent='Přestávka. Tvoje hra je pozastavená.';$('#start').textContent='ZPÁTKY DO HRY →'}});
addEventListener('keydown',e=>{if(e.code==='KeyM'&&!e.repeat){sound.toggle();return}if(!active)return;if(e.code==='Escape'&&fallback){pause();return}if(e.code==='Space'||e.ctrlKey)e.preventDefault();keys.add(e.code);if(e.repeat)return;if(/^Digit[1-4]$/.test(e.code)){selected=Number(e.code.slice(-1))-1;hud()}if(e.code==='Space'&&player.y===0)player.vy=4.8});
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();if(active){if(fallback)pause();else document.exitPointerLock?.()}});addEventListener('mousemove',e=>{if(active){player.yaw=Math.atan2(Math.sin(player.yaw+e.movementX*.0025),Math.cos(player.yaw+e.movementX*.0025));player.pitch=Math.max(-1.52,Math.min(1.52,player.pitch+e.movementY*.0025));syncView()}});
addEventListener('contextmenu',e=>{if(active)e.preventDefault()});addEventListener('mousedown',e=>{if(!active||e.target.closest?.('button'))return;e.preventDefault();if(e.button===0)shoot();if(e.button===2)useSupply()});addEventListener('wheel',e=>{if(active){e.preventDefault();selected=(selected+(e.deltaY>0?1:3))%4;hud()}},{passive:false});
addEventListener('resize',()=>engine.resize());reset();engine.runRenderLoop(()=>{if(active)update(Math.min(.035,engine.getDeltaTime()/1000));syncView();scene.render()});
