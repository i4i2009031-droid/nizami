import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {fileURLToPath} from 'node:url';
import {injectAndroid} from '../scripts/inject-android.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const native=path.join(root,'native/android');
const java=fs.readFileSync(path.join(native,'QatfahWhatsappDirect.java'),'utf8');
// Execute the exact Java-injected observer, rather than a separate test copy.
const declaration=java.match(/private static final String SESSION_STATE=([\s\S]*?);\n private void observeSession/);
assert.ok(declaration,'native passive observer must be available');
const observer=[...declaration[1].matchAll(/"(?:\\.|[^"\\])*"/g)].map(m=>JSON.parse(m[0])).join('');
const visible=(text='')=>({innerText:text,getClientRects:()=>[{}]});
function observe({online=true,chat=false,reconnect=false,revoked=false,dialog=false,qr=false,readyState='complete'}={}){
  const touched=[];
  const document={readyState,querySelectorAll(selector){
    touched.push(selector);
    if(selector.includes('[data-testid=logged-out]'))return revoked?[visible('You have been logged out')]:[];
    if(selector.includes('#pane-side'))return chat?[visible()]:[];
    if(selector.includes('[data-testid=alert-phone]'))return reconnect?[visible('Reconnecting')]:[];
    if(selector.includes('[role=dialog]'))return dialog?[visible('You have been logged out')]:[];
    if(selector.includes('canvas'))return qr?[visible()]:[];
    return [];
  }};
  return {state:JSON.parse(vm.runInNewContext(observer,{document,navigator:{onLine:online},getComputedStyle:()=>({visibility:'visible'})})),touched};
}

test('Android injection copies the actual MainActivity and hidden engine, removes legacy activity, and is repeatable',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qatfah-android-inject-'));
  try{
    fs.cpSync(native,path.join(temp,'native/android'),{recursive:true});
    const app=path.join(temp,'android/app/src/main');
    const destination=path.join(app,'java/com/qatfah/accounting');
    fs.mkdirSync(destination,{recursive:true});
    const gradle=path.join(temp,'android/app/build.gradle');
    fs.writeFileSync(gradle,'plugins { id "com.android.application" }\n');
    fs.writeFileSync(path.join(destination,'MainActivity.java'),'old generated stub');
    fs.writeFileSync(path.join(destination,'WhatsAppWebActivity.java'),'legacy visible activity');
    const manifest=path.join(app,'AndroidManifest.xml');
    // Capacitor already supplies a FileProvider. Its existence must not suppress
    // the separate legacy attachment authority retained for upgrade compatibility.
    const capacitorProvider='<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.fileprovider" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths"/></provider>';
    fs.writeFileSync(manifest,'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity"/><activity android:name=".WhatsAppWebActivity" android:exported="false"/><service android:name=".KeepThisService"/>'+capacitorProvider+'</application></manifest>');
    const inject=()=>injectAndroid('client',{cwd:temp});
    inject();
    for(const file of ['MainActivity.java','QatfahNativePlugin.java','QatfahWhatsappDirect.java','QatfahAttachmentProvider.java']){
      assert.equal(fs.readFileSync(path.join(destination,file),'utf8'),fs.readFileSync(path.join(native,file),'utf8'),`${file} must reach the APK unchanged`);
    }
    assert.equal(fs.readFileSync(path.join(app,'assets/whatsapp-direct.js'),'utf8'),fs.readFileSync(path.join(native,'whatsapp-direct.js'),'utf8'));
    for(const name of ['wppconnect-wa.js','WPP-LICENSE.txt','wppconnect-wa.js.LICENSE.txt']){
      assert.equal(fs.readFileSync(path.join(app,'assets',name),'utf8'),fs.readFileSync(path.join(native,'vendor',name),'utf8'));
    }
    assert.equal(fs.readFileSync(path.join(app,'assets/qatfah-wpp-manifest.json'),'utf8'),fs.readFileSync(path.join(native,'vendor/manifest.json'),'utf8'));
    assert.equal(fs.existsSync(path.join(destination,'WhatsAppWebActivity.java')),false);
    const first=fs.readFileSync(manifest,'utf8');
    assert.equal(first.includes('WhatsAppWebActivity'),false);
    assert.ok(first.includes('.KeepThisService'));
    assert.ok(first.includes(capacitorProvider),'keep Capacitor sharing provider unchanged');
    assert.ok(first.includes('${applicationId}.waattachments'));
    assert.ok(first.includes('android:name="com.qatfah.accounting.QatfahAttachmentProvider"'));
    assert.ok(fs.existsSync(path.join(app,'res/xml/qatfah_wa_paths.xml')));
    const build=fs.readFileSync(gradle,'utf8');assert.ok(build.includes('androidx.webkit:webkit:1.13.0'));
    inject();assert.equal(fs.readFileSync(manifest,'utf8'),first);assert.equal(fs.readFileSync(gradle,'utf8'),build);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('Android injection migrates only the attachment provider and repairs stale path metadata',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qatfah-provider-upgrade-'));
  try{
    fs.cpSync(native,path.join(temp,'native/android'),{recursive:true});
    const app=path.join(temp,'android/app/src/main');
    fs.mkdirSync(path.join(app,'res/xml'),{recursive:true});
    fs.writeFileSync(path.join(temp,'android/app/build.gradle'),'');
    const otherProvider='<provider android:name="example.OtherProvider" android:authorities="example.other" android:exported="false"/>';
    const oldProvider='<provider android:name="androidx.core.content.FileProvider" android:authorities="${applicationId}.waattachments" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/old_paths"/></provider>';
    const duplicate="<provider android:name='.QatfahAttachmentProvider' android:authorities='com.qatfah.accounting.waattachments'/>";
    const manifest=path.join(app,'AndroidManifest.xml');
    fs.writeFileSync(manifest,'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application>'+otherProvider+oldProvider+duplicate+'</application></manifest>');
    const paths=path.join(app,'res/xml/qatfah_wa_paths.xml');
    fs.writeFileSync(paths,'<paths><root-path name="unsafe" path="/"/></paths>');
    injectAndroid('client',{cwd:temp});
    const first=fs.readFileSync(manifest,'utf8');
    assert.ok(first.includes(otherProvider));
    assert.equal((first.match(/\.waattachments/g)||[]).length,1,'one registered attachment authority');
    assert.equal((first.match(/QatfahAttachmentProvider/g)||[]).length,1,'one distinct provider identity');
    assert.equal(first.includes('@xml/old_paths'),false);
    assert.ok(first.includes('android:resource="@xml/qatfah_wa_paths"'));
    assert.equal(fs.readFileSync(paths,'utf8'),'<?xml version="1.0" encoding="utf-8"?><paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="wa-attachments" path="wa-attachments/"/></paths>');
    injectAndroid('client',{cwd:temp});
    assert.equal(fs.readFileSync(manifest,'utf8'),first);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('admin injection does not add the client WhatsApp engine',()=>{
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qatfah-admin-inject-'));
  try{
    injectAndroid('admin',{cwd:temp});
    assert.deepEqual(fs.readdirSync(temp),[]);
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('missing DOM and QR presence cannot revoke pairing in the passive observer',()=>{
  for(const opts of [{},{qr:true},{readyState:'loading'},{dialog:true}]){
    const {state,touched}=observe(opts);
    assert.notEqual(state.authRevoked,true);
    assert.notEqual(state.authenticated,true);
    assert.equal(touched.some(selector=>selector.includes('canvas')),false);
  }
});

test('live transport readiness requires online authenticated UI with no reconnect notice',()=>{
  assert.deepEqual(observe({chat:true}).state,{status:'connected',authenticated:true,transportReady:true});
  assert.deepEqual(observe({chat:true,online:false}).state,{status:'offline'});
  assert.deepEqual(observe({chat:true,reconnect:true}).state,{status:'reconnecting'});
});

test('only a visible explicit signed-out screen reports authentication revocation',()=>{
  assert.deepEqual(observe({revoked:true}).state,{status:'not_linked',authRevoked:true});
  assert.notEqual(observe({dialog:true,chat:true}).state.authRevoked,true);
});

test('the Android build rejects missing or modified pinned WA-JS assets',()=>{
 for(const mutate of ['tamper','missing','manifest']){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qatfah-wpp-integrity-'));
  try{
   fs.cpSync(native,path.join(temp,'native/android'),{recursive:true});
   const vendor=path.join(temp,'native/android/vendor');
   if(mutate==='tamper')fs.appendFileSync(path.join(vendor,'wppconnect-wa.js'),'\n// tampered');
   if(mutate==='missing')fs.rmSync(path.join(vendor,'wppconnect-wa.js.LICENSE.txt'));
   if(mutate==='manifest'){
    const manifest=JSON.parse(fs.readFileSync(path.join(vendor,'manifest.json'),'utf8'));
    delete manifest.files['wppconnect-wa.js'];fs.writeFileSync(path.join(vendor,'manifest.json'),JSON.stringify(manifest));
   }
   assert.throws(()=>injectAndroid('client',{cwd:temp}),/integrity mismatch|ENOENT|Incomplete/);
   assert.equal(fs.existsSync(path.join(temp,'android')),false,'integrity must be checked before copying native outputs');
  }finally{fs.rmSync(temp,{recursive:true,force:true});}
 }
});

test('native runtime pin matches build manifest and no external WhatsApp Intent API remains',()=>{
 const manifest=JSON.parse(fs.readFileSync(path.join(native,'vendor/manifest.json'),'utf8'));
 assert.equal(java.match(/WPP_SHA256="([a-f0-9]+)"/)?.[1],manifest.files['wppconnect-wa.js'].sha256);
 assert.equal(java.match(/WPP_VERSION="([0-9.]+)"/)?.[1],manifest.version);
 const plugin=fs.readFileSync(path.join(native,'QatfahNativePlugin.java'),'utf8');
 assert.doesNotMatch(plugin,/sendWhatsAppIntent|Intent\.ACTION_SEND|com\.whatsapp\.w4b|@s\.whatsapp\.net/);
});
