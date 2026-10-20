import {test} from 'node:test';import assert from 'node:assert/strict';
import {statement,summary,activeRecords,groupedSummary} from '../apps/client/js/ledger.js';
const make=(type,payload,id,at='2026-10-20T12:00:00.000Z')=>({id,type,payload,at});
test('cash/credit and له/عليه agree across receipts/payments',()=>{
 const r=[make('invoice.create',{kind:'sale',payment:'credit',partyId:'p1',total:5000,items:[{title:'قات',qty:1,price:5000}]},'1'),make('receipt.create',{partyId:'p1',amount:2000},'2'),make('invoice.create',{kind:'purchase',payment:'credit',partyId:'p2',total:9000,items:[{title:'قات',qty:3,price:3000}]},'3'),make('payment.create',{partyId:'p2',amount:3500},'4'),make('expense.create',{amount:1000,category:'تنقلات'},'5')];
 assert.equal(statement(r,'p1').closing,3000);assert.equal(statement(r,'p2').closing,-5500);
 const x=summary(r);assert.equal(x.sales,5000);assert.equal(x.purchases,9000);assert.equal(x.expenses,1000);assert.equal(x.cashMovement,2000-3500-1000);assert.equal(x.tradingEstimate,-5000);
});
test('statement opening balance and reversal retain exact result',()=>{
 const r=[make('invoice.create',{kind:'sale',payment:'credit',partyId:'p',total:500,items:[{title:'test',qty:1,price:500}]},'abc','2026-08-01T01:00:00Z'),make('receipt.create',{partyId:'p',amount:200},'def','2026-09-02T01:00:00Z'),make('event.reverse',{ref:'def'},'ghi')];
 const s=statement(r,'p','2026-09-01','2026-10-31');assert.equal(s.opening,500);assert.equal(s.rows.length,0);assert.equal(s.closing,500);assert.equal(activeRecords(r).length,1);
});
test('grouped reports are chronological',()=>{
 const rows=[make('expense.create',{amount:25},'r1','2026-01-30T10:00:00Z'),make('expense.create',{amount:40},'r2','2026-03-01T10:00:00Z')];
 const out=groupedSummary(rows,'2026-01-01','2026-12-31','month');assert.deepEqual(out.map(x=>x.period),['2026-03','2026-01']);
});
import {itemsCatalog,parties,summaryByCurrency,rounded} from '../apps/client/js/ledger.js';
test('mixed currencies remain separate and partial payments change debt precisely',()=>{
 const now='2026-10-21T13:00:00Z';
 const rows=[
  make('invoice.create',{kind:'sale',payment:'credit',partyId:'p',currency:'YER',total:10000,paid:3500,items:[{title:'قات',qty:2,price:5000}]},'yer',now),
  make('invoice.create',{kind:'sale',payment:'credit',partyId:'p',currency:'USD',total:20.75,paid:5.25,items:[{title:'قات',qty:1,price:20.75}]},'usd',now),
  make('invoice.create',{kind:'purchase',payment:'credit',partyId:'supplier',currency:'SAR',total:55.50,paid:5.50,items:[{title:'مواد',qty:1,price:55.50}]},'sar',now)
 ];
 const summaries=summaryByCurrency(rows);
 assert.deepEqual(summaries.map(x=>x.sales),[10000,20.75,0]);
 assert.equal(summary(rows).cashMovement,3500);
 assert.equal(statement(rows,'p','0000-01-01','9999-12-31','YER').closing,6500);
 assert.equal(statement(rows,'p','0000-01-01','9999-12-31','USD').closing,15.5);
 assert.equal(statement(rows,'supplier','0000-01-01','9999-12-31','SAR').closing,-50);
 assert.equal(rounded(2.225,'USD'),2.23);
});
test('customer and item changes are reflected across every module without duplicate entries',()=>{
 const rows=[
 make('party.add',{id:'p1',name:'محل أحمد',type:'customer',phone:'967777000000'},'a'),
 make('item.add',{id:'i1',name:'قات ممتاز',barcode:'123',prices:{YER:4500},unit:'ربطة'},'b'),
 make('party.update',{id:'p1',name:'محل أحمد الجديد',phone:'967777123456'},'c'),
 make('item.update',{id:'i1',name:'قات ممتاز',barcode:'456',prices:{YER:4600},unit:'ربطة'},'d')
 ];
 assert.equal(parties(rows).length,1);assert.equal(parties(rows)[0].phone,'967777123456');
 assert.equal(itemsCatalog(rows).length,1);assert.equal(itemsCatalog(rows)[0].prices.YER,4600);
});
test('opening balance and receipts reconcile له/عليه without mixing transactions',()=>{
 const rows=[make('balance.open',{partyId:'p',amount:700,direction:'receivable',currency:'YER'},'o','2026-01-01T10:00:00Z'),make('receipt.create',{partyId:'p',amount:200,currency:'YER'},'r','2026-02-01T10:00:00Z')];
 const st=statement(rows,'p','2026-02-01','2026-02-28','YER');
 assert.equal(st.opening,700);assert.equal(st.rows.length,1);assert.equal(st.closing,500);
});

import {dateOnly} from '../apps/client/js/ledger.js';
test('business-day reports use Yemen local date near UTC midnight',()=>{
 assert.equal(dateOnly('2026-10-20T22:30:00.000Z'),'2026-10-21');
 const record=make('invoice.create',{kind:'sale',payment:'cash',currency:'YER',total:2500,paid:2500,items:[{title:'قات',qty:1,price:2500}]},'midnight','2026-10-20T22:30:00.000Z');
 assert.equal(summary([record],'2026-10-20','2026-10-20').sales,0);
 assert.equal(summary([record],'2026-10-21','2026-10-21').sales,2500);
});
