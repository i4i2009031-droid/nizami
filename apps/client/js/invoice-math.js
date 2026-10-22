/** Invoice calculations use decimal quantities and integer minor units. Prices
 * are rounded first, then each line is rounded half-up; invoice totals are the
 * sum of those displayed line amounts. Public amounts are in major units. */
import {minorFactor,toMinor,fromMinor,addUnits,dateOnly} from './accounting-primitives.js';

function decimalRatio(value,maximum,positive,label){
 if(typeof value!=='number'&&typeof value!=='string')throw Error(`Invalid ${label}`);
 const text=String(value).trim(),numeric=Number(text);
 if(!text||text.length>80||!Number.isFinite(numeric)||numeric<0||numeric>maximum||(positive&&numeric<=0))throw Error(`Invalid ${label}`);
 const match=text.match(/^\+?(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i);
 if(!match)throw Error(`Invalid ${label}`);
 // Avoid exponent expansion for zero and underflowing zero-valued prices.
 if(numeric===0)return [0n,1n];
 const fraction=match[2]??match[3]??'',integer=match[1]||'0';
 const shift=Number(match[4]||0)-fraction.length;
 let numerator=BigInt(integer+fraction),denominator=1n;
 if(shift>=0)numerator*=10n**BigInt(shift);else denominator=10n**BigInt(-shift);
 if(numerator>BigInt(maximum)*denominator||(positive&&numerator===0n))throw Error(`Invalid ${label}`);
 return [numerator,denominator];
}
const halfUp=(numerator,denominator)=>numerator/denominator+(numerator%denominator*2n>=denominator?1n:0n);
function lineUnits(qty,price,currency){
 const factor=BigInt(minorFactor(currency));
 const [quantity,quantityScale]=decimalRatio(qty,1e6,true,'invoice quantity');
 const [unitPrice,priceScale]=decimalRatio(price,1e12,false,'invoice price');
 const roundedPrice=halfUp(unitPrice*factor,priceScale);
 const units=Number(halfUp(quantity*roundedPrice,quantityScale));
 if(!Number.isSafeInteger(units)||units>1e12*Number(factor))throw Error('Invoice amount exceeds supported precision or limit');
 return units;
}
export function invoiceLineAmount(qty,price,currency='YER'){
 return fromMinor(lineUnits(qty,price,currency),currency);
}
export function invoiceItemsTotal(items,currency='YER'){
 const factor=minorFactor(currency);
 if(!Array.isArray(items))throw Error('Invalid invoice items');
 let units=0;
 for(const item of items){
  if(!item||typeof item!=='object')throw Error('Invalid invoice item');
  units=addUnits(units,lineUnits(item.qty,item.price,currency));
 }
 if(units>1e12*factor)throw Error('Invoice total exceeds supported limit');
 return fromMinor(units,currency);
}
/** The caller selects business date, sale kind and customer before calling.
 * Mixed currencies are rejected rather than converted or silently combined. */
export function dailySalesFigures(records,currency='YER'){
 minorFactor(currency);
 if(!Array.isArray(records))throw Error('Invalid invoice records');
 let total=0,paid=0;
 for(const record of records){
  const payload=record?.payload;
  if(record?.type!=='invoice.create'||!payload||(payload.currency||'YER')!==currency)throw Error('Invalid or mixed-currency invoice records');
  const invoiceTotal=toMinor(payload.total,currency);
  const invoicePaid=toMinor(payload.paid??(payload.payment==='cash'?payload.total:0),currency);
  if(invoicePaid>invoiceTotal)throw Error('Paid amount exceeds invoice total');
  total=addUnits(total,invoiceTotal);paid=addUnits(paid,invoicePaid);
 }
 return {total:fromMinor(total,currency),paid:fromMinor(paid,currency),due:fromMinor(total-paid,currency)};
}
/** A reversed/corrected invoice still reserves its original number. Counting
 * active records would recycle cancelled numbers and inflate corrections. */
export function nextInvoiceNumber(events,kind,date){
 if(!Array.isArray(events)||!['sale','purchase'].includes(kind))throw Error('Invalid invoice numbering request');
 const day=dateOnly(date instanceof Date?date.toISOString():date);
 const parsed=new Date(day+'T00:00:00.000Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==day)throw Error('Invalid invoice date');
 const prefix=(kind==='sale'?'INV':'PUR')+'-'+day.replaceAll('-','')+'-';
 let largest=0n;
 for(const event of events){
  if(event?.type!=='invoice.create')continue;
  const number=event.payload?.invoiceNumber;
  if(typeof number!=='string'||!number.startsWith(prefix))continue;
  const suffix=number.slice(prefix.length);
  if(!/^\d+$/.test(suffix))continue;
  const sequence=BigInt(suffix);if(sequence>largest)largest=sequence;
 }
 return prefix+(largest+1n).toString().padStart(4,'0');
}
