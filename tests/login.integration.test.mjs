import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {authenticate,hashPassword,randomHex} from '../apps/client/js/subscription.js';
import {persistSessionObject,readSessionObject} from '../apps/client/js/session.js';

const storage=()=>{
 const values=new Map();
 return {getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
};
test('subscription login can authenticate and save a session from the registry',async()=>{
 const secret='Synthetic-Test-Password-For-CI-Only#',salt=randomHex(),digest=await hashPassword(secret,salt);
 const oldFetch=globalThis.fetch;
 globalThis.fetch=async()=>({ok:true,json:async()=>({subscribers:[{id:'mock-merchant-1',username:'mock-merchant',salt,rounds:240000,passwordHash:digest,active:true,expiresAt:'2035-12-31'}]})});
 try{
  const user=await authenticate('mock-merchant',secret);
  const memory=storage();
  persistSessionObject({mode:'github',user,lastChecked:Date.now(),token:null},memory);
  const restored=readSessionObject(memory);
  assert.equal(restored.user.id,'mock-merchant-1');
  assert.equal(memory.getItem('qatfah_session').includes(secret),false);
  await assert.rejects(()=>authenticate('mock-merchant','wrong-secret'),/بيانات الدخول غير صحيحة/);
 }finally{globalThis.fetch=oldFetch;}
});
test('both the paid login and the demo button import the session saver',async()=>{
 const source=await readFile(new URL('../apps/client/js/app.js',import.meta.url),'utf8');
 assert.match(source,/import\s*\{[^}]*persistSessionObject[^}]*\}\s*from\s*['"]\.\/session\.js['"]/);
 assert.match(source,/const session=\{token:null,mode:'github'.*?persistSessionObject\(session\)/);
 assert.match(source,/const demo=\{mode:'demo'.*?persistSessionObject\(demo\)/);
 const worker=await readFile(new URL('../apps/client/sw.js',import.meta.url),'utf8');
 assert.match(worker,/js\/session\.js/);
 assert.match(worker,/qatfah-client-v\d+/);
});
