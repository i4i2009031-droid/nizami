/** Shared immutable bookkeeping primitives. Monetary arithmetic uses integer
 * minor units; YER has no fraction and SAR/USD have two decimal places. */
export const CURRENCIES=Object.freeze({YER:Object.freeze({label:'الريال اليمني',symbol:'ر.ي',digits:0}),USD:Object.freeze({label:'الدولار الأمريكي',symbol:'$',digits:2}),SAR:Object.freeze({label:'الريال السعودي',symbol:'ر.س',digits:2})});
export const currencyOf=p=>Object.hasOwn(CURRENCIES,p?.currency)?p.currency:'YER';
export function minorFactor(currency){
 const value=Object.hasOwn(CURRENCIES,currency)?CURRENCIES[currency]:null;if(!value)throw Error('Unsupported currency');
 return 10**value.digits;
}
/** Round the decimal representation, not a binary float multiplication. This
 * matters for inputs such as 1.005 SAR and for repeated 0.01 receipts. */
export function toMinor(amount,currency){
 if(typeof amount!=='number'&&typeof amount!=='string')throw Error('Invalid amount');
 const factor=minorFactor(currency),text=String(amount).trim(),number=Number(text);
 if(!text||!Number.isFinite(number)||number<0||number>1e12||text.length>80)throw Error('Invalid nonnegative amount');
 const match=text.match(/^\+?(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i);
 if(!match)throw Error('Invalid amount');
 if(number===0)return 0;
 const decimalPlaces=CURRENCIES[currency].digits;
 const fraction=match[2]||'',exponent=Number(match[3]||0);
 let digits=BigInt(match[1]+fraction),shift=decimalPlaces+exponent-fraction.length;
 if(shift>=0)digits*=10n**BigInt(shift);
 else{
  const divisor=10n**BigInt(-shift),quotient=digits/divisor,remainder=digits%divisor;
  digits=quotient+(remainder*2n>=divisor?1n:0n);
 }
 const units=Number(digits);
 if(!Number.isSafeInteger(units)||factor<=0)throw Error('Amount exceeds supported precision');
 return units;
}
export function fromMinor(units,currency){
 if(!Number.isSafeInteger(units))throw Error('Amount exceeds supported precision');
 return units/minorFactor(currency);
}
export function addUnits(a,b){
 const result=a+b;if(!Number.isSafeInteger(result))throw Error('Accounting total exceeds supported precision');
 return result;
}
export function signedMinor(value,currency){
 const number=Number(value);if(!Number.isFinite(number))throw Error('Invalid amount');
 return (number<0?-1:1)*toMinor(Math.abs(number),currency);
}
export function rounded(value,currency='YER'){
 const number=Number(value);if(!Number.isFinite(number))return NaN;
 return fromMinor(signedMinor(number,currency),currency);
}
/** Business dates are Yemen local calendar dates, including near UTC midnight. */
const arabiaDate=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'});
export const dateOnly=dt=>{const str=String(dt||'');if(!str.includes('T'))return str.slice(0,10);const d=new Date(str);if(Number.isNaN(d.getTime()))return str.slice(0,10);const parts=Object.fromEntries(arabiaDate.formatToParts(d).map(x=>[x.type,x.value]));return `${parts.year}-${parts.month}-${parts.day}`;};
export function activeRecords(events){const canceled=new Set(events.filter(e=>e.type==='event.reverse').map(e=>e.payload.ref));return events.filter(e=>e.type!=='event.reverse'&&!canceled.has(e.id));}
