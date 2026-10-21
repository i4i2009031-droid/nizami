/** Build immutable event identities before starting one storage transaction. */
export function createEventBatch(entries,{now=new Date().toISOString(),uuid=()=>crypto.randomUUID()}={}){
 return entries.map(({type,payload,at})=>({id:uuid(),type,payload,at:at??now,synced:true}));
}

/** Corrections keep the invoice's business date; the reversal records when the
 * correction was made. Moving a historical sale into today would change both
 * period reports and the customer's opening balance without a date edit.
 */
export function invoiceEventEntries(payload,previous=null){
 const entries=[];
 if(previous)entries.push({type:'event.reverse',payload:{ref:previous.id,notes:'تصحيح فاتورة من شاشة التحرير'}});
 entries.push({type:'invoice.create',payload,...(previous?{at:previous.at}:{})});
 return entries;
}
