import {test} from 'node:test';
import assert from 'node:assert/strict';
import {persistSessionObject,readSessionObject,clearSessionObject,SESSION_KEY} from '../apps/client/js/session.js';

function memoryStorage() {
 const values = new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,val)=>values.set(key,val),removeItem:key=>values.delete(key)};
}
const customer = () => ({mode:'github',user:{id:'client-1',username:'testuser',storeName:'محل اختبار',expiresAt:'2030-12-31'},lastChecked:Date.now()});

test('successful subscriber login persists without leaking the password',()=>{
 const storage=memoryStorage();
 const session={...customer(),password:'should-not-store',token:'should-not-store',user:{...customer().user,password:'should-not-store'}};
 persistSessionObject(session,storage);
 assert.equal(storage.getItem(SESSION_KEY).includes('should-not-store'),false);
 assert.equal(readSessionObject(storage).user.id,'client-1');
 assert.equal(readSessionObject(storage).mode,'github');
});
test('demo login preserves an offline session and logout clears it',()=>{
 const storage=memoryStorage(),session={mode:'demo',user:{id:'demo',username:'demo',expiresAt:'2099-12-31'},lastChecked:Date.now()};
 persistSessionObject(session,storage);
 assert.equal(readSessionObject(storage).user.id,'demo');
 clearSessionObject(storage);
 assert.equal(readSessionObject(storage),null);
});
test('bad or missing storage cannot crash the login screen',()=>{
 const storage=memoryStorage();
 assert.equal(readSessionObject(storage),null);
 storage.setItem(SESSION_KEY,'broken-json');
 assert.equal(readSessionObject(storage),null);
 storage.setItem(SESSION_KEY,'{"mode":"github","user":{}}');
 assert.equal(readSessionObject(storage),null);
 assert.throws(()=>persistSessionObject({mode:'github'},storage),/جلسة غير صالحة/);
});
test('changing subscription expiration refreshes the saved session',()=>{
 const storage=memoryStorage();
 persistSessionObject(customer(),storage);
 const saved=readSessionObject(storage);
 saved.user.expiresAt='2031-12-31';
 saved.lastChecked=Date.now();
 persistSessionObject(saved,storage);
 assert.equal(readSessionObject(storage).user.expiresAt,'2031-12-31');
 assert.equal(JSON.parse(storage.getItem(SESSION_KEY)).token,undefined);
});
