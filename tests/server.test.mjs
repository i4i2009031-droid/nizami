import { test } from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {cashbook,journalAudit} from '../apps/client/js/money-services.js';
import {statement} from '../apps/client/js/ledger.js';
const temp=mkdtempSync(join(tmpdir(),'qatfah-test-'));
const environmentKeys=['NODE_ENV','QATFAH_DATA_DIR','QATFAH_ADMIN_USER','QATFAH_ADMIN_PASSWORD','QATFAH_TOKEN_SECRET','GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','QATFAH_GOOGLE_TOKEN_KEY','QATFAH_WHATSAPP_ENABLED','QATFAH_WA_CLOUD_ACCOUNTS'];
const oldEnvironment=new Map(environmentKeys.map(key=>[key,process.env[key]]));
// These HTTP cases explicitly exercise unconfigured external integrations.
// Do not inherit workstation credentials or start an external WhatsApp socket.
for(const key of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','QATFAH_GOOGLE_TOKEN_KEY','QATFAH_WA_CLOUD_ACCOUNTS'])delete process.env[key];
process.env.QATFAH_WHATSAPP_ENABLED='false';
process.env.NODE_ENV='test';process.env.QATFAH_DATA_DIR=temp;process.env.QATFAH_ADMIN_USER='admin';process.env.QATFAH_ADMIN_PASSWORD='test-secure-admin-pass-1234';process.env.QATFAH_TOKEN_SECRET='a'.repeat(64);
const {createApp}=await import('../server/index.mjs');const server=createApp();await new Promise(done=>server.listen(0,'127.0.0.1',done));const root=`http://127.0.0.1:${server.address().port}`;
async function api(path,{token,method='GET',body}={}){const r=await fetch(root+path,{method,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},body:body?JSON.stringify(body):undefined});return {status:r.status,...await r.json()};}
const login=async(username,password)=>api('/api/auth/login',{method:'POST',body:{username,password}});
test('private server health, auth, admin, isolated customer sync',async()=>{
 assert.equal((await api('/api/health')).ok,true);
 assert.equal((await login('admin','wrong')).status,401);
 const admin=await login('admin','test-secure-admin-pass-1234');assert.equal(admin.user.role,'admin');
 const a=await api('/api/admin/users',{token:admin.token,method:'POST',body:{username:'client1',password:'SecurePass100',storeName:'اختبار أحمد',phone:'967777777777',expiresAt:'2028-01-01',active:true}});assert.equal(a.status,201);assert.equal(a.user.storeName,'اختبار أحمد');
 const b=await api('/api/admin/users',{token:admin.token,method:'POST',body:{username:'client2',password:'SecurePass200',storeName:'اختبار ب',expiresAt:'2028-01-01'}});assert.equal(b.status,201);
 const client=await login('client1','SecurePass100');const client2=await login('client2','SecurePass200');assert.equal(client.status,200);
 assert.equal((await api('/api/admin/users',{token:client.token})).status,401);
 const e={id:'fedcbaaa-1234-1234-1234-bbbbccccdddd',type:'invoice.create',at:'2026-10-20T20:00:00.000Z',payload:{kind:'sale',payment:'credit',partyId:'party-1',items:[{title:'صنف',qty:2,price:400}],total:800}};
 const pushed=await api('/api/sync/push',{token:client.token,method:'POST',body:{events:[e]}});assert.equal(pushed.status,200);
 assert.equal((await api('/api/sync/pull?after=0',{token:client.token})).events.length,1);
 assert.equal((await api('/api/sync/pull?after=0',{token:client2.token})).events.length,0);
 const duplicate=await api('/api/sync/push',{token:client.token,method:'POST',body:{events:[e]}});assert.equal(duplicate.status,200);assert.equal((await api('/api/sync/pull?after=0',{token:client.token})).events.length,1);
 const rev=await api(`/api/admin/users/${a.user.id}`,{token:admin.token,method:'PATCH',body:{active:false}});assert.equal(rev.user.active,false);
 assert.equal((await api('/api/sync/pull?after=0',{token:client.token})).status,401);
});
test.after(async()=>{try{await new Promise(done=>server.close(done));rmSync(temp,{recursive:true,force:true});}finally{for(const [key,value] of oldEnvironment){if(value===undefined)delete process.env[key];else process.env[key]=value;}}});
test('API validates multi-currency invoices, tenant catalog synchronization, Drive and WhatsApp configuration safely',async()=>{
 const admin=await login('admin','test-secure-admin-pass-1234');
 const created=await api('/api/admin/users',{token:admin.token,method:'POST',body:{username:'merchant_currency',password:'SecurePass300',storeName:'محل العملات',expiresAt:'2028-01-01'}});
 assert.equal(created.status,201);
 const merchant=await login('merchant_currency','SecurePass300');const token=merchant.token;
 assert.equal((await api('/api/drive/status',{token})).connected,false);
 assert.equal((await api('/api/drive/start',{token,method:'POST',body:{}})).status,503);
 assert.equal((await api('/api/whatsapp/status',{token})).status,'unavailable');
 assert.equal((await api('/api/whatsapp/send-document',{token,method:'POST',body:{phone:'967777123456',filename:'demo.pdf',caption:'demo',base64:'JVBERi0xLjQ='}})).status,'unavailable');
 const mk=(id,type,payload)=>({id,type,at:'2026-10-21T14:00:00Z',payload});
 const item=mk('aaaaaaaa-1111-4111-8111-111111111111','item.add',{id:'itemA',name:'قات ممتاز',barcode:'991',unit:'ربطة',prices:{YER:1000,USD:4.75,SAR:15.50}});
 const party=mk('aaaaaaaa-2222-4222-8222-222222222222','party.add',{id:'partyA',name:'أحمد عبدالله',type:'customer',phone:'967777123456'});
 const invoice=mk('aaaaaaaa-3333-4333-8333-333333333333','invoice.create',{partyId:'partyA',kind:'sale',payment:'credit',currency:'USD',paid:2.50,total:19.00,items:[{title:'قات ممتاز',qty:4,price:4.75,itemId:'itemA'}],invoiceNumber:'INV-20261021-0001'});
 const saved=await api('/api/sync/push',{token,method:'POST',body:{events:[item,party,invoice]}});
 assert.equal(saved.status,200);
 assert.equal((await api('/api/sync/pull?after=0',{token})).events.length,3);
 const invalid=mk('aaaaaaaa-4444-4444-8444-444444444444','invoice.create',{partyId:'partyA',kind:'sale',payment:'credit',currency:'USD',paid:999,total:19,items:[{title:'قات ممتاز',qty:4,price:4.75}]});
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events:[invalid]}})).status,422);
 const badCurrency=mk('aaaaaaaa-5555-4555-8555-555555555555','expense.create',{amount:200,currency:'BTC'});
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events:[badCurrency]}})).status,422);
 assert.equal((await api('/api/sync/pull?after=0',{token})).events.length,3);
});

test('API journals and cash movements retain atomic references, precision and isolated balances',async()=>{
 const admin=await login('admin','test-secure-admin-pass-1234');
 const created=await api('/api/admin/users',{token:admin.token,method:'POST',body:{username:'merchant_journal',password:'SecurePassJournal300',storeName:'اختبار القيود',expiresAt:'2028-01-01'}});
 assert.equal(created.status,201);
 const {token}=await login('merchant_journal','SecurePassJournal300');
 const mk=(type,payload)=>({id:randomUUID(),type,at:'2026-10-21T14:00:00Z',payload});
 const first=mk('party.add',{id:'journal-a',name:'أحمد'}),second=mk('party.add',{id:'journal-b',name:'محمد'});
 const opening=mk('cash.open',{currency:'USD',account:'cash',amount:10.05});
 const debit=mk('journal.create',{kind:'debit',method:'book',partyId:'journal-a',currency:'USD',amount:5.25});
 const receipt=mk('journal.create',{kind:'credit',method:'cash',partyId:'journal-a',currency:'USD',amount:1.1});
 const transfer=mk('journal.create',{kind:'transfer',method:'book',fromPartyId:'journal-a',toPartyId:'journal-b',currency:'USD',amount:2.35});
 const expense=mk('cash.movement',{direction:'out',category:'expense',currency:'USD',amount:0.8});
 const events=[first,second,opening,debit,receipt,transfer,expense];
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events}})).status,200);
 const loaded=(await api('/api/sync/pull?after=0',{token})).events;
 assert.equal(loaded.length,events.length);assert.equal(journalAudit(loaded).balanced,true);
 assert.equal(cashbook(loaded,'USD').closing,10.35);
 assert.equal(statement(loaded,'journal-a','0000-01-01','9999-12-31','USD').closing,1.8);
 assert.equal(statement(loaded,'journal-b','0000-01-01','9999-12-31','USD').closing,2.35);
 const invalid=mk('journal.create',{...transfer.payload,toPartyId:'missing'}),unrelated=mk('cash.movement',{direction:'in',currency:'USD',amount:999});
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events:[unrelated,invalid]}})).status,422);
 assert.equal((await api('/api/sync/pull?after=0',{token})).events.length,events.length);
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events:[{...receipt,id:randomUUID(),payload:{...receipt.payload,amount:1.005}}]}})).status,422);
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events:[{...receipt,payload:{...receipt.payload,amount:99}}]}})).status,422);
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events:[receipt]}})).status,200);
 assert.equal((await api('/api/sync/pull?after=0',{token})).events.length,events.length);
});

test('API honors per-line invoice rounding while preserving unflagged historical totals',async()=>{
 const admin=await login('admin','test-secure-admin-pass-1234');
 const created=await api('/api/admin/users',{token:admin.token,method:'POST',body:{username:'merchant_invoice_math',password:'SecurePassInvoice300',storeName:'اختبار دقة الفواتير',expiresAt:'2028-01-01'}});
 assert.equal(created.status,201);
 const {token}=await login('merchant_invoice_math','SecurePassInvoice300');
 const invoice=(items,total,extra={})=>({id:randomUUID(),type:'invoice.create',at:'2026-10-22T12:00:00Z',payload:{kind:'sale',currency:'USD',payment:'cash',paid:total,total,items,...extra}});
 const halves=[{title:'نصف الوحدة الأولى',qty:0.5,price:0.01},{title:'نصف الوحدة الثانية',qty:0.5,price:0.01}];
 const decimalTie=[{title:'كمية كسرية',qty:1.005,price:1}];
 const accepted=[
  invoice(halves,0.02,{roundingMode:'per_line'}),
  invoice(halves,0.01),
  invoice(decimalTie,1.01,{roundingMode:'per_line'}),
  invoice(decimalTie,1)
 ];
 assert.equal((await api('/api/sync/push',{token,method:'POST',body:{events:accepted}})).status,200);
 const loaded=(await api('/api/sync/pull?after=0',{token})).events;
 assert.equal(loaded.length,4);assert.equal(cashbook(loaded,'USD').closing,2.04);
 for(const invalid of [
  invoice(halves,0.01,{roundingMode:'per_line'}),
  invoice(halves,0.02),
  invoice(decimalTie,1,{roundingMode:'per_line'}),
  invoice([{title:'صنف',qty:1,price:1}],1,{roundingMode:'unknown'}),
  invoice([{title:'صنف',qty:1,price:1}],1,{roundingMode:null}),
  invoice([{title:'صنف',qty:true,price:1}],1,{roundingMode:'per_line'}),
  invoice([null],1,{roundingMode:'per_line'})
 ]){
  const response=await api('/api/sync/push',{token,method:'POST',body:{events:[invalid]}});
  assert.equal(response.status,422,JSON.stringify(response));
 }
 assert.equal((await api('/api/sync/pull?after=0',{token})).events.length,4,'invalid invoice batches must not alter the log');
});
