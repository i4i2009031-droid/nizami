import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyAndroidProvider} from '../scripts/verify-android-provider.mjs';

const provider='<provider android:name="com.qatfah.accounting.QatfahAttachmentProvider" android:authorities="com.qatfah.accounting.waattachments" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/qatfah_wa_paths"/></provider>';
const capacitor='<provider android:name="androidx.core.content.FileProvider" android:authorities="com.qatfah.accounting.fileprovider" android:exported="false" android:grantUriPermissions="true"><meta-data android:name="android.support.FILE_PROVIDER_PATHS" android:resource="@xml/file_paths"/></provider>';
const manifest=content=>'<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="com.qatfah.accounting"><application>'+content+'</application></manifest>';
const paths='<paths xmlns:android="http://schemas.android.com/apk/res/android"><cache-path name="wa-attachments" path="wa-attachments/"/></paths>';
const resources=`Package name=com.qatfah.accounting id=7f
  type xml id=15 entryCount=2
    resource 0x7f150000 xml/file_paths
      () (file) res/xml/file_paths.xml type=XML
    resource 0x7f150001 xml/qatfah_wa_paths
      () (file) res/xml/qatfah_wa_paths.xml type=XML
`;

test('packaged provider gate accepts distinct providers and the narrow cache directory',()=>{
  assert.deepEqual(verifyAndroidProvider(manifest(capacitor+provider),paths),{appId:'com.qatfah.accounting',authority:'com.qatfah.accounting.waattachments',provider:'com.qatfah.accounting.QatfahAttachmentProvider',path:'cache/wa-attachments/'});
});

test('numeric APK metadata is resolved through its own resource table ID and file',()=>{
  for(const reference of ['@ref/0x7f150001','@0x7f150001','@7F150001','@'+Number.parseInt('7f150001',16)]){
    const numeric=manifest(capacitor+provider.replace('@xml/qatfah_wa_paths',reference));
    assert.equal(verifyAndroidProvider(numeric,paths,'com.qatfah.accounting',resources).authority,'com.qatfah.accounting.waattachments');
    assert.throws(()=>verifyAndroidProvider(numeric,paths),/resources dump/);
  }
});

test('numeric APK metadata cannot borrow the correct filename from a different resource ID or package',()=>{
  const numeric=manifest(capacitor+provider.replace('@xml/qatfah_wa_paths','@ref/0x7f150001'));
  for(const bad of [
    resources.replace('resource 0x7f150001','resource 0x7f150002'),
    resources.replace('Package name=com.qatfah.accounting','Package name=another.application'),
    resources.replace('(file) res/xml/qatfah_wa_paths.xml','(file) res/xml/file_paths.xml'),
    resources.replace('resource 0x7f150001 xml/qatfah_wa_paths','resource 0x7f150001 xml/another_paths'),
    resources+'    resource 0x7f150002 xml/qatfah_wa_paths\n      () (file) res/xml/qatfah_wa_paths.xml type=XML\n',
    resources+'      (v35) (file) res/xml-v35/qatfah_wa_paths.xml type=XML\n'
  ])assert.throws(()=>verifyAndroidProvider(numeric,paths,'com.qatfah.accounting',bad));
  const wrongId=manifest(capacitor+provider.replace('@xml/qatfah_wa_paths','@ref/0x7f150000'));
  assert.throws(()=>verifyAndroidProvider(wrongId,paths,'com.qatfah.accounting',resources),/does not resolve/);
});

test('packaged provider gate rejects the APK40 omission even when a paths resource exists',()=>{
  assert.throws(()=>verifyAndroidProvider(manifest(capacitor),paths),/exactly one/);
  assert.throws(()=>verifyAndroidProvider(manifest(capacitor+'<!-- '+provider+' -->'),paths),/exactly one/);
});

test('packaged provider gate rejects unsafe or conflicting merge results',()=>{
  for(const bad of [
    provider+provider,
    provider.replace('QatfahAttachmentProvider','MissingProvider'),
    provider.replace('com.qatfah.accounting.waattachments','com.qatfah.accounting.wrong'),
    provider.replace('android:exported="false"','android:exported="true"'),
    provider.replace('android:grantUriPermissions="true"','android:grantUriPermissions="false"'),
    provider.replace('@xml/qatfah_wa_paths','@xml/file_paths')
  ])assert.throws(()=>verifyAndroidProvider(manifest(capacitor+bad),paths));
  assert.throws(()=>verifyAndroidProvider(manifest(provider),paths),/Capacitor/);
  for(const bad of [paths.replace('wa-attachments/','/'),paths.replace('cache-path','root-path'),paths.replace('</paths>','<external-path name="all" path="."/></paths>')]){
    assert.throws(()=>verifyAndroidProvider(manifest(capacitor+provider),bad));
  }
});
