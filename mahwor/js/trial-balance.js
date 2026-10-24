/** Trial balance computed from existing immutable double-entry postings. */
import {financialPostings} from './money-services.js';
import {CURRENCIES,addUnits,fromMinor,dateOnly} from './accounting-primitives.js';

export function trialBalance(events,currency='YER',through='9999-12-31'){
 if(!Object.hasOwn(CURRENCIES,currency))throw Error('عملة ميزان المراجعة غير صالحة');
 const map=new Map();let debitTotal=0,creditTotal=0;
 for(const row of financialPostings(events)){
  if(row.currency!==currency||dateOnly(row.at)>through)continue;
  const key=row.account;
  const current=map.get(key)||{account:key,debit:0,credit:0};
  current[row.side]=addUnits(current[row.side],row.units);
  map.set(key,current);
  if(row.side==='debit')debitTotal=addUnits(debitTotal,row.units);
  else creditTotal=addUnits(creditTotal,row.units);
 }
 const accounts=[...map.values()].sort((a,b)=>a.account.localeCompare(b.account)).map(x=>{
  const net=x.debit-x.credit;
  return {account:x.account,debit:fromMinor(Math.max(net,0),currency),credit:fromMinor(Math.max(-net,0),currency)};
 });
 const sums=accounts.reduce((a,x)=>({debit:a.debit+x.debit,credit:a.credit+x.credit}),{debit:0,credit:0});
 return {currency,through,accounts,totalDebit:fromMinor(debitTotal,currency),totalCredit:fromMinor(creditTotal,currency),balanceDebit:sums.debit,balanceCredit:sums.credit,balanced:debitTotal===creditTotal};
}
