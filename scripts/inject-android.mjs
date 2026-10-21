import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

/** Copy the checked-in Android integration verbatim into a Capacitor project. */
export function injectAndroid(app,{cwd=process.cwd()}={}){
  if(app!=='client'&&app!=='admin')throw Error('Expected client or admin');
  if(app==='admin')return 'Admin application does not need client native plugins';
  const src=path.resolve(cwd,'native/android');
  const dir=path.resolve(cwd,'android/app/src/main/java/com/qatfah/accounting');
  fs.mkdirSync(dir,{recursive:true});
  for(const file of ['MainActivity.java','QatfahNativePlugin.java','QatfahWhatsappDirect.java','QatfahAttachmentProvider.java']){
    fs.copyFileSync(path.join(src,file),path.join(dir,file));
  }
  // The visible legacy WhatsApp Activity is no longer an application entry point.
  fs.rmSync(path.join(dir,'WhatsAppWebActivity.java'),{force:true});
  const manifest=path.resolve(cwd,'android/app/src/main/AndroidManifest.xml');
  let xml=fs.readFileSync(manifest,'utf8');
  xml=xml.replace(/<activity\b(?=[^>]*android:name="(?:\.WhatsAppWebActivity|com\.qatfah\.accounting\.WhatsAppWebActivity)")[^>]*(?:\/\s*>|>[\s\S]*?<\/activity\s*>)/g,'');
  // Capacitor has its own androidx.core.content.FileProvider (.fileprovider).
  // Match our authority, not that shared base class. A distinct subclass also
  // prevents the manifest merger from combining the two provider identities.
  const provider='<provider android:name="com.qatfah.accounting.QatfahAttachmentProvider" android:authorities="${applicationId}.waattachments" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/qatfah_wa_paths"/></provider>';
  let providerWritten=false;
  xml=xml.replace(/<provider\b[^>]*?(?:\/\s*>|>[\s\S]*?<\/provider\s*>)/g,node=>{
    const tag=node.slice(0,node.indexOf('>')+1);
    const name=tag.match(/\bandroid:name\s*=\s*(["'])(.*?)\1/)?.[2];
    const authority=tag.match(/\bandroid:authorities\s*=\s*(["'])(.*?)\1/)?.[2];
    const ours=name==='com.qatfah.accounting.QatfahAttachmentProvider'||name==='.QatfahAttachmentProvider'||authority==='${applicationId}.waattachments'||authority==='com.qatfah.accounting.waattachments';
    if(!ours)return node;
    if(providerWritten)return '';
    providerWritten=true;
    return provider;
  });
  if(!providerWritten){
    if(!xml.includes('</application>'))throw Error('Android manifest has no application closing tag');
    xml=xml.replace('</application>',provider+'\n    </application>');
  }
  const xmlDir=path.resolve(cwd,'android/app/src/main/res/xml');
  fs.mkdirSync(xmlDir,{recursive:true});
  fs.writeFileSync(path.join(xmlDir,'qatfah_wa_paths.xml'),'<?xml version="1.0" encoding="utf-8"?><paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="wa-attachments" path="wa-attachments/"/></paths>');
  const assets=path.resolve(cwd,'android/app/src/main/assets');
  fs.mkdirSync(assets,{recursive:true});
  fs.copyFileSync(path.join(src,'whatsapp-direct.js'),path.join(assets,'whatsapp-direct.js'));
  fs.writeFileSync(manifest,xml);
  // 1.13.0 adds acknowledged, site-scoped storage deletion for explicit logout.
  const gradle=path.resolve(cwd,'android/app/build.gradle');
  let build=fs.readFileSync(gradle,'utf8');
  if(!build.includes('androidx.webkit:webkit:1.13.0')){
    build+='\n// Qatfah: site-scoped WhatsApp logout without touching accounting storage.\ndependencies { implementation "androidx.webkit:webkit:1.13.0" }\n';
    fs.writeFileSync(gradle,build);
  }
  return 'Injected Activity-owned WhatsApp session, native sending and document picker';
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  console.log(injectAndroid(process.argv[2]));
}
