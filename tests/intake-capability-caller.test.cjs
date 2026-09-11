const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const test = require('node:test');
const page = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const boot = page.match(/<script id="intake-capability-bootstrap">([\s\S]*?)<\/script>/)[1];
const saveSource = page.slice(page.indexOf('  var intakeSaveState='), page.indexOf('  function emailValid'));
const payloadSource = page.slice(page.indexOf('  function intakePayload('), page.indexOf('  var intakeSaveState='));
const now = Math.floor(Date.now() / 1000);
const baseClaims = {v:1,iss:'kaizen-student-intake',aud:'kaizen-intake-ef',sid:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',jti:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',par:'synthetic-parent',sub:'synthetic-child',pur:'ef-child-report',iat:now,exp:now+3600};
function token(overrides={}) {return 'kzcap1.'+Buffer.from(JSON.stringify({...baseClaims,...overrides})).toString('base64url')+'.'+'a'.repeat(43);}
const efCap=token(), statusCap=token({sub:'synthetic-parent',pur:'intake-status',jti:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});
const validQuery='?src=intake&childId=synthetic-child&parentId=synthetic-parent';
function bootstrap({query=validQuery,hash='#efCap='+efCap+'&statusCap='+statusCap,storage=new Map(),throws=false}={}) {
  const location={search:query,hash,pathname:'/parent/'};
  const c={window:{},location,document:{querySelector:()=>({content:"no-referrer"})},URLSearchParams,Date,atob:v=>Buffer.from(v,'base64').toString('binary'),history:{replaceState(a,b,url){assert.equal(url,location.pathname+location.search);location.hash='';}},sessionStorage:{getItem:k=>{if(throws)throw Error('blocked');return storage.get(k)||null;},setItem:(k,v)=>{if(throws)throw Error('blocked');storage.set(k,v);},removeItem:k=>{if(throws)throw Error('blocked');storage.delete(k);}}};
  vm.runInNewContext(boot,c);
  return {c,storage};
}
test('valid capabilities are consumed from the fragment and survive a same-tab refresh',()=>{
  const {c,storage}=bootstrap(); assert.equal(c.location.hash,'');assert.equal(c.window.__KZ_INTAKE_CAPS_VALID,true);
  assert.equal(bootstrap({hash:'',storage}).c.window.__KZ_INTAKE_CAPS_VALID,true);
  c.window.__KZ_MARK_INTAKE_ATTEMPT();
  assert.equal(bootstrap({hash:'',storage}).c.window.__KZ_INTAKE_ATTEMPTED,true);
});
for(const [name,args] of [
  ['missing',{hash:''}],['expired',{hash:'#efCap='+token({exp:now-1})+'&statusCap='+statusCap}],
  ['wrong child',{query:'?src=intake&childId=another-child&parentId=synthetic-parent'}],
  ['wrong purpose',{hash:'#efCap='+statusCap+'&statusCap='+statusCap}],
  ['mismatched submission',{hash:'#efCap='+efCap+'&statusCap='+token({pur:'intake-status',sub:'synthetic-parent',sid:'dddddddd-dddd-4ddd-8ddd-dddddddddddd'})}],
  ['duplicate capability',{hash:'#efCap='+efCap+'&efCap='+efCap+'&statusCap='+statusCap}],
  ['duplicate identity',{query:validQuery+'&childId=another'}],
  ['missing intake marker',{query:'?childId=synthetic-child&parentId=synthetic-parent'}],
  ['malformed signature',{hash:'#efCap=bad&statusCap='+statusCap}],
]) test(name+' intake link cannot downgrade to a public quiz',()=>{
  const {c}=bootstrap(args);assert.equal(c.window.__KZ_INTAKE_REQUESTED,true);assert.notEqual(c.window.__KZ_INTAKE_CAPS_VALID,true);assert.equal(c.location.hash,'');
});
test('blocked storage still clears fragment and suppresses analytics',()=>{
  const {c}=bootstrap({throws:true});assert.equal(c.location.hash,'');assert.equal(c.window.__KZ_INTAKE_REQUESTED,true);assert.notEqual(c.window.__KZ_INTAKE_CAPS_VALID,true);
});
test('ordinary visits clear stale capabilities and retain the public analytics lane',()=>{
  const {storage}=bootstrap();const {c}=bootstrap({query:'',hash:'',storage});assert.equal(c.window.__KZ_INTAKE_REQUESTED,false);assert.equal(storage.has('kz-intake-caps:/parent/'),false);
});
function response(status=200,body={ok:true}){return {status,json:async()=>body};}
function harness(replies=[response(),response(200,{ok:true,ghl:true,childRouted:true}),response(200,{ok:true,complete:true})]){
  const calls=[],elements=new Map(),timers=new Map();let timerId=0,clears=0,capClears=0,marks=0;
  const c={INTAKE_MODE:true,INTAKE_INVALID:false,INTAKE:{efCap,statusCap,childId:'synthetic-child',parentId:'synthetic-parent',child:'Synthetic'},
    INTAKE_REPORT:'https://offline.invalid/report',LEAD_ENDPOINT:'https://offline.invalid/worker',INTAKE_STATUS:'https://offline.invalid/status',AI_ENABLED:true,AbortController,
    LAST:{profile:Array.from({length:14},(_,i)=>({name:'Domain '+i,band:'developing',strengthPct:50})),overall:50,band:'developing'},childName:'Synthetic',childAge:'12',QTEXT:{q1:'Synthetic question'},
    buildReportHtml:()=>'<p>Synthetic report</p>',btoa:v=>Buffer.from(v,'binary').toString('base64'),unescape,encodeURIComponent,
    $:id=>{if(!elements.has(id))elements.set(id,{hidden:false,textContent:'',className:'',value:'Synthetic'});return elements.get(id);},
    markIntakeAttempt:()=>{marks++;},clearSave:()=>{clears++;},clearIntakeCapabilities:()=>{capClears++;},
    setTimeout:fn=>{timers.set(++timerId,fn);return timerId;},clearTimeout:id=>timers.delete(id),
    fetch:async(url,options)=>{calls.push({url,...options,parsed:JSON.parse(options.body)});const next=replies[calls.length-1];if(typeof next==='function')return next(options);if(next instanceof Error)throw next;assert.ok(next,'unexpected extra fetch');return next;},
  };
  vm.createContext(c);vm.runInContext(payloadSource+saveSource,c);
  return {c,calls,elements,timers,counts:()=>({clears,capClears,marks})};
}
test('report acknowledgement precedes one Worker call and capability status POST',async()=>{
  let acknowledge;const pending=new Promise(resolve=>{acknowledge=resolve;});const h=harness([()=>pending,response(200,{ok:true,ghl:true,childRouted:true}),response(200,{ok:true,complete:true})]);
  const worker={childId:'synthetic-child',overall:50};const run=h.c.saveIntakeSnapshot(worker);worker.overall=0;
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].parsed.capability,efCap);assert.match(h.elements.get('intake-save-status').textContent,/Saving/);
  await h.c.saveIntakeSnapshot(worker);assert.equal(h.calls.length,1);
  acknowledge(response());await run;
  assert.deepEqual(h.calls.map(c=>c.url),['https://offline.invalid/report','https://offline.invalid/worker','https://offline.invalid/status']);
  assert.equal(h.calls[1].parsed.overall,50);assert.equal(h.calls[1].parsed.capability,undefined);
  assert.deepEqual(h.calls[2].parsed,{capability:statusCap});assert.ok(h.calls.every(c=>c.method==='POST'));
  assert.match(h.elements.get('intake-save-status').textContent,/all required intake snapshots are complete/);
  assert.deepEqual(h.counts(),{clears:1,capClears:1,marks:1});assert.equal(h.timers.size,0);
  await h.c.saveIntakeSnapshot(worker);assert.equal(h.calls.length,3);
});
for(const [name,bad] of [['403',response(403,{ok:false})],['202',response(202,{ok:true})],['500',response(500,{ok:false})],['false body',response(200,{ok:false})],['missing body',response(200,{})],['malformed JSON',{status:200,json:async()=>{throw Error('bad JSON');}}],['lost response',Error('network')]]) {
  test('unconfirmed report '+name+' stops before Worker and status',async()=>{
    const h=harness([bad]);await h.c.saveIntakeSnapshot({});assert.equal(h.calls.length,1);assert.match(h.elements.get('intake-save-status').textContent,/could not confirm that this snapshot was saved/);assert.deepEqual(h.counts(),{clears:0,capClears:0,marks:1});await h.c.saveIntakeSnapshot({});assert.equal(h.calls.length,1);
  });
}
test('report timeout remains unknown and is not retried',async()=>{
  const h=harness([o=>new Promise((resolve,reject)=>o.signal.addEventListener('abort',()=>reject(Error('timeout'))))]);
  const run=h.c.saveIntakeSnapshot({});h.timers.values().next().value();await run;assert.equal(h.calls.length,1);assert.equal(h.c.intakeSaveState.reportSaved,false);
});
for(const bad of [response(200,{ok:true,ghl:false,childRouted:true}),response(200,{ok:true,ghl:true,childRouted:false}),Error('worker response lost')])test('unconfirmed Worker preserves saved-report state and never polls status',async()=>{
  const h=harness([response(),bad]);await h.c.saveIntakeSnapshot({});assert.equal(h.calls.length,2);assert.match(h.elements.get('intake-save-status').textContent,/report is saved, but completion/);assert.equal(h.c.intakeSaveState.childSaved,false);assert.equal(h.counts().clears,0);
});
test('status failure does not misreport confirmed child effects as unsaved',async()=>{
  const h=harness([response(),response(200,{ok:true,ghl:true,childRouted:true}),response(503,{ok:false})]);await h.c.saveIntakeSnapshot({});assert.match(h.elements.get('intake-save-status').textContent,/snapshot is saved.*could not confirm the full family's/);assert.equal(h.counts().clears,1);assert.equal(h.counts().capClears,0);
});
test('saved current snapshot distinguishes other incomplete family tasks',async()=>{
  const h=harness([response(),response(200,{ok:true,ghl:true,childRouted:true}),response(200,{ok:true,complete:false})]);await h.c.saveIntakeSnapshot({});assert.match(h.elements.get('intake-save-status').textContent,/finish the remaining snapshots/);assert.equal(h.counts().capClears,1);
});
test('unavailable attempt storage stops before the first request',async()=>{
  const h=harness();h.c.markIntakeAttempt=()=>{throw Error('storage');};await h.c.saveIntakeSnapshot({});assert.equal(h.calls.length,0);
});
test('invalid intake links never dispatch and no unload writer remains',async()=>{
  const h=harness();h.c.INTAKE_INVALID=true;await h.c.saveIntakeSnapshot({});assert.equal(h.calls.length,0);assert.doesNotMatch(page,/sendBeacon|pagehide|INTAKE_STATUS\+"\?parentId/);
});

test('ordinary cleanup failure keeps analytics suppressed',()=>{
  const {c}=bootstrap({query:'',hash:'',throws:true}); assert.equal(c.window.__KZ_INTAKE_REQUESTED,false);assert.equal(c.window.__KZ_INTAKE_SUPPRESS_METRICS,true);
});
test('referrer privacy applies to intake while ordinary visits restore the default policy',()=>{
  assert.match(boot,/if\(!requested\) document\.querySelector/);
  assert.ok(boot.indexOf('sessionStorage.removeItem(key);')<boot.indexOf('window.__KZ_INTAKE_SUPPRESS_METRICS=requested;'));
});
