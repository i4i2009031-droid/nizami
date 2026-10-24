/** Read-only inventory projection, based on the SAME immutable invoice event log.
 * No new database. Returns with no supported document type are not invented.
 * Negative quantities are shown, never silently clamped away.
 */
import {activeRecords} from './accounting-primitives.js';
export function inventorySummary(events){
 const map=new Map();
 for(const event of activeRecords(events)){
  if(event.type==='item.add'){
   map.set(event.payload.id,{id:event.payload.id,name:event.payload.name,unit:event.payload.unit||'وحدة',purchased:0,sold:0,opening:0});
  }
  if(event.type==='item.update'&&map.has(event.payload.id)){
   const old=map.get(event.payload.id);map.set(event.payload.id,{...old,name:event.payload.name||old.name,unit:event.payload.unit||old.unit});
  }
 }
 const byName=new Map([...map.values()].map(x=>[x.name,x]));
 for(const event of activeRecords(events)){
  if(event.type!=='invoice.create')continue;
  const p=event.payload;if(!['sale','purchase'].includes(p.kind))continue;
  for(const line of p.items||[]){
   const item=(line.itemId&&map.get(line.itemId))||byName.get(line.title);
   if(!item)continue;
   const qty=Number(line.qty);
   if(!Number.isFinite(qty)||qty<=0)continue;
   if(p.kind==='purchase')item.purchased+=qty;
   else item.sold+=qty;
  }
 }
 return [...map.values()].map(x=>({...x,remaining:x.opening+x.purchased-x.sold}))
   .sort((a,b)=>a.name.localeCompare(b.name,'ar'));
}
