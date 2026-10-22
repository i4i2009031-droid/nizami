import {test} from 'node:test';
import assert from 'node:assert/strict';
import {buildEventDocument} from '../apps/client/js/documents.js';

const at='2026-10-21T11:14:17.000Z';
const event=(id,type,payload)=>({id,type,payload,at});
const customers=[
 event('party-a','party.add',{id:'a',name:'محمد أحمد',phone:'967777123451',type:'customer'}),
 event('party-b','party.add',{id:'b',name:'مؤسسة الأمانة',phone:'967777123452',type:'supplier'})
];
const brand={name:'محل قطفة',logo:'data:image/png;base64,AAA',phone:'+967777123450',address:'صنعاء - شارع الزبيري'};

test('invoice document carries current brand and the selected party currency balance without rounding away cents',()=>{
 const sale=event('sale-usd','invoice.create',{kind:'sale',partyId:'a',currency:'USD',total:18.27,paid:0,payment:'credit',invoiceNumber:'INV-112',items:[{title:'صنف',qty:1,price:18.27}]});
 const receipt=event('receipt-usd','receipt.create',{partyId:'a',currency:'USD',amount:3.06});
 const otherCurrency=event('sale-yer','invoice.create',{kind:'sale',partyId:'a',currency:'YER',total:9999,paid:0,payment:'credit'});
 const doc=buildEventDocument(sale,[...customers,sale,receipt,otherCurrency],brand);
 assert.equal(doc.phone,'967777123451');
 assert.equal(doc.filename,'Qatfah-INV-112.pdf');
 assert.equal(doc.invoice.brandInfo,brand);
 assert.equal(doc.invoice.party.name,'محمد أحمد');
 assert.match(doc.invoice.balanceText,/15\.21/);
 assert.doesNotMatch(doc.invoice.balanceText,/9,999/);
});

test('journal PDF definitions retain full note, branding, accounting side and cash method',()=>{
 const note='سداد توريد البضاعة إلى مخزن الأمانة '.repeat(12);
 const journal=event('journal-001','journal.create',{kind:'credit',partyId:'a',amount:120.25,currency:'SAR',method:'cash',notes:note});
 const doc=buildEventDocument(journal,[...customers,journal],brand);
 assert.equal(doc.kind,'general');
 assert.equal(doc.spec.logo,brand.logo);
 assert.equal(doc.spec.brand,brand.name);
 assert.equal(doc.spec.contact,brand.phone);
 assert.equal(doc.spec.address,brand.address);
 assert.ok(doc.spec.meta.includes('البيان: '+note));
 assert.equal(doc.spec.rows[0][0],'محمد أحمد');
 assert.equal(doc.spec.rows[0][1],'—');
 assert.match(doc.spec.rows[0][2],/120\.25/);
 assert.equal(doc.spec.rows[0][3],'نقداً عبر الصندوق');
 assert.match(doc.spec.footer,/له \/ مستحق للعميل/);
});

test('transfer has two opposite account legs and each recipient is explicit and limited to a participant',()=>{
 const transfer=event('transfer-01','journal.create',{kind:'transfer',fromPartyId:'a',toPartyId:'b',amount:51.5,currency:'USD',method:'book',notes:'نقل جزء من الدين'});
 const events=[...customers,transfer];
 const source=buildEventDocument(transfer,events,brand,'a');
 const destination=buildEventDocument(transfer,events,brand,'b');
 assert.equal(source.phone,'967777123451');
 assert.equal(destination.phone,'967777123452');
 assert.equal(source.spec.rows.length,2);
 assert.equal(source.spec.rows[0][1],'—');
 assert.equal(source.spec.rows[1][2],'—');
 assert.match(source.spec.rows[0][2],/51\.50/);
 assert.match(source.spec.rows[1][1],/51\.50/);
 assert.match(source.spec.footer,/له \/ مستحق للعميل/);
 assert.match(destination.spec.footer,/عليه \/ مطلوب من العميل/);
 assert.throws(()=>buildEventDocument(transfer,events,brand,'unrelated-party'),/المستلم ليس طرفاً/);
});

test('voucher uses the current merchant identity on every generated definition',()=>{
 const receipt=event('receipt-01','receipt.create',{partyId:'a',currency:'YER',amount:7500,notes:'دفعة أولى'});
 for(let cycle=1;cycle<=5;cycle++){
  const updated={...brand,name:`متجر الدورة ${cycle}`,phone:`+96777712345${cycle}`,logo:`data:image/png;base64,cycle${cycle}`};
  const doc=buildEventDocument(receipt,[...customers,receipt],updated);
  assert.equal(doc.spec.brand,updated.name);
  assert.equal(doc.spec.logo,updated.logo);
  assert.equal(doc.spec.contact,updated.phone);
  assert.match(doc.caption,new RegExp(`متجر الدورة ${cycle}`));
 }
});
