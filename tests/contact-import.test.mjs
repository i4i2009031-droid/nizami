import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {localYemenPhoneDigits,parsePickedContact,pickContactPhone} from '../apps/client/js/contact-import.js';

const local='777123456';
test('Yemen country code is removed before trimming to nine local digits',()=>{
 for(const raw of ['+967 777 123 456','00967-777-123-456','967777123456','0777123456','777123456','+٩٦٧ ٧٧٧ ١٢٣ ٤٥٦']){
  assert.equal(localYemenPhoneDigits(raw),local,raw);
 }
 assert.equal(localYemenPhoneDigits('+967'),'');
 assert.equal(localYemenPhoneDigits('777'), '777');
 assert.equal(localYemenPhoneDigits('٩٦٧٧٧٧'), '777');
 assert.equal(localYemenPhoneDigits('777123456777'),local);
});
test('import accepts Yemen formats, fills only the suffix, rejects foreign or short numbers',()=>{
 for(const raw of ['+967 777 123 456','00967777123456','967777123456','0777123456','٧٧٧١٢٣٤٥٦']){
  const c=parsePickedContact({name:'  أحمد اليمني ',phone:raw});
  assert.deepEqual(c,{name:'أحمد اليمني',phone:'967'+local,localPhone:local});
 }
 assert.equal(parsePickedContact({cancelled:true}),null);
 assert.equal(parsePickedContact(null),null);
 assert.throws(()=>parsePickedContact({name:'بدون رقم'}),/لا تحتوي على رقم/);
 assert.throws(()=>parsePickedContact({phone:'+966 555 123 456'}),/رقم الجوال اليمني/);
 assert.throws(()=>parsePickedContact({phone:'+967 1234'}),/رقم الجوال اليمني/);
});
test('Android picker yields one contact and cancelled picker yields no mutation',async()=>{
 const selected=await pickContactPhone({nativePlugin:{pickPhoneContact:async()=>({name:'مريم',phone:'+967777123456'})}});
 assert.equal(selected.localPhone,local);
 assert.equal(await pickContactPhone({nativePlugin:{pickPhoneContact:async()=>({cancelled:true})}}),null);
});
test('browser contact picker fallback selects only one entry if the API exists',async()=>{
 const navigatorRef={contacts:{select:async(fields,options)=>{
  assert.deepEqual(fields,['name','tel']);assert.deepEqual(options,{multiple:false});
  return [{name:['من جهات الاتصال'],tel:['00967777123456']}];
 }}};
 assert.equal((await pickContactPhone({navigatorRef})).localPhone,local);
 await assert.rejects(()=>pickContactPhone({nativePlugin:{},navigatorRef:{}}),/تطبيق أندرويد/);
});
test('native Android contact chooser uses ACTION_PICK, not unrestricted READ_CONTACTS',async()=>{
 const java=await readFile(new URL('../native/android/QatfahNativePlugin.java',import.meta.url),'utf8');
 assert.match(java,/void pickPhoneContact\(PluginCall call\)/);
 assert.match(java,/Intent\.ACTION_PICK,ContactsContract\.CommonDataKinds\.Phone\.CONTENT_URI/);
 assert.match(java,/ContactsContract\.CommonDataKinds\.Phone\.NUMBER/);
 assert.match(java,/getContentResolver\(\)\.query/);
 assert.doesNotMatch(java,/Manifest\.permission\.READ_CONTACTS|requestPermissions\(/);
});
test('all add-customer flows expose contact picker; main menu exposes searched sections',async()=>{
 const app=await readFile(new URL('../apps/client/js/app.js',import.meta.url),'utf8');
 for(const id of ['party-pick-contact','quick-party-pick-contact','journal-party-pick-contact']){
  assert.match(app,new RegExp('id="'+id+'"'));
  assert.match(app,new RegExp("bindContactPicker\\('"+id+"'"));
 }
 for(const id of ['supplier','receipts','payments','expenses','statements','money-services','whatsapp','invoices-list','parties-list']){
  assert.match(app,new RegExp("\\['"+id+"'"));
 }
 assert.match(app,/id="home-services"/);
 assert.match(app,/id="home-service-search"/);
});
