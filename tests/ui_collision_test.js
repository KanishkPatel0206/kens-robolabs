const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>errs.push(e.message.slice(0,200)));
const html=fs.readFileSync(__dirname+'/../index.html','utf8').replace('<script src="vendor/three.min.js"></script>','').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:(t,k)=>k==='measureText'?()=>({width:5}):()=>{},set:()=>true});
w.scrollTo=()=>{};w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));
const ev=c=>w.eval(c),sl=ms=>new Promise(r=>setTimeout(r,ms)),out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));
(async()=>{await sl(300);const ids=ev('Object.keys(defaults)');let bad=[],selfs=[],bases={};
 for(const k of ids){ev(`setPreset('${k}')`);await sl(2);const r=ev('(()=>{const r=collisionReport();return {fl:r.hit&&/floor|pedestal/.test(r.msg),self:/self/.test(r.msg),msg:r.msg,clear:r.clear,b:baseH}})()');bases[k]=r.b;if(r.fl)bad.push(k+':'+r.msg);if(r.self)selfs.push(k+':'+r.msg)}
 T('every preset loads clear of the floor/pedestal',bad.length===0,bad.join(' | '));
 T('every preset loads free of self-collision',selfs.length===0,selfs.join(' | '));
 console.log('base heights (mm):',JSON.stringify(bases));
 // random moves must never end in a collision when the previous state was ok
 let blocked=0,viol=0,moves=0;
 for(const k of ['puma','ur5','irb120','stanford','iiwa7','scara4','cyl','sph','6r','cartesian']){ev(`setPreset('${k}')`);for(let m=0;m<60;m++){const was=ev('!collisionReport().hit');const before=ev('JSON.stringify(joints)');
   ev(`(()=>{const i=Math.floor(Math.random()*joints.length),j=joints[i],v=j.min+Math.random()*(j.max-j.min);if(j.type==='R')j.theta=v;else j.d=v;renderAll(false)})()`);moves++;
   const now=ev('collisionReport().hit');if(was&&now)viol++;if(ev('JSON.stringify(joints)')===before)blocked++}}
 T('no move from a clear pose ever ends in collision (600 random moves)',viol===0,`violations ${viol}, blocked ${blocked}/${moves}`);
 T('collisions are actually detected and blocked somewhere',blocked>0,blocked);
 // forced floor hit: lower base height under a hanging arm
 ev(`setPreset('puma')`);const b0=ev('baseH');ev(`document.querySelector('#baseH').value=10;document.querySelector('#baseH').dispatchEvent(new Event('change'))`);
 T('lowering the base into a reaching arm flags a floor collision',ev('collisionReport().hit'),ev('collisionReport().msg'));
 T('status pill shows the warning',/floor/.test(w.document.querySelector('#colStatus').textContent),w.document.querySelector('#colStatus').textContent);
 ev(`document.querySelector('#baseH').value=${b0};document.querySelector('#baseH').dispatchEvent(new Event('change'))`);T('status returns to clear',/No collision/.test(w.document.querySelector('#colStatus').textContent));
 // synthetic self-collision: bend irb120 so forearm hits base column
 ev(`setPreset('iiwa7')`);ev(`joints[1].theta=0;joints[3].theta=-120;joints[3].theta=Math.max(joints[3].min,joints[3].theta);renderAll()`);
 // workspace filter
 ev(`setPreset('iiwa7');document.querySelector('[data-page="workspaceAnalysis"]').click();document.querySelector('#workspaceSamples').value='300'`);ev(`document.querySelector('#workspaceRun').click()`);
 const ws=w.document.querySelector('#workspaceSummary').textContent;T('workspace sampler reports collision rejections',/rejected for collision/.test(ws),ws.slice(0,110));
 // IK tag exists in markup path (function)
 T('collidesQ available for IK tagging',ev('typeof collidesQ')==='function'&&ev('collidesQ(joints.map(j=>j.type==="R"?j.theta*Math.PI/180:j.d/1000))')===false);
 // CSS sanity: scroll containers exist
 const css=[...w.document.querySelectorAll('style')].map(s=>s.textContent).join('');
 T('sticky/scroll rules present (sidebar, joint tree, inspector, tables, plots)',['aside{position:sticky','.right-col{position:sticky','.tabcontent{max-height','canvas.plot-box','@media(max-width:1000px)'].every(k=>css.includes(k)));
 console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,4):'none');process.exit(0)})();
