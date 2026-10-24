/** Financial operations inspired by exchange/remittance workflow categories. All amounts
 * are stored by currency; a conversion MUST contain both legs and an explicit rate.
 * Standalone local original implementation, not decompiled Dart bytecode. */
import {activeRecords,CURRENCIES,currencyOf,dateOnly,toMinor,fromMinor,addUnits,chronologicalOrder} from './accounting-primitives.js';
export {minorFactor,toMinor,fromMinor} from './accounting-primitives.js';

export const MONEY_ACCOUNTS = Object.freeze(['cash','bank']);
const amountPositive=(n,currency)=>{const u=toMinor(n,currency);if(u<=0)throw Error('Amount must be positive');return u;};
const partyIdentifier=value=>{
 if(typeof value!=='string'||!value.trim()||value.trim().length>150)throw Error('اختر حساب العميل أو المورد');
 return value.trim();
};
const normalizedNotes=value=>{
 if(value!==undefined&&typeof value!=='string')throw Error('البيان غير صالح');
 const notes=(value||'').trim();if(notes.length>1000)throw Error('البيان أطول من الحد المسموح');return notes;
};
function activeParties(events){
 const found=new Map();for(const event of activeRecords(events)){
  if(event.type==='party.add')found.set(event.payload.id,{...event.payload});
  if(event.type==='party.update'&&found.has(event.payload.id))found.set(event.payload.id,{...found.get(event.payload.id),...event.payload});
 }return found;
}
function assertJournalParties(value,people){
 const identifiers=value.kind==='transfer'?[value.fromPartyId,value.toPartyId]:[value.partyId];
 if(identifiers.some(id=>!people.has(id)))throw Error('الحساب المحدد غير موجود أو ملغى');
}
/** Customer sign convention: debit raises debt, credit reduces debt. A book
 * transfer credits the source and debits the destination in one atomic event.
 * Transfers never create physical cash. The book offset is deliberately not
 * sales or expense, so a manual balance adjustment cannot fabricate profit. */
export function validateSimpleJournal(payload,events=null){
 const p=payload;if(!p||!['debit','credit','transfer'].includes(p.kind))throw Error('اختر نوع القيد البسيط');
 if(!Object.hasOwn(CURRENCIES,p.currency))throw Error('عملة القيد غير مدعومة');
 if(!['cash','book'].includes(p.method))throw Error('اختر نقداً أو قيداً دفترياً');
 const amount=fromMinor(amountPositive(p.amount,p.currency),p.currency),notes=normalizedNotes(p.notes);
 const result={...p,amount,notes};
 if(p.kind==='transfer'){
  if(p.method!=='book')throw Error('التحويل بين حسابين قيد دفتري فقط ولا يؤثر على الصندوق');
  result.fromPartyId=partyIdentifier(p.fromPartyId);result.toPartyId=partyIdentifier(p.toPartyId);
  if(result.fromPartyId===result.toPartyId)throw Error('اختر حسابين مختلفين للتحويل');
  delete result.partyId;
 }else{
  result.partyId=partyIdentifier(p.partyId);delete result.fromPartyId;delete result.toPartyId;
 }
 if(events)assertJournalParties(result,activeParties(events));
 return result;
}
export function validateCashMovement(payload){
 const p=payload;if(!p||!['in','out'].includes(p.direction))throw Error('اختر وارد أو صادر للصندوق');
 if(!Object.hasOwn(CURRENCIES,p.currency))throw Error('عملة حركة الصندوق غير مدعومة');
 const category=p.category||(p.direction==='in'?'capital':'expense');
 if(p.direction==='in'?category!=='capital':!['expense','withdrawal'].includes(category))throw Error('نوع حركة الصندوق لا يطابق اتجاهها');
 return {...p,category,amount:fromMinor(amountPositive(p.amount,p.currency),p.currency),notes:normalizedNotes(p.notes)};
}
function canonicalMoney(value,currency,positive=true){
 if(typeof value!=='number')throw Error('المبلغ يجب أن يكون رقمًا محفوظًا بدقة العملة');
 const units=toMinor(value,currency);
 if((positive&&units<=0)||fromMinor(units,currency)!==value)throw Error('المبلغ لا يطابق دقة العملة المختارة');
 return units;
}
/** Validated both at save and at restore boundaries. New events cannot store a
 * partial transfer or an invalid amount even when entered outside their form. */
export function validateNewAccountingEvents(events){
 const active=new Set(activeRecords(events).map(event=>event.id));
 // Validate a whole backup/transaction in linear time: rebuilding the party
 // catalogue for every journal entry would make large local books quadratic.
 const people=activeParties(events);
 for(const event of events){
  let value;const p=event.payload||{},legacyTypes=['invoice.create','receipt.create','payment.create','expense.create','balance.open','cash.open'];
  if(legacyTypes.includes(event.type)){
   // Older logs omit currency/paid; keep their established YER and cash/credit
   // defaults. Explicitly inconsistent or over-precision amounts must never
   // be silently rounded by projections after restore.
   if(p.currency!==undefined&&!Object.hasOwn(CURRENCIES,p.currency))throw Error('عملة العملية غير مدعومة');
   const currency=currencyOf(p);
   if(event.type==='invoice.create'){
    const total=canonicalMoney(p.total,currency),paid=canonicalMoney(p.paid??(p.payment==='cash'?p.total:0),currency,false);
    if(paid>total||(p.payment==='cash'&&paid!==total))throw Error('الفاتورة النقدية يجب أن تكون مسددة بالكامل ولا يجوز تجاوز إجمالي الفاتورة');
    if(p.payment!==undefined&&!['cash','credit'].includes(p.payment))throw Error('طريقة دفع الفاتورة غير صالحة');
    if(p.payment==='credit'&&!String(p.partyId||'').trim())throw Error('الفاتورة الآجلة تحتاج حساب العميل أو المورد');
   }else{
    canonicalMoney(p.amount,currency);
    if(event.type==='cash.open'&&!MONEY_ACCOUNTS.includes(p.account))throw Error('حساب الرصيد الافتتاحي غير صالح');
    if(event.type==='balance.open'&&!['receivable','payable'].includes(p.direction))throw Error('اتجاه الرصيد الافتتاحي غير صالح');
   }
   if(typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at)))throw Error('تاريخ العملية غير صالح');
  }
  if(event.type==='journal.create'){
   value=validateSimpleJournal(event.payload);
   if(active.has(event.id))assertJournalParties(value,people);
  }
  if(event.type==='cash.movement')value=validateCashMovement(event.payload);
  if(value){
   if(typeof event.payload.amount!=='number'||event.payload.amount!==value.amount)throw Error('المبلغ لا يطابق دقة العملة المختارة');
   if(typeof event.at!=='string'||!Number.isFinite(Date.parse(event.at)))throw Error('تاريخ القيد غير صالح');
  }
 }
 return events;
}
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
  const add=(event,currency,account,side,amount,partyId)=>{
    const units=toMinor(amount,currency);if(!units)return;
    journal.push({eventId:event.id,at:event.at,type:event.type,currency,account,side,units,...(partyId?{partyId}:{})});
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
        add(e,c,'cash','debit',paid);add(e,c,'receivable','debit',due,p.partyId);add(e,c,'sales','credit',total);
      }else if(p.kind==='purchase'){
        add(e,c,'inventory','debit',total);add(e,c,'cash','credit',paid);add(e,c,'payable','credit',due,p.partyId);
      }else throw Error('Unknown invoice kind');
    }
    if(e.type==='cash.open'){
      if(!MONEY_ACCOUNTS.includes(p.account))throw Error('Unsupported opening cash account');
      amountPositive(p.amount,c);add(e,c,p.account,'debit',p.amount);add(e,c,'opening-equity','credit',p.amount);
    }
    if(e.type==='receipt.create'){add(e,c,'cash','debit',p.amount);add(e,c,'receivable','credit',p.amount,p.partyId);}
    if(e.type==='payment.create'){add(e,c,'payable','debit',p.amount,p.partyId);add(e,c,'cash','credit',p.amount);}
    if(e.type==='expense.create'){add(e,c,'expense','debit',p.amount);add(e,c,'cash','credit',p.amount);}
    if(e.type==='balance.open'){
      if(p.direction==='receivable'){add(e,c,'receivable','debit',p.amount,p.partyId);add(e,c,'opening-equity','credit',p.amount);}
      else if(p.direction==='payable'){add(e,c,'opening-equity','debit',p.amount);add(e,c,'payable','credit',p.amount,p.partyId);}
      else throw Error('Invalid opening balance direction');
    }
    if(e.type==='journal.create'){
      const v=validateSimpleJournal(p);
      if(v.kind==='transfer'){
        add(e,v.currency,'party-control','credit',v.amount,v.fromPartyId);
        add(e,v.currency,'party-control','debit',v.amount,v.toPartyId);
      }else if(v.kind==='debit'){
        add(e,v.currency,'party-control','debit',v.amount,v.partyId);
        add(e,v.currency,v.method==='cash'?'cash':'journal-offset','credit',v.amount);
      }else{
        add(e,v.currency,v.method==='cash'?'cash':'journal-offset','debit',v.amount);
        add(e,v.currency,'party-control','credit',v.amount,v.partyId);
      }
    }
    if(e.type==='cash.movement'){
      const v=validateCashMovement(p);
      if(v.direction==='in'){add(e,v.currency,'cash','debit',v.amount);add(e,v.currency,'owner-capital','credit',v.amount);}
      else {add(e,v.currency,v.category==='expense'?'expense':'owner-drawings','debit',v.amount);add(e,v.currency,'cash','credit',v.amount);}
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
    const key=x.side==='debit'?'debits':'credits';groups.get(k)[key]=addUnits(groups.get(k)[key],x.units);
  }
  const unbalanced=[...groups.values()].filter(g=>g.debits!==g.credits);
  return {balanced:unbalanced.length===0,postings,unbalanced};
}
export function accountBalances(events,from='0000-01-01',to='9999-12-31'){
  const map={};for(const c of Object.keys(CURRENCIES))map[c]={cash:0,bank:0,remittanceDue:0,feeIncome:0};
  for(const x of financialPostings(events)){
    const day=dateOnly(x.at);if(day<from||day>to)continue;
    const units=(x.side==='debit'?1:-1)*x.units;
    if(x.account==='cash'||x.account==='bank')map[x.currency][x.account]=addUnits(map[x.currency][x.account],units);
    if(x.account==='remittance-payable')map[x.currency].remittanceDue=addUnits(map[x.currency].remittanceDue,-units);
    if(x.account==='fee-revenue')map[x.currency].feeIncome=addUnits(map[x.currency].feeIncome,-units);
  }
  for(const c of Object.keys(CURRENCIES))for(const k of Object.keys(map[c]))map[c][k]=fromMinor(map[c][k],c);
  return map;
}

function cashSource(event,people){
 const p=event.payload||{},name=people.get(p.partyId)?.name||'بدون جهة';
 const number=p.number||p.invoiceNumber?String(p.number||p.invoiceNumber):String(event.id).slice(0,16);
 if(event.type==='invoice.create')return `فاتورة ${p.kind==='sale'?'مبيعات':'مشتريات'} ${Number(p.paid??(p.payment==='cash'?p.total:0))<Number(p.total)?'دفعة نقدية':'نقدية'} #${number}`;
 if(event.type==='journal.create')return `قيد بسيط نقدي - ${name}`;
 if(event.type==='receipt.create')return `سند قبض - ${name}`;
 if(event.type==='payment.create')return `سند صرف - ${name}`;
 if(event.type==='expense.create')return `مصروف يومي${p.category?' - '+p.category:''}`;
 if(event.type==='cash.open')return 'رصيد افتتاحي للصندوق';
 if(event.type==='cash.movement')return p.direction==='in'?'تغذية رأس مال':p.category==='withdrawal'?'سحب مالك':'مصروف نقدي مباشر';
 if(event.type==='money.exchange')return `صرف عملة ${p.fromCurrency} / ${p.toCurrency}`;
 if(event.type==='fund.transfer')return p.from==='cash'?'تحويل من الصندوق إلى البنك':'تحويل من البنك إلى الصندوق';
 if(event.type==='remittance.issue')return `استلام حوالة ${p.reference}`;
 if(event.type==='remittance.settle')return `صرف حوالة ${p.reference}`;
 return event.type;
}
/** Cash is projected from exactly the same journal as accountBalances. Opening
 * entries are shown chronologically but never counted as trading receipts.
 * `opening` includes pre-period cash and opening entries dated in the period;
 * `startingBalance` is the balance immediately before the first report day. */
export function cashbook(events,currency='YER',from='0000-01-01',to='9999-12-31'){
 if(!Object.hasOwn(CURRENCIES,currency))throw Error('عملة حركة الصندوق غير مدعومة');
 if(typeof from!=='string'||typeof to!=='string'||from>to)throw Error('تحقق من تاريخ البداية والنهاية');
 const records=activeRecords(events),byId=new Map(records.map(e=>[e.id,e])),people=activeParties(events),groups=new Map();
 for(const posting of financialPostings(events)){
  if(posting.currency!==currency||posting.account!=='cash')continue;
  if(!groups.has(posting.eventId))groups.set(posting.eventId,{inUnits:0,outUnits:0});
  const group=groups.get(posting.eventId),side=posting.side==='debit'?'inUnits':'outUnits';group[side]=addUnits(group[side],posting.units);
 }
 const ordered=[...groups.entries()].map(([id,units])=>({event:byId.get(id),...units})).sort((a,b)=>chronologicalOrder(a.event,b.event));
 let startingUnits=0,openingUnits=0,incomingUnits=0,outgoingUnits=0,runningUnits=0;const rows=[],openingEntries=[];
 for(const {event,inUnits,outUnits} of ordered){
  const day=dateOnly(event.at),changeUnits=inUnits-outUnits;
  if(day<from){startingUnits=addUnits(startingUnits,changeUnits);continue;}
  if(day>to)continue;
  const isOpening=event.type==='cash.open';
  if(isOpening)openingUnits=addUnits(openingUnits,changeUnits);
  else {incomingUnits=addUnits(incomingUnits,inUnits);outgoingUnits=addUnits(outgoingUnits,outUnits);}
  // An exchange can receive a fee and pay cash in the same currency. Keep both
  // flows visible, instead of showing only a net amount that cannot be matched
  // to the inbound/outbound totals above the table.
  for(const [direction,units] of [['in',inUnits],['out',outUnits]]){
   if(!units)continue;
   const leg=direction==='in'?units:-units;
   rows.push({id:event.id,key:`${event.id}:${direction}`,at:event.at,type:event.type,currency,source:cashSource(event,people)+(inUnits&&outUnits?(direction==='in'?' - وارد':' - صادر'):''),notes:event.payload.notes||'',isOpening,direction,amount:fromMinor(units,currency),change:fromMinor(leg,currency),incoming:direction==='in'?fromMinor(units,currency):0,outgoing:direction==='out'?fromMinor(units,currency):0,changeUnits:leg});
  }
 }
 runningUnits=startingUnits;
 for(const row of rows){runningUnits=addUnits(runningUnits,row.changeUnits);row.runningBalance=fromMinor(runningUnits,currency);delete row.changeUnits;if(row.isOpening)openingEntries.push(row);}
 const opening=addUnits(startingUnits,openingUnits),closing=addUnits(addUnits(opening,incomingUnits),-outgoingUnits);
 if(closing!==runningUnits)throw Error('Cash reconciliation failed');
 return {currency,from,to,opening:fromMinor(opening,currency),startingBalance:fromMinor(startingUnits,currency),incoming:fromMinor(incomingUnits,currency),outgoing:fromMinor(outgoingUnits,currency),netChange:fromMinor(incomingUnits-outgoingUnits,currency),closing:fromMinor(closing,currency),rows,openingEntries};
}
