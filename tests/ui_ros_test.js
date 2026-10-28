// v6.2 "ROS 2 Lab" checks: the in-browser ROS 2 simulation.
//
// Three layers, mirroring how the feature is built:
//   1. engine/ros.js  (ROS2) — middleware, CLI and graded tasks, plain Node;
//   2. engine/pysub.js (PY)  — the rclpy-subset interpreter, plain Node;
//   3. the real page under jsdom, with engine + assets/ros.js mounted, to
//      exercise the terminal, the playground, the arm bridge and the tasks.
const {JSDOM,VirtualConsole}=require('jsdom');const fs=require('fs'),path=require('path');
const root=path.join(__dirname,'..'),rd=f=>fs.readFileSync(path.join(root,f),'utf8');
const ROS2=require(path.join(root,'engine','ros.js')),PY=require(path.join(root,'engine','pysub.js'));
const out=[],T=(n,ok,d='')=>out.push((ok?'PASS ':'FAIL ')+n+(d!==''?'  '+d:''));

/* ======================================================================
   1. engine/ros.js — middleware, QoS, CLI, tasks (no DOM)
   ====================================================================== */
{
  const r=ROS2.selfTests();
  const bad=r.filter(t=>!t.pass);
  T('engine/ros.js self-tests all pass',bad.length===0,bad.map(t=>t.name).join('; '));
  T('engine/ros.js is version 6.2.0 and ships the six graded tasks',ROS2.VERSION==='6.2.0'&&ROS2.TASKS.length===6,ROS2.TASKS.map(t=>t.id).join(','));
  T('engine/ros.js ships the example catalogue and launch files',Object.keys(ROS2.EXAMPLES).length>=2&&!!ROS2.LAUNCH_FILES['demo.launch.py']&&!!ROS2.LAUNCH_FILES['arm.launch.py']);
  T('engine/ros.js exposes the message type catalogue',ROS2.hasType('std_msgs/String')&&ROS2.hasType('trajectory_msgs/JointTrajectory')&&ROS2.interfaceShow('std_msgs/String')==='string data');
}

/* ======================================================================
   2. engine/pysub.js — the rclpy-subset interpreter (no DOM)
   ====================================================================== */
{
  const r=PY.selfTests();
  const bad=r.filter(t=>!t.pass);
  T('engine/pysub.js self-tests all pass',bad.length===0,bad.map(t=>t.name+' → '+t.detail).join('; '));
  T('engine/pysub.js is version 6.2.0',PY.VERSION==='6.2.0');

  // a fresh script really drives a fresh graph
  const g=new ROS2.Graph();
  const res=PY.run("import rclpy\nfrom rclpy.node import Node\nfrom sensor_msgs.msg import JointState\nclass P(Node):\n    def __init__(self):\n        super().__init__('jsp')\n        self.pub = self.create_publisher(JointState, '/joint_states', 10)\n        m = JointState()\n        m.name = ['Joint 1', 'Joint 2']\n        m.position = [12.5, -3.0]\n        self.pub.publish(m)\nrclpy.init()\nP()\nrclpy.shutdown()\n",{graph:g});
  const t=g.topics.get('/joint_states');
  T('a Python JointState publish reaches the graph',res.ok&&t&&t.last.name.length===2&&t.last.position[0]===12.5,res.error||(t?JSON.stringify(t.last.position):'no topic'));

  // every graded task solution passes its own check, in a fresh graph
  let firstFail='';
  const allPass=ROS2.TASKS.every((task)=>{
    const gg=new ROS2.Graph();
    const r2=PY.run(task.solution,{graph:gg,spinSeconds:2.0});
    const ctx=ROS2.makeContext(gg);
    if(task.uses==='arm')ctx.arm=()=>({moved:true});
    const v=r2.ok?task.check(ctx):{ok:false,detail:'script error: '+r2.error};
    if(!v.ok){firstFail=task.id+': '+v.detail;return false;}
    return true;
  });
  T('every graded task solution passes its own engine check',allPass,firstFail);
}

/* ======================================================================
   3. static wiring in index.html
   ====================================================================== */
{
  const html=rd('index.html');
  T('the page has a dedicated ROS 2 Lab section and mount point',/<section id="rosPage" class="hidden">/.test(html)&&/<div id="rosLab"><\/div>/.test(html));
  T('the nav exposes a ROS 2 Lab entry',/data-page="ros"/.test(html)&&/<span class="navicon">◍<\/span>ROS 2 Lab/.test(html));
  T('assets/ros.css and the three scripts are linked',/assets\/ros\.css/.test(html)&&/<script src="engine\/ros\.js"><\/script>/.test(html)&&/<script src="engine\/pysub\.js"><\/script>/.test(html)&&/<script src="assets\/ros\.js"><\/script>/.test(html));
  T('the ROS 2 Lab is listed in the outcomes and the mobile sheet',/rosPage:/.test(html)&&/\['ros', '◍', 'ROS 2 Lab'\]/.test(html));
}

/* ======================================================================
   4. the layer, in the real page under jsdom
   ====================================================================== */
const errs=[],vc=new VirtualConsole();vc.on('jsdomError',e=>{if(!/Not implemented/.test(e.message))errs.push(e.message.slice(0,200))});
const html=rd('index.html').replace(/<script src="https:[^>]*><\/script>/,'').replace('<div class="toast" id="toast"></div>','<div class="toast" id="toast"></div><script>window.structuredClone=o=>JSON.parse(JSON.stringify(o))</script>');
const w=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,virtualConsole:vc,url:'http://localhost/'}).window;
w.HTMLCanvasElement.prototype.getContext=()=>new Proxy({}, {get:()=>()=>{},set:()=>true});w.scrollTo=()=>{};
w.addEventListener('error',e=>errs.push(String(e.error&&e.error.stack||e.message).slice(0,300)));

setTimeout(()=>{
  const ev=c=>w.eval(c),d=w.document;
  try{
    w.eval(rd('engine/ros.js'));
    w.eval(rd('engine/pysub.js'));
    w.eval(rd('assets/ros.js'));
    const UI=w.ROSUI;
    const term=d.querySelector('#rosTerm');

    T('assets/ros.js installs the lab and exposes ROSUI',!!UI&&UI.version==='6.2.0',UI?('version '+UI.version):'ROSUI missing');
    T('the page mounts the terminal, editor, graph and inspector',!!d.querySelector('#rosTerm')&&!!d.querySelector('#rosCode')&&!!d.querySelector('#rosGraph')&&!!d.querySelector('#rosTopics'));
    T('six graded task cards are listed',d.querySelectorAll('#rosTasks .ros-task').length===6,d.querySelectorAll('#rosTasks .ros-task').length+' cards');
    T('the Python tab is active and the C++ tab is present but ships later',d.querySelector('[data-lang="py"]').classList.contains('active')&&d.querySelector('[data-lang="cpp"]').disabled===true);

    // --- sandbox: run the talker node ---
    d.querySelector('#rosSandbox').click();
    d.querySelector('#rosExec').click();
    const g=UI.graph();
    T('running the sandbox creates a talker node and the /chatter topic',g.nodes.some(n=>n.name==='talker')&&!!g.topics.get('/chatter'),g.nodes.map(n=>n.name).join(','));
    T('the timer published messages during rclpy.spin()',g.topics.get('/chatter').count>=5,g.topics.get('/chatter').count+' messages');
    T('the topic inspector lists /chatter with its message type',/\/chatter/.test(d.querySelector('#rosTopics').textContent)&&/std_msgs\/String/.test(d.querySelector('#rosTopics').textContent));
    T('the node/topic graph draws node and topic boxes',d.querySelectorAll('#rosGraph rect').length>=2,d.querySelectorAll('#rosGraph rect').length+' rects');
    T('the stats strip shows node and topic counts',d.querySelector('#rosStatNodes').textContent==='1'&&d.querySelector('#rosStatTopics').textContent==='1');

    // --- message inspector ---
    const row=Array.prototype.find.call(d.querySelectorAll('#rosTopics [data-topic]'),r=>r.dataset.topic==='/chatter');
    row.click();
    T('clicking a topic echoes its last message',/data:/.test(d.querySelector('#rosEcho').textContent)&&/type: std_msgs\/String/.test(d.querySelector('#rosEcho').textContent),d.querySelector('#rosEcho').textContent.split('\n')[0]);

    // --- terminal ---
    UI.runTerminal('node list');
    T('the terminal runs `ros2 node list`',/talker/.test(term.textContent));
    UI.runTerminal('topic list -t');
    T('the terminal prints topic types',/\/chatter \[std_msgs\/String\]/.test(term.textContent));
    UI.runTerminal('interface show std_msgs/String');
    T('the terminal prints an interface definition',/string data/.test(term.textContent));
    UI.runTerminal('frobnicate');
    T('an unknown command is reported in the terminal, not thrown',/Unknown command/.test(term.textContent)&&/exit code 1/.test(term.textContent));

    // --- `ros2 run` starts a catalogue node ---
    UI.newGraph(); UI.runTerminal('run robolabs_demo talker');
    T('`ros2 run robolabs_demo talker` starts the example node',/starting robolabs_demo\/talker/.test(term.textContent)&&UI.graph().nodes.some(n=>n.name==='talker'));

    // --- clock stepping ---
    UI.newGraph();
    const t0=UI.graph().t;
    d.querySelector('#rosStep').click();
    T('Step advances the simulated clock',UI.graph().t>t0,(UI.graph().t-t0)+' s');

    // --- graded task: untouched starter fails, solution passes ---
    UI.selectTask('hello');
    d.querySelector('#rosCheck').click();
    T('Check fails the untouched starter',!!d.querySelector('#rosVerdict .ros-verdict.fail'),d.querySelector('#rosVerdict').textContent);
    d.querySelector('#rosSolution').click();
    T('Show & run solution loads the solution and passes',/create_publisher/.test(d.querySelector('#rosCode').value)&&!!d.querySelector('#rosVerdict .ros-verdict.pass'),d.querySelector('#rosVerdict').textContent);

    // --- a Python error is reported, not thrown ---
    d.querySelector('#rosCode').value='print(oops)';
    d.querySelector('#rosExec').click();
    T('a Python error prints a traceback instead of throwing',/Traceback/.test(d.querySelector('#rosPyOut').textContent)&&/not defined/.test(d.querySelector('#rosPyOut').textContent));

    // --- the arm bridge: the move task really moves the robot ---
    ev("setPreset('3r')");
    UI.selectTask('move');
    T('the move task has an arm-motion check',/arm_controller\/joint_trajectory/.test(d.querySelector('#rosCode').value.split('\n')[0]+w.ROS2.TASKS.find(t=>t.id==='move').solution));
    d.querySelector('#rosSolution').click();
    const th1=ev('joints[0].theta'),th2=ev('joints[1].theta');
    T('the move task passes and the arm actually moved',!!d.querySelector('#rosVerdict .ros-verdict.pass')&&Math.abs(th1-45)<1e-6&&Math.abs(th2-30)<1e-6,'joint1='+th1+', joint2='+th2);
    T('the workspace robot re-rendered after the trajectory',/Matrix recalculated/.test(d.querySelector('#statusBox').textContent));

    // --- joint-name resolution also accepts a trailing number ---
    ev("setPreset('3r')");
    UI.applyJointState({name:['Joint 2','Joint 3'],position:[-20,15]});
    T('a JointState message moves the joints it names',Math.abs(ev('joints[1].theta')+20)<1e-6&&Math.abs(ev('joints[2].theta')-15)<1e-6,'j2='+ev('joints[1].theta')+', j3='+ev('joints[2].theta'));

    // --- switching language tabs ---
    const cpp=d.querySelector('[data-lang="cpp"]');
    cpp.click();
    T('clicking the disabled C++ tab keeps Python active',d.querySelector('[data-lang="py"]').classList.contains('active'));
  }catch(e){errs.push(String(e&&e.stack||e).slice(0,400));}

  console.log(out.join('\n'));
  console.log('JS errors:',errs.length?errs.slice(0,3):'none');
  process.exit(out.some(x=>x.startsWith('FAIL'))?1:0);
},600);
