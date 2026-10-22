import test from 'node:test';
import assert from 'node:assert/strict';
import {statement,summary} from '../apps/client/js/ledger.js';
import {cashbook,accountBalances,journalAudit} from '../apps/client/js/money-services.js';
import {chronologicalOrder} from '../apps/client/js/accounting-primitives.js';
import {prepareEventImport} from '../apps/client/js/storage.js';

const at='2026-10-22T09:00:00Z';
const event=(id,type,payload,time=at)=>({id,type,payload,at:time});
const invoice=(id,total=100,replaces='')=>event(id,'invoice.create',{kind:'sale',payment:'credit',partyId:'customer',currency:'YER',total,paid:0,replaces,items:[{title:'سلعة',qty:1,price:total}]});
const reverse=(id,ref)=>event(id,'event.reverse',{ref});

test('offset timestamps preserve statement opening and every chronological running balance',()=>{
 // The opening entry occurs at 23:00 Yemen time on the previous day, although
 // its literal ISO date is greater than the in-period receipt's UTC date.
 const records=[
  event('opening','balance.open',{partyId:'customer',direction:'receivable',currency:'USD',amount:10},'2026-10-21T00:00:00+04:00'),
  event('receipt','receipt.create',{partyId:'customer',currency:'USD',amount:2},'2026-10-20T23:30:00Z'),
  event('later','payment.create',{partyId:'customer',currency:'USD',amount:1},'2026-10-21T06:00:00+03:00')
 ];
 const result=statement(records,'customer','2026-10-21','2026-10-21','USD');
 assert.equal(result.opening,10);
 assert.deepEqual(result.rows.map(row=>[row.id,row.balance]),[['receipt',8],['later',9]]);
 assert.equal(result.closing,9);
});

test('cashbook orders actual instants rather than ISO spelling and keeps currency partitions',()=>{
 const records=[
  event('open','cash.open',{account:'cash',currency:'SAR',amount:20},'2026-10-20T20:00:00Z'),
  event('first','cash.movement',{direction:'in',category:'capital',currency:'SAR',amount:5.25},'2026-10-21T02:00:00+03:00'),
  event('second','expense.create',{currency:'SAR',amount:2.1},'2026-10-21T00:30:00Z'),
  event('other','cash.movement',{direction:'in',category:'capital',currency:'USD',amount:50},'2026-10-21T00:15:00Z')
 ];
 const cash=cashbook(records,'SAR','2026-10-21','2026-10-21');
 assert.equal(cash.opening,20);
 assert.deepEqual(cash.rows.map(row=>[row.id,row.runningBalance]),[['first',25.25],['second',23.15]]);
 assert.equal(cash.closing,23.15);
 assert.equal(accountBalances(records).SAR.cash,23.15);
 assert.equal(cashbook(records,'USD').closing,50);
 assert.equal(cashbook(records,'YER').closing,0);
 const equalInstant=[{id:'z',at:'2026-10-21T03:00:00+03:00'},{id:'a',at:'2026-10-21T00:00:00Z'}];
 assert.deepEqual(equalInstant.sort(chronologicalOrder).map(x=>x.id),['a','z']);
});

test('incomplete corrections and invalid reversal references never reach saved accounts',()=>{
 const original=invoice('original'),before=structuredClone(original);
 for(const incomplete of [
  [invoice('replacement',120,'original')],
  [invoice('replacement',120,'missing')],
  [invoice('replacement',120,'replacement')],
  [reverse('undo','missing')],
  [reverse('undo','undo')],
  [reverse('first-undo','original'),reverse('second-undo','first-undo')],
  [event('item','item.add',{id:'item',name:'صنف'}),reverse('undo-item','item'),invoice('replacement',120,'item')]
 ])assert.throws(()=>prepareEventImport([original],incomplete),/تصحيح|إلغاء/);
 assert.deepEqual(original,before);
 assert.equal(summary([original]).sales,100);
 assert.equal(statement([original],'customer').closing,100);
});

test('a closed invoice correction loop is rejected while a complete sequential chain reconciles once',()=>{
 const cyclic=[invoice('first',100,'second'),invoice('second',120,'first'),reverse('r1','first'),reverse('r2','second')];
 assert.throws(()=>prepareEventImport([],cyclic),/دائري/);
 const original=invoice('original'),first=invoice('first',120,'original'),second=invoice('second',145,'first');
 const added=prepareEventImport([original],[reverse('r1','original'),first,reverse('r2','first'),second]);
 const combined=[original,...added];
 assert.equal(summary(combined).sales,145);
 assert.equal(statement(combined,'customer').closing,145);
 assert.equal(journalAudit(combined).balanced,true);
});

test('offline saves reject duplicate settlement or cancellation of a still-settled remittance atomically',()=>{
 const issued=event('issue','remittance.issue',{reference:'TEST-001',currency:'USD',amount:30,fee:2});
 const settled=event('settle','remittance.settle',{issuedId:'issue',reference:'TEST-001'});
 const existing=[issued,settled],before=structuredClone(existing);
 assert.throws(()=>prepareEventImport(existing,[event('settle-twice','remittance.settle',settled.payload)]),/already/);
 assert.throws(()=>prepareEventImport(existing,[reverse('cancel-issue','issue')]),/reversed/);
 assert.deepEqual(existing,before);
 const both=prepareEventImport(existing,[reverse('cancel-issue','issue'),reverse('cancel-settlement','settle')]);
 assert.equal(cashbook([...existing,...both],'USD').closing,0);
 assert.equal(cashbook(existing,'USD').closing,2);
});

test('partial cash receipts survive save validation and correction reversal without duplicate cash or debt',()=>{
 const original=invoice('original',100);
 original.payload.paid=25;
 const corrected=invoice('corrected',120,'original');corrected.payload.paid=30;
 const base=prepareEventImport([],[original]);
 assert.equal(cashbook(base).closing,25);assert.equal(statement(base,'customer').closing,75);
 const next=prepareEventImport(base,[reverse('cancel','original'),corrected]);
 const log=[...base,...next];
 assert.equal(cashbook(log).closing,30);assert.equal(statement(log,'customer').closing,90);
 assert.equal(summary(log).sales,120);assert.equal(journalAudit(log).balanced,true);
});

test('restore cannot mark an unpaid invoice as cash or silently change monetary precision',()=>{
 const original=invoice('original');
 const invalid=[
  {...original,payload:{...original.payload,payment:'cash',paid:0}},
  {...original,payload:{...original.payload,paid:101}},
  {...original,payload:{...original.payload,total:0}},
  {...original,payload:{...original.payload,total:1.005,currency:'USD'}},
  {...original,payload:{...original.payload,total:'100'}},
  {...original,payload:{...original.payload,currency:'BTC'}},
  {...original,payload:{...original.payload,payment:'credit',partyId:''}},
  event('expense','expense.create',{amount:1.005,currency:'USD'}),
  event('receipt','receipt.create',{amount:-1,currency:'YER'}),
  event('payment','payment.create',{amount:0,currency:'SAR'}),
  event('cash-open','cash.open',{amount:0.5,account:'cash',currency:'YER'}),
  event('party-open','balance.open',{amount:1,direction:'other',currency:'YER'})
 ];
 for(const malformed of invalid){
  assert.throws(()=>prepareEventImport([],[malformed]),undefined,JSON.stringify(malformed));
 }
 const cash=invoice('legacy-cash');cash.payload.payment='cash';delete cash.payload.paid;delete cash.payload.currency;
 const credit=invoice('legacy-credit');delete credit.payload.paid;delete credit.payload.currency;
 const restored=prepareEventImport([],[cash,credit]);
 assert.equal(cashbook(restored).closing,100);
 assert.equal(statement(restored,'customer').closing,100);
});
