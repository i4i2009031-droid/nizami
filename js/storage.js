import {validateNewAccountingEvents} from './money-services.js';
const DB_VERSION=2;let dbPromise=null;let activeTenant='demo';
export function setTenant(id){activeTenant=String(id||'demo').replace(/[^\w-]/g,'');dbPromise=null;}
const open=()=>{
 if(dbPromise)return dbPromise;
 dbPromise=new Promise((resolve,reject)=>{
  const request=indexedDB.open(`qatfah_${activeTenant}`,DB_VERSION);
  request.onupgradeneeded=()=>{const db=request.result;if(!db.objectStoreNames.contains('events'))db.createObjectStore('events',{keyPath:'id'});if(!db.objectStoreNames.contains('meta'))db.createObjectStore('meta',{keyPath:'key'});};
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });return dbPromise;
};
async function operate(store,mode,cb){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);const obj=tx.objectStore(store);let value,reason;const abort=error=>{reason=error;try{tx.abort();}catch{}reject(error);};tx.oncomplete=()=>resolve(value?.result);tx.onerror=()=>reject(reason||tx.error);tx.onabort=()=>reject(reason||tx.error||new Error('لم يتم حفظ العملية؛ أُلغيت معاملة التخزين'));try{value=cb(obj,abort);}catch(err){abort(err);}});}
export async function allEvents(){const db=await open();return new Promise((ok,bad)=>{const r=db.transaction('events','readonly').objectStore('events').getAll();r.onsuccess=()=>ok(r.result.sort((a,b)=>(a.at||'').localeCompare(b.at||'')||a.id.localeCompare(b.id)));r.onerror=()=>bad(r.error);});}
export const putEvent=async event=>commitEvents([event]);
/** Save the replacement invoice, reversal and new catalogue items together.
 * A duplicate event id or storage failure rolls back the entire business action.
 */
export async function commitEvents(events){
 if(!Array.isArray(events)||!events.length)throw new Error('لا توجد عمليات للحفظ');
 const ids=new Set();
 for(const e of events){
  if(!e||typeof e.id!=='string'||!e.id||ids.has(e.id))throw new Error('معرّف عملية مفقود أو مكرر');
  ids.add(e.id);
 }
 return operate('events','readwrite',(store,abort)=>{
  // Check references and invoice correction lineage against the latest committed
  // log inside this write transaction. One transfer is one immutable event, and
  // neither another tab nor a restore can insert only one side of that transfer.
  const request=store.getAll();
  request.onsuccess=()=>{
   try{
    if(request.result.some(e=>ids.has(e.id)))throw new Error('معرّف عملية موجود مسبقًا؛ لم يتم حفظ العملية');
    prepareEventImport(request.result,events);
    for(const event of events)store.add(event);
   }catch(error){abort(error);}
  };
 });
}
export const hasEvent=async id=>{const db=await open();return new Promise((ok,bad)=>{const r=db.transaction('events','readonly').objectStore('events').getKey(id);r.onsuccess=()=>ok(r.result!==undefined);r.onerror=()=>bad(r.error);});};
export async function metaGet(key,otherwise=null){const db=await open();return new Promise((ok,bad)=>{const r=db.transaction('meta','readonly').objectStore('meta').get(key);r.onsuccess=()=>ok(r.result?.value??otherwise);r.onerror=()=>bad(r.error);});}
export const metaPut=async(key,value)=>operate('meta','readwrite',s=>s.put({key,value}));
export async function pendingEvents(){return (await allEvents()).filter(e=>!e.synced).map(({synced,...e})=>e);}
export async function markSynced(ids){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite'),obj=tx.objectStore('events');for(const id of ids){const r=obj.get(id);r.onsuccess=()=>{if(r.result){r.result.synced=true;obj.put(r.result);}};}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
const eventFingerprint=event=>{const {synced,...content}=event;return JSON.stringify(canonical(content));};
/** Prepare an all-or-nothing merge. Reversal events are not replacement branches:
 * two devices can cancel the same original, but cannot replace it with two invoices.
 */
export function prepareEventImport(existing,events){
 if(!Array.isArray(existing)||!Array.isArray(events))throw new Error('النسخة الاحتياطية غير صالحة');
 const byId=new Map(existing.map(e=>[e.id,e])),incomingIds=new Set(),additions=[];
 for(const event of events){
  if(!event||typeof event.id!=='string'||!event.id||incomingIds.has(event.id))throw new Error('سجل مفقود أو مكرر داخل النسخة');
  incomingIds.add(event.id);
  if(byId.has(event.id)){
   if(eventFingerprint(byId.get(event.id))!==eventFingerprint(event))throw new Error('تعارض في سجل محفوظ بنفس المعرّف؛ لم تُستعد أي عملية من النسخة');
  }else{
   byId.set(event.id,event);additions.push({...event,synced:true});
  }
 }
 const replacements=new Map();
 for(const event of byId.values()){
  if(event.type!=='invoice.create')continue;
  const target=event.payload?.replaces;
  if(target===undefined||target===null||target==='')continue;
  if(typeof target!=='string')throw new Error('مرجع تعديل فاتورة غير صالح؛ لم تُستعد أي عملية من النسخة');
  if(replacements.has(target)&&replacements.get(target)!==event.id)throw new Error('تعارض بين تعديلين مختلفين لنفس الفاتورة؛ لم تُستعد أي عملية من النسخة. يجب تحديد التعديل الصحيح قبل الدمج');
  replacements.set(target,event.id);
 }
 validateNewAccountingEvents([...byId.values()]);
 return additions;
}
export async function importEvents(events){
 if(!Array.isArray(events))throw new Error('النسخة الاحتياطية غير صالحة');
 // Read and validate the complete merge before any write, within one transaction.
 // IndexedDB serializes competing writers until this transaction completes/aborts.
 return operate('events','readwrite',(store,abort)=>{
  const request=store.getAll();
  request.onsuccess=()=>{
   try{for(const event of prepareEventImport(request.result,events))store.add(event);}
   catch(error){abort(error);}
  };
 });
}
