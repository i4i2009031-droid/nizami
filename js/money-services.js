/** Financial operations inspired by exchange/remittance workflow categories. All amounts
 * are stored by currency; a conversion MUST contain both legs and an explicit rate.
 * Standalone local original implementation, not decompiled Dart bytecode. */
import {activeRecords, CURRENCIES, currencyOf, dateOnly} from './ledger.js';

export const MONEY_ACCOUNTS = Object.freeze(['cash','bank']);
export const minorFactor = currency => {
  const v=CURRENCIES[currency];
  if(!v)throw Error('Unsupported currency');
  return 10**v.digits;
};
export function toMinor(amount,currency){
  if(typeof amount!=='number'&&typeof amount!=='string')throw Error('Invalid amount');
  const n=Number(amount),factor=minorFactor(currency);
  if(!Number.isFinite(n)||n<0||n>1e12)throw Error('Invalid nonnegative amount');
  const x=Math.round(n*factor+Number.EPSILON);
  if(!Number.isSafeInteger(x))throw Error('Amount exceeds supported precision');
  return x;
}
export function fromMinor(amount,currency){return amount/minorFactor(currency);}
const amountPositive=(n,currency)=>{const u=toMinor(n,currency);if(u<=0)throw Error('Amount must be positive');return u;};
export function validateExchange(p){
  if(!p||!CURRENCIES[p.fromCurrency]||!CURRENCIES[p.toCurrency]||p.fromCurrency===p.toCurrency)
    throw Error('Choose two distinct currencies');
  const input=amountPositive(p.fromAmount,p.fromCurrency),output=amountPositive(p.toAmount,p.toCurrency);
  const feeCurrency=p.feeCurrency||p.fromCurrency;
  if(!CURRENCIES[feeCurrency])throw Error('Invalid fee currency');
  const fee=toMinor(p.fee||0,feeCurrency);
  const implied=fromMinor(output,p.toCurrency)/fromMinor(input,p.fromCurrency);
  if(!Number.isFinite(implied)||implied<=0)throw Error('Invalid exchange rate');
  if(p.rate!==undefined&&p.rate!==null&&p.rate!==''&&Math.abs(Number(p.rate)-implied)>Math.max(.0000001,implied*.00001))throw Error('Exchange rate is inconsistent with the two amounts');
  return {...p,feeCurrency,rate:implied,fromAmount:fromMinor(input,p.fromCurrency),toAmount:fromMinor(output,p.toCurrency),fee:fromMinor(fee,feeCurrency)};
}
export function validateRemittance(p){
  if(!p||!CURRENCIES[p.currency])throw Error('Invalid currency');
  const amount=amountPositive(p.amount,p.currency),fee=toMinor(p.fee||0,p.currency);
  const reference=String(p.reference||'').trim();
  if(reference.length<4||reference.length>64||!/^[\p{L}\p{N}._-]+$/u.test(reference))throw Error('Remittance reference must be 4-64 characters');
  return {...p,amount:fromMinor(amount,p.currency),fee:fromMinor(fee,p.currency),reference};
}
export function unsettledRemittances(events){
  const issued=new Map(),settled=new Set();
  for(const e of activeRecords(events)){
    if(e.type==='remittance.issue')issued.set(e.payload.reference,e);
    if(e.type==='remittance.settle')settled.add(e.payload.reference);
  }
  return [...issued.values()].filter(e=>!settled.has(e.payload.reference));
}
export function validateSettlement(events,reference){
  const match=unsettledRemittances(events).find(e=>e.payload.reference===reference);
  if(!match)throw Error('Remittance is not pending or is already settled');
  return match;
}
export function validateAccountTransfer(p){
  if(!CURRENCIES[p?.currency]||!MONEY_ACCOUNTS.includes(p.from)||!MONEY_ACCOUNTS.includes(p.to)||p.from===p.to)
    throw Error('Choose two different cash/bank accounts');
  return {...p,amount:fromMinor(amountPositive(p.amount,p.currency),p.currency)};
}
/** Balanced double-entry postings for each event and currency, with integer minor units. */
export function financialPostings(events){
  const journal=[];
  const add=(event,currency,account,side,amount)=>{
    const units=toMinor(amount,currency);if(!units)return;
    journal.push({eventId:event.id,at:event.at,type:event.type,currency,account,side,units});
  };
  const records=activeRecords(events);
  const issues=new Map(),settled=new Set();
  for(const e of records)if(e.type==='remittance.issue'){
    const id=validateRemittance(e.payload).reference;
    if(issues.has(id))throw Error('Duplicate remittance reference');
    issues.set(id,e);
  }
  for(const e of records){
    const p=e.payload||{},c=currencyOf(p),total=Number(p.total)||0;
    if(e.type==='invoice.create'){
      const paid=Number(p.paid??(p.payment==='cash'?p.total:0));
      const dueUnits=toMinor(total,c)-toMinor(paid,c);
      if(dueUnits<0)throw Error('Invoice overpayment');
      const due=fromMinor(dueUnits,c);
      if(p.kind==='sale'){
        add(e,c,'cash','debit',paid);add(e,c,'receivable','debit',due);add(e,c,'sales','credit',total);
      }else if(p.kind==='purchase'){
        add(e,c,'inventory','debit',total);add(e,c,'cash','credit',paid);add(e,c,'payable','credit',due);
      }else throw Error('Unknown invoice kind');
    }
    if(e.type==='cash.open'){
      if(!MONEY_ACCOUNTS.includes(p.account))throw Error('Unsupported opening cash account');
      amountPositive(p.amount,c);add(e,c,p.account,'debit',p.amount);add(e,c,'opening-equity','credit',p.amount);
    }
    if(e.type==='receipt.create'){add(e,c,'cash','debit',p.amount);add(e,c,'receivable','credit',p.amount);}
    if(e.type==='payment.create'){add(e,c,'payable','debit',p.amount);add(e,c,'cash','credit',p.amount);}
    if(e.type==='expense.create'){add(e,c,'expense','debit',p.amount);add(e,c,'cash','credit',p.amount);}
    if(e.type==='balance.open'){
      if(p.direction==='receivable'){add(e,c,'receivable','debit',p.amount);add(e,c,'opening-equity','credit',p.amount);}
      else if(p.direction==='payable'){add(e,c,'opening-equity','debit',p.amount);add(e,c,'payable','credit',p.amount);}
      else throw Error('Invalid opening balance direction');
    }
    if(e.type==='money.exchange'){
      const v=validateExchange(p);
      add(e,v.fromCurrency,'cash','debit',v.fromAmount);
      add(e,v.fromCurrency,'fx-clearing','credit',v.fromAmount);
      add(e,v.toCurrency,'fx-clearing','debit',v.toAmount);
      add(e,v.toCurrency,'cash','credit',v.toAmount);
      if(v.fee){add(e,v.feeCurrency,'cash','debit',v.fee);add(e,v.feeCurrency,'fee-revenue','credit',v.fee);}
    }
    if(e.type==='fund.transfer'){
      const v=validateAccountTransfer(p);add(e,v.currency,v.to,'debit',v.amount);add(e,v.currency,v.from,'credit',v.amount);
    }
    if(e.type==='remittance.issue'){
      const v=validateRemittance(p);add(e,v.currency,'cash','debit',v.amount+v.fee);
      add(e,v.currency,'remittance-payable','credit',v.amount);
      add(e,v.currency,'fee-revenue','credit',v.fee);
    }
    if(e.type==='remittance.settle'){
      const issued=issues.get(p.reference);
      if(!issued||issued.id!==p.issuedId)throw Error('Settlement references unknown or reversed remittance');
      if(settled.has(p.reference))throw Error('Remittance has already been settled');
      settled.add(p.reference);
      const v=validateRemittance(issued.payload);
      add(e,v.currency,'remittance-payable','debit',v.amount);add(e,v.currency,'cash','credit',v.amount);
    }
  }
  return journal;
}
export function journalAudit(events){
  const postings=financialPostings(events),groups=new Map();
  for(const x of postings){const k=x.eventId+'|'+x.currency;
    if(!groups.has(k))groups.set(k,{eventId:x.eventId,currency:x.currency,debits:0,credits:0});
    groups.get(k)[x.side==='debit'?'debits':'credits']+=x.units;
  }
  const unbalanced=[...groups.values()].filter(g=>g.debits!==g.credits);
  return {balanced:unbalanced.length===0,postings,unbalanced};
}
export function accountBalances(events,from='0000-01-01',to='9999-12-31'){
  const map={};for(const c of Object.keys(CURRENCIES))map[c]={cash:0,bank:0,remittanceDue:0,feeIncome:0};
  for(const x of financialPostings(events)){
    const day=dateOnly(x.at);if(day<from||day>to)continue;
    const factor=x.side==='debit'?1:-1,v=fromMinor(x.units,x.currency);
    if(x.account==='cash'||x.account==='bank')map[x.currency][x.account]+=factor*v;
    if(x.account==='remittance-payable')map[x.currency].remittanceDue-=factor*v;
    if(x.account==='fee-revenue')map[x.currency].feeIncome-=factor*v;
  }
  for(const c of Object.keys(CURRENCIES))for(const k of Object.keys(map[c]))map[c][k]=fromMinor(toMinor(Math.abs(map[c][k]),c)*(Math.sign(map[c][k])||1),c);
  return map;
}
