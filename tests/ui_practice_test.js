// v6 "Practice Modules" checks: the Learning Center as self-study modules.
//
// Two layers, mirroring how the feature is built:
//   1. engine/practice.js + the committed assets/figures/*.svg, in plain Node;
//   2. engine/practice.js + assets/practice.js loaded into the real page under
//      jsdom, to exercise the navigator, the quiz and the progress store.
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const RL=require(path.join(root,'engine','core.js')),P=require(path.join(root,'engine','practice.js'));
const out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));

/* ======================================================================
   1. engine/practice.js — the catalogue, generation and verification (no DOM)
   ====================================================================== */
const IDS=['mdh-parameters','transform-order','forward-kinematics','inverse-kinematics','jacobian','trajectory','workspace','dynamics'];
T('practice engine reports version 6.0.0',P.VERSION==='6.0.0',P.VERSION);
T('eight practice modules, in order',P.MODULES.length===8&&IDS.every((id,i)=>P.MODULES[i].id===id),P.MODULES.map(m=>m.id).join(', '));
T('every module has documentation, figures and a quiz builder',
  P.MODULES.every(m=>m.doc.length>=3&&m.figures.length>=1&&typeof m.makeQuiz==='function'&&typeof m.verify==='function'));

// generation is deterministic from its seed
{
  const a=JSON.stringify(P.generate('forward-kinematics',7,8).map(q=>q.kind==='num'?q.answer:q.answerIndex));
  const b=JSON.stringify(P.generate('forward-kinematics',7,8).map(q=>q.kind==='num'?q.answer:q.answerIndex));
  const c=JSON.stringify(P.generate('forward-kinematics',8,8).map(q=>q.kind==='num'?q.answer:q.answerIndex));
  T('quiz generation is deterministic for a seed (and varies with it)',a===b&&a!==c);
}

// every generated question is well-formed
{
  let n=0,bad='';
  for(const m of P.MODULES)for(let seed=1;seed<=6&&!bad;seed++){
    for(const q of P.generate(m.id,seed,8)){
      n++;
      if(!q.prompt||!q.solution){bad=m.id+' q'+n+' missing prompt/solution';break;}
      if(q.kind==='num'){if(typeof q.answer!=='number'||!isFinite(q.answer)||!(q.tol>=0)){bad=m.id+' q'+n+' bad numeric answer';break;}}
      else if(q.kind==='mc'){if(!Array.isArray(q.choices)||q.choices.length<2||!(q.answerIndex>=0&&q.answerIndex<q.choices.length)){bad=m.id+' q'+n+' bad choices';break;}}
      else{bad=m.id+' q'+n+' unknown kind '+q.kind;break;}
    }
  }
  T('all 384 generated questions are well-formed',!bad,bad||n+' questions across 8 modules x 6 seeds');
}

// every published answer passes the module's independent re-derivation
{
  let bad='';
  for(const m of P.MODULES)for(let seed=1;seed<=6&&!bad;seed++){
    for(const q of P.generate(m.id,seed,8))if(!m.verify(q)){bad=m.id+' seed '+seed+' failed verify';break;}
  }
  T('every published answer is independently re-derived',!bad,bad||'all modules verified');
}

// the engine's own self-test report
{
  const st=P.selfTests();
  const fails=st.filter(t=>!t.pass);
  T('engine self-tests pass ('+st.length+')',fails.length===0,fails.map(f=>f.name).join('; ')||'13/13');
}

// cross-check: FK answers equal RL.fk to machine precision
{
  let worst=0;
  for(let seed=1;seed<=5;seed++)for(const q of P.generate('forward-kinematics',seed,8)){
    if(q.kind!=='num')continue;
    const s=q.ctx,p=RL.Pof(RL.fk(s.robot,s.q).T).map(v=>v*1000);
    const want=/distance/.test(q.prompt)?Math.hypot(p[0],p[1]):(/y-coordinate/.test(q.prompt)?p[1]:p[0]);
    worst=Math.max(worst,Math.abs(want-q.answer));
  }
  T('FK practice answers equal RL.fk to machine precision',worst<1e-9,'max |error| = '+worst.toExponential(1)+' mm');
}

// cross-check: IK answers reproduce their target through FK
{
  let worst=0,n=0,bad='';
  for(let seed=1;seed<=5;seed++)for(const q of P.generate('inverse-kinematics',seed,8)){
    if(q.kind!=='num')continue;
    const s=q.ctx,n2=Math.hypot(s.x,s.y)**2;
    const c2=(n2-s.L1*s.L1-s.L2*s.L2)/(2*s.L1*s.L2);
    const absT2=Math.acos(Math.max(-1,Math.min(1,c2)))*180/Math.PI;
    n++;
    if(/θ<sub>1<\/sub>/.test(q.prompt)){
      const p=RL.Pof(RL.fk(s.robot,[q.answer*Math.PI/180,-absT2*Math.PI/180]).T).map(v=>v*1000);
      worst=Math.max(worst,Math.hypot(p[0]-s.x,p[1]-s.y));
    }else{
      worst=Math.max(worst,Math.abs(absT2-q.answer));
    }
  }
  T('IK practice answers reproduce their target through FK',worst<1e-6&&n>0,'max |error| = '+worst.toExponential(1)+(n?' ('+n+' questions)':''));
}

// cross-check: Jacobian determinant equals L1 L2 sin q2
{
  let worst=0;
  for(let seed=1;seed<=5;seed++)for(const q of P.generate('jacobian',seed,8)){
    if(q.kind!=='num'||!/determinant/.test(q.prompt))continue;
    const s=q.ctx,closed=Math.abs(s.L1*s.L2*Math.sin(s.q2*Math.PI/180));
    worst=Math.max(worst,Math.abs(closed-q.answer));
  }
  T('Jacobian determinants equal L1·L2·|sin q2|',worst<1e-6,'max |error| = '+worst.toExponential(1)+' mm2');
}

// cross-check: trajectory peak velocities equal 1.5 / 1.875 dq / T
{
  let worst=0;
  for(let seed=1;seed<=5;seed++)for(const q of P.generate('trajectory',seed,8)){
    if(q.kind!=='num')continue;
    const s=q.ctx,k=/quintic/i.test(q.prompt)?1.875:1.5;
    worst=Math.max(worst,Math.abs(k*s.dq/s.T-q.answer));
  }
  T('trajectory peak velocities equal 1.5/1.875 Δq/T',worst<1e-9,'max |error| = '+worst.toExponential(1)+' °/s');
}

// figures: every module's figures exist on disk and contain no NaN
{
  const figBad=[];
  const seen=new Set();
  for(const m of P.allModules())for(const f of m.figures){
    if(!/^assets\/figures\/[a-z0-9-]+\.svg$/.test(f.src)){figBad.push(m.id+' bad src '+f.src);continue;}
    const abs=path.join(root,f.src);
    if(!fs.existsSync(abs)){figBad.push(m.id+' missing '+f.src);continue;}
    if(/NaN|undefined|Infinity/.test(fs.readFileSync(abs,'utf8'))){figBad.push(m.id+' NaN in '+f.src);continue;}
    seen.add(f.src);
  }
  T('every module ships generated figures that exist and are numeric',figBad.length===0,figBad.join('; ')||seen.size+' distinct figures referenced');
}

// the page wires the practice layer in
T('index.html loads the practice style and scripts',
  /<link[^>]+assets\/practice\.css/.test(rd('index.html'))&&/<script src="engine\/practice\.js">/.test(rd('index.html'))&&/<script src="assets\/practice\.js">/.test(rd('index.html')));
T('the Learning Center mounts the practice modules and keeps its hero + checklist',
  /<section id="learnPage"/.test(rd('index.html'))&&/<div id="practiceModules"><\/div>/.test(rd('index.html')));
T('the legacy FK drill gained a Show solution affordance',
  /id="qSolution"/.test(rd('index.html'))&&/id="qSol"/.test(rd('index.html')));

/* ======================================================================
   2. assets/practice.js — the layer, in the real page under jsdom
   ====================================================================== */
const errs=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errs.push(e.message.slice(0,200))});
const html=rd('index.html').replace(/<script src="https:[^>]*><\/script>/,'').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};
w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));

setTimeout(()=>{
  const ev=c=>w.eval(c),d=w.document;
  try{
    w.eval(rd('engine/practice.js'));
    w.eval(rd('assets/practice.js'));
    const UI=w.PRACTICEUI;

    T('assets/practice.js installs the practice layer and exposes PRACTICEUI',!!UI&&UI.version==='6.0.0'&&UI.moduleCount===8,UI?('version '+UI.version+', '+UI.moduleCount+' modules'):'PRACTICEUI missing');

    // navigator
    const nav=d.querySelectorAll('#prNavList .pr-navbtn');
    T('the navigator lists all eight modules',nav.length===8,d.querySelectorAll('#prNavList li').length+' items');
    T('the first module is selected and its title is shown',!!d.querySelector('#prTitle').textContent&&d.querySelector('#prNavList .pr-navbtn.active')===nav[0],d.querySelector('#prTitle').textContent);

    // documentation + figures for the active module
    T('the active module renders reference documentation',d.querySelectorAll('#prDoc h3').length>=2&&d.querySelectorAll('#prDoc p, #prDoc .pr-eq, #prDoc ul').length>=2);
    const figs=d.querySelectorAll('#prFigures .pr-fig img');
    T('the active module renders its figures with captions',figs.length>=1&&d.querySelectorAll('#prFigures .pr-fig figcaption').length===figs.length,figs.length+' figure(s)');
    T('figure sources point at committed SVGs',Array.prototype.every.call(figs,im=>/^assets\/figures\/.+\.svg$/.test(im.getAttribute('src'))));

    // the quiz
    T('the quiz has eight questions',d.querySelectorAll('#prQuiz .pr-q').length===8);
    T('numeric questions offer an input, choice questions offer options',
      d.querySelectorAll('#prQuiz .pr-in').length+d.querySelectorAll('#prQuiz .pr-choices').length===8);

    // answer the first question wrong, then right
    const q0=ev('PRACTICEUI.questions()[0].q');
    if(q0.kind==='num'){
      const off=q0.answer+ (Math.abs(q0.answer)*0.5+10);
      ev(`(()=>{const n=document.querySelector('.pr-q[data-i="0"] .pr-in');n.value=${JSON.stringify(String(off))}})()`);
      d.querySelector('.pr-q[data-i="0"] .pr-check').click();
      T('a wrong numeric answer is marked incorrect',ev(`document.querySelector('.pr-q[data-i="0"]').classList.contains('bad')`)===true);
      ev(`(()=>{const n=document.querySelector('.pr-q[data-i="0"] .pr-in');n.value=${JSON.stringify(String(q0.answer))}})()`);
      d.querySelector('.pr-q[data-i="0"] .pr-check').click();
      T('the correct numeric answer is accepted',ev(`document.querySelector('.pr-q[data-i="0"]').classList.contains('ok')`)===true);
    }else{
      // choose a wrong option, then the right one
      const wrongK=(q0.answerIndex+1)%q0.choices.length;
      d.querySelector(`.pr-q[data-i="0"] .pr-choice[data-k="${wrongK}"]`).click();
      d.querySelector('.pr-q[data-i="0"] .pr-check').click();
      T('a wrong choice is marked incorrect',ev(`document.querySelector('.pr-q[data-i="0"]').classList.contains('bad')`)===true);
      d.querySelector(`.pr-q[data-i="0"] .pr-choice[data-k="${q0.answerIndex}"]`).click();
      d.querySelector('.pr-q[data-i="0"] .pr-check').click();
      T('the correct choice is accepted',ev(`document.querySelector('.pr-q[data-i="0"]').classList.contains('ok')`)===true);
    }

    // show / hide solution
    d.querySelector('.pr-q[data-i="0"] .pr-show').click();
    const shown=ev(`!document.querySelector('.pr-q[data-i="0"] .pr-solution').classList.contains('hidden')`);
    T('Show solution reveals the worked solution',shown===true);
    T('the revealed solution contains the working',d.querySelector('.pr-q[data-i="0"] .pr-solution').textContent.trim().length>20);
    d.querySelector('.pr-q[data-i="0"] .pr-show').click();
    const hidden=ev(`document.querySelector('.pr-q[data-i="0"] .pr-solution').classList.contains('hidden')`);
    T('the solution can be hidden again',hidden===true);

    // scoring + progress persistence
    T('the first attempt is counted once in the score',/1 \/ 1/.test(d.querySelector('#prScore').textContent),d.querySelector('#prScore').textContent);
    const prog=JSON.parse(w.localStorage.getItem('robolabs-practice-progress'));
    T('progress is persisted to localStorage (seen and correct)',
      !!prog&&prog.modules&&prog.modules['mdh-parameters']&&prog.modules['mdh-parameters'].seen===1&&prog.modules['mdh-parameters'].correct===1,
      JSON.stringify(prog&&prog.modules));

    // answer every question and confirm a perfect module score
    ev(`PRACTICEUI.questions().forEach((it,i)=>{const n=document.querySelector('.pr-q[data-i="'+i+'"]');if(it.q.kind==='num'){n.querySelector('.pr-in').value=String(it.q.answer);}else{n.querySelector('.pr-choice[data-k="'+it.q.answerIndex+'"]').click();}n.querySelector('.pr-check').click();})`);
    T('answering every question correctly scores the whole module',/8 \/ 8/.test(d.querySelector('#prScore').textContent),d.querySelector('#prScore').textContent);

    // switching modules
    d.querySelectorAll('#prNavList .pr-navbtn')[4].click();
    T('selecting a module swaps the title, reference and quiz',
      ev('PRACTICEUI.activeModule()')==='jacobian'&&/Jacobian/.test(d.querySelector('#prTitle').textContent)&&d.querySelectorAll('#prQuiz .pr-q').length===8,
      d.querySelector('#prTitle').textContent);
    T('module progress shows in the navigator',/8 \/ 8/.test(d.querySelector('#prNavList .pr-navbtn').textContent),d.querySelector('#prNavList .pr-navbtn .pr-navscore').textContent);

    // New questions rerolls the quiz (new seed -> new values)
    const before=ev('JSON.stringify(PRACTICEUI.questions().map(q=>q.q.answer))');
    d.querySelector('#prNewQuiz').click();
    const after=ev('JSON.stringify(PRACTICEUI.questions().map(q=>q.q.answer))');
    T('New questions regenerates the quiz',before!==after);

    // the legacy FK drill is untouched but gains the solution affordance
    T('the legacy FK drill keeps its ids and gains #qSolution/#qSol',
      !!d.querySelector('#quizPanel')&&!!d.querySelector('#qx')&&!!d.querySelector('#qy')&&!!d.querySelector('#qz')&&
      !!d.querySelector('#qCheck')&&!!d.querySelector('#qNext')&&!!d.querySelector('#qShow')&&!!d.querySelector('#quizScore')&&
      d.querySelectorAll('#qSolution').length===1&&d.querySelectorAll('#qSol').length===1);
    ev("document.querySelector('#qNext').click()");
    d.querySelector('#qSolution').click();
    T('the legacy Show solution prints the running frame origins',/tool frame/.test(d.querySelector('#qSol').textContent)&&/Running origin/.test(d.querySelector('#qSol').textContent));
  }catch(e){
    T('assets/practice.js runs in the page without throwing',false,String(e&&e.message||e));
  }
  console.log(out.join('\n'));
  console.log('JS errors:',errs.length?errs.slice(0,3):'none');
  process.exit(out.some(x=>x.startsWith('FAIL'))?1:0);
},600);
