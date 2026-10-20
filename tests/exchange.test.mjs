import {test} from 'node:test';import assert from 'node:assert/strict';
import {validateExchange,validateRemittance,validateAccountTransfer,validateSettlement,unsettledRemittances,financialPostings,journalAudit,accountBalances} from '../apps/client/js/money-services.js';
const e=(id,type,payload,at='2026-10-20T15:00:00Z')=>({id,type,payload,at});
test('exchange trades cannot mix unquoted rates or currencies',()=>{
 const trade=validateExchange({fromCurrency:'USD',toCurrency:'YER',fromAmount:10,toAmount:5300,rate:530,fee:2,feeCurrency:'YER'});
 assert.equal(trade.rate,530);
 assert.throws(()=>validateExchange({...trade,rate:540}),/rate/);
 assert.throws(()=>validateExchange({...trade,toCurrency:'USD'}),/distinct/);
});
test('balanced journal tracks double-entry in all three currencies',()=>{
 const ev=[e('i','invoice.create',{kind:'sale',currency:'YER',total:4000,paid:1000}),e('x','money.exchange',{fromCurrency:'USD',toCurrency:'YER',fromAmount:10,toAmount:5300,fee:2,feeCurrency:'YER'}),e('p','invoice.create',{kind:'purchase',currency:'SAR',total:20.75,paid:10.25})];
 assert.equal(journalAudit(ev).balanced,true);const b=accountBalances(ev);
 assert.equal(b.YER.cash,-4298);assert.equal(b.USD.cash,10);assert.equal(b.SAR.cash,-10.25);
 assert.equal(b.YER.feeIncome,2);
});
test('remittance issue/settle respects unique reference and liability',()=>{
 const issue=e('a','remittance.issue',validateRemittance({reference:'HD-205',currency:'SAR',amount:50,fee:2,partyId:'p'}));
 assert.equal(unsettledRemittances([issue]).length,1);
 assert.throws(()=>validateSettlement([issue],'NON-EXISTENT'));
 const settle=e('b','remittance.settle',{issuedId:'a',reference:'HD-205'});
 assert.equal(journalAudit([issue,settle]).balanced,true);
 const s=accountBalances([issue,settle]);assert.equal(s.SAR.cash,2);assert.equal(s.SAR.remittanceDue,0);assert.equal(s.SAR.feeIncome,2);
 assert.equal(unsettledRemittances([issue,settle]).length,0);
 assert.throws(()=>validateSettlement([issue,settle],'HD-205'));
});
test('cash-bank movements net to zero and reversal removes both postings',()=>{
 const tr=e('t','fund.transfer',validateAccountTransfer({from:'cash',to:'bank',currency:'USD',amount:22.35}));
 assert.equal(journalAudit([tr]).balanced,true);
 const b=accountBalances([tr]);assert.equal(b.USD.cash,-22.35);assert.equal(b.USD.bank,22.35);
 assert.equal(financialPostings([tr,e('r','event.reverse',{ref:'t'})]).length,0);
});
test('duplicates and reversed origin cannot generate duplicate remittance payments',()=>{
 const r=e('x','remittance.issue',validateRemittance({reference:'ABC-212',currency:'USD',amount:10}));
 const r2=e('y','remittance.issue',validateRemittance({reference:'ABC-212',currency:'USD',amount:10}));
 assert.throws(()=>journalAudit([r,r2]),/Duplicate/);
 const pay=e('p','remittance.settle',{issuedId:'x',reference:'ABC-212'});
 assert.throws(()=>journalAudit([r,pay,e('q','remittance.settle',{issuedId:'x',reference:'ABC-212'})]),/already/);
 assert.throws(()=>journalAudit([r,pay,e('z','event.reverse',{ref:'x'})]),/reversed/);
});
test('invalid inputs never enter financial ledger',()=>{
 assert.throws(()=>validateRemittance({reference:'x',currency:'YER',amount:12}),/reference/);
 assert.throws(()=>validateAccountTransfer({currency:'USD',from:'cash',to:'cash',amount:10}),/different/);
 assert.throws(()=>journalAudit([e('a','invoice.create',{kind:'sale',currency:'USD',total:10,paid:11})]),/overpayment/);
});
