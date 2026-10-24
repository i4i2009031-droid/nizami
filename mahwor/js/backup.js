/** Portable Qatfah bookkeeping backup. All catalogues, contacts, currencies,
 * invoices and identity settings are materialised from the original event log. */
import {validateNewAccountingEvents} from './money-services.js';
export const BACKUP_FORMAT = 'QatfahPortableBackup';
export const BACKUP_VERSION = 2;
const validCurrency = new Set(['YER','SAR','USD']);
export function buildPortableBackup(tenantId, events, createdAt=new Date().toISOString()) {
  if(!tenantId || !Array.isArray(events))throw new Error('بيانات النسخة الاحتياطية غير صحيحة');
  return { format: BACKUP_FORMAT, version: BACKUP_VERSION, tenant: String(tenantId), createdAt,
    currencies:[...validCurrency], events: structuredClone(events) };
}
export function parsePortableBackup(text, tenantId) {
  if(typeof text!=='string'||text.length>40_000_000)throw new Error('ملف النسخة كبير أو غير صالح');
  let data;try{data=JSON.parse(text);}catch{throw new Error('ملف JSON غير صالح');}
  if(!data||data.format!==BACKUP_FORMAT||data.version!==BACKUP_VERSION||!Array.isArray(data.events))throw new Error('صيغة النسخة غير مدعومة');
  if(data.tenant!==String(tenantId))throw new Error('هذه النسخة تخص حسابًا آخر؛ لا تخلط سجلات المحلات');
  if(data.events.length>100_000)throw new Error('عدد السجلات يتجاوز حد الاستيراد الآمن');
  const ids=new Set();
  for(const event of data.events) {
    if(!event||typeof event!=='object'||typeof event.id!=='string'||event.id.length>150||
      typeof event.type!=='string'||event.type.length>80||typeof event.at!=='string'||
      !event.payload||typeof event.payload!=='object'||Array.isArray(event.payload)||ids.has(event.id))
      throw new Error('نسخة تحتوي سجلًا مفقودًا أو مكررًا');
    ids.add(event.id);
    if(event.payload.currency&&!validCurrency.has(event.payload.currency))throw new Error('عملة غير مدعومة داخل النسخة');
  }
  validateNewAccountingEvents(data.events);
  return data;
}
export function backupFileName(date=new Date()){
 const d=new Date(date); if(Number.isNaN(d.getTime()))throw new Error('تاريخ غير صالح');
 return `MAHWOR_Backup_${d.toISOString().slice(0,10)}.json`;
}
