/** Pure, deterministic accounting projections. Never combine different currencies. */
import {CURRENCIES,currencyOf,rounded,dateOnly,activeRecords,toMinor,fromMinor,addUnits,signedMinor,chronologicalOrder} from './accounting-primitives.js';
import {cashbook,financialPostings,validateSimpleJournal,validateCashMovement} from './money-services.js';
export {CURRENCIES,currencyOf,rounded,dateOnly,activeRecords} from './accounting-primitives.js';
export function money(n,currency='YER'){const c=CURRENCIES[currency]||CURRENCIES.YER;return `${new Intl.NumberFormat('en-US',{minimumFractionDigits:c.digits,maximumFractionDigits:c.digits}).format(Number(n)||0)} ${c.symbol}`;}
/** A customer's debit is owed to the shop; credit is owed to the customer. */
export function balanceDescription(value,currency='YER'){
 const balance=rounded(value,currency);
 if(!Number.isFinite(balance))throw new Error('رصيد غير صالح');
 return {side:balance>0?'debit':balance<0?'credit':'settled',label:balance>0?'عليه / مطلوب من العميل':balance<0?'له / مستحق للعميل':'خالص',amount:Math.abs(balance)};
}
export function parties(events){const map=new Map();for(const e of activeRecords(events)){
 if(e.type==='party.add')map.set(e.payload.id,{...e.payload});
 if(e.type==='party.update'&&map.has(e.payload.id))map.set(e.payload.id,{...map.get(e.payload.id),...e.payload});
}return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));}
export function itemsCatalog(events){const map=new Map();for(const e of activeRecords(events)){
 if(e.type==='item.add')map.set(e.payload.id,{...e.payload});
 if(e.type==='item.update'&&map.has(e.payload.id))map.set(e.payload.id,{...map.get(e.payload.id),...e.payload});
}return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));}
export function currentSettings(events){let profile={name:'محور الحسابات',address:'اليمن',phone:'',logo:'',email:'',commercialId:'',currency:'YER'};for(const e of activeRecords(events))if(e.type==='settings.update')profile={...profile,...e.payload};return profile;}
export function linesForParty(events,partyId,currency='YER'){
 const out=[];for(const e of activeRecords(events)){
  const p=e.payload;if(currencyOf(p)!==currency)continue;
  const isTransfer=e.type==='journal.create'&&p.kind==='transfer';
  if(isTransfer?![p.fromPartyId,p.toPartyId].includes(partyId):p.partyId!==partyId)continue;
  let change=0,title='';
  if(e.type==='invoice.create'){
   const due=fromMinor(toMinor(p.total,currency)-toMinor(p.paid??(p.payment==='cash'?p.total:0),currency),currency);
   if(due<0)throw Error('Invoice overpayment');
   change=p.kind==='sale'?due:-due;
   title=p.kind==='sale'?'فاتورة مبيعات':'فاتورة مشتريات';
  }
  if(e.type==='receipt.create'){change=-p.amount;title='سند قبض';}
  if(e.type==='payment.create'){change=p.amount;title='سند صرف';}
  if(e.type==='balance.open'){change=p.direction==='receivable'?p.amount:-p.amount;title='رصيد افتتاحي';}
  if(e.type==='journal.create'){
   const v=validateSimpleJournal(p);
   change=v.kind==='transfer'?(v.fromPartyId===partyId?-v.amount:v.amount):v.kind==='debit'?v.amount:-v.amount;
   title=v.kind==='transfer'?'قيد تحويل بين حسابين':v.kind==='debit'?'قيد بسيط - عليه':'قيد بسيط - له';
  }
  if(title&&(change!==0||e.type==='invoice.create')){const value=rounded(change,currency);out.push({id:e.id,at:e.at,title,change:value,amount:Math.abs(value),currency,notes:p.notes||'',...(isTransfer?{counterpartyId:p.fromPartyId===partyId?p.toPartyId:p.fromPartyId}:{})});}
 }
 return out.sort(chronologicalOrder);
}
/** Positive => customer owes shop (عليه). Negative => shop owes customer (له). */
export function statement(events,partyId,from='0000-01-01',to='9999-12-31',currency='YER'){
 const list=linesForParty(events,partyId,currency);let openingUnits=0,periodUnits=0;const rows=[];
 for(const row of list){const d=dateOnly(row.at),units=signedMinor(row.change,currency);if(d<from){openingUnits=addUnits(openingUnits,units);continue;}if(d>to)continue;periodUnits=addUnits(periodUnits,units);rows.push({...row,balance:fromMinor(addUnits(openingUnits,periodUnits),currency)});}
 const opening=fromMinor(openingUnits,currency),closing=fromMinor(addUnits(openingUnits,periodUnits),currency);return {opening,rows,closing,debtor:Math.max(closing,0),creditor:Math.max(-closing,0),currency};
}
export function summary(events,from='0000-01-01',to='9999-12-31',currency='YER'){
 const units={sales:0,purchases:0,expenses:0,receipts:0,payments:0,cashSales:0,cashPurchases:0};
 const add=(field,amount)=>{units[field]=addUnits(units[field],toMinor(amount,currency));};
 const counted=new Set(),postings=financialPostings(events);
 for(const posting of postings){const day=dateOnly(posting.at);if(posting.currency===currency&&day>=from&&day<=to)counted.add(posting.eventId);}
 for(const e of activeRecords(events)){
  const d=dateOnly(e.at),p=e.payload;
  if(d<from||d>to||currencyOf(p)!==currency)continue;
  if(e.type==='invoice.create'){
   const paid=p.paid??(p.payment==='cash'?p.total:0);
   if(p.kind==='sale'){add('sales',p.total);add('cashSales',paid);}
   else{add('purchases',p.total);add('cashPurchases',paid);}
   counted.add(e.id);
  }
  if(e.type==='receipt.create')add('receipts',p.amount);
  if(e.type==='payment.create')add('payments',p.amount);
  if(e.type==='expense.create')add('expenses',p.amount);
  if(e.type==='cash.movement'){const v=validateCashMovement(p);if(v.category==='expense')add('expenses',v.amount);}
 }
 const cash=cashbook(events,currency,from,to);
 const totals={currency,...Object.fromEntries(Object.entries(units).map(([key,value])=>[key,fromMinor(value,currency)])),count:counted.size,
  cashMovement:cash.netChange,cashIncoming:cash.incoming,cashOutgoing:cash.outgoing,cashOpening:cash.opening,cashClosing:cash.closing};
 totals.tradingEstimate=fromMinor(addUnits(addUnits(units.sales,-units.purchases),-units.expenses),currency);
 return totals;
}
export function summaryByCurrency(events,from='0000-01-01',to='9999-12-31'){return Object.keys(CURRENCIES).map(currency=>summary(events,from,to,currency));}
export function groupedSummary(events,from,to,group='day',currency='YER'){
 const periods=new Map(),financialIds=new Set(financialPostings(events).filter(p=>p.currency===currency).map(p=>p.eventId));for(const e of activeRecords(events)){
  const day=dateOnly(e.at);if(day<from||day>to||!financialIds.has(e.id))continue;
  const key=group==='year'?day.slice(0,4):group==='month'?day.slice(0,7):day;
  const current=periods.get(key)||{from:day,to:day};current.from=current.from<day?current.from:day;current.to=current.to>day?current.to:day;periods.set(key,current);
 }
 // Keep the complete event log while filtering dates: settlements need their
 // original remittance even when it was issued in another reporting period.
 return [...periods.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([period,range])=>({period,...summary(events,range.from,range.to,currency)}));
}
export function describeEvent(e,partiesList=[]){const p=e.payload,who=partiesList.find(x=>x.id===p.partyId)?.name||'بدون جهة',name=id=>partiesList.find(x=>x.id===id)?.name||id;const types={'party.add':'إضافة حساب','party.update':'تعديل حساب','item.add':'إضافة صنف','item.update':'تعديل صنف','invoice.create':p.kind==='sale'?'فاتورة مبيعات':'فاتورة مشتريات','receipt.create':'سند قبض','payment.create':'سند صرف','expense.create':'مصروف يومي','settings.update':'تعديل الإعدادات','event.reverse':'إلغاء عملية','balance.open':'رصيد افتتاحي','journal.create':p.kind==='transfer'?'قيد تحويل بين حسابين':p.kind==='debit'?'قيد بسيط - عليه':'قيد بسيط - له','cash.movement':p.direction==='in'?'تغذية رأس مال':p.category==='withdrawal'?'سحب مالك':'مصروف نقدي مباشر','cash.open':'رصيد افتتاحي للصندوق','money.exchange':'صرف عملة','fund.transfer':'تحويل صندوق / بنك','remittance.issue':'استلام حوالة','remittance.settle':'صرف حوالة'};return {title:types[e.type]||e.type,sub:e.type==='journal.create'&&p.kind==='transfer'?`${name(p.fromPartyId)} ← ${name(p.toPartyId)}`:['invoice.create','journal.create','receipt.create','payment.create'].includes(e.type)?who:p.name||p.notes||p.category||who,amount:p.total??p.amount??p.fromAmount??0,currency:currencyOf(p)};}
