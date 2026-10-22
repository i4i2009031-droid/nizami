import test from 'node:test';
import assert from 'node:assert/strict';
import {invoiceLineAmount,invoiceItemsTotal,dailySalesFigures,nextInvoiceNumber} from '../apps/client/js/invoice-math.js';

test('fractional quantities use exact decimal half-up rounding for each currency',()=>{
 assert.equal(invoiceLineAmount(1.005,1,'USD'),1.01);
 assert.equal(invoiceLineAmount('0.5','0.29','SAR'),0.15);
 assert.equal(invoiceLineAmount(0.5,1,'YER'),1);
 assert.equal(invoiceLineAmount('1.0049',1,'USD'),1);
 assert.equal(invoiceLineAmount('1.0051',1,'USD'),1.01);
 assert.equal(invoiceLineAmount('5e-1',0.01,'USD'),0.01);
 assert.equal(invoiceLineAmount('.5','.29','USD'),0.15);
});

test('unit price rounds before multiplying, matching the saved and displayed price',()=>{
 assert.equal(invoiceLineAmount(0.5,1.005,'USD'),0.51);
 assert.equal(invoiceLineAmount(0.5,1.004,'USD'),0.5);
 assert.equal(invoiceLineAmount(1.5,1.5,'YER'),3);
 assert.equal(invoiceLineAmount(1000000,0,'USD'),0);
});

test('invoice total sums displayed line amounts rather than rounding the raw aggregate',()=>{
 assert.equal(invoiceItemsTotal([{qty:0.5,price:0.01},{qty:0.5,price:0.01}],'USD'),0.02);
 assert.equal(invoiceItemsTotal([{qty:0.5,price:1},{qty:0.5,price:1}],'YER'),2);
 assert.equal(invoiceItemsTotal(Array.from({length:80},()=>({qty:0.5,price:0.29})),'SAR'),12);
 assert.equal(invoiceItemsTotal([],'USD'),0);
});

test('invalid quantities, prices, currencies and unsafe invoice totals are rejected',()=>{
 for(const qty of [0,-1,Infinity,NaN,true,null,'','1e-9999',1000001,'1000000.0000000000000000001','0x10'])assert.throws(()=>invoiceLineAmount(qty,1,'USD'));
 for(const price of [-1,Infinity,NaN,true,null,'',1e12+1,'1000000000000.0000000000001'])assert.throws(()=>invoiceLineAmount(1,price,'USD'));
 assert.equal(invoiceLineAmount(1,1e12,'USD'),1e12);
 assert.throws(()=>invoiceLineAmount(1e6,1e12,'USD'),/limit|precision/);
 assert.throws(()=>invoiceItemsTotal([{qty:1,price:1e12},{qty:1,price:0.01}],'USD'),/limit/);
 assert.throws(()=>invoiceItemsTotal([null],'USD'));
 assert.throws(()=>invoiceItemsTotal({},'USD'));
 assert.throws(()=>invoiceLineAmount(1,1,'BTC'));
});

const event=(id,number,kind='sale',extra={})=>({id,type:'invoice.create',at:'2026-10-22T09:00:00Z',payload:{kind,invoiceNumber:number,...extra}});
const reverse=id=>({id:'reverse-'+id,type:'event.reverse',payload:{ref:id}});
test('number allocation preserves cancelled history and uses max sequence rather than record count',()=>{
 const events=[event('one','INV-20261022-0001'),event('nine','INV-20261022-0009'),reverse('nine')];
 assert.equal(nextInvoiceNumber(events,'sale','2026-10-22'),'INV-20261022-0010');
 assert.equal(nextInvoiceNumber(events,'purchase','2026-10-22'),'PUR-20261022-0001');
 assert.equal(nextInvoiceNumber(events,'sale','2026-10-23'),'INV-20261023-0001');
});

test('several historical corrections share one reserved number and do not advance unrelated dates',()=>{
 const original=event('original','INV-20261021-0004');
 const corrected=event('corrected','INV-20261021-0004','sale',{replaces:'original'});
 const correctedAgain=event('corrected-again','INV-20261021-0004','sale',{replaces:'corrected'});
 const events=[original,reverse('original'),corrected,reverse('corrected'),correctedAgain,event('today','INV-20261022-0002'),event('purchase','PUR-20261022-0050','purchase')];
 assert.equal(nextInvoiceNumber(events,'sale','2026-10-21'),'INV-20261021-0005');
 assert.equal(nextInvoiceNumber(events,'sale','2026-10-22'),'INV-20261022-0003');
 assert.equal(nextInvoiceNumber(events,'purchase','2026-10-22'),'PUR-20261022-0051');
});

test('invoice numbering handles full sequence, malformed references and Yemen midnight',()=>{
 const events=[event('large','INV-20261022-9999'),event('bad','INV-20261022-99999oops'),event('later','INV-20261023-99999')];
 assert.equal(nextInvoiceNumber(events,'sale','2026-10-21T22:30:00Z'),'INV-20261022-10000');
 assert.equal(nextInvoiceNumber([],'sale','2026-10-22'),'INV-20261022-0001');
 assert.throws(()=>nextInvoiceNumber([],'sale','2026-02-30'),/date/);
 assert.throws(()=>nextInvoiceNumber([],'other','2026-10-22'));
});

test('daily figures sum integer cents and use the historical cash/credit paid fallback',()=>{
 const records=Array.from({length:100},(_,i)=>event('cent-'+i,'INV-'+i,'sale',{currency:'USD',total:0.01,payment:'cash'}));
 records.push(event('partial','INV-partial','sale',{currency:'USD',total:0.29,paid:0.1,payment:'credit'}));
 records.push(event('debt','INV-debt','sale',{currency:'USD',total:0.02,payment:'credit'}));
 assert.deepEqual(dailySalesFigures(records,'USD'),{total:1.31,paid:1.1,due:0.21});
 assert.deepEqual(dailySalesFigures([],'SAR'),{total:0,paid:0,due:0});
 assert.deepEqual(dailySalesFigures([event('legacy','INV-old','sale',{total:5,payment:'cash'})],'YER'),{total:5,paid:5,due:0});
});

test('daily figures reject mixed currencies and payments greater than invoice totals',()=>{
 assert.throws(()=>dailySalesFigures([event('sar','INV-1','sale',{currency:'SAR',total:1,payment:'cash'})],'USD'),/currency/);
 assert.throws(()=>dailySalesFigures([event('unknown','INV-3','sale',{currency:'BTC',total:1,payment:'cash'})],'YER'),/currency/);
 assert.throws(()=>dailySalesFigures([event('overpaid','INV-2','sale',{currency:'USD',total:1,paid:1.01,payment:'credit'})],'USD'),/exceeds/);
 assert.throws(()=>dailySalesFigures([reverse('one')],'USD'));
});
