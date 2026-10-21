import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {planAndroidBuild,configureGradle,configureAndroidBuild} from '../scripts/configure-android-build.mjs';

const gradle=`apply plugin: 'com.android.application'
android {
    namespace "com.qatfah.accounting"
    defaultConfig {
        applicationId "com.qatfah.accounting"
        versionCode 1
        versionName "1.0"
        minSdkVersion rootProject.ext.minSdkVersion
    }
    buildTypes {
        release {
            minifyEnabled false
        }
    }
}
dependencies {
    implementation 'androidx.webkit:webkit:1.13.0'
}
`;
const baseEnv={GITHUB_EVENT_NAME:'push',GITHUB_REF:'refs/heads/main',GITHUB_RUN_NUMBER:'38',GITHUB_SHA:'a'.repeat(40)};
// These are plainly non-key fixture bytes, never a generated or usable signing key.
const fixtureSigning={QATFAH_KEYSTORE_BASE64:Buffer.from('not-a-real-keystore-fixture').toString('base64'),
  QATFAH_KEYSTORE_PASSWORD:'fixture-store-pass',QATFAH_KEY_ALIAS:'fixture-key-alias',QATFAH_KEY_PASSWORD:'fixture-key-pass'};
function plan(env={}){return planAndroidBuild({app:'client',env:{...baseEnv,...env},version:'0.1.0'});}
function fixture(t){
  const parent=fs.mkdtempSync(path.join(os.tmpdir(),'qatfah-build-test-'));
  const root=path.join(parent,'checkout'),temp=path.join(parent,'runner-temp');
  fs.mkdirSync(path.join(root,'android/app'),{recursive:true});fs.mkdirSync(temp);
  fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({version:'0.1.0'}));
  fs.writeFileSync(path.join(root,'android/app/build.gradle'),gradle);
  t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
  return {root,temp,env:{...baseEnv,RUNNER_TEMP:temp,GITHUB_OUTPUT:path.join(parent,'outputs')}};
}

test('all four credentials on main select release and a monotonic semantic version',()=>{
  const release=plan(fixtureSigning);assert.equal(release.mode,'release');
  assert.equal(release.versionCode,38);assert.equal(release.versionName,'0.1.0+build.38');
  assert.equal(plan({...fixtureSigning,GITHUB_RUN_NUMBER:'39'}).versionCode,release.versionCode+1);
});

test('absence of signing credentials selects an explicitly identified debug test build',()=>{
  const debug=plan();assert.equal(debug.mode,'debug');assert.match(debug.reason,/not configured/);
});

test('partial signing configuration fails and the error never contains secret values',()=>{
  assert.throws(()=>plan({QATFAH_KEYSTORE_PASSWORD:fixtureSigning.QATFAH_KEYSTORE_PASSWORD}),error=>{
    assert.match(error.message,/Incomplete release signing configuration/);
    assert.match(error.message,/QATFAH_KEYSTORE_BASE64/);
    assert.ok(!error.message.includes(fixtureSigning.QATFAH_KEYSTORE_PASSWORD));return true;
  });
});

test('pull requests cannot use release signing even if credentials accidentally reach the process',()=>{
  assert.equal(plan({...fixtureSigning,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/1/merge'}).mode,'debug');
  assert.equal(plan({...fixtureSigning,GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/heads/main'}).mode,'debug');
});

test('manual main builds may sign; a manual build from another branch remains debug',()=>{
  assert.equal(plan({...fixtureSigning,GITHUB_EVENT_NAME:'workflow_dispatch'}).mode,'release');
  assert.equal(plan({...fixtureSigning,GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_REF:'refs/heads/feature'}).mode,'debug');
});

test('invalid or overflowing version codes and non-semantic versions are rejected',()=>{
  for(const run of ['','0','-1','3.5','2100000001','38\nmode=release'])assert.throws(()=>plan({GITHUB_RUN_NUMBER:run}));
  assert.throws(()=>planAndroidBuild({app:'client',env:baseEnv,version:'latest'}));
  assert.throws(()=>planAndroidBuild({app:'unknown',env:baseEnv,version:'0.1.0'}));
});

test('Gradle configuration keeps native dependencies and reads signing values only from environment',()=>{
  const configured=configureGradle(gradle,plan(fixtureSigning));
  assert.match(configured,/versionCode 38/);assert.match(configured,/versionName "0\.1\.0\+build\.38"/);
  assert.match(configured,/androidx\.webkit:webkit:1\.13\.0/);
  assert.match(configured,/debuggable false/);assert.match(configured,/signingConfig signingConfigs\.qatfahRelease/);
  for(const value of Object.values(fixtureSigning))assert.ok(!configured.includes(value));
});

test('reconfiguration is idempotent and does not retain release signing in a debug plan',()=>{
  const first=configureGradle(gradle,plan(fixtureSigning));
  const second=configureGradle(first,plan({...fixtureSigning,GITHUB_RUN_NUMBER:'39'}));
  assert.equal((second.match(/BEGIN QATFAH CI BUILD/g)||[]).length,1);
  assert.match(second,/versionCode 39/);assert.ok(!second.includes('versionCode 38'));
  const debug=configureGradle(second,plan());
  assert.ok(!debug.includes('qatfahRelease'));assert.ok(!debug.includes('QATFAH_KEYSTORE_PASSWORD'));
});

test('debug fixture writes metadata and version fields, never a keystore',t=>{
  const f=fixture(t);const output=configureAndroidBuild({...f,app:'admin'});
  assert.equal(output.keyFile,'');assert.deepEqual(fs.readdirSync(f.temp),[]);
  const info=fs.readFileSync(output.infoFile,'utf8');
  assert.match(info,/Build mode: debug/);assert.match(info,/TEST BUILD, NOT PRODUCTION/);
  assert.match(info,/Application ID: com.qatfah.admin/);
  assert.match(fs.readFileSync(f.env.GITHUB_OUTPUT,'utf8'),/mode=debug/);
});

test('release fixture keeps private key bytes outside checkout with restricted permissions',t=>{
  const f=fixture(t);const output=configureAndroidBuild({...f,app:'client',env:{...f.env,...fixtureSigning}});
  assert.equal(output.mode,'release');assert.ok(output.keyFile.startsWith(f.temp+path.sep));
  assert.equal(fs.statSync(output.keyFile).mode&0o777,0o600);
  assert.equal(fs.statSync(path.dirname(output.keyFile)).mode&0o777,0o700);
  assert.equal(fs.readFileSync(output.keyFile,'utf8'),'not-a-real-keystore-fixture');
  const publicFiles=[output.infoFile,path.join(f.root,'android/app/build.gradle'),f.env.GITHUB_OUTPUT].map(file=>fs.readFileSync(file,'utf8')).join('\n');
  for(const value of Object.values(fixtureSigning))assert.ok(!publicFiles.includes(value));
  assert.match(publicFiles,/Build mode: release/);
});

test('malformed keystore or a source-tree key location fails without rewriting Android source',t=>{
  const f=fixture(t);
  assert.throws(()=>configureAndroidBuild({...f,app:'client',env:{...f.env,...fixtureSigning,QATFAH_KEYSTORE_BASE64:'%invalid%'}}),/valid base64/);
  assert.throws(()=>configureAndroidBuild({...f,app:'client',env:{...f.env,...fixtureSigning,RUNNER_TEMP:f.root}}),/outside the source checkout/);
  assert.equal(fs.readFileSync(path.join(f.root,'android/app/build.gradle'),'utf8'),gradle);
  assert.deepEqual(fs.readdirSync(f.temp),[]);
});

test('ambiguous Android version definitions fail before credentials are written',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,'android/app/build.gradle'),gradle+'\nversionCode 8\n');
  assert.throws(()=>configureAndroidBuild({...f,app:'client',env:{...f.env,...fixtureSigning}}),/one versionCode/);
  assert.deepEqual(fs.readdirSync(f.temp),[]);
});
