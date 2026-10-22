import test from 'node:test';
import assert from 'node:assert/strict';
import {statement,summary,groupedSummary} from '../apps/client/js/ledger.js';
import {validateSimpleJournal,validateCashMovement,financialPostings,journalAudit,accountBalances,cashbook,toMinor} from '../apps/client/js/money-services.js';
import {prepareEventImport} from '../apps/client/js/storage.js';
import {buildPortableBackup,parsePortableBackup} from '../apps/client/js/backup.js';

const at='2026-10-21T10:00:00.000Z';
const e=(id,type,payload,time=at)=>({id,type,payload,at:time});
const people=[e('party-a','party.add',{id:'a',name:'أحمد صالح',type:'customer',phone:'967771111111'}),e('party-b','party.add',{id:'b',name:'محمد علي',type:'supplier',phone:'967772222222'})];
const journal=(id,payload)=>e(id,'journal.create',validateSimpleJournal(payload,people));
const closing=(records,id,currency)=>statement(records,id,'0000-01-01','9999-12-31',currency).closing;

for(const currency of ['YER','SAR','USD'])test(`five distinct journal/cash/debt cycles reconcile exactly in ${currency}`,()=>{
 const scale=currency==='YER'?1:100,records=[...people];
 let aUnits=0,bUnits=0,cashUnits=0;
 for(let cycle=1;cycle<=5;cycle++){
  const debitUnits=1100+cycle*137,creditUnits=200+cycle*13,transferUnits=70+cycle*11;
  const withdrawalUnits=120+cycle*19,receiptUnits=80+cycle*23;
  const payload={currency,partyId:'a',method:'book',notes:`تجربة ${cycle}`};
  records.push(journal(`${currency}-${cycle}-debit`,{...payload,kind:'debit',amount:debitUnits/scale}));
  aUnits+=debitUnits;
  assert.equal(closing(records,'a',currency),aUnits/scale);
  assert.equal(accountBalances(records)[currency].cash,cashUnits/scale);
  records.push(journal(`${currency}-${cycle}-credit`,{...payload,kind:'credit',amount:creditUnits/scale}));
  aUnits-=creditUnits;
  records.push(journal(`${currency}-${cycle}-transfer`,{currency,kind:'transfer',method:'book',fromPartyId:'a',toPartyId:'b',amount:transferUnits/scale}));
  aUnits-=transferUnits;bUnits+=transferUnits;
  assert.equal(closing(records,'a',currency),aUnits/scale);
  assert.equal(closing(records,'b',currency),bUnits/scale);
  assert.equal(accountBalances(records)[currency].cash,cashUnits/scale);
  records.push(journal(`${currency}-${cycle}-cash-out`,{...payload,kind:'debit',method:'cash',amount:withdrawalUnits/scale}));
  aUnits+=withdrawalUnits;cashUnits-=withdrawalUnits;
  records.push(journal(`${currency}-${cycle}-cash-in`,{...payload,kind:'credit',method:'cash',amount:receiptUnits/scale}));
  aUnits-=receiptUnits;cashUnits+=receiptUnits;
  assert.equal(closing(records,'a',currency),aUnits/scale);
  const book=cashbook(records,currency);
  assert.equal(book.closing,cashUnits/scale);
  assert.equal(toMinor(book.incoming,currency)-toMinor(book.outgoing,currency),cashUnits);
  assert.equal(book.rows.length,cycle*2);
  assert.equal(journalAudit(records).balanced,true);
  for(const other of ['YER','SAR','USD'].filter(c=>c!==currency)){
   assert.equal(closing(records,'a',other),0);assert.equal(closing(records,'b',other),0);assert.equal(cashbook(records,other).closing,0);
  }
 }
 const st=statement(records,'a','0000-01-01','9999-12-31',currency);
 let running=0;for(const row of st.rows){running+=(row.change<0?-1:1)*toMinor(Math.abs(row.change),currency);assert.equal(row.balance,running/scale);}
 const postingBalance=financialPostings(records).filter(p=>p.partyId==='a'&&p.currency===currency).reduce((sum,p)=>sum+(p.side==='debit'?p.units:-p.units),0);
 assert.equal(postingBalance,aUnits);
});

test('cash sales, credit sales and later cash receipts cannot double-count either debt or cash',()=>{
 const records=[...people,
  e('open','cash.open',{account:'cash',currency:'YER',amount:10000},'2026-10-20T10:00:00Z'),
  e('cash-sale','invoice.create',{kind:'sale',payment:'cash',partyId:'a',currency:'YER',total:2300,paid:2300,invoiceNumber:'104'}),
  e('credit-sale','invoice.create',{kind:'sale',payment:'credit',partyId:'a',currency:'YER',total:4700,paid:0}),
  e('cash-purchase','invoice.create',{kind:'purchase',payment:'cash',partyId:'b',currency:'YER',total:1100,paid:1100}),
  e('credit-purchase','invoice.create',{kind:'purchase',payment:'credit',partyId:'b',currency:'YER',total:1500,paid:0}),
  e('receive','receipt.create',{partyId:'a',currency:'YER',amount:700}),
  e('pay','payment.create',{partyId:'b',currency:'YER',amount:200}),
  e('expense','expense.create',{currency:'YER',amount:100,category:'مواصلات'})
 ];
 const book=cashbook(records,'YER');
 assert.equal(book.opening,10000);assert.equal(book.incoming,3000);assert.equal(book.outgoing,1400);assert.equal(book.closing,11600);
 assert.equal(closing(records,'a','YER'),4000);assert.equal(closing(records,'b','YER'),-1300);
 assert.equal(book.rows.some(r=>['credit-sale','credit-purchase'].includes(r.id)),false);
 assert.equal(book.rows.find(r=>r.id==='cash-sale').source,'فاتورة مبيعات نقدية #104');
 assert.equal(summary(records).cashMovement,1600);assert.equal(summary(records).cashClosing,11600);
 const period=cashbook(records,'YER','2026-10-21','2026-10-21');
 assert.equal(period.opening,10000);assert.equal(period.startingBalance,10000);assert.equal(period.openingEntries.length,0);assert.equal(period.closing,11600);
 assert.equal(accountBalances(records).YER.cash,book.closing);
});

test('cash opening entries remain chronologically correct and separate from income',()=>{
 const records=[e('later-open','cash.open',{account:'cash',currency:'SAR',amount:3.35},'2026-10-21T11:00:00Z'),e('sale','invoice.create',{kind:'sale',payment:'cash',currency:'SAR',total:1.15,paid:1.15},'2026-10-21T10:00:00Z'),e('earlier-open','cash.open',{account:'cash',currency:'SAR',amount:10.05},'2026-10-20T10:00:00Z')];
 const book=cashbook(records,'SAR','2026-10-21','2026-10-21');
 assert.equal(book.startingBalance,10.05);assert.equal(book.opening,13.4);assert.equal(book.incoming,1.15);assert.equal(book.closing,14.55);
 assert.deepEqual(book.rows.map(r=>[r.id,r.runningBalance]),[['sale',11.2],['later-open',14.55]]);
 assert.equal(book.openingEntries.length,1);
});

test('direct capital, operating expense and owner withdrawal have distinct balanced offsets',()=>{
 const movement=(id,payload)=>e(id,'cash.movement',validateCashMovement(payload));
 const records=[movement('capital',{direction:'in',currency:'USD',amount:100}),movement('expense',{direction:'out',currency:'USD',amount:2.35,category:'expense'}),movement('drawings',{direction:'out',currency:'USD',amount:4.25,category:'withdrawal'})];
 const book=cashbook(records,'USD');assert.equal(book.incoming,100);assert.equal(book.outgoing,6.6);assert.equal(book.closing,93.4);
 assert.equal(summary(records,'0000-01-01','9999-12-31','USD').expenses,2.35);
 assert.equal(journalAudit(records).balanced,true);
 assert.ok(financialPostings(records).some(p=>p.account==='owner-drawings'&&p.units===425));
 assert.throws(()=>validateCashMovement({direction:'in',category:'expense',currency:'USD',amount:10}),/اتجاه/);
});

test('reversing a transfer removes both party legs and reversing a cash journal removes its cash leg',()=>{
 const transfer=journal('transfer',{kind:'transfer',method:'book',fromPartyId:'a',toPartyId:'b',currency:'USD',amount:2.35});
 const cash=journal('cash',{kind:'credit',method:'cash',partyId:'a',currency:'USD',amount:4.85});
 const records=[...people,transfer,cash,e('reverse-transfer','event.reverse',{ref:transfer.id})];
 assert.equal(closing(records,'a','USD'),-4.85);assert.equal(closing(records,'b','USD'),0);assert.equal(cashbook(records,'USD').closing,4.85);
 records.push(e('reverse-cash','event.reverse',{ref:cash.id}));
 assert.equal(closing(records,'a','USD'),0);assert.equal(cashbook(records,'USD').closing,0);assert.equal(financialPostings(records).length,0);
});

test('cash reports include exchange, remittance and bank legs without losing origin outside the period',()=>{
 const records=[e('issue','remittance.issue',{reference:'RM-0001',currency:'SAR',amount:40,fee:2},'2026-09-01T10:00:00Z'),e('settle','remittance.settle',{reference:'RM-0001',issuedId:'issue'},'2026-10-21T10:00:00Z'),e('exchange','money.exchange',{fromCurrency:'USD',toCurrency:'YER',fromAmount:10,toAmount:5300,fee:2,feeCurrency:'YER'},'2026-10-21T11:00:00Z'),e('bank','fund.transfer',{currency:'USD',from:'bank',to:'cash',amount:5.55},'2026-10-21T12:00:00Z')];
 const sar=cashbook(records,'SAR','2026-10-01','2026-10-31');assert.equal(sar.opening,42);assert.equal(sar.outgoing,40);assert.equal(sar.closing,2);
 assert.equal(summary(records,'2026-10-01','2026-10-31','SAR').cashMovement,-40);
 assert.equal(groupedSummary(records,'2026-10-01','2026-10-31','month','SAR')[0].cashMovement,-40);
 assert.equal(cashbook(records,'USD').incoming,15.55);assert.equal(cashbook(records,'YER').incoming,2);assert.equal(cashbook(records,'YER').outgoing,5300);
 assert.deepEqual(cashbook(records,'YER').rows.map(row=>[row.direction,row.amount]),[['in',2],['out',5300]]);
 for(const c of ['YER','SAR','USD'])assert.equal(cashbook(records,c).closing,accountBalances(records)[c].cash);
});

test('decimal rounding and many small payments remain exact',()=>{
 assert.equal(toMinor('1.005','SAR'),101);assert.equal(toMinor('1.015','USD'),102);assert.equal(toMinor('0.295','USD'),30);
 const records=[...people];for(let i=0;i<1000;i++)records.push(journal(`r${i}`,{kind:'credit',method:'cash',partyId:'a',currency:'USD',amount:0.01}));
 assert.equal(cashbook(records,'USD').closing,10);assert.equal(accountBalances(records).USD.cash,10);assert.equal(closing(records,'a','USD'),-10);
 for(const bad of ['',null,undefined,NaN,Infinity,-1,'not-a-number'])assert.throws(()=>toMinor(bad,'USD'));
 assert.throws(()=>toMinor(1,'constructor'),/Unsupported/);
});

test('save and restore reject partial transfers, unknown parties and non-canonical amounts atomically',()=>{
 const valid=journal('valid',{kind:'transfer',method:'book',fromPartyId:'a',toPartyId:'b',currency:'USD',amount:3.45});
 assert.equal(prepareEventImport(people,[valid]).length,1);
 const before=structuredClone(people);
 for(const patch of [{toPartyId:'missing'},{toPartyId:'a'},{method:'cash'},{amount:-1},{amount:1.005},{currency:'BTC'}]){
  const malformed={...valid,payload:{...valid.payload,...patch}};
  assert.throws(()=>prepareEventImport(people,[e('extra','settings.update',{name:'لن يُحفظ'}),malformed]));
  assert.deepEqual(people,before);
  assert.throws(()=>parsePortableBackup(JSON.stringify(buildPortableBackup('audit',[...people,malformed])),'audit'));
 }
 const restored=parsePortableBackup(JSON.stringify(buildPortableBackup('audit',[...people,valid])),'audit');
 assert.deepEqual(restored.events,[...people,valid]);assert.equal(closing(restored.events,'a','USD'),-3.45);assert.equal(closing(restored.events,'b','USD'),3.45);
 const reversed=[...people,valid,e('reverse-journal','event.reverse',{ref:valid.id}),e('reverse-party','event.reverse',{ref:'party-a'})];
 assert.equal(prepareEventImport([],reversed).length,reversed.length);
});
