const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errs.push(e.message.slice(0,200))});
const three=fs.readFileSync(__dirname+'/../vendor/three.min.js','utf8');
const mk=(url)=>{const html=fs.readFileSync(__dirname+'/../index.html','utf8').replace(/<script src="https:[^>]*><\/script>/,'').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
 const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url}).window;w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));return w};
const w=mk('http://localhost/'),ev=c=>w.eval(c),out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));
setTimeout(()=>{w.eval(three);
 ev("scene3d=new THREE.Scene();scene3d.add(new THREE.GridHelper(2000,40));robotGroup3d=new THREE.Group();frameGroup3d=new THREE.Group();scene3d.add(robotGroup3d);scene3d.add(frameGroup3d);renderer3d={}");
 // framing: every mesh of every robot must be inside the snapshot camera frustum
 let worst=0,bad=[];const ids=ev('Object.keys(defaults)');
 for(const k of ids){ev(`setPreset('${k}')`);for(let r=0;r<6;r++){if(r)ev(`joints.forEach(j=>{const v=j.min+Math.random()*(j.max-j.min);if(j.type==='R')j.theta=v;else j.d=v});`);
   ev('showFrames=false;selected=-1;render3D()');
   const m=ev(`(()=>{const cam=__export.snapCam(1400,900);let w=0;robotGroup3d.children.forEach(o=>{if(!o.geometry||o.geometry.type==='PlaneGeometry')return;const b=new THREE.Box3().setFromObject(o);for(const x of [b.min.x,b.max.x])for(const y of [b.min.y,b.max.y])for(const z of [b.min.z,b.max.z]){const v=new THREE.Vector3(x,y,z).project(cam);w=Math.max(w,Math.abs(v.x),Math.abs(v.y));if(v.z<-1||v.z>1)w=9}});return w})()`);
   worst=Math.max(worst,m);if(m>0.97)bad.push(k+' '+m.toFixed(2))}}
 T('snapshot camera keeps every part of all 16 robots inside the image (96 poses)',bad.length===0,'worst NDC '+worst.toFixed(2)+(bad.length?' bad: '+bad.slice(0,4).join(','):''));
 // fake renderer: verify snapshot logic, blank guard, state restore
 ev(`window.__mode='robot';window.__log=[];THREE.WebGLRenderer=function(){this.domElement={toDataURL:()=>'data:image/png;base64,AAAA'};this.setPixelRatio=()=>{};this.setSize=(a,b)=>__log.push('size '+a+'x'+b);this.render=()=>__log.push('render');this.getContext=()=>({RGBA:6408,UNSIGNED_BYTE:5121,readPixels:(x,y,a,b,f,t,px)=>px.set(__mode==='blank'?[240,244,255,255]:(x%11<3?[200,60,60,255]:[240,244,255,255]))});this.dispose=()=>__log.push('dispose');this.forceContextLoss=()=>{}}`);
 ev("setPreset('ur5');selected=3;showFrames=false;trace3DPoints.length=0");
 const u=ev('__export.snap3D(true)');T('snapshot returns a PNG data URL when the render has content',/^data:image\/png/.test(u));
 T('snapshot renders offscreen at 1400x900 and disposes the renderer',ev('__log.join()').includes('size 1400x900')&&ev('__log.join()').includes('dispose'));
 T('page state restored after snapshot (selected joint, frames off, trace)',ev('selected')===3&&ev('showFrames')===false&&ev('trace3DPoints.length')===0);
 ev("__mode='blank'");T('blank render is refused (returns null, never a blank image)',ev('__export.snap3D(true)')===null);
 // report behaviour
 ev("__mode='robot';setPreset('stanford');document.querySelector('[data-page=\"export\"]').click()");
 const rep=ev('__export.report(__export.O())'),d=new JSDOM(rep).window.document;
 T('report: figure comes first and holds the 3D image',d.querySelector('h2').textContent.includes('Robot pose')&&!!d.querySelector('figure img[src^="data:image/png"]'));
 ev("__mode='blank'");const rep2=ev('__export.report(__export.O())');T('report: clear note instead of a blank box when capture fails',/3D image unavailable/.test(rep2)&&!/<img src="data:image\/png/.test(rep2));
 T('report: robot shown by its proper name',/Stanford arm RRPRRR/.test(rep));
 T('report: derivation blocks use T sup/sub, units and do not split across pages',d.querySelectorAll('.blk').length>=7&&/<sup>0<\/sup>T<sub>1<\/sub>/.test(rep)&&/Tx\(0\.000 mm\)/.test(rep));
 T('report: footer link is short anchor text (no overflowing URL)',/Open this exact robot/.test(rep)&&!/>https?:\/\/[^<]*#s=/.test(rep)&&!/>file:\/\//.test(rep));
 T('report: print colour + page-break CSS present',/print-color-adjust:exact/.test(ev('__export.doc(__export.O())'))&&/\.blk\{break-inside:avoid\}/.test(ev('__export.doc(__export.O())')));
 T('app version bumped to 2.0.1 and in the report footer',ev('APP_VERSION')==='2.0.1'&&/v2\.0\.1/.test(rep));
 // share link when the page is opened from disk (file://)
 const f=mk('file:///F:/store/crayon-robotics-lab/index.html');setTimeout(()=>{const su=f.eval('shareURL()');T('file:// pages produce a share link to the published site (works for anyone)',/^https:\/\/kanishkpatel0206\.github\.io\/crayon-robotics-lab\/#s=/.test(su),su.slice(0,60));
  console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,3):'none');process.exit(0)},400)},400);
