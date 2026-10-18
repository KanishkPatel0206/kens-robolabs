const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message.slice(0,200)));
const html=fs.readFileSync(__dirname+'/../index.html','utf8').replace('<script src="vendor/three.min.js"></script>','').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};
w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));
const ev=c=>w.eval(c),out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:'')),key=(k,o={})=>w.dispatchEvent(new w.KeyboardEvent('keydown',{key:k,bubbles:true,...o}));
setTimeout(()=>{
 // 1 share link round trip
 ev("setPreset('ur5')");const before=ev('JSON.stringify([joints,toolOffset,toolOffsetZ,baseH])');
 w.HTMLElement.prototype.focus=()=>{};Object.defineProperty(w.navigator,'clipboard',{value:{writeText:()=>Promise.resolve()},configurable:true});
 ev("document.querySelector('#shareBtn').click()");const hash=w.location.hash;T('share link written to address bar',hash.startsWith('#s=')&&hash.length>40,hash.length+' chars');
 ev("setPreset('2r')");w.location.hash=hash;w.dispatchEvent(new w.HashChangeEvent('hashchange'));
 T('share link restores the exact robot (joints, tool, base height)',ev('JSON.stringify([joints,toolOffset,toolOffsetZ,baseH])')===before);
 w.location.hash='#s=not-valid!!';w.dispatchEvent(new w.HashChangeEvent('hashchange'));T('corrupt share link rejected safely',ev('joints.length')===6);
 const bad=Buffer.from(JSON.stringify({j:[{type:'X'}],tx:0,tz:0})).toString('base64');w.location.hash='#s='+bad;w.dispatchEvent(new w.HashChangeEvent('hashchange'));T('malformed robot in link rejected',ev('joints.length')===6);
 // 2 keyboard
 ev("setPreset('3r');selected=0;renderAll();document.querySelector('[data-page=\"workspace\"]').click()");const t0=ev('joints[0].theta');key('ArrowRight');key('ArrowRight',{shiftKey:true});T('arrow keys move joint (1° then Shift+10°)',ev('joints[0].theta')-t0===11,ev('joints[0].theta')-t0);
 key(']');T('[ ] select joint',ev('selected')===1);ev('history.length=0;snap()');ev('joints[1].theta+=20');key('z',{ctrlKey:true});T('Ctrl+Z undoes',ev('joints[1].theta')!==ev('joints[1].theta+20')&&true);
 const ti=w.document.createElement('input');w.document.body.appendChild(ti);const th=ev('joints[0].theta');ti.dispatchEvent(new w.KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));T('keys ignored while typing in a field',ev('joints[0].theta')===th);
 // 3 present
 key('p');T('P toggles presentation mode',w.document.body.classList.contains('present'));key('Escape');T('Esc exits presentation mode',!w.document.body.classList.contains('present'));
 // 4 payload: check vs finite-difference of potential energy U=-m g.p
 ev("setPreset('3r');document.querySelector('[data-page=\"dynamics\"]').click()");ev("document.querySelector('#dynG').value='y';document.querySelector('#payKg').value='4';document.querySelector('#payGo').click()");
 const txt=w.document.querySelector('#payOut').textContent;T('payload table rendered',/Heaviest load/.test(txt));
 const chk=ev(`(()=>{const m=4,g=[0,-9.81,0],h=1e-4;const U=()=>{const p=pos(calc().T);return -m*(g[0]*p[0]+g[1]*p[1]+g[2]*p[2])/1000};const pay=[];joints.forEach((j,i)=>{const k='theta',v=j[k];j[k]=v+h;const u1=U();j[k]=v-h;const u0=U();j[k]=v;pay.push((u1-u0)/(2*h*Math.PI/180))});
   const r=toRL(),q=qNow(),J=RL.jacobian(r,q);const mine=joints.map((_,i)=>-m*(J[0][i]*g[0]+J[1][i]*g[1]+J[2][i]*g[2]));return Math.max(...pay.map((v,i)=>Math.abs(v-mine[i])))})()`);T('payload torque matches finite-difference of potential energy (N·m)',chk<1e-4,chk.toExponential(1));
 // 5 quiz: engine answer equals page FK; checks right/wrong
 ev("document.querySelector('[data-page=\"learn\"]').click()");const A=ev('__Q().ans');ev(`document.querySelector('#qx').value=${A[0]};document.querySelector('#qy').value=${A[1]};document.querySelector('#qz').value=${A[2]};document.querySelector('#qCheck').click()`);
 T('quiz accepts the correct answer',/Correct/.test(w.document.querySelector('#qOut').textContent)&&w.document.querySelector('#quizScore').textContent==='1 / 1');
 ev("document.querySelector('#qx').value=9999;document.querySelector('#qCheck').click()");T('quiz rejects a wrong answer',/Not quite/.test(w.document.querySelector('#qOut').textContent)&&w.document.querySelector('#quizScore').textContent==='1 / 2');
 let okq=0;for(let i=0;i<30;i++){ev('quizNew()');const a=ev('__Q().ans');const r=ev(`(()=>{const Q=__Q();setPreset(Q.id);Q.js.forEach((j,i)=>{joints[i][j.type==='R'?'theta':'d']=j[j.type==='R'?'theta':'d']});const p=pos(calc().T);return p})()`);if(Math.hypot(...a.map((v,i)=>v-r[i]))<1e-6)okq++}T('quiz answers equal the live robot FK (30 random questions)',okq===30,okq+'/30');
 // fixes
 ev("setPreset('puma')");const b=ev('baseH');ev('snap();baseH=900;document.querySelector("#baseH").value=900');ev("document.querySelector('#undoBtn').click()");T('undo restores base height',ev('baseH')===b,ev('baseH')+' vs '+b);
 let moved=0;for(let i=0;i<30;i++){const b4=ev('JSON.stringify(joints)');ev("document.querySelector('#randPose').click()");if(ev('JSON.stringify(joints)')!==b4&&!ev('collisionReport().hit'))moved++}T('Random pose always finds a clear pose (PUMA)',moved===30,moved+'/30');
 ev("document.querySelector('#zeroPose').click()");T('Zero pose applied and clear (PUMA, base raised if needed)',!ev('collisionReport().hit')&&ev('joints.every(j=>(j.type==="R"?j.theta:j.d)===Math.min(j.max,Math.max(j.min,0)))'),'base '+ev('baseH'));
 ev("document.querySelector('#saveBtn').click()");T('save stores base height',JSON.parse(w.localStorage.getItem('crayon-mdh-project')).baseH===ev('baseH'));
 let dl;w.URL.createObjectURL=x=>{dl=x;return 'b'};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};ev("document.querySelector('#exportBtn').click()");
 dl.text().then(tx=>{T('export includes baseHeight_mm',JSON.parse(tx).baseHeight_mm===ev('baseH'));console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,3):'none');process.exit(0)})},400);
