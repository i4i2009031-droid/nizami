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
async function operate(store,mode,cb){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction(store,mode);const obj=tx.objectStore(store);let value;try{value=cb(obj);}catch(err){reject(err);return;}tx.oncomplete=()=>resolve(value?.result);tx.onerror=()=>reject(tx.error);});}
export async function allEvents(){const db=await open();return new Promise((ok,bad)=>{const r=db.transaction('events','readonly').objectStore('events').getAll();r.onsuccess=()=>ok(r.result.sort((a,b)=>(a.at||'').localeCompare(b.at||'')||a.id.localeCompare(b.id)));r.onerror=()=>bad(r.error);});}
export const putEvent=async event=>operate('events','readwrite',s=>s.put(event));
export const hasEvent=async id=>{const db=await open();return new Promise((ok,bad)=>{const r=db.transaction('events','readonly').objectStore('events').getKey(id);r.onsuccess=()=>ok(r.result!==undefined);r.onerror=()=>bad(r.error);});};
export async function metaGet(key,otherwise=null){const db=await open();return new Promise((ok,bad)=>{const r=db.transaction('meta','readonly').objectStore('meta').get(key);r.onsuccess=()=>ok(r.result?.value??otherwise);r.onerror=()=>bad(r.error);});}
export const metaPut=async(key,value)=>operate('meta','readwrite',s=>s.put({key,value}));
export async function pendingEvents(){return (await allEvents()).filter(e=>!e.synced).map(({synced,...e})=>e);}
export async function markSynced(ids){const db=await open();return new Promise((resolve,reject)=>{const tx=db.transaction('events','readwrite'),obj=tx.objectStore('events');for(const id of ids){const r=obj.get(id);r.onsuccess=()=>{if(r.result){r.result.synced=true;obj.put(r.result);}};}tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);});}
export async function importEvents(events){for(const e of events){if(!await hasEvent(e.id))await putEvent({...e,synced:true});}}
