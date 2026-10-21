import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createEventBatch,invoiceEventEntries} from '../apps/client/js/event-batch.js';
import {summary,statement,activeRecords} from '../apps/client/js/ledger.js';

test('correcting a historical invoice preserves its reporting day and opening debt, with a current correction audit',()=>{
 const original={id:'old-invoice',type:'invoice.create',at:'2026-10-20T12:00:00Z',payload:{kind:'sale',partyId:'customer',currency:'USD',total:100,paid:0,payment:'credit',invoiceNumber:'INV-20261020-0001',items:[{title:'Original item',qty:1,price:100}]}};
 const payload={...original.payload,total:120.25,items:[{title:'Corrected item',qty:1,price:120.25}],replaces:original.id};
 let count=0;
 const correction=createEventBatch([
  {type:'item.add',payload:{id:'new-item',name:'Corrected item'}},
  ...invoiceEventEntries(payload,original)
 ],{now:'2026-10-21T15:00:00Z',uuid:()=>`event-${++count}`});
 const replacement=correction.find(e=>e.type==='invoice.create');
 assert.equal(replacement.at,original.at);
 assert.equal(replacement.payload.invoiceNumber,original.payload.invoiceNumber);
 assert.equal(correction.find(e=>e.type==='event.reverse').at,'2026-10-21T15:00:00Z');
 assert.equal(correction.find(e=>e.type==='item.add').at,'2026-10-21T15:00:00Z');
 const events=[original,...correction];
 assert.equal(activeRecords(events).filter(e=>e.type==='invoice.create').length,1);
 assert.equal(summary(events,'2026-10-20','2026-10-20','USD').sales,120.25);
 assert.equal(summary(events,'2026-10-21','2026-10-21','USD').sales,0);
 assert.equal(statement(events,'customer','2026-10-21','2026-10-31','USD').opening,120.25);
 const fresh=createEventBatch(invoiceEventEntries(payload),{now:'2026-10-22T10:00:00Z',uuid:()=>`new-${++count}`});
 assert.equal(fresh.length,1);assert.equal(fresh[0].at,'2026-10-22T10:00:00Z');
});
