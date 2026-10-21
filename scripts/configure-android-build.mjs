import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const SIGNING_KEYS=Object.freeze([
  'QATFAH_KEYSTORE_BASE64','QATFAH_KEYSTORE_PASSWORD','QATFAH_KEY_ALIAS','QATFAH_KEY_PASSWORD'
]);
const BEGIN='// BEGIN QATFAH CI BUILD';
const END='// END QATFAH CI BUILD';

export function planAndroidBuild({app,env,version}){
  if(!['client','admin'].includes(app))throw new Error('Expected client or admin');
  const number=String(env.GITHUB_RUN_NUMBER||'');
  if(!/^[1-9][0-9]*$/.test(number)||Number(number)>2100000000)throw new Error('GITHUB_RUN_NUMBER must be a positive Android versionCode');
  if(!/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version||''))throw new Error('package.json must contain a semantic version');
  const trusted=env.GITHUB_REF==='refs/heads/main'&&['push','workflow_dispatch'].includes(env.GITHUB_EVENT_NAME);
  const present=trusted?SIGNING_KEYS.filter(key=>typeof env[key]==='string'&&env[key].length>0):[];
  if(present.length&&present.length!==SIGNING_KEYS.length){
    const missing=SIGNING_KEYS.filter(key=>!present.includes(key));
    throw new Error('Incomplete release signing configuration. Missing: '+missing.join(', '));
  }
  const mode=present.length===SIGNING_KEYS.length?'release':'debug';
  return {app,mode,versionCode:Number(number),versionName:version.split('+')[0]+'+build.'+number,
    applicationId:app==='client'?'com.qatfah.accounting':'com.qatfah.admin',
    reason:mode==='release'?'owner signing credentials configured':trusted?'owner signing credentials are not configured':'pull request or non-main build; signing credentials are not used'};
}

export function configureGradle(source,plan){
  let result=source.replace(/\n\/\/ BEGIN QATFAH CI BUILD\n[\s\S]*?\/\/ END QATFAH CI BUILD\n?/g,'\n');
  const codes=[...result.matchAll(/^(\s*)versionCode\s*(?:=\s*)?[0-9]+\s*$/gm)];
  const names=[...result.matchAll(/^(\s*)versionName\s*(?:=\s*)?["'][^"'\r\n]+["']\s*$/gm)];
  if(codes.length!==1||names.length!==1)throw new Error('Expected one versionCode and one versionName in Android app/build.gradle');
  result=result.replace(/^(\s*)versionCode\s*(?:=\s*)?[0-9]+\s*$/gm,(_,space)=>space+'versionCode '+plan.versionCode);
  result=result.replace(/^(\s*)versionName\s*(?:=\s*)?["'][^"'\r\n]+["']\s*$/gm,(_,space)=>space+'versionName "'+plan.versionName+'"');
  let config='\n'+BEGIN+'\nandroid {\n';
  if(plan.mode==='release'){
    config+=`    signingConfigs {
        qatfahRelease {
            storeFile file(System.getenv('QATFAH_KEYSTORE_FILE'))
            storePassword System.getenv('QATFAH_KEYSTORE_PASSWORD')
            keyAlias System.getenv('QATFAH_KEY_ALIAS')
            keyPassword System.getenv('QATFAH_KEY_PASSWORD')
        }
    }
`;
  }
  config+=`    buildTypes {
        release {
            debuggable false
${plan.mode==='release'?'            signingConfig signingConfigs.qatfahRelease\n':''}        }
    }
}
${END}
`;
  return result.trimEnd()+'\n'+config;
}

export function configureAndroidBuild({root=process.cwd(),app,env=process.env}){
  root=path.resolve(root);
  const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
  const plan=planAndroidBuild({app,env,version:pkg.version});
  const gradlePath=path.join(root,'android/app/build.gradle');
  const gradle=configureGradle(fs.readFileSync(gradlePath,'utf8'),plan);
  let keyFile='',keyDirectory='';
  try{
    if(plan.mode==='release'){
      const encoded=env.QATFAH_KEYSTORE_BASE64.replace(/\s+/g,'');
      if(!encoded||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('QATFAH_KEYSTORE_BASE64 is not valid base64');
      const bytes=Buffer.from(encoded,'base64');
      if(!bytes.length||bytes.length>2*1024*1024)throw new Error('Release keystore is empty or too large');
      const temp=path.resolve(env.RUNNER_TEMP||os.tmpdir());
      const relative=path.relative(root,temp);
      if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Signing keystore must stay outside the source checkout');
      fs.mkdirSync(temp,{recursive:true});
      keyDirectory=fs.mkdtempSync(path.join(temp,'qatfah-signing-'+app+'-'));
      fs.chmodSync(keyDirectory,0o700);
      keyFile=path.join(keyDirectory,'release.keystore');
      fs.writeFileSync(keyFile,bytes,{mode:0o600,flag:'wx'});
      bytes.fill(0);
    }
    fs.writeFileSync(gradlePath,gradle);
    const info=[
      'Qatfah Android build information',
      'App: '+plan.app,
      'Application ID: '+plan.applicationId,
      'Build mode: '+plan.mode,
      'Version code: '+plan.versionCode,
      'Version name: '+plan.versionName,
      'Source commit: '+String(env.GITHUB_SHA||'local').replace(/[\r\n]/g,''),
      'Signing: '+(plan.mode==='release'?'owner-provided release key':'Android debug key; TEST BUILD, NOT PRODUCTION'),
      'Build decision: '+plan.reason,
      'Production acceptance: device and deployment validation still required',
      ''
    ].join('\n');
    const infoFile=path.join(root,'Qatfah-build-info-'+app+'.txt');
    fs.writeFileSync(infoFile,info);
    if(env.GITHUB_OUTPUT){
      if(/[\r\n]/.test(keyFile))throw new Error('Invalid runner temporary path');
      fs.appendFileSync(env.GITHUB_OUTPUT,'mode='+plan.mode+'\nkeystore_file='+keyFile+'\nversion_code='+plan.versionCode+'\nversion_name='+plan.versionName+'\n');
    }
    return {...plan,keyFile,infoFile};
  }catch(error){
    if(keyDirectory)fs.rmSync(keyDirectory,{recursive:true,force:true});
    throw error;
  }
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  try{
    const plan=configureAndroidBuild({app:process.argv[2]});
    console.log(`Configured ${plan.app}: ${plan.mode}, version ${plan.versionName} (${plan.versionCode})`);
    if(plan.mode==='debug')console.log('This is a test build. An owner signing key is required for a signed release.');
  }catch(error){
    console.error(error.message);process.exitCode=1;
  }
}
