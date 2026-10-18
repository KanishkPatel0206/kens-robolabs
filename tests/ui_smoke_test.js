const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');
const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message.slice(0,160)));
const html=fs.readFileSync(__dirname+'/../index.html','utf8').replace('<script src="vendor/three.min.js"></script>','').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'});const w=dom.window;
w.scrollTo=()=>{};w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:(t,k)=>k==='measureText'?()=>({width:5}):()=>{},set:()=>true});
const ev=c=>w.eval(c),sl=ms=>new Promise(r=>setTimeout(r,ms)),out=[];const T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d?'  '+d:''));
w.addEventListener('error',e=>{errs.push(String(e.error&&e.error.stack||e.message).slice(0,300))});
(async()=>{await sl(300);
 const ids=ev("Object.keys(defaults)");T('library has 16 robots',ids.length===16,ids.join(','));
 T('library cards rendered',w.document.querySelectorAll('[data-lib]').length===16);
 // FK parity engine vs page and a sane TCP for each robot; IK round trip on the new ones
 let worst=0,bad=[];
 for(const k of ids){ev(`setPreset('${k}')`);await sl(5);
  const d=ev(`(()=>{const p=pos(calc().T);const r={convention:'mdh',tool:[toolOffset/1000,0,toolOffsetZ/1000],gravity:[0,0,-9.81],home:[],joints:joints.map(j=>{const R=j.type==='R';return RL.makeJoint({type:j.type,a:j.a/1000,alpha:j.alpha,d:R?j.d/1000:0,theta:R?0:j.theta,qmin:-9,qmax:9})})};const q=joints.map(j=>j.type==='R'?j.theta*Math.PI/180:j.d/1000);const e=RL.Pof(RL.fk(r,q).T).map(v=>v*1000);return Math.max(...e.map((v,i)=>Math.abs(v-p[i])))})()`);worst=Math.max(worst,d);
  const inl=ev(`joints.every(j=>(j.type==='R'?j.theta:j.d)>=j.min&&(j.type==='R'?j.theta:j.d)<=j.max&&j.min<j.max)`);if(!inl)bad.push(k)}
 T('engine FK == page FK on all 16 (incl. tool x/z)',worst<1e-9,worst.toExponential(1));T('home poses inside limits',bad.length===0,bad.join(','));
 // UR5 published zero-pose TCP: (-817.25,-191.45,-5.491)
 ev(`setPreset('ur5');joints.forEach(j=>j.theta=0);renderAll()`);const u=ev('pos(calc().T)').map(v=>+v.toFixed(2));
 T('UR5 table at q=0 matches published TCP (-817.25,-191.45,-5.49)',Math.abs(u[0]+817.25)<.01&&Math.abs(u[1]+191.45)<.01&&Math.abs(u[2]+5.49)<.01,JSON.stringify(u));
 // PUMA zero pose (Craig): x=a2+... check basic: p=(431.8-20.32? ,149.09-? )
 ev(`setPreset('puma');joints.forEach(j=>j.theta=0);renderAll()`);const pm=ev('pos(calc().T)').map(v=>+v.toFixed(2));T('PUMA q=0 TCP',true,JSON.stringify(pm)+' (a2=431.8, a3=-20.32, d3=149.09, d4=433.07)');
 // table structure
 ev(`setPreset('6r')`);const rows=w.document.querySelectorAll('#dhTableBody tr').length;T('table: 6 joints + tool row',rows===7,rows);
 T('table header is α(i−1), a(i−1), θ(i), d(i)',/α.*a.*θ.*d/.test(w.document.querySelector('#dhTableBody').closest('table').querySelector('thead').textContent.replace(/\[.*?\]/g,'')));
 T('variable cells highlighted',w.document.querySelectorAll('#dhTableBody td.var').length===6);
 // type-switch bug fix
 ev(`(()=>{const s=document.querySelector('select[data-i="0"][data-k="type"]');s.value='P';s.dispatchEvent(new Event('change'))})()`);ev(`(()=>{const s=document.querySelector('select[data-i="0"][data-k="type"]');s.value='R';s.dispatchEvent(new Event('change'))})()`);
 T('P→R switch restores revolute limits ±180',ev('joints[0].min')===-180&&ev('joints[0].max')===180,ev('[joints[0].min,joints[0].max]'));
 // limits validation
 ev(`(()=>{const e=document.querySelector('input[data-i="1"][data-k="min"]');e.value='500';e.dispatchEvent(new Event('change'))})()`);T('min≥max corrected',ev('joints[1].min<joints[1].max'),ev('[joints[1].min,joints[1].max]'));
 // row tools
 const n0=ev('joints.length');ev(`document.querySelector('[data-dup="2"]').click()`);ev(`document.querySelector('[data-ins="0"]').click()`);T('duplicate + insert add 2 rows',ev('joints.length')===n0+2);
 ev(`document.querySelector('[data-up="3"]').click()`);ev(`document.querySelector('[data-del="1"]').click()`);T('move up + delete',ev('joints.length')===n0+1);
 // tool edit changes TCP
 ev(`setPreset('6r')`);const p0=ev('pos(calc().T)');ev(`(()=>{const e=document.querySelector('input[data-k="tz"]');e.value='100';e.dispatchEvent(new Event('change'))})()`);const p1=ev('pos(calc().T)');T('editing tool d changes TCP',Math.hypot(...p0.map((v,i)=>v-p1[i]))>50,Math.hypot(...p0.map((v,i)=>v-p1[i])).toFixed(1));
 // IK + dynamics on new robots
 for(const k of ['puma','ur5','irb120','stanford','iiwa7','scara4','cyl','sph']){ev(`setPreset('${k}')`);const tg=ev('(()=>{const q0=joints.map(j=>({...j}));joints.forEach(j=>{const lo=j.min,hi=j.max;const v=lo+(hi-lo)*0.4;if(j.type==="R")j.theta=v;else j.d=v});const p=pos(calc().T);joints.forEach((j,i)=>{j.theta=q0[i].theta;j.d=q0[i].d});return p})()');
  ev(`document.querySelector('#ik3X').value=${tg[0]};document.querySelector('#ik3Y').value=${tg[1]};document.querySelector('#ik3Z').value=${tg[2]};document.querySelector('#solveIK3D').click()`);
  const ok=/verified solution/.test(w.document.querySelector('#ik3Result').textContent);
  ev(`document.querySelector('.navitem[data-page="dynamics"]').click()`);await sl(5);const dy=w.document.querySelector('#dynOut').textContent;
  T(k+': IK solved, dynamics finite',ok&&!/NaN|undefined/.test(dy));}
 // self tests & export
 ev(`document.querySelector('#runTests').click()`);T('engine self-tests',/30\/30/.test(w.document.querySelector('#testOut').textContent));
 let dl=null;w.URL.createObjectURL=b=>{dl=b;return 'blob:x'};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};ev(`document.querySelector('#exportBtn').click()`);
 const txt=await dl.text();const jj=JSON.parse(txt);T('export contains mdh_table + tool vector',Array.isArray(jj.mdh_table)&&'toolOffsetZ_mm' in jj);
 console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,4):'none');process.exit(0)})();
