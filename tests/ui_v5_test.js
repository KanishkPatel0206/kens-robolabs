// v5 "Professional Credibility" checks: premade 3D models, URDF interop, validation.
//
// Two layers, mirroring how the feature is built:
//   1. engine/v5.js + the committed assets/robots/*.urdf files, in plain Node;
//   2. engine/v5.js + assets/v5.js loaded into the real page under jsdom, to
//      exercise the model loader, the export path and the Professional page.
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const RL=require(path.join(root,'engine','core.js')),RL5=require(path.join(root,'engine','v5.js'));
const out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));
// smallest signed angle difference in degrees (handles -180/+180)
const ang=(a,b)=>{const d=(a-b)*Math.PI/180;return Math.abs(Math.atan2(Math.sin(d),Math.cos(d)))*180/Math.PI;};

/* ======================================================================
   1. engine/v5.js — the premade catalogue and URDF interop (no DOM)
   ====================================================================== */
const models=RL5.MODELS;
T('v5 engine exposes six premade models',models.length===6,models.map(m=>m.id).join(', '));
T('every premade model mirrors a named library preset',models.every(m=>typeof m.preset==='string'&&m.preset.length>0&&m.dof===m.joints.length),models.map(m=>m.id+'->'+m.preset+' ('+m.dof+'R)').join(', '));

const st=RL5.selfTests();
T('v5 engine self-tests all pass',st.length>=15&&st.every(t=>t.pass),st.filter(t=>t.pass).length+'/'+st.length+(st.some(t=>!t.pass)?' fail: '+st.filter(t=>!t.pass).map(t=>t.name).join('; '):''));

// every shipped URDF exists, re-imports cleanly and reproduces its model exactly
// (the only acceptable warning is the informational one for a nonzero tool frame)
const EXPECTED_WARNING=/^trailing fixed joint ".*" was read as the tool frame\.$/;
let shipBad=[],shipOk=[];
for(const m of models){
  const rel='assets/robots/'+m.id+'.urdf';
  if(!fs.existsSync(path.join(root,rel))){shipBad.push(m.id+' (file missing)');continue;}
  const back=RL5.urdfToRobot(RL5.parseURDF(rd(rel)),{convention:'mdh'});
  const ref=RL5.modelToRobot(m);
  const badWarn=(back.warnings||[]).filter(x=>!EXPECTED_WARNING.test(x));
  if(!back.ok||back.robot.joints.length!==ref.joints.length||badWarn.length){
    shipBad.push(m.id+' (import: '+((back.errors||[])[0]||badWarn[0]||'joint mismatch')+')');continue;
  }
  let worst=0,where='';
  back.robot.joints.forEach((j,i)=>{
    ['a','d'].forEach(k=>{const dv=Math.abs((j[k]||0)-(ref.joints[i][k]||0));if(dv>worst){worst=dv;where='j'+(i+1)+' '+k;}});
    ['alpha','theta'].forEach(k=>{const dv=ang(j[k]||0,ref.joints[i][k]||0);if(dv>worst){worst=dv;where='j'+(i+1)+' '+k;}});
    ['qmin','qmax'].forEach(k=>{const dv=Math.abs((j[k]||0)-(ref.joints[i][k]||0));if(dv>worst){worst=dv;where='j'+(i+1)+' '+k;}});
  });
  const bt=back.robot.tool||[0,0,0],rt=ref.tool||[0,0,0];   // tool is omitted when it is zero
  for(let k=0;k<3;k++){const dv=Math.abs((bt[k]||0)-(rt[k]||0));if(dv>worst){worst=dv;where='tool['+k+']';}}
  let fk=0;
  for(let s=0;s<8;s++){const q=ref.joints.map((_,i)=>0.3*Math.sin(s+i));fk=Math.max(fk,RL.maxAbsDiff(RL.fk(back.robot,q).T,RL.fk(ref,q).T));}
  if(worst>1e-9||fk>1e-12)shipBad.push(m.id+' (Δ '+worst.toExponential(1)+' @'+where+', ΔFK '+fk.toExponential(1)+')');
  shipOk.push(m.id+':'+(worst===0?'exact':'ε'+worst.toExponential(0)));
}
T('all six shipped URDFs re-import to their model exactly (params + FK, no unexpected warnings)',shipBad.length===0,shipBad.join('; ')||shipOk.join(' '));

// the generator reproduces the committed artefact -> single source of truth.
// Line endings are normalised: a git checkout with core.autocrlf=true rewrites
// them, and that must not be mistaken for a content difference.
const nl=s=>s.replace(/\r\n/g,'\n');
const byteBad=models.filter(m=>nl(RL5.urdfFor(m))!==nl(rd('assets/robots/'+m.id+'.urdf')));
T('URDF export reproduces the committed assets/robots file (byte-identical modulo line endings)',byteBad.length===0,byteBad.join(', ')||models.length+'/'+models.length+' identical');

// trajectory v2: reaches both ends at rest and stays inside the limits
{
  const qf=[0.8,-0.6,1.0,-0.4,0.7,-0.9],r=RL5.modelToRobot(models[0]);
  const tr=RL5.jointTrajectoryV2(r,r.joints.map(()=>0),qf,{profile:'s-curve',dt:0.002,vmax:r.joints.map(()=>2),amax:r.joints.map(()=>8)});
  const last=tr.q.length-1;
  const ends=Math.max(...tr.q[0].map(Math.abs),...tr.q[last].map((v,i)=>Math.abs(v-qf[i])));
  T('S-curve trajectory v2 reaches both ends at rest inside the limits',tr.q.length>50&&ends<1e-9&&tr.checks.ok,'endpoint error '+ends.toExponential(1)+', '+tr.q.length+' samples, '+tr.checks.messages.length+' limit report(s)');
}

// workspace metrics separate reachable and dexterous sets
{
  const w=RL5.workspaceMetrics(RL5.modelToRobot(models[0]),{samples:150});
  T('workspace metrics separate reachable and dexterous poses',w.reachable.length>50&&Array.isArray(w.dexterous)&&typeof w.dexterityAvailable==='boolean','reachable '+w.reachable.length+', dexterous '+w.dexterous.length+', available '+w.dexterityAvailable);
}

// redundancy: secondary motion moves the joints without moving the tool
{
  const r=RL5.modelToRobot(models[3]),q=r.joints.map((_,i)=>0.3*Math.sin(i+1));   // a generic (non-singular) pose
  const step=RL5.nullSpaceStep(r,q,[0,0,0,0,0,0],r.joints.map((_,i)=>(i%2?1:-1)*0.05),{lambda:1e-4});
  const drift=Math.hypot(...[0,1,2].map(k=>step.J[k].reduce((s,v,i)=>s+v*step.dq[i],0)));
  const moved=Math.hypot(...step.projected);
  T('null-space secondary motion moves the joints without moving the tool',drift<1e-3&&moved>1e-9,'TCP drift '+drift.toExponential(2)+' m, |Δq| '+moved.toExponential(2));
}

/* ======================================================================
   2. assets/v5.js — the layer, in the real page under jsdom
   ====================================================================== */
T('v5 release assets are present',['engine/v5.js','assets/v5.js','assets/v5.css'].every(f=>fs.existsSync(path.join(root,f)))&&models.every(m=>fs.existsSync(path.join(root,'assets','robots',m.id+'.urdf'))));
T('index.html loads the v5 style and scripts',/<link[^>]+assets\/v5\.css/.test(rd('index.html'))&&/<script src="engine\/v5\.js">/.test(rd('index.html'))&&/<script src="assets\/v5\.js">/.test(rd('index.html')));

const three=rd('vendor/three.min.js');
const errs=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errs.push(e.message.slice(0,200))});
const html=rd('index.html').replace(/<script src="https:[^>]*><\/script>/,'').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};
w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));

setTimeout(()=>{
  const ev=c=>w.eval(c),d=w.document;
  try{
    // The page's init3D() cannot create a WebGL renderer in jsdom, so build the
    // same scene objects the page would; the v5 model renderer only needs them.
    ev(three);
    ev("scene3d=new THREE.Scene();scene3d.add(new THREE.GridHelper(2000,40));robotGroup3d=new THREE.Group();frameGroup3d=new THREE.Group();scene3d.add(robotGroup3d);scene3d.add(frameGroup3d);renderer3d={}");
    w.eval(rd('engine/v5.js'));
    w.eval(rd('assets/v5.js'));

    const UI=w.RL5UI;
    T('assets/v5.js installs the professional layer and exposes RL5UI',!!UI&&UI.version==='5.0.0',UI?('version '+UI.version):'RL5UI missing');

    T('the Professional page builds all nine panels',d.querySelectorAll('#proBody .v5-panel').length===9,d.querySelectorAll('#proBody .v5-panel').length+' panels');
    const bad=d.querySelectorAll('#proBody .v5-badge.bad'),all=d.querySelectorAll('#proBody .v5-badge');
    T('the in-browser validation harness reports no failures',all.length>40&&bad.length===0,bad.length+' FAIL of '+all.length+' badges');
    const groups={};Array.prototype.forEach.call(d.querySelectorAll('#proBody .v5-cap'),c=>{const k=c.textContent.trim();groups[k]=(groups[k]||0)+1;});
    T('validation covers core, v5, page<->engine parity and the model/preset match',!!groups.core&&!!groups.v5&&groups.parity===1&&groups.library===models.length,Object.keys(groups).map(k=>k+':'+groups[k]).join(' '));

    // The library offers BOTH forms for every model (link/skeleton + 3D model),
    // and the matched teaching robot is still loadable by its own preset key.
    const lib=document.querySelectorAll('#libraryPage [data-v5-load]');
    const missing=[];
    if(UI){
      for(const m of models){
        const sel=mode=>d.querySelectorAll('#libraryPage [data-v5-load="'+m.id+'"][data-v5-mode="'+mode+'"]').length;
        if(!sel('link'))missing.push(m.id+' link');
        if(!sel('model'))missing.push(m.id+' model');
        if(!d.querySelector('#libraryPage [data-lib="'+m.preset+'"]'))missing.push(m.id+' preset');
      }
    }
    T('every premade model offers both load forms in the library',missing.length===0,missing.join(', ')||lib.length+' load buttons, 6 presets kept');

    // The 3D-model view really produces detailed geometry, and the link view is
    // still there as the fallback — for every model.
    let meshBad=[],meshOk=[];
    for(const m of models){
      let modelMode=0,linkMode=0;
      try{
        UI.loadModel(m.id,'model');
        modelMode=ev('robotGroup3d.children.length');
        UI.loadModel(m.id,'link');
        linkMode=ev('robotGroup3d.children.length');
      }catch(e){meshBad.push(m.id+' threw '+e.message);continue;}
      if(!(modelMode>=30&&modelMode<=250&&linkMode>=5&&modelMode>linkMode))meshBad.push(m.id+' model '+modelMode+' vs link '+linkMode);
      meshOk.push(m.id+':'+modelMode+'/'+linkMode);
    }
    T('the 3D-model view builds detailed geometry and the link view still works',meshBad.length===0,meshBad.join('; ')||meshOk.join(' '));

    // Export/re-import through the real UI: same params as the preset, and the
    // file re-imports into the pose on screen.
    let rtBad=[],rtOk=[];
    for(const m of models){
      UI.loadModel(m.id,'model');
      const xml=UI.exportURDF();
      const back=RL5.urdfToRobot(RL5.parseURDF(xml),{convention:'mdh'});
      const ref=UI.presetRobot(m.preset);
      if(!back.ok||!ref){rtBad.push(m.id+' (import/preset)');continue;}
      let worst=0;
      back.robot.joints.forEach((j,i)=>{
        ['a','d'].forEach(k=>{worst=Math.max(worst,Math.abs((j[k]||0)-(ref.joints[i][k]||0)));});
        ['alpha','theta'].forEach(k=>{worst=Math.max(worst,ang(j[k]||0,ref.joints[i][k]||0));});
      });
      const bt=back.robot.tool||[0,0,0],rt=ref.tool||[0,0,0];   // tool is omitted when it is zero
      for(let k=0;k<3;k++)worst=Math.max(worst,Math.abs((bt[k]||0)-(rt[k]||0)));
      const onScreen=RL.maxAbsDiff(RL.fk(UI.pageToRL(),UI.pageQ()).T,RL.fk(back.robot,back.robot.joints.map(()=>0)).T);
      if(worst>1e-9||onScreen>1e-12)rtBad.push(m.id+' (Δ '+worst.toExponential(1)+', pose '+onScreen.toExponential(1)+')');
      rtOk.push(m.id);
    }
    T('the UI export matches the library preset and re-imports into the on-screen pose',rtBad.length===0,rtBad.join('; ')||rtOk.join(', '));

    // Per-model invariants: nonzero tool frames and estimated (not placeholder) inertias.
    const toolBad=[];
    for(const m of models){
      UI.loadModel(m.id,'link');
      const r=UI.pageToRL(),t=[m.tool?m.tool[0]:0,m.tool?m.tool[1]:0];
      if(Math.abs(r.tool[0]-t[0]/1000)>1e-12||Math.abs(r.tool[2]-t[1]/1000)>1e-12)toolBad.push(m.id+' tool');
      if(!r.joints[0].inertia||Math.abs(r.joints[0].inertia[0]-0.01)<1e-9)toolBad.push(m.id+' inertia');
    }
    T('loading a model sets its tool frame and estimated link inertias',toolBad.length===0,toolBad.join(', ')||'tools + inertias ok');
  }catch(e){
    T('assets/v5.js runs in the page without throwing',false,String(e&&e.message||e));
  }
  console.log(out.join('\n'));
  console.log('JS errors:',errs.length?errs.slice(0,3):'none');
  process.exit(out.some(x=>x.startsWith('FAIL'))?1:0);
},600);
