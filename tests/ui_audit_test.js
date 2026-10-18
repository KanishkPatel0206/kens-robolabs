const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message.slice(0,200)));
const html=fs.readFileSync(__dirname+'/../index.html','utf8').replace('<script src="vendor/three.min.js"></script>','').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.scrollTo=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:(t,k)=>k==='measureText'?()=>({width:5}):()=>{},set:()=>true});
w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));
const ev=c=>w.eval(c),sl=ms=>new Promise(r=>setTimeout(r,ms)),out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));
(async()=>{await sl(300);const ids=ev('Object.keys(defaults)');
 // mock THREE to exercise render3D
 ev(`(()=>{const any=()=>new Proxy(function(){},{get:(t,k)=>k===Symbol.toPrimitive?()=>1:k==='children'?[]:any(),apply:()=>any(),construct:()=>any()});window.THREE=any();
  const grp=()=>({children:[],add(o){this.children.push(o)}});scene3d={};robotGroup3d=grp();frameGroup3d=grp();window.__meshes=()=>robotGroup3d.children.length})()`);
 let geoWorst=0,nanPages=[],meshCnt={},fdWorst=0,driftWorst=0,driftWho='';
 for(const k of ids){ev(`setPreset('${k}')`);await sl(3);
  // random poses: geometry consistency
  for(let r=0;r<5;r++){ev(`joints.forEach(j=>{const v=j.min+Math.random()*(j.max-j.min);if(j.type==='R')j.theta=v;else j.d=v})`);
   geoWorst=Math.max(geoWorst,ev(`(()=>{const Ts=calc().Ts;let w=0;linkPlan(Ts).forEach((L,i)=>{const d=joints[i].d;const e=[0,1,2].map(c=>L.oI[c]-d*L.zI[c]-L.mid[c]);w=Math.max(w,Math.hypot(...e))});return w})()`));
   // jacobian vs FD
   fdWorst=Math.max(fdWorst,ev(`(()=>{const r={convention:'mdh',tool:[toolOffset/1000,0,toolOffsetZ/1000],gravity:[0,0,-9.81],home:[],joints:joints.map(j=>{const R=j.type==='R';return RL.makeJoint({type:j.type,a:j.a/1000,alpha:j.alpha,d:R?j.d/1000:0,theta:R?0:j.theta,qmin:-9,qmax:9})})};const q=joints.map(j=>j.type==='R'?j.theta*Math.PI/180:j.d/1000);return RL.maxAbsDiff(RL.jacobian(r,q),RL.jacobianFD(r,q))})()`))}
  try{ev('render3D()');meshCnt[k]=ev('__meshes()')}catch(e){meshCnt[k]='ERR '+e.message}
  // all pages: no NaN / undefined
  for(const pg of ['workspace','fk','frames','ik','jacobian','trajectory','workspaceAnalysis','dynamics','library']){ev(`document.querySelector('[data-page="${pg}"]').click()`);await sl(2);
   const tx=w.document.querySelector('main').textContent;if(/NaN|undefined/.test(tx))nanPages.push(k+'/'+pg)}
  // energy conservation
  ev(`document.querySelector('[data-page="dynamics"]').click()`);await sl(2);ev(`document.querySelector('#dynG').value='y';document.querySelector('#dynSim').click()`);
  const m=w.document.querySelector('#dynOut').textContent.match(/drift ([0-9.e+-]+)/);if(m){const d=+m[1];if(d>driftWorst){driftWorst=d;driftWho=k}}}
 T('geometry: every a(i-1)/d(i) path closes on the FK origin, all 16 robots',geoWorst<1e-9,geoWorst.toExponential(1));
 T('render3D runs for all 16 robots',Object.values(meshCnt).every(v=>typeof v==='number'&&v>5),JSON.stringify(meshCnt).slice(0,120));
 T('Jacobian == finite differences, all robots',fdWorst<1e-5,fdWorst.toExponential(1));
 T('no NaN/undefined text on any page for any robot',nanPages.length===0,nanPages.slice(0,5).join(','));
 T('energy conserved in RK4 sim, all robots',driftWorst<1e-3,driftWorst.toExponential(1)+' worst='+driftWho);
 // inspector / prismatic behaviour
 ev(`setPreset('scara4');selected=2;renderAll()`);
 const nu=w.document.querySelectorAll('[data-nudge]');T('prismatic joint shows mm nudge buttons',nu.length===5&&/mm/.test(nu[3].textContent),nu.length);
 ev(`joints[2].d=100;renderAll();document.querySelector('[data-nudge="10"]').click()`);const d1=ev('joints[2].d');ev(`document.querySelector('[data-nudge="10"]').click();document.querySelector('[data-nudge="10"]').click();document.querySelector('[data-nudge="10"]').click();document.querySelector('[data-nudge="10"]').click();document.querySelector('[data-nudge="10"]').click()`);
 T('nudge moves d and clamps at max',d1===110&&ev('joints[2].d')===150,d1+' / '+ev('joints[2].d'));
 T('joint card flags AT LIMIT + range bar',/AT LIMIT/.test(w.document.querySelector('#jointList').textContent)&&!!w.document.querySelector('.rangebar i'));
 ev(`(()=>{const e=document.querySelector('#paramFields [data-param="type"]');e.value='R';e.dispatchEvent(new Event('change'))})()`);T('inspector P→R: limits ±180, theta in range',ev('joints[2].min')===-180&&ev('joints[2].max')===180&&Math.abs(ev('joints[2].theta'))<=180,ev('[joints[2].min,joints[2].max,joints[2].theta]'));
 ev(`(()=>{const e=document.querySelector('#paramFields [data-param="type"]');e.value='P';e.dispatchEvent(new Event('change'))})()`);T('inspector R→P: limits 0..300, d clamped inside',ev('joints[2].min')===0&&ev('joints[2].max')===300&&ev('joints[2].d')>=0&&ev('joints[2].d')<=300,ev('[joints[2].min,joints[2].max,joints[2].d]'));
 ev(`(()=>{const e=document.querySelector('#paramFields [data-param="max"]');e.value='-50';e.dispatchEvent(new Event('change'))})()`);T('inspector: max below min corrected',ev('joints[2].min<joints[2].max'),ev('[joints[2].min,joints[2].max]'));
 // slider drag should create <=2 undo entries
 ev(`setPreset('cartesian');selected=0;renderAll();history.length=0`);for(let v=0;v<30;v++)ev(`(()=>{const s=document.querySelector('#jointSlider');s.value=${v*5};s.oninput({target:s})})()`);T('slider drag does not flood undo history',ev('history.length')<=2,ev('history.length'));
 // undo restores tool + joints
 ev(`setPreset('irb120');history.length=0;snap();toolOffsetZ=5;joints[0].theta=77;`);ev(`document.querySelector('#undoBtn').click()`);T('undo restores tool frame and joints',ev('toolOffsetZ')===72&&ev('joints[0].theta')===20,ev('[toolOffsetZ,joints[0].theta]'));
 // save persists tool z
 ev(`setPreset('irb120');document.querySelector('#saveBtn').click()`);T('save stores tool z',JSON.parse(w.localStorage.getItem('crayon-mdh-project')).toolOffsetZ===72);
 console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,4):'none');process.exit(0)})();
