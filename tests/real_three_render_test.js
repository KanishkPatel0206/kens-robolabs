const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message.slice(0,200)));
const root=__dirname+'/../';const three=fs.readFileSync(root+'vendor/three.min.js','utf8');
const html=fs.readFileSync(root+'index.html','utf8').replace('<script src="vendor/three.min.js"></script>','').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};
const ev=c=>w.eval(c),out=[];
setTimeout(()=>{w.eval(three);ev("window.__T=typeof THREE!=='undefined'?THREE.REVISION:'none'");out.push('real THREE revision in page: '+ev('__T'));
 ev("scene3d=new THREE.Scene();scene3d.add(new THREE.GridHelper(2000,40));robotGroup3d=new THREE.Group();frameGroup3d=new THREE.Group();scene3d.add(robotGroup3d);scene3d.add(frameGroup3d);");
 const ids=ev('Object.keys(defaults)');let bad=[],low=[];
 for(const k of ids){try{ev(`setPreset('${k}')`);ev('render3D()');
   const r=ev(`(()=>{const b=new THREE.Box3().setFromObject(robotGroup3d);const m=robotGroup3d.children.length;const nan=!isFinite(b.min.x+b.min.y+b.min.z+b.max.x+b.max.y+b.max.z);return {m,nan,minz:b.min.z,floor:-baseH,grid:scene3d.children.find(o=>o.type==='GridHelper').position.z}})()`);
   if(r.nan||r.m<5)bad.push(k+JSON.stringify(r));if(r.minz<r.floor-5)low.push(k+' minz '+r.minz.toFixed(0)+' floor '+r.floor)}catch(e){bad.push(k+' ERR '+e.message)}}
 out.push('render3D with real three.js, all '+ids.length+' robots: '+(bad.length?'FAIL '+bad.join(' | '):'OK (no exceptions, finite geometry)'));
 out.push('anything below the floor plane at load: '+(low.length?low.join(' | '):'none'));
 // collision colouring: force a hit and check a red material exists
 ev("setPreset('puma');baseH=10;renderAll()");const red=ev("robotGroup3d.children.some(o=>o.material&&o.material.color&&o.material.color.getHex()===0xff3b30)");out.push('colliding links drawn red: '+red);
 // prismatic parts present
 ev("setPreset('scara4');render3D()");out.push('prismatic rail/stops/carriage drawn (scara4 children): '+ev('robotGroup3d.children.length'));
 console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,3):'none');process.exit(0)},400);
