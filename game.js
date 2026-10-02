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
const CELL=2.5,keys=new Set(),obstacles=[],doors=[];
const rooms=[
 {name:'101 · Matematika',subject:'Matematika',x1:1,x2:7,z1:1,z2:9,doorX:4,doorZ:10},
 {name:'102 · Čeština',subject:'Čeština',x1:9,x2:15,z1:1,z2:9,doorX:12,doorZ:10},
 {name:'103 · Angličtina',subject:'Angličtina',x1:17,x2:23,z1:1,z2:9,doorX:20,doorZ:10},
 {name:'104 · Zeměpis',subject:'Zeměpis',x1:25,x2:31,z1:1,z2:9,doorX:28,doorZ:10},
 {name:'105 · Dějepis',subject:'Dějepis',x1:33,x2:39,z1:1,z2:9,doorX:36,doorZ:10},
 {name:'106 · Knihovna',kind:'library',x1:41,x2:47,z1:1,z2:9,doorX:44,doorZ:10},
 {name:'Sborovna',kind:'staff',x1:49,x2:55,z1:1,z2:9,doorX:52,doorZ:10},
 {name:'201 · Hudebka',subject:'Hudebka',x1:1,x2:7,z1:14,z2:23,doorX:4,doorZ:13},
 {name:'202 · Výtvarka',subject:'Výtvarka',x1:9,x2:15,z1:14,z2:23,doorX:12,doorZ:13},
 {name:'203 · Tělocvična',subject:'Tělocvik',kind:'gym',x1:17,x2:23,z1:14,z2:23,doorX:20,doorZ:13},
 {name:'Jídelna',kind:'cafeteria',x1:25,x2:39,z1:14,z2:23,doorX:28,doorZ:13},
 {name:'204 · Fyzika a informatika',kind:'lab',x1:41,x2:47,z1:14,z2:23,doorX:44,doorZ:13},
 {name:'WC · kluci',kind:'toilet',x1:49,x2:51,z1:14,z2:23,doorX:50,doorZ:13},
 {name:'WC · holky',kind:'toilet',x1:53,x2:55,z1:14,z2:23,doorX:54,doorZ:13}
];
const cafeteria=rooms.find(r=>r.kind==='cafeteria');
const map=Array.from({length:25},()=>Array(57).fill('1'));
for(let z=11;z<=12;z++)for(let x=1;x<56;x++)map[z][x]='0';
for(const r of rooms){for(let z=r.z1;z<=r.z2;z++)for(let x=r.x1;x<=r.x2;x++)map[z][x]='0';map[r.doorZ][r.doorX]='0';}
map[13][36]='0';map[12][0]='0';
function inRoom(x,z,r){return x>r.x1*CELL&&x<(r.x2+1)*CELL&&z>r.z1*CELL&&z<(r.z2+1)*CELL}
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
const schoolWidth=map[0].length*CELL,schoolDepth=map.length*CELL;
box('floor',[schoolWidth,.15,schoolDepth],[schoolWidth/2,-.075,schoolDepth/2],mat.floor);
box('ceiling',[schoolWidth,.15,schoolDepth],[schoolWidth/2,3.85,schoolDepth/2],mat.ceiling);
const glass=material('window glass','#b7e8f4');glass.alpha=.2;glass.emissiveColor=new B.Color3(.12,.19,.22);
function solidBox(name,size,pos,m){const mesh=box(name,size,pos,m,null,true);mesh.metadata={solid:true};return mesh;}
for(let z=0;z<map.length;z++)for(let x=0;x<map[z].length;x++){
 if(map[z][x]==='1'){
  const wx=(x+.5)*CELL,wz=(z+.5)*CELL,isWindow=(z===0||z===24)&&x>0&&x<56&&x%8!==0&&x%2===0;
  if(isWindow){
   solidBox('window sill',[CELL,1.1,CELL],[wx,.55,wz],mat.lower);solidBox('above window',[CELL,.7,CELL],[wx,3.45,wz],mat.wall);
   for(const dx of [-1.17,1.17])solidBox('window frame',[.16,2,CELL],[wx+dx,2.1,wz],mat.white);
   const paneZ=z===0?2.43:schoolDepth-2.43;solidBox('window',[2.18,2,.045],[wx,2.1,paneZ],glass);
   box('window crossbar',[.055,2,.07],[wx,2.1,paneZ],mat.white);box('window crossbar',[2.18,.055,.07],[wx,2.1,paneZ],mat.white);
  }else{
   const wall=solidBox('wall',[CELL,3.8,CELL],[wx,1.9,wz],mat.wall);wall.metadata.wall=true;
   box('lower wall',[CELL+.006,1.1,CELL+.006],[wx,.55,wz],mat.lower);box('stripe',[CELL+.015,.09,CELL+.015],[wx,1.12,wz],mat.trim);
  }
 }else if(x%4===2&&z%4===3)box('ceiling light',[1.4,.08,.55],[(x+.5)*CELL,3.72,(z+.5)*CELL],mat.white);
}
// Outdoor scenery is only beyond the perimeter; the openings above are actual windows.
const grass=material('outside grass','#72a96c');box('school grounds',[schoolWidth+60,.1,schoolDepth+60],[schoolWidth/2,-.22,schoolDepth/2],grass);
for(let i=0;i<15;i++)for(const z of [-8,schoolDepth+8]){cylinder('tree trunk',3,.4,[i*10,1.3,z],mat.wood);sphere('tree crown',4,[i*10,3.4,z],mat.lettuce);}
function makeDoor(name,cx,cz,vertical=false){
 const x=(cx+.5)*CELL,z=(cz+.5)*CELL,width=2.14;
 const hinge=new B.TransformNode('hinge '+name,scene);hinge.position.set(x-(vertical?0:width/2),0,z-(vertical?width/2:0));if(vertical)hinge.rotation.y=-Math.PI/2;
 const leaf=box('door '+name,[width,2.7,.12],[width/2,1.35,0],mat.wood,hinge,true);leaf.metadata={solid:true,door:true};
 box('handle',[.15,.1,.17],[width-.18,1.1,.1],mat.trim,hinge);
 for(const side of [-1,1])solidBox('door jamb',vertical?[.2,2.8,.16]:[.16,2.8,.2],[x+(vertical?0:side*1.15),1.4,z+(vertical?side*1.15:0)],mat.white);
 solidBox('door header',vertical?[CELL,1,.3]:[CELL,1,.3],[x,3.3,z],mat.wall).rotation.y=vertical?Math.PI/2:0;
 for(const side of [-1,1]){const sign=textSign(name,2.2,.38,[x+(vertical?side*.15:0),3.12,z+(vertical?0:side*.15)]);sign.rotation.y=vertical?(side>0?Math.PI/2:-Math.PI/2):(side>0?Math.PI:0);}
 const d={name,x,z,cx,cz,vertical,open:false,angle:0,hinge,leaf};doors.push(d);return d;
}
for(const r of rooms)r.door=makeDoor(r.name,r.doorX,r.doorZ);
makeDoor('Jídelna · druhý vstup',36,13);makeDoor('HLAVNÍ VCHOD',0,12,true);
const staffRoom=rooms.find(r=>r.kind==='staff'),staffDoor={x:(staffRoom.doorX+.5)*CELL,z:(staffRoom.doorZ-.5)*CELL};
function nearestDoor(o=player){return doors.filter(d=>Math.hypot(d.x-o.x,d.z-o.z)<3.5).sort((a,b)=>Math.hypot(a.x-o.x,a.z-o.z)-Math.hypot(b.x-o.x,b.z-o.z))[0];}
function toggleDoor(d){if(!d)return;if(d.open&&Math.hypot(d.x-player.x,d.z-player.z)<1.5){toast('Ustup od dveří, než je zavřeš.');return;}d.open=!d.open;d.leaf.metadata.solid=!d.open;toast((d.open?'Otevřeno: ':'Zavřeno: ')+d.name);sound.play('scissors');}
function updateDoors(dt){for(const d of doors){const goal=d.open?Math.PI/2:0;d.angle+=(goal-d.angle)*Math.min(1,dt*12);d.hinge.rotation.y=(d.vertical?-Math.PI/2:0)+d.angle;d.leaf.computeWorldMatrix(true);}}
function furniture(name,size,x,y,z,m){const mesh=solidBox(name,size,[x,y,z],m);obstacles.push({x,z,rx:size[0]/2,rz:size[2]/2});return mesh;}
function desk(x,z){furniture('desk',[1.7,.12,.85],x,.85,z,mat.wood);for(const dx of [-.7,.7])for(const dz of [-.3,.3])box('desk leg',[.08,.8,.08],[x+dx,.4,z+dz],mat.metal);box('chair',[.55,.1,.55],[x,.45,z+1],mat.blue);box('chair back',[.55,.5,.08],[x,.75,z+1.22],mat.blue);}
for(const r of rooms){
 const centerX=(r.x1+r.x2+1)*CELL/2,centerZ=(r.z1+r.z2+1)*CELL/2,top=r.z1===1;
 if(r.subject&&r.kind!=='gym'||r.kind==='lab'){
  for(const x of [r.x1*CELL+3,(r.x2+1)*CELL-3])for(const z of [r.z1*CELL+5,r.z1*CELL+9,r.z1*CELL+13])desk(x,z);
  const boardZ=top?r.z1*CELL+.1:(r.z2+1)*CELL-.1;
  solidBox('blackboard',[4,1.3,.12],[centerX,2,boardZ],mat.board);const sign=textSign(r.subject||'Fyzika / Informatika',3.6,.45,[centerX,2,boardZ+(top?.08:-.08)],null,'#e6e8c6','#234f49');if(top)sign.rotation.y=Math.PI;
  if(r.subject==='Hudebka'){furniture('piano',[2.2,1.2,.7],r.x1*CELL+2, .6,r.z1*CELL+2,mat.metal);box('piano keys',[2,.08,.4],[r.x1*CELL+2,1,r.z1*CELL+2.4],mat.white);}
  if(r.subject==='Zeměpis')sphere('globe',.75,[r.x1*CELL+3,1.25,r.z1*CELL+5],mat.water);
  if(r.subject==='Výtvarka')for(let i=0;i<4;i++)box('color pots',[.16,.25,.16],[r.x1*CELL+2.5+i*.25,1.05,r.z1*CELL+5],[mat.red,mat.blue,mat.trim,mat.lettuce][i]);
  if(r.kind==='lab')for(let i=0;i<3;i++){box('computer',[.6,.4,.08],[r.x1*CELL+3,1.1,r.z1*CELL+5+i*4],mat.metal);}
 }
 if(r.kind==='library'){for(let x=r.x1*CELL+2;x<(r.x2+1)*CELL-1;x+=3){furniture('bookshelf',[1.6,2.1,.5],x,1.05,r.z1*CELL+1,mat.wood);for(let row=0;row<3;row++)for(let i=0;i<8;i++)box('book',[.13,.4,.56],[x-.65+i*.18,.4+row*.55,r.z1*CELL+1.1],[mat.red,mat.blue,mat.purple,mat.trim][i%4]);}desk(centerX,centerZ);}
 if(r.kind==='staff'){desk(centerX-3,centerZ);desk(centerX+3,centerZ);}
 if(r.kind==='gym'){
  box('court',[14,.025,19],[centerX,.025,centerZ],mat.wood);
  for(const x of [centerX-6,centerX+6])box('court line',[.06,.009,17],[x,.045,centerZ],mat.white);
  for(const z of [centerZ-8,centerZ,centerZ+8])box('court line',[12,.009,.06],[centerX,.045,z],mat.white);
  solidBox('backboard',[1.8,1,.1],[centerX,2.6,(r.z2+1)*CELL-.3],mat.white);
  const hoop=B.MeshBuilder.CreateTorus('basket hoop',{diameter:.7,thickness:.05,tessellation:24},scene);hoop.position.set(centerX,2.25,(r.z2+1)*CELL-.8);hoop.material=mat.red;hoop.isPickable=false;
  for(const z of [centerZ-5,centerZ+5])furniture('bench',[.7,.4,3],(r.x2+1)*CELL-1,.3,z,mat.blue);
 }
 if(r.kind==='cafeteria'){
  for(let x=r.x1*CELL+4;x<(r.x2+1)*CELL-2;x+=6)for(const z of [r.z1*CELL+7,r.z1*CELL+12,r.z1*CELL+17]){furniture('dining table',[3,.15,1.5],x,.85,z,mat.wood);for(const side of [-1,1])furniture('dining bench',[3,.3,.5],x,.45,z+side*1.3,mat.blue);}
  furniture('serving counter',[20,1,.9],centerX,.5,(r.z2+1)*CELL-2,mat.white);textSign('VÝDEJ JÍDLA A PITÍ',5,.7,[centerX,2.4,(r.z2+1)*CELL-1.9]);
 }
 if(r.kind==='toilet'){
  for(let i=0;i<3;i++){const z=r.z1*CELL+5+i*5;furniture('WC stall',[2,.9,.9],r.x1*CELL+1.5,.45,z,mat.white);sphere('toilet bowl',.55,[r.x1*CELL+1.5,.65,z+.6],mat.white);solidBox('stall partition',[2.3,2,.08],[r.x1*CELL+1.2,1,z+1.8],mat.lower);}
  furniture('sink',[1.5,.25,.6],(r.x2+1)*CELL-1,1,r.z1*CELL+2,mat.white);
 }
}
// Lockers line the corridor walls, with clear gaps around every doorway.
for(let x=2;x<55;x++){if(doors.some(d=>Math.abs((x+.5)*CELL-d.x)<2.6))continue;for(const z of [27.9,32.1]){const wx=(x+.5)*CELL;furniture('locker',[.8,1.9,.5],wx,.95,z, x%2?mat.blue:mat.lower);box('locker handle',[.05,.15,.08],[wx+.25,1.1,z+(z<30?.29:-.29)],mat.silver);}}
textSign('← VCHOD   |   JÍDELNA →',4.5,.45,[64,3.1,32.4]);
// Batch fixed geometry by material to keep the enlarged school inexpensive to draw.
const staticGroups=new Map();for(const m of scene.meshes.slice()){if(m.parent||!m.material)continue;const key=m.material.uniqueId+':'+!!m.metadata?.solid;const group=staticGroups.get(key)||[];group.push(m);staticGroups.set(key,group);}
for(const group of staticGroups.values())if(group.length>1){const solid=!!group[0].metadata?.solid;group.forEach(m=>m.computeWorldMatrix(true));const merged=B.Mesh.MergeMeshes(group,true,true);if(merged){merged.name='school static geometry';merged.isPickable=solid;merged.metadata=solid?{solid:true}:null;merged.receiveShadows=true;merged.freezeWorldMatrix();}}
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
function blocked(x,z,r=.28){for(const dx of [-r,r])for(const dz of [-r,r])if(map[Math.floor((z+dz)/CELL)]?.[Math.floor((x+dx)/CELL)]!=='0')return true;return obstacles.some(o=>Math.abs(x-o.x)<o.rx+r&&Math.abs(z-o.z)<o.rz+r)||doors.some(d=>!d.open&&Math.abs(x-d.x)<(d.vertical?.1:1.1)+r&&Math.abs(z-d.z)<(d.vertical?1.1:.1)+r)}
function move(o,dx,dz){if(!blocked(o.x+dx,o.z))o.x+=dx;if(!blocked(o.x,o.z+dz))o.z+=dz}
function visible(from,to){const delta=to.subtract(from),d=delta.length();return !scene.pickWithRay(new B.Ray(from,delta.normalize(),d),m=>m.isEnabled()&&!!m.metadata?.solid).hit}
function route(t){
 const sx=Math.floor(t.x/CELL),sz=Math.floor(t.z/CELL),ex=Math.floor(player.x/CELL),ez=Math.floor(player.z/CELL),queue=[[sx,sz]],seen=new Set([sx+','+sz]),prev=new Map();
 for(let i=0;i<queue.length;i++){const [x,z]=queue[i];if(x===ex&&z===ez){let p=[x,z];while(prev.has(p.join(','))){const before=prev.get(p.join(','));if(before[0]===sx&&before[1]===sz)return {x:(p[0]+.5)*CELL,z:(p[1]+.5)*CELL};p=before;}return {x:player.x,z:player.z}}
  for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]){const nx=x+dx,nz=z+dz,key=nx+','+nz;if(map[nz]?.[nx]==='0'&&!doors.some(d=>!d.open&&d.cx===nx&&d.cz===nz)&&!seen.has(key)){seen.add(key);prev.set(key,[x,z]);queue.push([nx,nz])}}
 }return {x:t.x,z:t.z};
}
const teacherRoster=[
 {name:'Šiklová',subject:'Matematika'},
 {name:'Komoň',subject:'Čeština'},
 {name:'Underlová',subject:'Angličtina'},
 {name:'Lambertová',subject:'Zeměpis'},
 {name:'Taušl',subject:'Tělocvik'},
 {name:'Doležalová',subject:'Dějepis'},
 {name:'Ditrichová',subject:'Hudebka'},
 {name:'Novotná',subject:'Výtvarka'}
];
const teacherNameMaterials=new Map();
function teacherNameplate(profile){
 let m=teacherNameMaterials.get(profile.name);
 if(!m){
  const texture=new B.DynamicTexture('name '+profile.name,{width:512,height:160},scene,true),c=texture.getContext();
  c.clearRect(0,0,512,160);c.fillStyle='rgba(14,25,34,0.78)';c.fillRect(0,0,512,160);
  c.textAlign='center';c.textBaseline='middle';c.fillStyle='#ffffff';c.font='bold 70px Arial';c.fillText(profile.name,256,52);
  c.fillStyle='#c6e3df';c.font='46px Arial';c.fillText(profile.subject,256,119);
  texture.hasAlpha=true;texture.update();
  m=new B.StandardMaterial('nameplate '+profile.name,scene);m.diffuseTexture=texture;m.emissiveTexture=texture;m.diffuseColor=B.Color3.Black();m.emissiveColor=B.Color3.White();m.disableLighting=true;m.useAlphaFromDiffuseTexture=true;m.backFaceCulling=false;m.specularColor=B.Color3.Black();teacherNameMaterials.set(profile.name,m);
 }
 const plate=B.MeshBuilder.CreatePlane('nameplate '+profile.name,{width:2.05,height:.64},scene);plate.material=m;plate.isPickable=false;plate.rotationQuaternion=B.Quaternion.Identity();return plate;
}
function createTeacher(x,z,index){
 const root=new B.TransformNode('teacher',scene),jacket=material('jacket '+index,['#8373bc','#d38d64','#5b9990'][index%3]);root.position.set(x,0,z);
 const profile=teacherRoster[index%teacherRoster.length];
 const t={root,x,z,profile,nameplate:teacherNameplate(profile),hp:65+day*10,max:65+day*10,cool:2+Math.random()*2,wind:0,grade:1,pathTime:0,walk:0};
 const target=mesh=>{mesh.isPickable=true;mesh.metadata={teacher:t};shadows.addShadowCaster(mesh);return mesh};
 target(box('jacket',[.65,.7,.34],[0,1.05,0],jacket,root));target(sphere('head',.48,[0,1.7,0],mat.skin,root));sphere('hair',.48,[0,1.8,-.035],mat.hair,root);
 box('shirt',[.19,.45,.025],[0,1.17,.182],mat.white,root);box('tie',[.07,.38,.03],[0,1.12,.2],mat.trim,root);
 for(const side of [-1,1]){target(box('arm',[.18,.65,.22],[side*.43,1.04,0],jacket,root));sphere('fist',.18,[side*.43,.69,0],mat.skin,root);target(box('leg',[.22,.64,.24],[side*.18,.38,0],mat.pants,root));box('shoe',[.25,.15,.38],[side*.18,.075,.06],mat.shoe,root);box('glasses',[.2,.1,.035],[side*.12,1.72,.225],mat.metal,root);box('lens',[.14,.055,.04],[side*.12,1.72,.248],mat.white,root);sphere('pupil',.032,[side*.12,1.72,.275],mat.metal,root);}
 box('mouth',[.14,.024,.025],[0,1.56,.23],mat.hair,root);box('book',[.24,.3,.07],[.43,.86,.14],mat.red,root);
 t.label=textSign('!',.35,.35,[0,3.2,0],root,'#d34251');t.label.billboardMode=B.Mesh.BILLBOARDMODE_ALL;t.label.setEnabled(false);
 t.bar=box('health',[.7,.06,.015],[0,2.06,0],mat.lettuce,root);return t;
}
const ghostMat=material('friendly ghost','#b1f5ed');ghostMat.alpha=.62;ghostMat.emissiveColor=new B.Color3(.2,.5,.46);ghostMat.backFaceCulling=false;
function becomeGhost(t){
 t.wind=0;t.ghost={age:0,step:0,waypoints:[{x:t.x,z:30},{x:staffDoor.x,z:30},{x:staffDoor.x,z:staffDoor.z}]};
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
function clearEntities(){for(const item of [...teachers,...shots,...pickups]){item.root.dispose();item.nameplate?.dispose();}teachers=[];shots=[];pickups=[];}
function spawnDay(){
 clearEntities();for(let i=0;i<Math.min(3+day,12);i++){
 const profile=teacherRoster[i%teacherRoster.length],room=rooms.find(r=>r.subject===profile.subject);
 const x=(room.doorX+.5)*CELL+(i>=8?.9:0),z=room.z1===1?(room.z2+.1)*CELL:(room.z1+1.3)*CELL;
 const t=createTeacher(x,z,i);t.home=room;teachers.push(t);
 }
 pickups=[];for(let i=0;i<6;i++)pickups.push(spawnPickup(cafeteria.x1*CELL+6+i*3,(cafeteria.z2+1)*CELL-3.3,'food'));
 for(let i=0;i<4;i++)pickups.push(spawnPickup(cafeteria.x1*CELL+25+i*2,(cafeteria.z2+1)*CELL-3.3,'drink'));
 toast('DEN '+day+' — prohledej učebny, zásoby jsou v jídelně.');hud();
}
function reset(){for(const d of doors){d.open=false;d.angle=0;d.leaf.metadata.solid=true;}updateDoors(1);player={x:6.25,z:30,y:0,vy:0,yaw:Math.PI/2,pitch:0,student:studentChoice};studentClothes.diffuseColor=B.Color3.FromHexString(studentTypes[studentChoice].color);hp=150;food=3;drink=2;day=1;kills=0;selected=0;cooldown=swing=hit=flash=nextDay=0;dead=false;spawnDay();syncView()}
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
 if(!visible(new B.Vector3(t.x,1.15,t.z),new B.Vector3(player.x,1+player.y,player.z)))return;
 const origin=new B.Vector3(t.x,1.15,t.z),aim=new B.Vector3(player.x,1+player.y,player.z),dir=aim.subtract(origin).normalize(),note=t.grade===100;
 const root=B.MeshBuilder.CreatePlane(note?'POZNÁMKA 100 DMG':'Známka '+t.grade,{width:note?1.8:1.15,height:note?1.2:1.15},scene);
 root.material=gradeMaterial(t.grade);root.isPickable=false;root.position.copyFrom(origin);root.rotationQuaternion=camera.rotationQuaternion.clone();
 shots.push({root,velocity:dir.scale(note?5.8:7),damage:note?100:t.grade*10,life:8});
}
function update(dt){time+=dt;updateDoors(dt);cooldown=Math.max(0,cooldown-dt);swing=Math.max(0,swing-dt*5);hit=Math.max(0,hit-dt);flash=Math.max(0,flash-dt);notice-=dt;if(notice<0)$('#toast').textContent='';
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
 const step=shot.velocity.scale(dt);const wallHit=scene.pickWithRay(new B.Ray(pos,step.normalizeToNew(),step.length()),m=>m.isEnabled()&&!!m.metadata?.solid);if(wallHit.hit){shot.life=0;continue}pos.addInPlace(step);
 if(shot.life>0&&Math.hypot(pos.x-player.x,pos.z-player.z)<.36&&pos.y>player.y+.12&&pos.y<player.y+1.85){shot.life=0;damage(shot.damage);if(dead)break}
 }
 shots=shots.filter(s=>{if(s.life<=0){s.root.dispose();return false}return true});if(dead)return;
 pickups=pickups.filter(p=>{p.root.rotation.y+=dt;p.root.position.y=.5+Math.sin(time*3)*.08;if(Math.hypot(p.x-player.x,p.z-player.z)<.8){if(p.type==='food')food++;else drink++;p.root.dispose();sound.play('pickup');toast(p.type==='food'?'Našel jsi svačinu!':'Našel jsi pití!');hud();return false}return true});
 if(teachers.every(t=>t.hp<=0)){if(!nextDay){nextDay=4;sound.play('bell');toast('ZVONÍ! Den přežitý.')}nextDay-=dt;if(nextDay<=0){if(teachers.some(t=>t.ghost)){nextDay=.1;return}day++;nextDay=0;spawnDay()}}
}
function syncView(){
 // World-space yaw, then local pitch. Roll is always zero and world up stays fixed.
 const nearby=active?nearestDoor():null;$('#door-hint').textContent=nearby?'F — '+(nearby.open?'zavřít ':'otevřít ')+nearby.name:'';const location=rooms.find(r=>inRoom(player.x,player.z,r));$('#location').textContent=location?location.name:'Hlavní chodba';
 const shake=hit>0?Math.sin(time*70)*hit*.035:0;
 camera.position.set(player.x+Math.cos(player.yaw)*shake,1.65+player.y,player.z-Math.sin(player.yaw)*shake);
 camera.rotation.set(0,0,0);camera.rotationQuaternion.copyFrom(B.Quaternion.RotationYawPitchRoll(player.yaw,player.pitch,0));camera.upVector.copyFromFloats(0,1,0);
 for(const t of teachers){t.nameplate.setEnabled(t.root.isEnabled());t.nameplate.position.copyFrom(t.root.position).addInPlace(new B.Vector3(0,2.55,0));t.nameplate.rotationQuaternion.copyFrom(camera.rotationQuaternion);}
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
addEventListener('keydown',e=>{if(e.code==='KeyM'&&!e.repeat){sound.toggle();return}if(!active)return;if(e.code==='Escape'&&fallback){pause();return}if(e.code==='Space'||e.ctrlKey)e.preventDefault();keys.add(e.code);if(e.repeat)return;if(/^Digit[1-4]$/.test(e.code)){selected=Number(e.code.slice(-1))-1;hud()}if(e.code==='KeyF')toggleDoor(nearestDoor());if(e.code==='Space'&&player.y===0)player.vy=4.8});
addEventListener('keyup',e=>keys.delete(e.code));addEventListener('blur',()=>{keys.clear();if(active){if(fallback)pause();else document.exitPointerLock?.()}});addEventListener('mousemove',e=>{if(active){player.yaw=Math.atan2(Math.sin(player.yaw+e.movementX*.0025),Math.cos(player.yaw+e.movementX*.0025));player.pitch=Math.max(-1.52,Math.min(1.52,player.pitch+e.movementY*.0025));syncView()}});
addEventListener('contextmenu',e=>{if(active)e.preventDefault()});addEventListener('mousedown',e=>{if(!active||e.target.closest?.('button'))return;e.preventDefault();if(e.button===0)shoot();if(e.button===2)useSupply()});addEventListener('wheel',e=>{if(active){e.preventDefault();selected=(selected+(e.deltaY>0?1:3))%4;hud()}},{passive:false});
addEventListener('resize',()=>engine.resize());reset();engine.runRenderLoop(()=>{if(active)update(Math.min(.035,engine.getDeltaTime()/1000));syncView();scene.render()});
