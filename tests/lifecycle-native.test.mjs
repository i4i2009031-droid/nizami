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
    fs.writeFileSync(manifest,'<manifest xmlns:android="http://schemas.android.com/apk/res/android"><application><activity android:name=".MainActivity"/><activity android:name=".WhatsAppWebActivity" android:exported="false"/><service android:name=".KeepThisService"/></application></manifest>');
    const inject=()=>injectAndroid('client',{cwd:temp});
    inject();
    for(const file of ['MainActivity.java','QatfahNativePlugin.java','QatfahWhatsappDirect.java']){
      assert.equal(fs.readFileSync(path.join(destination,file),'utf8'),fs.readFileSync(path.join(native,file),'utf8'),`${file} must reach the APK unchanged`);
    }
    assert.equal(fs.readFileSync(path.join(app,'assets/whatsapp-direct.js'),'utf8'),fs.readFileSync(path.join(native,'whatsapp-direct.js'),'utf8'));
    assert.equal(fs.existsSync(path.join(destination,'WhatsAppWebActivity.java')),false);
    const first=fs.readFileSync(manifest,'utf8');
    assert.equal(first.includes('WhatsAppWebActivity'),false);
    assert.ok(first.includes('.KeepThisService'));
    assert.ok(first.includes('${applicationId}.waattachments'));
    assert.ok(fs.existsSync(path.join(app,'res/xml/qatfah_wa_paths.xml')));
    const build=fs.readFileSync(gradle,'utf8');assert.ok(build.includes('androidx.webkit:webkit:1.13.0'));
    inject();assert.equal(fs.readFileSync(manifest,'utf8'),first);assert.equal(fs.readFileSync(gradle,'utf8'),build);
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
