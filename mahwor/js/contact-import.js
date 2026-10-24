/** User-initiated, one-contact phone import. No address book read permission, no upload. */
import {latinPhoneDigits,normalizeYemenPhone} from './whatsapp-session.js';

/** Return just the digits AFTER the fixed +967 prefix, including partial input. */
export function localYemenPhoneDigits(value){
 let digits=latinPhoneDigits(value).replace(/\D/g,'');
 if(digits.startsWith('00967'))digits=digits.slice(5);
 else if(digits.startsWith('967'))digits=digits.slice(3);
 if(digits.startsWith('0'))digits=digits.slice(1);
 return digits.slice(0,9);
}
export function parsePickedContact(data){
 if(!data||data.cancelled===true)return null;
 if(typeof data.phone!=='string'||!data.phone.trim())throw Error('جهة الاتصال المختارة لا تحتوي على رقم هاتف');
 const phone=normalizeYemenPhone(data.phone);
 return {phone,localPhone:phone.slice(3),name:typeof data.name==='string'?data.name.trim().slice(0,110):''};
}
/** Prefer Android ACTION_PICK; use web Contacts Picker only if available. */
export async function pickContactPhone({nativePlugin,navigatorRef=globalThis.navigator}={}){
 if(typeof nativePlugin?.pickPhoneContact==='function')return parsePickedContact(await nativePlugin.pickPhoneContact());
 if(typeof navigatorRef?.contacts?.select==='function'){
  const selected=await navigatorRef.contacts.select(['name','tel'],{multiple:false});
  if(!Array.isArray(selected)||selected.length===0)return null;
  const contact=selected[0]||{};
  return parsePickedContact({name:Array.isArray(contact.name)?contact.name[0]:contact.name,phone:Array.isArray(contact.tel)?contact.tel[0]:contact.tel});
 }
 throw Error('اختيار جهات الاتصال متاح عبر تطبيق أندرويد الجديد، حدّث التطبيق أو اكتب الرقم يدوياً');
}
