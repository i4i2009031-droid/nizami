import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WA_LINK_KEY,createWhatsappSession,createWhatsappPairing,createWhatsappSender as actualCreateWhatsappSender,whatsappSendMessage,whatsappSendProgressMessage,whatsappSendDetails,normalizeYemenPhone} from '../apps/client/js/whatsapp-session.js';

// Native response fixtures echo requestId exactly as the real Android engine.
// Stale/missing result tests below use the real helper directly, without this fixture adapter.
function createWhatsappSender(options){
 const getPlugin=options.getPlugin;
 return actualCreateWhatsappSender({...options,getPlugin:()=>{
  const plugin=getPlugin();if(!plugin?.sendWhatsAppInApp)return plugin;
  return {...plugin,sendWhatsAppInApp:async request=>{
   const value=await plugin.sendWhatsAppInApp(request);
   if(value&&typeof value==='object')value.requestId=request.requestId;
   return value;
  }};
 }});
}

function memory(initial={}){const values=new Map(Object.entries(initial));return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let next=0;const timers=new Map();return {timers,schedule:fn=>{const id=++next;timers.set(id,fn);return id;},cancel:id=>timers.delete(id),tick:async()=>{for(const fn of [...timers.values()])await fn();}};}
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
const linkedStatus={linked:true,authenticated:true,transportReady:true,sessionAlive:true,status:'connected'};

test('confirmed link persists across restart without inventing live transport readiness',()=>{
 const storage=memory(),host={},session=createWhatsappSession({storage,host});
 session.applyNative(linkedStatus);
 assert.equal(storage.getItem(WA_LINK_KEY),'true');assert.equal(host.WA_SESSION_ACTIVE,true);
 const restored=createWhatsappSession({storage,host:{}});
 assert.equal(restored.snapshot().linked,true);assert.equal(restored.snapshot().transportReady,false);
 for(const status of ['loading','unknown','reconnecting','offline','not_linked'])restored.applyNative({status,transportReady:false,linked:false,authenticated:false});
 assert.equal(restored.snapshot().linked,true);assert.equal(storage.getItem(WA_LINK_KEY),'true');
 restored.setOnline(false);assert.equal(restored.snapshot().transportReady,false);
});

test('only explicit auth revocation or logout clears pairing, and new auth relatches it',()=>{
 const storage=memory(),host={},session=createWhatsappSession({storage,host});
 session.applyNative(linkedStatus);session.applyNative(null);
 assert.equal(session.snapshot().linked,true);
 session.applyNative({authRevoked:true,requiresRetry:true,status:'not_linked'});
 assert.equal(session.snapshot().linked,false);assert.equal(host.WA_SESSION_ACTIVE,false);assert.equal(storage.getItem(WA_LINK_KEY),null);
 assert.equal(session.snapshot().requiresRetry,true);
 session.applyNative(linkedStatus);assert.equal(session.snapshot().requiresRetry,false);
 session.clear();assert.equal(session.snapshot().linked,false);assert.equal(session.snapshot().requiresRetry,true);
});

test('storage errors do not discard in-memory authentication or crash the UI',()=>{
 const storage={getItem(){throw Error('disabled');},setItem(){throw Error('full');},removeItem(){throw Error('disabled');}},host={};
 const session=createWhatsappSession({storage,host});session.applyNative(linkedStatus);
 assert.equal(host.WA_PERMANENTLY_LINKED,true);assert.equal(session.snapshot().linked,true);
});

test('opening and closing linked panels never starts QR queries, including after a network interruption',async()=>{
 const storage=memory({[WA_LINK_KEY]:'true'}),session=createWhatsappSession({storage}),timers=clock();let queries=0;
 const panel=createWhatsappPairing({session,getStatus:async()=>{queries++;return {status:'not_linked'};},...timers});
 for(let i=0;i<6;i++){panel.open();assert.equal(panel.snapshot().mode,'connected');panel.close();}
 session.applyNative({status:'reconnecting',linked:true,transportReady:false});session.setOnline(false);
 panel.open();await timers.tick();await flush();
 assert.equal(queries,0);assert.equal(timers.timers.size,0);assert.equal(panel.snapshot().mode,'connected');
 assert.equal(session.snapshot().transportReady,false);
});

test('phone input stops QR refresh immediately and pairing code gets its own cancellable timer',async()=>{
 const session=createWhatsappSession({storage:memory()}),timers=clock();let queries=0;
 const panel=createWhatsappPairing({session,getStatus:async()=>{queries++;return {status:'not_linked',qr:'data:image/png;base64,dGVzdA==',code:'ABCD-1234'};},...timers});
 panel.open();await flush();assert.equal(queries,1);assert.equal(timers.timers.size,1);
 panel.setMode('phone_input');await timers.tick();assert.equal(queries,1);assert.equal(timers.timers.size,0);
 panel.setMode('pairing_code');await flush();assert.equal(panel.snapshot().code,'ABCD1234');assert.equal(timers.timers.size,1);
 session.applyNative(linkedStatus);assert.equal(panel.snapshot().mode,'connected');assert.equal(timers.timers.size,0);
 panel.close();panel.open();await flush();assert.equal(queries,2);
});

test('late QR response cannot replace a verified connection',async()=>{
 const session=createWhatsappSession({storage:memory()}),timers=clock();let finish;
 const panel=createWhatsappPairing({session,getStatus:()=>new Promise(resolve=>{finish=resolve;}),...timers});
 panel.open();session.applyNative(linkedStatus);finish({status:'not_linked',qr:'data:image/png;base64,b2xk'});await flush();
 assert.equal(panel.snapshot().mode,'connected');assert.equal(panel.snapshot().qr,'');assert.equal(session.snapshot().linked,true);
 assert.equal(timers.timers.size,0);
});

test('late results from a closed sheet cannot revoke a later verified session',async()=>{
 const session=createWhatsappSession({storage:memory()}),timers=clock();let finish;
 const panel=createWhatsappPairing({session,getStatus:()=>new Promise(resolve=>{finish=resolve;}),...timers});
 panel.open();panel.close();session.applyNative(linkedStatus);panel.open();finish({authRevoked:true,status:'not_linked'});await flush();
 assert.equal(session.snapshot().linked,true);assert.equal(panel.snapshot().mode,'connected');
});

test('after explicit logout QR waits for the user to start a new link',async()=>{
 const session=createWhatsappSession({storage:memory()}),timers=clock();let queries=0;
 const panel=createWhatsappPairing({session,getStatus:async()=>{queries++;return {status:'not_linked'};},...timers});
 session.applyNative(linkedStatus);panel.open();session.clear();await flush();
 assert.equal(panel.snapshot().mode,'qr');assert.equal(queries,0);assert.equal(timers.timers.size,0);
 session.applyNative({requiresRetry:false,status:'loading'});await panel.retry();assert.equal(queries,1);panel.close();
});

test('all supported Yemen formats normalize to one recipient and invalid countries/numbers fail',()=>{
 for(const number of ['782843242','0782843242','967782843242','+967782843242','00967782843242','+967 782-843-242','٧٨٢٨٤٣٢٤٢','٠٠٩٦٧٧٨٢٨٤٣٢٤٢','۷۸۲۸۴۳۲۴۲'])assert.equal(normalizeYemenPhone(number),'967782843242');
 for(const number of ['', '78284324','682843242','+966782843242','967967782843242','7a82843242','7828432429','+967'])assert.throws(()=>normalizeYemenPhone(number));
});

const payload={phone:'+967 782-843-242',caption:'فاتورة قطفة',base64:'JVBERi0=',filename:'invoice.pdf'};
const accepted={status:'submitted',submitted:true,dispatched:true,ack:1,messageId:'true_967782843242@c.us_ACK1'};

test('silent sender normalizes recipient and preserves exact PDF/caption payload',async()=>{
 const calls=[];const sender=createWhatsappSender({makeRequestId:()=> 'silent-request',getPlugin:()=>({sendWhatsAppInApp:async value=>{calls.push(value);return accepted;}})});
 assert.equal(await sender(payload),accepted);
 assert.deepEqual(calls,[{...payload,phone:'967782843242',requestId:'silent-request'}]);assert.equal(payload.requestId,undefined);
});

test('even an explicitly safe pre-dispatch failure never opens an app or share fallback',async()=>{
 let fallbacks=0;const result={status:'error',safeToFallback:true,dispatched:false,message:'غير مرتبط'};
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:async()=>result,sendWhatsAppIntent:async()=>{fallbacks++;}})});
 assert.equal(await sender(payload),result);assert.equal(fallbacks,0);assert.equal(whatsappSendMessage(result),'غير مرتبط');
});

test('all uncertain or legacy results are returned without retries or UI fallback',async()=>{
 let fallbacks=0,sends=0;
 for(const result of [{dispatched:true,safeToFallback:true,status:'uncertain'},{submitted:true,safeToFallback:true},{status:'uncertain'},{safeToFallback:true,dispatched:null},{safeToFallback:true,dispatched:'false'}]){
  const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:async()=>{sends++;return result;},sendWhatsAppIntent:async()=>{fallbacks++;}})});
  assert.equal(await sender(payload),result);
 }
 assert.equal(fallbacks,0);assert.equal(sends,5);
});

test('bridge rejection does not launch another transport',async()=>{
 let fallbacks=0;
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:async()=>{throw Error('bridge lost after dispatch');},sendWhatsAppIntent:async()=>{fallbacks++;}})});
 await assert.rejects(()=>sender(payload),/bridge lost/);assert.equal(fallbacks,0);
});

test('send lock prevents duplicate taps and releases after success and rejection',async()=>{
 let resolveSend,attempts=0;
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:()=>{attempts++;if(attempts===1)return new Promise(resolve=>{resolveSend=resolve;});if(attempts===2)throw Error('transport failure');return Promise.resolve(accepted);}})});
 const first=sender(payload);await assert.rejects(()=>sender(payload),/قيد الإرسال/);assert.equal(attempts,1);
 resolveSend(accepted);await first;await assert.rejects(()=>sender(payload),/transport failure/);
 assert.equal(await sender(payload),accepted);assert.equal(attempts,3);
});

test('cached progress reads only the active request and ends before final return',async()=>{
 const timers=clock(),send=deferred(),progress=[],calls=[];
 const sender=createWhatsappSender({makeRequestId:()=> 'active-send',getPlugin:()=>({
  sendWhatsAppInApp:request=>{calls.push(['send',request]);return send.promise;},
  whatsappSendStatus:async request=>{calls.push(['status',request]);return {requestId:'active-send',phase:'verifying',finished:false};}
 }),onProgress:value=>progress.push(value),...timers});
 const pending=sender(payload);await timers.tick();assert.deepEqual(calls[1],['status',{requestId:'active-send'}]);
 assert.deepEqual(progress.map(x=>x.phase),['preparing','verifying']);send.resolve(accepted);assert.equal(await pending,accepted);assert.equal(timers.timers.size,0);
});

test('one cached status read at a time and late completion cannot update a finished operation',async()=>{
 const timers=clock(),send=deferred(),status=deferred(),progress=[];let reads=0;
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:()=>send.promise,whatsappSendStatus:()=>{reads++;return status.promise;}}),makeRequestId:()=> 'slow-status',onProgress:value=>progress.push(value),...timers});
 const pending=sender(payload),poll=timers.tick();await timers.tick();assert.equal(reads,1);
 send.resolve(accepted);await pending;assert.equal(timers.timers.size,0);
 status.resolve({requestId:'slow-status',phase:'verifying',finished:false});await poll;
 assert.deepEqual(progress.map(value=>value.phase),['preparing']);
});

test('status from another request and finished status are never treated as progress',async()=>{
 const timers=clock(),send=deferred(),progress=[];let counter=0;
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:()=>send.promise,whatsappSendStatus:async()=>++counter===1?{requestId:'other',phase:'verifying'}:{requestId:'current',phase:'submitted',finished:true}}),makeRequestId:()=> 'current',onProgress:v=>progress.push(v),...timers});
 const pending=sender(payload);await timers.tick();await timers.tick();send.resolve(accepted);await pending;
 assert.deepEqual(progress.map(x=>x.phase),['preparing']);
});

test('status and presentation failures do not interrupt actual sending or leak timers',async()=>{
 const timers=clock(),send=deferred();let reads=0;
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:()=>send.promise,whatsappSendStatus:async()=>{reads++;throw Error('status unavailable');}}),onProgress:()=>{throw Error('view closed');},...timers});
 const pending=sender(payload);await timers.tick();assert.equal(reads,1);
 send.reject(Error('bridge lost after dispatch'));await assert.rejects(pending,/bridge lost after dispatch/);assert.equal(timers.timers.size,0);
});

test('missing response is ambiguous and the caller can start a later deliberate attempt',async()=>{
 let calls=0;const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:async()=>++calls===1?undefined:accepted})});
 await assert.rejects(()=>sender(payload),/راجع المحادثة/);assert.equal(await sender(payload),accepted);assert.equal(calls,2);
});

test('invalid phone, offline state, and absent native bridge fail without sending',async()=>{
 let sends=0;const plugin={sendWhatsAppInApp:async()=>{sends++;return accepted;}};
 const sender=createWhatsappSender({getPlugin:()=>plugin});await assert.rejects(()=>sender({...payload,phone:'+966512345678'}),/اليمني/);
 await assert.rejects(()=>createWhatsappSender({getPlugin:()=>plugin,isOnline:()=>false})(payload),/بالإنترنت/);
 await assert.rejects(()=>createWhatsappSender({getPlugin:()=>null})(payload),/أندرويد/);
 assert.equal(sends,0);assert.equal(await sender(payload),accepted);
});

test('visible messages distinguish server acceptance, delivery and missing acknowledgement',()=>{
 assert.match(whatsappSendMessage(accepted),/خادم واتساب/);assert.doesNotMatch(whatsappSendMessage(accepted),/تم تسليم/);
 assert.match(whatsappSendMessage({...accepted,ack:2}),/تم تسليم/);
 for(const result of [{submitted:true},{...accepted,ack:0},{...accepted,messageId:''}])assert.match(whatsappSendMessage(result),/راجع المحادثة/);
});

test('visible diagnostics exclude file contents and provide safe stage/code details',()=>{
 const value={failedStage:'verifying_recipient',code:'recipient_mismatch',driverVersion:4,phone:'967782843242',caption:'private invoice',base64:'JVBERi0private'};
 const details=whatsappSendDetails(value);assert.match(details,/مطابقة رقم العميل/);assert.match(details,/recipient_mismatch/);assert.match(details,/المحرك: 4/);
 for(const secret of [value.phone,value.caption,value.base64])assert.equal(details.includes(secret),false);
 assert.match(whatsappSendProgressMessage({phase:'submitting'}),/في الخلفية/);
 const msg=whatsappSendMessage({status:'uncertain',dispatched:true,message:'انتهت مهلة تأكيد قبول المستند'});assert.match(msg,/انتهت مهلة/);assert.match(msg,/راجع المحادثة/);
});

for(const nativeRequestId of ['older-request',undefined])test(`stale or missing native request id ${String(nativeRequestId)} cannot report another attempt as sent`,async()=>{
 const timers=clock();let calls=0,fallbacks=0;
 const sender=actualCreateWhatsappSender({makeRequestId:()=> 'current-request',getPlugin:()=>({
  sendWhatsAppInApp:async request=>{calls++;return {...accepted,requestId:calls===1?nativeRequestId:request.requestId};},
  sendWhatsAppIntent:async()=>{fallbacks++;}
 }),...timers});
 await assert.rejects(()=>sender(payload),error=>error.code==='wa_request_mismatch'&&error.primaryResult.status==='uncertain');
 assert.equal(timers.timers.size,0);assert.equal(fallbacks,0);
 const result=await sender(payload);assert.equal(result.requestId,'current-request');assert.equal(result.submitted,true);assert.equal(calls,2);
});
