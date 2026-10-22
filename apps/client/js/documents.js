import {CURRENCIES,parties,describeEvent,statement,balanceDescription,money} from './ledger.js';
import {makePdf,makeInvoicePdf} from './pdf.js';

// One document definition serves printing and the silent send path. Creating it
// does not navigate, open a preview, or ask the operating system to share a file.
export function buildEventDocument(event,events,brandInfo,recipientId='') {
 const p=event.payload||{},currency=p.currency||'YER',people=parties(events);
 const involved=p.kind==='transfer'&&event.type==='journal.create'?[p.fromPartyId,p.toPartyId]:[p.partyId];
 if(recipientId&&!involved.includes(recipientId))throw Error('المستلم ليس طرفاً في هذا المستند');
 const person=people.find(x=>x.id===(recipientId||involved[0]));
 const d=describeEvent(event,people),number=p.invoiceNumber||event.id.slice(0,12);
 const filename=`Qatfah-${number}${recipientId?'-'+recipientId.slice(0,8):''}.pdf`;
 const date=new Date(event.at).toLocaleString('ar-YE',{timeZone:'Asia/Aden',dateStyle:'medium',timeStyle:'short'});
 const balance=person?balanceDescription(statement(events,person.id,'0000-01-01','9999-12-31',currency).closing,currency):null;
 const balanceText=balance?`${balance.label}: ${money(balance.amount,currency)}`:'';
 const caption=`${d.title} #${number} • ${money(d.amount,currency)} • ${brandInfo.name}${person?' • '+person.name:''}${balanceText?' • '+balanceText:''}`;
 if(event.type==='invoice.create')return {filename,phone:person?.phone||'',caption,kind:'invoice',invoice:{event,brandInfo,party:person||{},balanceText}};
 let columns=['البيان','القيمة'],rows=[[p.notes||d.title,money(d.amount,currency)]];
 const meta=[`رقم المستند: ${number}`,`التاريخ والوقت: ${date}`,`الجهة: ${person?.name||p.category||'الصندوق'}`,`العملة: ${CURRENCIES[currency].label}`];
 if(event.type==='journal.create'){
  columns=['الحساب','عليه / مدين','له / دائن','طريقة القيد'];
  const name=id=>people.find(x=>x.id===id)?.name||id;
  const method=p.method==='cash'?'نقداً عبر الصندوق':'قيد دفتري فقط';
  rows=p.kind==='transfer'?
   [[name(p.fromPartyId),'—',money(p.amount,currency),method],[name(p.toPartyId),money(p.amount,currency),'—',method]]:
   [[name(p.partyId),p.kind==='debit'?money(p.amount,currency):'—',p.kind==='credit'?money(p.amount,currency):'—',method]];
  meta.push(p.kind==='transfer'?'نقل الدين من الحساب الأول إلى الحساب الثاني دون حركة نقدية':p.kind==='debit'?(p.method==='cash'?'صرف نقدي للعميل يزيد المبلغ المطلوب منه':'زيادة المبلغ المطلوب من العميل دون حركة نقدية'):(p.method==='cash'?'قبض نقدي من العميل ينقص المبلغ المطلوب منه':'تخفيض المبلغ المطلوب من العميل دون حركة نقدية'));
 }
 if(p.notes)meta.push(`البيان: ${p.notes}`);
 if(balanceText)meta.push(`الرصيد الحالي للحساب: ${balanceText}`);
 return {filename,phone:person?.phone||'',caption,kind:'general',spec:{title:d.title,brand:brandInfo.name,logo:brandInfo.logo,contact:brandInfo.phone,address:brandInfo.address,currency,meta,columns,rows,footer:`الإجمالي: ${money(d.amount,currency)}${balanceText?' • '+balanceText:''}`}};
}

export async function makeEventDocument(event,events,brandInfo,recipientId='') {
 const document=buildEventDocument(event,events,brandInfo,recipientId);
 const blob=await (document.kind==='invoice'?makeInvoicePdf(document.invoice):makePdf(document.spec));
 return {...document,blob};
}
