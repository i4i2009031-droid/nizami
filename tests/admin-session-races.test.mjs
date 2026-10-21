import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {subscriptionDate,isSubscriptionActive} from '../apps/admin/js/subscription.js';

const source=fs.readFileSync(new URL('../apps/admin/js/admin.js',import.meta.url),'utf8').replace(/^import[^\n]+\n/,'');
const deferred=()=>{let resolve,reject;const promise=new Promise((ok,bad)=>{resolve=ok;reject=bad;});return {promise,resolve,reject};};
const user=(passwordHash='old-hash')=>({id:'merchant',username:'merchant',active:true,expiresAt:'2030-01-01',passwordHash,salt:'a'.repeat(32),rounds:240000});
const response=data=>({ok:true,status:200,json:async()=>data});
const registry=(sha,subscribers)=>response({sha,content:Buffer.from(JSON.stringify({subscribers})).toString('base64')});

function harness({fetcher=async()=>{throw Error('Unexpected network request');},hasher=async()=> 'derived-hash',encrypt=async()=>new Uint8Array([1,2,3]),storageFails=false}={}){
 const elements=new Map(),calls=[],writes=[],storage=new Map(),alerts=[];
 const element=id=>{
  if(!elements.has(id))elements.set(id,{id,value:'',textContent:'',innerHTML:'',hidden:false,disabled:false,isConnected:true,fields:{},classList:{add(){},remove(){}},reset(){},querySelector(){return element(id+'-button');}});
  return elements.get(id);
 };
 const context=vm.createContext({
  document:{getElementById:element,addEventListener(){}},window:{alert:message=>alerts.push(message)},navigator:{onLine:true},
  FormData:class{constructor(form){this.fields={...form.fields};}get(name){return this.fields[name]??null;}},
  localStorage:{getItem:name=>storage.get(name)??null,setItem(name,value){if(storageFails)throw Error('Storage quota');writes.push([name,value]);storage.set(name,value);}},
  crypto:{randomUUID:()=> 'new-merchant',getRandomValues:array=>array.fill(17),subtle:{encrypt,importKey:async()=>({}),deriveKey:async()=>({}),decrypt:async()=>new TextEncoder().encode('{}')}},
  hashPassword:hasher,randomHex:()=> 'b'.repeat(32),REGISTRY_API:'https://example.test/registry',HASH_ROUNDS:240000,subscriptionDate,isSubscriptionActive,
  fetch:(...args)=>{calls.push(args);return fetcher(...args);},AbortSignal:{timeout:()=>undefined},
  TextEncoder,TextDecoder,Uint8Array,Intl,Date,Promise,console,
  btoa:value=>Buffer.from(value,'binary').toString('base64'),atob:value=>Buffer.from(value,'base64').toString('binary'),
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,confirm:()=>true
 });
 vm.runInContext(source+'\n globalThis.adminTest={loadUsers,pushUsers,saveVault,accountForm,render};',context);
 const run=code=>vm.runInContext(code,context);
 const login=(subscribers=[user()],sha='sha-old')=>run(`sessionGeneration++;resetRegistry();key={};vault={token:'token',metadata:{},cache:${JSON.stringify(subscribers)}};users=${JSON.stringify(subscribers)};registrySha=${JSON.stringify(sha)};`);
 const snapshot=()=>JSON.parse(run('JSON.stringify({users,registrySha,registryReadBusy,registryWriteBusy,sessionGeneration,vault})'));
 const form=(password='')=>{const form=element('account-form');form.fields={username:'merchant',password,expiresAt:'2030-01-01',active:'true',storeName:'متجر',phone:'967777123456'};return form;};
 return {context,api:context.adminTest,run,login,snapshot,element,form,calls,writes,storage,alerts,logout:()=>element('logout').onclick()};
}

test('cached admin accounts remain read-only until the current registry read completes',async()=>{
 const network=deferred(),h=harness({fetcher:()=>network.promise});h.login();
 const loading=h.api.loadUsers();
 assert.equal(h.element('new-user').disabled,true);
 h.run('accountForm(users[0])');assert.equal(h.element('sheet-content').innerHTML,'');
 network.resolve(registry('verified-sha',[user('verified-hash')]));await loading;
 assert.equal(h.element('new-user').disabled,false);assert.equal(h.snapshot().registrySha,'verified-sha');
});

test('a form cannot save a stale account object under a newer registry SHA',async()=>{
 const h=harness();h.login();h.run('accountForm(users[0])');const form=h.form();
 h.run(`users=${JSON.stringify([user('new-password-hash')])};registrySha='sha-new';`);
 await form.onsubmit({preventDefault(){},target:form});
 assert.equal(h.calls.length,0);assert.equal(h.snapshot().users[0].passwordHash,'new-password-hash');
 assert.match(h.element('toast').textContent,/تغيّر سجل المشتركين/);
});

test('a registry change during password hashing rejects the stale save before PUT',async()=>{
 const hashing=deferred(),h=harness({hasher:()=>hashing.promise});h.login();h.run('accountForm(users[0])');
 const form=h.form('StrongRandomPassword123456789');const saving=form.onsubmit({preventDefault(){},target:form});
 h.run(`users=${JSON.stringify([user('fresh-remote-hash')])};registrySha='sha-fresh';`);
 hashing.resolve('locally-derived-hash');await saving;
 assert.equal(h.calls.length,0);assert.equal(h.snapshot().users[0].passwordHash,'fresh-remote-hash');
 assert.match(h.element('toast').textContent,/تغيّر سجل المشتركين/);
});

test('late registry GET cannot change a new login session or its busy flags',async()=>{
 const network=deferred(),h=harness({fetcher:()=>network.promise});h.login();
 const loading=h.api.loadUsers();const rejected=assert.rejects(loading,/تغيرت جلسة/);
 h.logout();h.login([user('new-session-hash')],'new-session-sha');h.run('registryReadBusy=true');
 network.resolve(registry('stale-response-sha',[user('stale-response-hash')]));await rejected;
 assert.equal(h.snapshot().registrySha,'new-session-sha');assert.equal(h.snapshot().users[0].passwordHash,'new-session-hash');
 assert.equal(h.snapshot().registryReadBusy,true);assert.equal(h.writes.length,0);
});

test('acknowledged PUT after logout stays a remote success without mutating the new session',async()=>{
 const network=deferred(),h=harness({fetcher:()=>network.promise});h.login();
 const generation=h.snapshot().sessionGeneration;
 const saving=h.api.pushUsers([user('outgoing-hash')],{expectedSha:'sha-old',generation});
 assert.equal(JSON.parse(h.calls[0][1].body).sha,'sha-old');
 h.logout();h.login([user('new-session-hash')],'new-session-sha');h.run('registryWriteBusy=true');
 network.resolve(response({content:{sha:'acknowledged-old-session-sha'}}));
 const result=await saving;assert.equal(result.remoteSaved,true);assert.equal(result.current,false);
 assert.equal(h.snapshot().registrySha,'new-session-sha');assert.equal(h.snapshot().users[0].passwordHash,'new-session-hash');
 assert.equal(h.snapshot().registryWriteBusy,true);assert.equal(h.writes.length,0);
});

test('late vault encryption cannot overwrite storage after logout and a new login',async()=>{
 const encryption=deferred();let encryptStarted=false;
 const h=harness({encrypt:()=>{encryptStarted=true;return encryption.promise;}});h.login();
 h.storage.set('qatfah_admin_encrypted_vault_2','existing-vault');
 const saving=h.api.saveVault();const rejected=assert.rejects(saving,/تغيرت جلسة/);
 await Promise.resolve();await Promise.resolve();assert.equal(encryptStarted,true);
 h.logout();h.login([user('new-session-hash')],'new-session-sha');
 encryption.resolve(new Uint8Array([1,2,3]));await rejected;
 assert.equal(h.storage.get('qatfah_admin_encrypted_vault_2'),'existing-vault');assert.equal(h.writes.length,0);
});

test('local vault failure does not turn an acknowledged remote PUT into a failed save',async()=>{
 const h=harness({fetcher:async()=>response({content:{sha:'saved-sha'}}),storageFails:true});h.login();
 const result=await h.api.pushUsers([user('saved-hash')],{expectedSha:'sha-old',generation:h.snapshot().sessionGeneration});
 assert.equal(result.remoteSaved,true);assert.equal(result.current,true);assert.equal(result.localSaved,false);
 assert.equal(h.snapshot().registrySha,'saved-sha');assert.equal(h.snapshot().users[0].passwordHash,'saved-hash');
 assert.equal(h.snapshot().registryWriteBusy,false);
});
