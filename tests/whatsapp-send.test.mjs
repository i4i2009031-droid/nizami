import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Adapter contract tests. WA-JS and its network response are simulated; these
// tests deliberately do not claim that a real WhatsApp recipient received data.
const source=fs.readFileSync(new URL('../native/android/whatsapp-direct.js',import.meta.url),'utf8');
const PHONE='967782843242', JID=PHONE+'@c.us';
const PDF='%PDF-1.4\n% transport contract fixture\n%%EOF';
const BASE64=Buffer.from(PDF).toString('base64');
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function harness({phone=PHONE,online=true,authenticated=true,ready=true,contact,send,result,version='4.7.1'}={}){
 let now=1000,nextTimer=0;
 const timers=new Map(),calls=[],forbidden=[];
 const no=name=>()=>{forbidden.push(name);throw Error('Forbidden visible side effect: '+name);};
 const wpp={version,isReady:ready,loader:{isReady:ready},
  conn:{isAuthenticated:()=>authenticated,isMainReady:()=>ready,isOnline:()=>online},
  contact:{queryWidExists:async jid=>{calls.push({kind:'query',jid});return contact===undefined?{wid:jid}:typeof contact==='function'?contact(jid):contact;}},
  chat:{sendFileMessage:async(jid,content,options)=>{calls.push({kind:'file',jid,content,options});return send?send():result??{id:`true_${jid}_FILE1`,ack:1,sendMsgResult:{messageSendResult:'OK'}};},
   sendTextMessage:async(jid,content,options)=>{calls.push({kind:'text',jid,content,options});return send?send():result??{id:`true_${jid}_TEXT1`,ack:1,sendMsgResult:{messageSendResult:'OK'}};}}
 };
 const window={WPP:wpp,open:no('window.open'),alert:no('alert'),confirm:no('confirm')};
 const context={window,navigator:{onLine:online,share:no('navigator.share')},
  document:new Proxy({}, {get(_target,key){return no('document.'+String(key))();}}),
  location:new Proxy({}, {get(_target,key){return no('location.'+String(key))();},set(){no('navigation')();return false;}}),
  atob:s=>Buffer.from(s,'base64').toString('binary'),Date:{now:()=>now},
  setTimeout(fn,delay){const id=++nextTimer;timers.set(id,{fn,due:now+delay});return id;},clearTimeout:id=>timers.delete(id)};
 assert.equal(vm.runInNewContext(source,context),true);
 const driver=window.__qatfahDirect;
 async function tick(ms){now+=ms;for(const [id,timer] of [...timers])if(timer.due<=now){timers.delete(id);timer.fn();}await flush();}
 function prepare(options={}){return driver.prepare({requestId:'request-1',phone,caption:'تفاصيل الفاتورة',filename:'فاتورة_قطفة.pdf',isPdf:true,...options});}
 async function start(options={}){assert.equal(prepare(options),true);if(options.isPdf!==false)assert.equal(driver.addChunk(BASE64),true);assert.equal(driver.start(),true);await flush();}
 return {driver,wpp,calls,forbidden,timers,context,prepare,start,tick,status:()=>JSON.parse(driver.status())};
}

for(let cycle=1;cycle<=5;cycle++)test(`silent document contract cycle ${cycle}: one exact recipient, identical PDF/caption, ack1 and zero UI calls`,async()=>{
 const phone='96777'+String(1000000+cycle),caption='سند تجربة '+cycle;
 const h=harness({phone});await h.start({requestId:'cycle-'+cycle,caption});
 const sends=h.calls.filter(x=>x.kind==='file');assert.equal(sends.length,1);
 assert.equal(sends[0].jid,phone+'@c.us');assert.equal(sends[0].content,'data:application/pdf;base64,'+BASE64);
 assert.deepEqual(JSON.parse(JSON.stringify(sends[0].options)),{waitForAck:true,markIsRead:false,detectMentioned:false,type:'document',mimetype:'application/pdf',filename:'فاتورة_قطفة.pdf',caption});
 assert.equal(h.status().submitted,true);assert.equal(h.status().ack,1);assert.equal(h.status().delivered,false);
 assert.equal(h.status().deliveryConfirmed,false);assert.equal(h.status().safeToFallback,false);
 assert.equal(h.status().messageId,`true_${phone}@c.us_FILE1`);assert.equal(h.status().requestId,'cycle-'+cycle);
 assert.equal(h.timers.size,0);assert.deepEqual(h.forbidden,[]);
});

test('ack2 denotes recipient delivery, whereas ack1 denotes server acceptance',async()=>{
 const h=harness({result:{id:`true_${JID}_A2`,ack:2}});await h.start();
 assert.equal(h.status().submitted,true);assert.equal(h.status().delivered,true);assert.equal(h.status().deliveryConfirmed,true);
});

test('text uses the same verified JID and acknowledgement contract without file UI',async()=>{
 const h=harness();await h.start({isPdf:false,caption:'إشعار قطفة'});
 assert.equal(h.calls.filter(x=>x.kind==='text').length,1);assert.equal(h.calls.filter(x=>x.kind==='file').length,0);
 assert.equal(h.status().submitted,true);assert.deepEqual(h.forbidden,[]);
});

for(const [label,options,code] of [
 ['missing authentication',{authenticated:false},'session_not_authenticated'],
 ['offline connection',{online:false},'offline'],
 ['incompatible bundle',{version:'0.0.0'},'wpp_version_mismatch'],
 ['unknown customer',{contact:null},'recipient_not_registered'],
 ['different canonical phone',{contact:{wid:'967700000001@c.us'}},'recipient_mismatch']
])test(`${label} fails before dispatch and never opens another UI`,async()=>{
 const h=harness(options);await h.start();
 assert.equal(h.status().code,code);assert.equal(h.status().dispatched,false);assert.equal(h.status().submitted,false);
 assert.equal(h.calls.filter(x=>x.kind==='file').length,0);assert.equal(h.status().safeToFallback,false);assert.deepEqual(h.forbidden,[]);
});

test('missing WA-JS APIs produce a pre-dispatch error, never an invented Store call',async()=>{
 const h=harness();delete h.wpp.chat.sendFileMessage;await h.start();
 assert.equal(h.status().code,'wpp_api_unavailable');assert.equal(h.status().dispatched,false);assert.deepEqual(h.forbidden,[]);
});

test('unready engine times out without navigating or dispatching',async()=>{
 const h=harness({ready:false});await h.start();await h.tick(16000);
 assert.equal(h.status().code,'wpp_not_ready');assert.equal(h.status().dispatched,false);assert.equal(h.timers.size,0);
});

test('engine readiness may arrive asynchronously without destroying the session',async()=>{
 const h=harness({ready:false});await h.start();h.wpp.isReady=true;h.wpp.conn.isMainReady=()=>true;
 await h.tick(200);assert.equal(h.status().submitted,true);assert.deepEqual(h.forbidden,[]);
});

test('recipient LID is accepted only when the preflight explicitly mapped the exact requested phone',async()=>{
 const h=harness({contact:{wid:JID,lid:'123456789@lid'},result:{id:'true_123456789@lid_LID1',to:'123456789@lid',ack:1}});
 await h.start();assert.equal(h.status().submitted,true);assert.equal(h.calls.find(x=>x.kind==='file').jid,JID);
});

for(const [label,result,code] of [
 ['no response',{},'ack_id_missing'],
 ['missing message id',{ack:1},'ack_id_missing'],
 ['queued without ack',{id:`true_${JID}_A0`,ack:0},'ack_not_confirmed'],
 ['negative ack',{id:`true_${JID}_ERR`,ack:-1},'ack_not_confirmed'],
 ['invalid ack',{id:`true_${JID}_ERR`,ack:9},'ack_not_confirmed'],
 ['other recipient',{id:'true_967700000001@c.us_WRONG',ack:1},'ack_recipient_mismatch'],
 ['unmapped LID',{id:'true_999999999@lid_WRONG',ack:1},'ack_recipient_mismatch'],
 ['conflicting to field',{id:`true_${JID}_RIGHT`,to:'967700000001@c.us',ack:1},'ack_recipient_mismatch'],
 ['opaque id',{id:'opaque',ack:1},'ack_recipient_mismatch']
])test(`${label} is uncertain, not success, and causes no retry`,async()=>{
 const h=harness({result});await h.start();assert.equal(h.status().phase,'uncertain');assert.equal(h.status().code,code);
 assert.equal(h.status().submitted,false);assert.equal(h.status().dispatched,true);assert.equal(h.status().safeToFallback,false);
 await h.tick(200000);assert.equal(h.calls.filter(x=>x.kind==='file').length,1);assert.deepEqual(h.forbidden,[]);
});

test('rejection after invoking WA-JS remains uncertain with no second transport',async()=>{
 const h=harness({send:()=>Promise.reject(Error('upload failed'))});await h.start();
 assert.equal(h.status().phase,'uncertain');assert.equal(h.status().code,'wpp_operation_failed');assert.equal(h.status().dispatched,true);
 assert.equal(h.calls.filter(x=>x.kind==='file').length,1);assert.deepEqual(h.forbidden,[]);
});

test('double start and parallel prepare cannot dispatch twice',async()=>{
 const pending=deferred(),h=harness({send:()=>pending.promise});await h.start();
 assert.equal(h.driver.start(),false);assert.equal(h.prepare({requestId:'another'}),false);
 pending.resolve({id:`true_${JID}_ACK`,ack:1});await flush();assert.equal(h.status().submitted,true);
 assert.equal(h.calls.filter(x=>x.kind==='file').length,1);assert.equal(h.prepare({requestId:'next'}),true);
});

test('timeout releases visible operation but blocks dispatch while original network promise remains unresolved',async()=>{
 const pending=deferred(),h=harness({send:()=>pending.promise});await h.start();await h.tick(100001);
 assert.equal(h.status().phase,'uncertain');assert.equal(h.status().code,'send_timeout');assert.equal(h.timers.size,0);
 assert.equal(h.prepare({requestId:'duplicate'}),false);h.driver.cancel();assert.equal(h.prepare({requestId:'duplicate'}),false);
 pending.resolve({id:`true_${JID}_LATE`,ack:1});await flush();
 assert.equal(h.status().phase,'uncertain','late completion must not change a finished button result');
 assert.equal(h.prepare({requestId:'new-explicit-attempt'}),true);
 assert.equal(h.calls.filter(x=>x.kind==='file').length,1);
});

test('cancellation before recipient lookup completes prevents dispatch and ignores stale completion',async()=>{
 const lookup=deferred(),h=harness({contact:()=>lookup.promise});await h.start();
 h.driver.cancel();assert.equal(h.status().dispatched,false);assert.equal(h.status().code,'send_interrupted');
 assert.equal(h.prepare({requestId:'new-request'}),true);lookup.resolve({wid:JID});await flush();
 assert.equal(h.calls.filter(x=>x.kind==='file').length,0);assert.equal(h.status().requestId,'new-request');
});

test('successful request ids cannot be replayed, even with another recipient',async()=>{
 const h=harness();await h.start();assert.equal(h.prepare(),false);assert.equal(h.prepare({phone:'967700000001'}),false);
 assert.equal(h.calls.filter(x=>x.kind==='file').length,1);
});

test('repeated adapter injection retains the same controller and its in-flight lock',async()=>{
 const pending=deferred(),h=harness({send:()=>pending.promise});await h.start();
 assert.equal(vm.runInNewContext(source,h.context),true);assert.equal(h.context.window.__qatfahDirect,h.driver);
 assert.equal(h.prepare({requestId:'second'}),false);pending.resolve({id:`true_${JID}_ACK`,ack:1});await flush();
});

for(const value of ['', '+967782843242','96778284324','966782843242','9677828432429','96778284324a'])test(`raw native target ${JSON.stringify(value)} cannot bypass Yemen validation`,()=>{
 const h=harness();assert.equal(h.prepare({phone:value}),false);assert.equal(h.calls.length,0);
});

test('invalid PDF bytes never reach WA-JS despite a plausible file extension',async()=>{
 const h=harness();assert.equal(h.prepare(),true);assert.equal(h.driver.addChunk(Buffer.from('<html>not PDF</html>').toString('base64')),true);
 assert.equal(h.driver.start(),true);await flush();assert.equal(h.status().code,'invalid_pdf');assert.equal(h.status().dispatched,false);
});

test('invalid or oversize encoded PDF chunks fail before dispatch and discard the staged buffer',()=>{
 for(const chunk of ['not base64!', 'a'.repeat(7000000)]){
  const h=harness();assert.equal(h.prepare(),true);assert.equal(h.driver.addChunk(chunk),false);
  assert.equal(h.status().code,'invalid_pdf');assert.equal(h.status().dispatched,false);
 }
});

test('filename traversal, unsupported file type and overlong caption are rejected before staging',()=>{
 for(const options of [{filename:'../secret.pdf'},{filename:'bad.exe'},{caption:'x'.repeat(3001)},{filename:'bad\u0000.pdf'},{requestId:'unsafe!'}]){
  const h=harness();assert.equal(h.prepare(options),false);assert.equal(h.calls.length,0);
 }
});
