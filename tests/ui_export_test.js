const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs');const {execFileSync}=require('child_process');const errs=[];const vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errs.push(e.message.slice(0,200))});
const html=fs.readFileSync(__dirname+'/../index.html','utf8').replace(/<script src="https:[^>]*><\/script>/,'').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));
const ev=c=>w.eval(c),out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));
setTimeout(()=>{
 T('version label shows v2',/v2/.test(w.document.querySelector('.tag').textContent)&&ev('APP_VERSION')==='2.0.0');
 // navigation
 ev("document.querySelector('[data-page=\"export\"]').click()");T('Export page opens, others hide',!w.document.querySelector('#exportPage').classList.contains('hidden')&&w.document.querySelector('#workspacePage').classList.contains('hidden'));
 ev("document.querySelector('.navitem[data-page=\"library\"]').click()");T('leaving Export page hides it again',w.document.querySelector('#exportPage').classList.contains('hidden')&&!w.document.querySelector('#libraryPage').classList.contains('hidden'));
 // python reproduces the page FK for every robot (numerical round trip)
 let worst=0,n=0;const ids=ev('Object.keys(defaults)');
 for(const k of ids){ev(`setPreset('${k}');joints.forEach(j=>{const v=j.min+(j.max-j.min)*0.37;if(j.type==='R')j.theta=+v.toFixed(2);else j.d=+v.toFixed(2)})`);ev('renderAll()');
  const pg=ev('pos(calc().T)'),code=ev('__export.python()');fs.writeFileSync('/tmp/gen.py',code);
  const o=execFileSync('python3',['/tmp/gen.py']).toString(),m=(o.split('TCP =')[1].split('mm')[0].match(/-?\d+(?:\.\d*)?(?:e[-+]?\d+)?/gi)||[]).map(Number),m0=null;const py=m;worst=Math.max(worst,Math.hypot(...pg.map((v,i)=>v-py[i])));n++}
 T('generated Python reproduces the page FK on all '+n+' robots (mm)',worst<1e-3,worst.toExponential(1));
 // other text formats
 ev("setPreset('stanford')");const o=ev('__export.O()');
 const tex=ev('__export.latex(__export.O())');const cnt=(s,r)=>(s.match(r)||[]).length;
 T('LaTeX: bmatrix begin/end balanced, one per link + final',cnt(tex,/\\begin\{bmatrix\}/g)===cnt(tex,/\\end\{bmatrix\}/g)&&cnt(tex,/\\begin\{bmatrix\}/g)===7,cnt(tex,/\\begin\{bmatrix\}/g)+' matrices');
 T('LaTeX: braces balanced',cnt(tex,/\{/g)===cnt(tex,/\}/g));
 const md=ev('__export.markdown(__export.O())');T('Markdown: table has 6 joint rows',cnt(md,/^\| \d \|/gm)===6);
 const mat=ev('__export.matlab()');T('MATLAB: 6 Link() lines, prismatic present, modified flag',cnt(mat,/^L\(\d\) = Link\(/gm)===6&&/prismatic/.test(mat)&&cnt(mat,/'modified'/g)===6);
 // CSV
 const cm=ev('__export.CSV.matrices()').split('\n'),cj=ev('__export.CSV.jacobian()').split('\n'),cp=ev('__export.CSV.pose()').split('\n'),cd=ev('__export.CSV.dynamics()').split('\n');
 T('CSV matrices/jacobian/pose/dynamics shapes',cm.length===1+6+1&&cm[0].split(',').length===17&&cj.length===7&&cp.length===2&&cd.length===7,[cm.length,cj.length,cp.length,cd.length].join('/'));
 
 // report
 ev("setPreset('irb120')");const rep=ev('__export.doc(__export.O())');const d=new JSDOM(rep).window.document;
 T('report: valid HTML with title, DH table, 6 link matrices + final',!!d.querySelector('h1')&&d.querySelectorAll('table.m').length>=7&&/Modified DH parameters/.test(d.body.textContent));
 T('report: footer has share link, version and 30/30 self-tests',/v2\.0\.0/.test(d.body.textContent)&&/#s=/.test(d.body.innerHTML)&&/30\/30/.test(d.body.textContent));
 const F=(v)=>v.toFixed(3);const P=ev('pos(calc().T)');T('report: final tool position printed correctly',d.body.textContent.includes('X = '+F(P[0])+' mm'));
 ev("document.querySelector('[data-page=\"trajectory\"]').click();document.querySelector('#trajGenerate')&&document.querySelector('#trajGenerate').click()");
 const rep2=ev('(()=>{const o=__export.O();o.s.traj=true;return __export.report(o)})()');T('report: trajectory section present after generating one',ev('trajData.length')>10&&/Joint trajectory/.test(rep2)&&/<img/.test(rep2)||ev('trajData.length')>10&&/Joint trajectory/.test(rep2),ev('trajData.length')+' samples');
 T('CSV trajectory has one row per sample',ev('__export.CSV.trajectory().split("\\n").length')===ev('trajData.length')+1);

 ev(`document.querySelector('[data-page="workspaceAnalysis"]').click();document.querySelector('#workspaceSamples').value='300';document.querySelector('#workspaceRun').click()`);
 const r4=ev(`(()=>{const o=__export.O();o.s.ws=true;return __export.report(o)})()`);T('report: workspace section present after sampling',/Workspace<\/h2>/.test(r4)&&/sampled poses/.test(r4));
 T('3D snapshot falls back to SVG when WebGL is unavailable',/^data:image\/svg/.test(ev('__export.snap3D()')||''));
 // section toggles
 ev("document.querySelector('#ex_table').checked=false;document.querySelector('#ex_deriv').checked=false");const r3=ev('__export.report(__export.O())');T('unticking sections removes them',!/Modified DH parameters/.test(r3)&&!/Worked derivation/.test(r3));
 // buttons wired: Word copy w/ stubbed ClipboardItem, downloads
 let items=[];w.ClipboardItem=function(o){this.o=o};Object.defineProperty(w.navigator,'clipboard',{value:{write:i=>{items=i;return Promise.resolve()},writeText:()=>Promise.resolve()},configurable:true});
 ev("document.querySelector('#exWord').click()");T('Copy for Word puts HTML + text on the clipboard',items.length===1&&'text/html' in items[0].o&&'text/plain' in items[0].o);
 const dl=[];w.URL.createObjectURL=b=>{dl.push(b);return 'blob:x'};w.URL.revokeObjectURL=()=>{};w.HTMLAnchorElement.prototype.click=function(){};
 ['latex','markdown','matlab','python'].forEach(k=>ev(`document.querySelector('[data-ex="${k}"]').click()`));['matrices','jacobian','pose','dynamics'].forEach(k=>ev(`document.querySelector('[data-csv="${k}"]').click()`));ev("document.querySelector('#exDl').click()");
 T('all 9 download buttons produce a file',dl.length===9,dl.length);
 console.log(out.join('\n'));console.log('JS errors:',errs.length?errs.slice(0,3):'none');process.exit(0)},400);
