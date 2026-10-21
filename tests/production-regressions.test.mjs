import {test} from 'node:test';
import assert from 'node:assert/strict';
import {balanceDescription,statement} from '../apps/client/js/ledger.js';
import {isSubscriptionActive,subscriptionDate} from '../apps/client/js/subscription.js';

test('debt labels match customer obligations and settle at currency precision',()=>{
 assert.deepEqual(balanceDescription(15.5,'USD'),{side:'debit',label:'عليه / مطلوب من العميل',amount:15.5});
 assert.deepEqual(balanceDescription(-12.25,'SAR'),{side:'credit',label:'له / مستحق للعميل',amount:12.25});
 assert.deepEqual(balanceDescription(0,'YER'),{side:'settled',label:'خالص',amount:0});
 assert.throws(()=>balanceDescription(Infinity,'YER'),/رصيد/);
});

test('a customer overpayment creates credit without consuming a different currency debt',()=>{
 const e=(id,type,payload,at)=>({id,type,payload,at});
 const records=[
  e('opening','balance.open',{partyId:'customer',direction:'receivable',amount:80,currency:'USD'},'2026-09-30T10:00:00Z'),
  e('sale','invoice.create',{partyId:'customer',kind:'sale',paid:0,total:20.25,currency:'USD'},'2026-10-01T10:00:00Z'),
  e('receipt','receipt.create',{partyId:'customer',amount:105.5,currency:'USD'},'2026-10-02T10:00:00Z'),
  e('yer','invoice.create',{partyId:'customer',kind:'sale',paid:0,total:5000,currency:'YER'},'2026-10-02T12:00:00Z')
 ];
 const usd=statement(records,'customer','2026-10-01','2026-10-31','USD');
 assert.equal(usd.opening,80);
 assert.deepEqual(usd.rows.map(x=>x.balance),[100.25,-5.25]);
 assert.equal(usd.creditor,5.25);
 assert.equal(statement(records,'customer','2026-10-01','2026-10-31','YER').closing,5000);
});

test('subscription expiry uses Yemen midnight and rejects malformed registry dates',()=>{
 const now=new Date('2026-10-20T21:30:00Z');
 assert.equal(subscriptionDate(now),'2026-10-21');
 assert.equal(isSubscriptionActive({id:'merchant',active:true,expiresAt:'2026-10-20'},now),false);
 assert.equal(isSubscriptionActive({id:'merchant',active:true,expiresAt:'2026-10-21'},now),true);
 assert.equal(isSubscriptionActive({id:'merchant',active:true,expiresAt:'2026-99-99'},now),false);
 assert.equal(isSubscriptionActive({id:'merchant',active:true,expiresAt:'2027-02-31'},now),false);
 assert.equal(isSubscriptionActive({id:'merchant',active:'true',expiresAt:'2030-01-01'},now),false);
});
