// v3 "Trust & Polish" checks: outcomes, checklist, sanitising, release hygiene.
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const errs=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errs.push(e.message.slice(0,160))});
const html=rd('index.html').replace(/<script src="https:[^>]*><\/script>/,'').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/#'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};
const out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));
setTimeout(()=>{
  const d=w.document,ids=['workspace','library','pro','frames','fk','ik','learn','jacobian','trajectory','workspaceAnalysis','dynamics','export'].map(x=>x+'Page');
  const missing=ids.filter(id=>!d.querySelector('#'+id+' .v3-outcome'));
  T('A3.3 every one of the 12 pages states a learning outcome',missing.length===0,missing.join(','));
  T('A3.3 outcomes are added once (idempotent)',d.querySelectorAll('.v3-outcome').length===12);
  const cl=d.querySelector('#learnPage #v3FrameChecklist');
  T('A3.4 frame-assignment checklist is in the Learning Center',!!cl);
  T('A3.4 checklist has 8 tickable, labelled steps',!!cl&&cl.querySelectorAll('input[type=checkbox][aria-label]').length===8);
  T('A3.4 checklist has a print button',!!d.querySelector('#v3PrintCheck'));
  T('E3.1 joint-name markup is never rendered as HTML',(()=>{w.eval("setPreset('ur5');joints[0].name='<img src=x onerror=window.__x=1>';renderAll()");return !w.__x&&!d.querySelector('img[src="x"]')})());
  T('A3.1 version is consistent (UI, package.json, changelog, README)',w.APP_VERSION==='6.0.0'&&JSON.parse(rd('package.json')).version==='6.0.0'&&/\[6\.0\.0\]/.test(rd('CHANGELOG.md'))&&/v6\.0/.test(rd('README.md')));
  T('E3.7 static release assets exist',['favicon.svg','site.webmanifest','404.html','robots.txt','sitemap.xml','assets/v3.css'].every(f=>fs.existsSync(path.join(root,f))));
  T('E3.7 manifest icons all resolve',JSON.parse(rd('site.webmanifest')).icons.every(i=>fs.existsSync(path.join(root,i.src))));
  T('E3.8 LICENSE names the author (no placeholder)',/Kanishk Patel/.test(rd('LICENSE'))&&!/<YOUR NAME>/.test(rd('LICENSE')));
  T('E3.8 no duplicate files in repo root',!fs.existsSync(path.join(root,'robot-stanford (1).png')));
  T('D3 accessibility hooks present (skip link, aria-current, reduced motion)',/skip/i.test(html)&&/aria-current/.test(html)&&/prefers-reduced-motion/.test(rd('assets/v3.css')));
  console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,3):'none');process.exit(out.some(x=>x.startsWith('FAIL'))?1:0);
},500);
