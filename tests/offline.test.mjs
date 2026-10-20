import {test} from 'node:test';import assert from 'node:assert/strict';
import {buildPortableBackup,parsePortableBackup,backupFileName} from '../apps/client/js/backup.js';
import {randomHex,hashPassword,equalSecret} from '../apps/client/js/subscription.js';

test('portable local JSON includes settings/logo, contacts, stock, invoices and currencies, and restores intact',()=>{
 const events=[
  {id:'1',type:'settings.update',at:'2026-10-20T12:00:00Z',payload:{name:'تاجر قطفة',logo:'data:image/jpeg;base64,xxx',currency:'YER'}},
  {id:'2',type:'party.add',at:'2026-10-20T12:00:00Z',payload:{name:'أحمد',phone:'967777123456'}},
  {id:'3',type:'item.add',at:'2026-10-20T12:00:00Z',payload:{name:'صنف',prices:{YER:500,USD:2,SAR:7}}},
  {id:'4',type:'invoice.create',at:'2026-10-20T12:00:00Z',payload:{currency:'USD',total:20}}
 ];
 const data=buildPortableBackup('merchant-01',events,'2026-10-20T12:00:00Z');
 const out=parsePortableBackup(JSON.stringify(data),'merchant-01');assert.deepEqual(out.events,events);
 assert.match(backupFileName(new Date('2026-10-20')),/^Qatfah_Backup_2026-10-20.json$/);
 assert.throws(()=>parsePortableBackup(JSON.stringify(data),'merchant-02'),/تخص حساب/);
});
test('portable JSON validates duplicated and corrupt events',()=>{
 const v=buildPortableBackup('demo',[{id:'a',type:'party.add',at:'2026-10-20',payload:{}}]);
 assert.throws(()=>parsePortableBackup('oops','demo'),/JSON/);
 assert.throws(()=>parsePortableBackup(JSON.stringify({...v,events:[...v.events,...v.events]}),'demo'),/مكرر/);
 assert.throws(()=>parsePortableBackup(JSON.stringify({...v,events:[{...v.events[0],payload:{currency:'BTC'}}]}),'demo'),/عملة/);
});
test('subscription client password verifier is slow salted PBKDF2 and constant time comparison',async()=>{
 const salt=randomHex(),first=await hashPassword('W5am!ZuhVQ-PJ3abm-tN',salt),second=await hashPassword('W5am!ZuhVQ-PJ3abm-tN',salt);
 assert.equal(first,second);assert.equal(first.length,64);assert.equal(equalSecret(first,second),true);assert.equal(equalSecret(first,second.slice(1)),false);
});
