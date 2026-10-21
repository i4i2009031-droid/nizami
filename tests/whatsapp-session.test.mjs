import {test} from 'node:test';
import assert from 'node:assert/strict';
import {WA_LINK_KEY,createWhatsappSession,createWhatsappPairing,createWhatsappSender,whatsappSendMessage,normalizeYemenPhone} from '../apps/client/js/whatsapp-session.js';

function memory(initial={}){const values=new Map(Object.entries(initial));return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,String(value)),removeItem:key=>values.delete(key)};}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function clock(){let next=0;const timers=new Map();return {timers,schedule:fn=>{const id=++next;timers.set(id,fn);return id;},cancel:id=>timers.delete(id),tick:async()=>{for(const fn of [...timers.values()])await fn();}};}
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

test('safe pre-dispatch failure opens direct recipient fallback once with the same PDF payload',async()=>{
 const sent=[],fallback=[],payload={phone:'967782843242',base64:'JVBERi0=',filename:'invoice.pdf'};
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:async value=>{sent.push(value);return {safeToFallback:true,dispatched:false};},sendWhatsAppIntent:async value=>{fallback.push(value);return {openedInWhatsApp:true,submitted:false};}})});
 const result=await sender(payload);assert.deepEqual(sent,[payload]);assert.deepEqual(fallback,[payload]);assert.equal(result.submitted,false);
 assert.match(whatsappSendMessage(result),/أكمل الإرسال في واتساب/);
});

test('a dispatched or ambiguous result never automatically retries or opens fallback',async()=>{
 let fallbacks=0;
 for(const result of [{dispatched:true,safeToFallback:true,status:'uncertain'},{submitted:true,safeToFallback:true},{status:'uncertain'}]){
  const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:async()=>result,sendWhatsAppIntent:async()=>{fallbacks++;}})});
  assert.equal(await sender({}),result);
 }
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:async()=>{throw Error('bridge lost after dispatch');},sendWhatsAppIntent:async()=>{fallbacks++;}})});
 await assert.rejects(()=>sender({}),/bridge lost/);assert.equal(fallbacks,0);
});

test('send lock prevents duplicate taps and releases after both success and rejection',async()=>{
 let resolveSend,attempts=0;
 const sender=createWhatsappSender({getPlugin:()=>({sendWhatsAppInApp:()=>{attempts++;if(attempts===1)return new Promise(resolve=>{resolveSend=resolve;});if(attempts===2)throw Error('transport failure');return Promise.resolve({submitted:true});}})});
 const first=sender({});await assert.rejects(()=>sender({}),/قيد الإرسال/);assert.equal(attempts,1);
 resolveSend({submitted:true});await first;
 await assert.rejects(()=>sender({}),/transport failure/);
 assert.equal((await sender({})).submitted,true);assert.equal(attempts,3);
});
