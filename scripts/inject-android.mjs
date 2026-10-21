import fs from 'node:fs';import path from 'node:path';
const app=process.argv[2];if(app!=='client'&&app!=='admin')throw Error('Expected client or admin');
if(app==='admin'){console.log('Admin application does not need client native plugins');process.exit(0);}
const pkg='com.qatfah.accounting',src=path.resolve('native/android'),dir=path.resolve('android/app/src/main/java/com/qatfah/accounting');fs.mkdirSync(dir,{recursive:true});
for(const f of ['QatfahNativePlugin.java','WhatsAppWebActivity.java','QatfahWhatsappDirect.java'])fs.copyFileSync(path.join(src,f),path.join(dir,f));
fs.writeFileSync(path.join(dir,'MainActivity.java'),`package ${pkg};\nimport android.os.Bundle;\nimport com.getcapacitor.BridgeActivity;\npublic class MainActivity extends BridgeActivity { @Override public void onCreate(Bundle state) { registerPlugin(QatfahNativePlugin.class); super.onCreate(state); } }\n`);
const manifest=path.resolve('android/app/src/main/AndroidManifest.xml');let xml=fs.readFileSync(manifest,'utf8');if(!xml.includes('WhatsAppWebActivity'))xml=xml.replace('</application>','<activity android:name=".WhatsAppWebActivity" android:exported="false" android:windowSoftInputMode="adjustResize"/>\n    </application>');if(!xml.includes('androidx.core.content.FileProvider')){
 const provider='<provider android:name="androidx.core.content.FileProvider" android:authorities="\u0024{applicationId}.waattachments" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/qatfah_wa_paths"/></provider>';
 xml=xml.replace('</application>',provider+String.fromCharCode(10)+'    </application>');
}
const xmlDir=path.resolve('android/app/src/main/res/xml');fs.mkdirSync(xmlDir,{recursive:true});
fs.writeFileSync(path.join(xmlDir,'qatfah_wa_paths.xml'),'<?xml version="1.0" encoding="utf-8"?><paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="wa-attachments" path="wa-attachments/"/></paths>');
fs.copyFileSync(path.join(src,'whatsapp-direct.js'),path.resolve('android/app/src/main/assets/whatsapp-direct.js'));
fs.writeFileSync(manifest,xml);console.log('Injected native Android backup document picker and WhatsApp Web activity');
