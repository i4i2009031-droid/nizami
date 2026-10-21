/** Pure, deterministic accounting projections. Never combine different currencies. */
export const CURRENCIES={YER:{label:'الريال اليمني',symbol:'ر.ي',digits:0},USD:{label:'الدولار الأمريكي',symbol:'$',digits:2},SAR:{label:'الريال السعودي',symbol:'ر.س',digits:2}};
export const currencyOf=p=>CURRENCIES[p?.currency]?p.currency:'YER';
export const rounded=(value,currency='YER')=>{const digits=CURRENCIES[currency]?.digits??0;const f=10**digits;return Math.round((Number(value)+Number.EPSILON)*f)/f;};
export function money(n,currency='YER'){const c=CURRENCIES[currency]||CURRENCIES.YER;return `${new Intl.NumberFormat('en-US',{minimumFractionDigits:c.digits,maximumFractionDigits:c.digits}).format(Number(n)||0)} ${c.symbol}`;}
/** A customer's debit is owed to the shop; credit is owed to the customer. */
export function balanceDescription(value,currency='YER'){
 const balance=rounded(value,currency);
 if(!Number.isFinite(balance))throw new Error('رصيد غير صالح');
 return {side:balance>0?'debit':balance<0?'credit':'settled',label:balance>0?'عليه / مطلوب من العميل':balance<0?'له / مستحق للعميل':'خالص',amount:Math.abs(balance)};
}
/** Business dates use Yemen local time (UTC+3), not UTC calendar days. */
const arabiaDate=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'});
export const dateOnly=dt=>{const str=String(dt||'');if(!str.includes('T'))return str.slice(0,10);const d=new Date(str);if(Number.isNaN(d.getTime()))return str.slice(0,10);const parts=Object.fromEntries(arabiaDate.formatToParts(d).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
export function activeRecords(events){const canceled=new Set(events.filter(e=>e.type==='event.reverse').map(e=>e.payload.ref));return events.filter(e=>e.type!=='event.reverse'&&!canceled.has(e.id));}
export function parties(events){const map=new Map();for(const e of activeRecords(events)){
 if(e.type==='party.add')map.set(e.payload.id,{...e.payload});
 if(e.type==='party.update'&&map.has(e.payload.id))map.set(e.payload.id,{...map.get(e.payload.id),...e.payload});
}return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));}
export function itemsCatalog(events){const map=new Map();for(const e of activeRecords(events)){
 if(e.type==='item.add')map.set(e.payload.id,{...e.payload});
 if(e.type==='item.update'&&map.has(e.payload.id))map.set(e.payload.id,{...map.get(e.payload.id),...e.payload});
}return [...map.values()].sort((a,b)=>a.name.localeCompare(b.name,'ar'));}
export function currentSettings(events){let profile={name:'محل قطفة',address:'اليمن',phone:'',logo:'',email:'',commercialId:'',currency:'YER'};for(const e of activeRecords(events))if(e.type==='settings.update')profile={...profile,...e.payload};return profile;}
export function linesForParty(events,partyId,currency='YER'){
 const out=[];for(const e of activeRecords(events)){
  const p=e.payload;if(p.partyId!==partyId||currencyOf(p)!==currency)continue;let change=0,title='';
  if(e.type==='invoice.create'){
   const due=rounded(Number(p.total)-(p.paid??(p.payment==='cash'?p.total:0)),currency);
   change=p.kind==='sale'?due:-due;
   title=p.kind==='sale'?'فاتورة مبيعات':'فاتورة مشتريات';
  }
  if(e.type==='receipt.create'){change=-p.amount;title='سند قبض';}
  if(e.type==='payment.create'){change=p.amount;title='سند صرف';}
  if(e.type==='balance.open'){change=p.direction==='receivable'?p.amount:-p.amount;title='رصيد افتتاحي';}
  if(title&&(change!==0||e.type==='invoice.create'))out.push({id:e.id,at:e.at,title,change:rounded(change,currency),amount:Math.abs(change),currency});
 }
 return out.sort((a,b)=>a.at.localeCompare(b.at)||a.id.localeCompare(b.id));
}
/** Positive => customer owes shop (عليه). Negative => shop owes customer (له). */
export function statement(events,partyId,from='0000-01-01',to='9999-12-31',currency='YER'){
 const list=linesForParty(events,partyId,currency);let opening=0,balance=0;const rows=[];
 for(const row of list){const d=dateOnly(row.at);if(d<from){opening=rounded(opening+row.change,currency);continue;}if(d>to)continue;balance=rounded(balance+row.change,currency);rows.push({...row,balance:rounded(opening+balance,currency)});}
 const closing=rounded(opening+balance,currency);return {opening,rows,closing,debtor:Math.max(closing,0),creditor:Math.max(-closing,0),currency};
}
export function summary(events,from='0000-01-01',to='9999-12-31',currency='YER'){
 const totals={currency,sales:0,purchases:0,expenses:0,receipts:0,payments:0,cashSales:0,cashPurchases:0,count:0,cashMovement:0};
 for(const e of activeRecords(events)){
  const d=dateOnly(e.at),p=e.payload;
  if(d<from||d>to||currencyOf(p)!==currency)continue;
  if(e.type==='invoice.create'){
   const paid=rounded(Number(p.paid??(p.payment==='cash'?p.total:0)),currency);
   if(p.kind==='sale'){totals.sales+=p.total;totals.cashSales+=paid;totals.cashMovement+=paid;}
   else{totals.purchases+=p.total;totals.cashPurchases+=paid;totals.cashMovement-=paid;}
   totals.count++;
  }
  if(e.type==='receipt.create'){totals.receipts+=p.amount;totals.cashMovement+=p.amount;totals.count++;}
  if(e.type==='payment.create'){totals.payments+=p.amount;totals.cashMovement-=p.amount;totals.count++;}
  if(e.type==='expense.create'){totals.expenses+=p.amount;totals.cashMovement-=p.amount;totals.count++;}
 }
 for(const k of Object.keys(totals))if(typeof totals[k]==='number')totals[k]=rounded(totals[k],currency);
 totals.tradingEstimate=rounded(totals.sales-totals.purchases-totals.expenses,currency);
 return totals;
}
export function summaryByCurrency(events,from='0000-01-01',to='9999-12-31'){return Object.keys(CURRENCIES).map(currency=>summary(events,from,to,currency));}
export function groupedSummary(events,from,to,group='day',currency='YER'){
 const map=new Map();for(const e of activeRecords(events)){
  const day=dateOnly(e.at);if(day<from||day>to||currencyOf(e.payload)!==currency||!['invoice.create','expense.create','receipt.create','payment.create'].includes(e.type))continue;
  const key=group==='year'?day.slice(0,4):group==='month'?day.slice(0,7):day;
  if(!map.has(key))map.set(key,[]);map.get(key).push(e);
 }
 return [...map.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([period,list])=>({period,...summary(list,'0000-01-01','9999-12-31',currency)}));
}
export function describeEvent(e,partiesList=[]){const p=e.payload,who=partiesList.find(x=>x.id===p.partyId)?.name||'بدون جهة';const types={'party.add':'إضافة حساب','party.update':'تعديل حساب','item.add':'إضافة صنف','item.update':'تعديل صنف','invoice.create':p.kind==='sale'?'فاتورة مبيعات':'فاتورة مشتريات','receipt.create':'سند قبض','payment.create':'سند صرف','expense.create':'مصروف يومي','settings.update':'تعديل الإعدادات','event.reverse':'إلغاء عملية','balance.open':'رصيد افتتاحي'};return {title:types[e.type]||e.type,sub:e.type==='invoice.create'?who:p.name||p.category||who,amount:p.total??p.amount??0,currency:currencyOf(p)};}
