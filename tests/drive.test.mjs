import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {googleDrive,driveConfigured} from '../server/google-drive.mjs';
test('Google Drive tenant-specific OAuth, encrypted tokens, backup folder and restore (mocked Google API)',async context=>{
 const oldFetch=globalThis.fetch;
 const environmentKeys=['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','QATFAH_GOOGLE_TOKEN_KEY'];
 const oldEnvironment=new Map(environmentKeys.map(key=>[key,process.env[key]]));
 let db;
 // In --test-isolation=none the next file shares this process. Restore the
 // OAuth fixture even on an assertion failure, so an unconfigured server test
 // cannot accidentally inherit these fabricated credentials.
 context.after(()=>{
  globalThis.fetch=oldFetch;
  for(const [key,value] of oldEnvironment){if(value===undefined)delete process.env[key];else process.env[key]=value;}
  db?.close();
 });
 process.env.GOOGLE_CLIENT_ID='test-client.apps.googleusercontent.com';
 process.env.GOOGLE_CLIENT_SECRET='test-fake-secret';
 process.env.GOOGLE_REDIRECT_URI='https://example.test/api/google/callback';
 process.env.QATFAH_GOOGLE_TOKEN_KEY='a'.repeat(64);
 assert.equal(driveConfigured(),true);
 db=new DatabaseSync(':memory:');const svc=googleDrive(db),calls=[];
 globalThis.fetch=async(url,init={})=>{
  const u=String(url);calls.push(u);
  if(u.includes('oauth2.googleapis.com/token'))return new Response(JSON.stringify({access_token:'fake-access',refresh_token:'fake-refresh',expires_in:3600}),{status:200});
  if(u.includes('upload/drive/v3/files'))return new Response(JSON.stringify({id:'fileabc1234567',name:'Qatfah_2026.qtf'}),{status:200});
  if(u.includes('drive/v3/files/fileabc1234567?fields'))return new Response(JSON.stringify({id:'fileabc1234567',name:'Qatfah_2026.qtf',parents:['folderabc1234567']}),{status:200});
  if(u.includes('drive/v3/files/fileabc1234567?alt=media'))return new Response(JSON.stringify({format:'QatfahBackupEnvelope'}),{status:200});
  if(u.includes('drive/v3/files?q='))return new Response(JSON.stringify({files:[]}),{status:200});
  if(u.includes('drive/v3/files')&&init.method==='POST')return new Response(JSON.stringify({id:'folderabc1234567'}),{status:200});
  return new Response(JSON.stringify({files:[{id:'fileabc1234567',name:'Qatfah_2026.qtf'}]}),{status:200});
 };
  const url=svc.start('tenant-A').url,nonce=new URL(url).searchParams.get('state');
  assert.ok(nonce);assert.equal(new URL(url).searchParams.get('scope'),'https://www.googleapis.com/auth/drive.file');
  await svc.finish('fake-code',nonce);assert.equal(svc.connected('tenant-A').connected,true);
  assert.equal(svc.connected('tenant-B').connected,false);
  const raw=db.prepare('SELECT tokens_encrypted FROM google_drive_links WHERE tenant_id=?').get('tenant-A').tokens_encrypted;
  assert.equal(raw.includes('fake-refresh'),false,'refresh token should be encrypted at rest');
  await assert.rejects(()=>svc.finish('fake-code',nonce));
  const envelope=JSON.stringify({format:'QatfahBackupEnvelope',version:1,salt:'ABC',ciphertext:'XYZ'});
  const upload=await svc.upload('tenant-A',envelope,'Qatfah_2026.qtf');assert.equal(upload.id,'fileabc1234567');
  assert.ok(calls.some(x=>x.includes('upload/drive/v3/files')));
  await assert.rejects(()=>svc.download('tenant-B','fileabc1234567'));
  const file=await svc.download('tenant-A','fileabc1234567');assert.ok(file.encrypted.includes('QatfahBackupEnvelope'));
  svc.disconnect('tenant-A');assert.equal(svc.connected('tenant-A').connected,false);
});
