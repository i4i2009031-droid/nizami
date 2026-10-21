import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEventImport} from '../apps/client/js/storage.js';
import {summary,statement} from '../apps/client/js/ledger.js';

const at='2026-10-21T09:00:00.000Z';
const invoice=(id,total,replaces='')=>({id,type:'invoice.create',at,synced:false,payload:{kind:'sale',payment:'credit',partyId:'customer',currency:'YER',total,paid:0,items:[{title:'سلعة',qty:1,price:total}],replaces}});
const reverse=(id,ref)=>({id,type:'event.reverse',at,synced:false,payload:{ref}});
const original=invoice('original',100);

function merge(existing,incoming){return [...existing,...prepareEventImport(existing,incoming)];}

test('two devices replacing the same invoice are rejected despite distinct event IDs',()=>{
  const existing=[original,reverse('local-reversal','original'),invoice('local-edit',120,'original')];
  const incoming=[{id:'unrelated-item',type:'item.add',at,payload:{id:'item',name:'سلعة جديدة'}},original,reverse('remote-reversal','original'),invoice('remote-edit',130,'original')];
  const before=structuredClone(existing),backupBefore=structuredClone(incoming);
  assert.throws(()=>prepareEventImport(existing,incoming),/تعارض بين تعديلين مختلفين لنفس الفاتورة/);
  assert.deepEqual(existing,before);assert.deepEqual(incoming,backupBefore);
  assert.equal(summary(existing).sales,120);assert.equal(statement(existing,'customer').closing,120);
});

test('a backup containing competing replacement branches is rejected before additions are returned',()=>{
  const backup=[original,reverse('r','original'),invoice('edit-one',120,'original'),invoice('edit-two',140,'original')];
  assert.throws(()=>prepareEventImport([],backup),/لم تُستعد أي عملية/);
});

test('sequential edits replace the most recent invoice and do not double-count totals',()=>{
  const existing=[original,reverse('r-one','original'),invoice('edit-one',120,'original')];
  const restored=merge(existing,[...existing,reverse('r-two','edit-one'),invoice('edit-two',145,'edit-one')]);
  assert.equal(restored.length,5);assert.equal(summary(restored).sales,145);
  assert.equal(summary(restored).count,1);assert.equal(statement(restored,'customer').closing,145);
});

test('reimporting identical IDs remains idempotent regardless of key order or synced flag',()=>{
  const existing=[original,reverse('reversal','original'),invoice('edit',120,'original')];
  const incoming=existing.map(e=>({payload:Object.fromEntries(Object.entries(e.payload).reverse()),synced:true,at:e.at,type:e.type,id:e.id}));
  assert.deepEqual(prepareEventImport(existing,incoming),[]);
  assert.equal(summary(merge(existing,incoming)).sales,120);
});

test('same-ID content conflicts still reject the entire merge',()=>{
  const changed=invoice('original',999);
  assert.throws(()=>prepareEventImport([original],[{id:'receipt',type:'receipt.create',at,payload:{amount:10}},changed]),/بنفس المعرّف/);
});

test('ordinary manual cancellation is allowed without introducing a replacement invoice',()=>{
  const restored=merge([original],[original,reverse('manual-cancel','original')]);
  assert.equal(summary(restored).sales,0);assert.equal(summary(restored).count,0);
  assert.equal(statement(restored,'customer').closing,0);
});

test('independent reversal records referencing the same invoice are not competing replacements',()=>{
  const existing=[original,reverse('local-reversal','original'),invoice('edited',120,'original')];
  const restored=merge(existing,[original,reverse('remote-reversal','original')]);
  assert.equal(summary(restored).sales,120);assert.equal(summary(restored).count,1);
});

test('edits to different invoices and non-invoice replaces properties do not conflict',()=>{
  const other=invoice('other',200);
  const existing=[original,other,reverse('r-one','original'),invoice('edited-one',110,'original')];
  const restored=merge(existing,[reverse('r-two','other'),invoice('edited-two',240,'other'),{id:'setting',type:'settings.update',at,payload:{replaces:'original',name:'الاسم'}}]);
  assert.equal(summary(restored).sales,350);assert.equal(summary(restored).count,2);
});

test('legacy invoices without a replaces field and new events are imported without mutation',()=>{
  const legacy=invoice('legacy',80);delete legacy.payload.replaces;
  const before=structuredClone(legacy),added=prepareEventImport([], [legacy]);
  assert.equal(added.length,1);assert.equal(added[0].synced,true);
  assert.deepEqual(legacy,before);assert.equal(summary(added).sales,80);
});

test('malformed replacement references and duplicate incoming IDs are rejected',()=>{
  const malformed=invoice('bad',50);malformed.payload.replaces={id:'original'};
  assert.throws(()=>prepareEventImport([original],[malformed]),/مرجع تعديل فاتورة غير صالح/);
  assert.throws(()=>prepareEventImport([],[original,original]),/سجل مفقود أو مكرر/);
  assert.throws(()=>prepareEventImport([],null),/النسخة الاحتياطية غير صالحة/);
});
