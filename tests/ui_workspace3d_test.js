/* v6.1 — Workspace Analysis: interactive 3D reachable-volume view.
   Node pass: the page ships the 3D canvas and its fallbacks, drops the flat
   projection selector, and defines the 3D helpers.
   jsdom pass (three.js present, stubbed WebGL renderer): sampling builds a
   coloured Points cloud from the sampled TCP data, fits the camera and reveals
   the 3D canvas. jsdom pass (no three.js): the page degrades to the
   orthographic canvas instead of throwing. */
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const path=require('path');
const root=path.join(__dirname,'..');const rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));
const htmlSrc=rd('index.html'),three=rd('vendor/three.min.js');

/* ---------------- static wiring ---------------- */
T('index.html ships the 3D workspace canvas and both fallbacks',/id="workspace3d"/.test(htmlSrc)&&/id="ws3dFallback"/.test(htmlSrc)&&/id="ws2dFallback"/.test(htmlSrc)&&/id="workspacePlot"/.test(htmlSrc));
T('the flat projection selector is gone (3D replaces the 2D plot)',!/id="workspaceProjection"/.test(htmlSrc));
T('index.html defines the 3D workspace helpers',['initWorkspace3D','renderWorkspace3D','ws3dBuild','ws3dFit','ws3dTick','ws3dView','ws3dResize'].every(n=>new RegExp('function '+n+'\\b').test(htmlSrc)));
T('the 3D view controls are wired',/id="ws3dFit"/.test(htmlSrc)&&/data-ws3dview="iso"/.test(htmlSrc)&&/data-ws3dview="top"/.test(htmlSrc)&&/data-ws3dview="front"/.test(htmlSrc));
T('the sampler no longer reads the removed projection control unguarded',htmlSrc.includes("proj=($('#workspaceProjection')||{value:'xy'}).value"));
T('the 2D canvas is kept as the WebGL fallback and report figure',/id="ws2dFallback"[^>]*>\s*<h3[^>]*>[^<]*<\/h3>\s*<canvas id="workspacePlot"/.test(htmlSrc));

/* ---------------- jsdom harness ---------------- */
const mk=(withThree)=>{const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errs.push(e.message.slice(0,200))});
  const html=htmlSrc.replace(/<script src="https:[^>]*><\/script>/,'').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
  const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
  w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:(t,k)=>k==='measureText'?()=>({width:5}):()=>{},set:()=>true});
  w.scrollTo=()=>{};w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));
  if(withThree){w.eval(three);w.eval("THREE.WebGLRenderer=function(){this.setPixelRatio=function(){};this.setSize=function(){};this.render=function(){};this.domElement=document.createElement('canvas')}");}
  return {w,errs};
};

setTimeout(()=>{
  /* ------------- with three.js ------------- */
  {const {w,errs}=mk(true);const ev=c=>w.eval(c),d=w.document;
   T('the projection selector is really removed from the DOM',d.querySelector('#workspaceProjection')===null);
   d.querySelector('[data-page="workspaceAnalysis"]').click();
   d.querySelector('#workspaceSamples').value='300';
   d.querySelector('#workspaceRun').click();
   T('sampling produces 300 reachable TCP points',ev('workspaceData.length')===300,ev('workspaceData.length')+' pts');
   T('the 3D scene holds a coloured Points cloud of every sample',ev('!!ws3d&&!!ws3d.points')&&ev('ws3d.points.geometry.getAttribute("position").count')===300&&ev('ws3d.points.geometry.getAttribute("color").count')===300,ev('ws3d&&ws3d.points?ws3d.points.geometry.getAttribute("position").count:0')+' vertices');
   T('the cloud carries XYZ axes and a ground grid',ev('ws3d.axes.children.length')>=3&&ev('ws3d.grid&&ws3d.grid.type')==='GridHelper',ev('ws3d.axes.children.length')+' axis objects');
   T('the camera is fitted to the sampled bounds',Number.isFinite(ev('ws3dOrbit.r'))&&ev('ws3dOrbit.r')>0&&Math.abs(ev('ws3dOrbit.target[0]')-ev('ws3d.bounds.cx'))<1e-6,'r '+ev('ws3dOrbit.r.toFixed(1)')+' mm');
   T('the live-TCP marker is placed at the tool centre point',ev('!!ws3d.marker')&&Array.isArray(ev('ws3d.marker.position.toArray()'))&&ev('ws3d.marker.position.toArray()').every(Number.isFinite));
   T('the 3D canvas is shown and the 2D fallback stays hidden',d.querySelector('#workspace3d').style.display!=='none'&&d.querySelector('#ws2dFallback').style.display==='none');
   T('the 2D canvas is still drawn for the report figure',d.querySelector('#workspacePlot').width>0,d.querySelector('#workspacePlot').width+'px backing');
   d.querySelector('[data-ws3dview="top"]').click();
   T('the Top view button sets a near-vertical camera',Math.abs(ev('ws3dOrbit.phi')-0.06)<1e-6,'phi '+ev('ws3dOrbit.phi'));
   d.querySelector('#ws3dFit').click();
   T('Fit 3D re-centres on the sampled bounds',Math.abs(ev('ws3dOrbit.target[0]')-ev('ws3d.bounds.cx'))<1e-6);
   T('the summary still reports the sampled bounds',/Sampled 300 configurations/.test(d.querySelector('#workspaceSummary').textContent));
   T('no JS errors while building the 3D view',errs.length===0,errs.slice(0,2).join(' | '));
  }

  /* ------------- without three.js: graceful fallback ------------- */
  {const {w,errs}=mk(false);const ev=c=>w.eval(c),d=w.document;
   d.querySelector('[data-page="workspaceAnalysis"]').click();
   d.querySelector('#workspaceSamples').value='300';
   d.querySelector('#workspaceRun').click();
   T('without three.js initWorkspace3D reports unavailable',ev('initWorkspace3D()')===false);
   T('without three.js the 3D canvas hides and both notes show',d.querySelector('#workspace3d').style.display==='none'&&d.querySelector('#ws3dFallback').style.display==='block'&&d.querySelector('#ws2dFallback').style.display==='block');
   T('without three.js the orthographic canvas still renders',d.querySelector('#workspacePlot').width>0,d.querySelector('#workspacePlot').width+'px backing');
   T('without three.js the summary is still written',/Sampled 300 configurations/.test(d.querySelector('#workspaceSummary').textContent));
   T('without three.js there are no JS errors',errs.length===0,errs.slice(0,2).join(' | '));
  }

  console.log(out.join('\n'));
  console.log('JS errors: none');
  process.exit(out.filter(l=>l.startsWith('FAIL')).length?1:0);
},900);
