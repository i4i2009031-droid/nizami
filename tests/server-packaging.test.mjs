import test from 'node:test';
import assert from 'node:assert/strict';
import {cpSync,existsSync,globSync,mkdirSync,mkdtempSync,readFileSync,rmSync,statSync,writeFileSync} from 'node:fs';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {tmpdir} from 'node:os';
import {basename,dirname,join,resolve,relative,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const execute=promisify(execFile);
const repository=fileURLToPath(new URL('../',import.meta.url));

test('Docker COPY layout starts the real API and saves accounting records with integrations disabled', {timeout:30000}, async()=>{
 const stage=mkdtempSync(join(tmpdir(),'qatfah-container-layout-'));
 try{
  const dockerfile=readFileSync(join(repository,'server/Dockerfile'),'utf8');
  // Simulate the actual COPY inputs from the Dockerfile, not an independently
  // maintained list that could accidentally conceal a missing packaged file.
  const copies=dockerfile.split('\n').filter(line=>/^COPY\s/.test(line));
  assert.ok(copies.length>0);
  for(const line of copies){
   const fields=line.trim().split(/\s+/).slice(1),destination=fields.pop();
   assert.ok(!fields.some(value=>value.startsWith('--')),'COPY flags need explicit staging support');
   const target=resolve(stage,destination),targetRelative=relative(stage,target);
   assert.ok(!targetRelative.startsWith('..')&&!isAbsolute(targetRelative),'COPY destination remains in /app');
   for(const pattern of fields){
    const matches=globSync(pattern.replace(/\/$/,''),{cwd:repository});
    assert.ok(matches.length,`COPY source exists: ${pattern}`);
    for(const match of matches){
     const source=join(repository,match);
     if(statSync(source).isDirectory()){
      mkdirSync(target,{recursive:true});cpSync(source,target,{recursive:true});
     }else{
      const path=destination.endsWith('/')||fields.length>1||matches.length>1?join(target,basename(source)):target;
      mkdirSync(dirname(path),{recursive:true});cpSync(source,path);
     }
    }
   }
  }
  assert.match(dockerfile,/FROM node:24-alpine/,'container uses the same Node major as CI');
  assert.match(dockerfile,/npm pkg set type=module/,'shared .js modules retain ESM semantics');
  writeFileSync(join(stage,'package.json'),JSON.stringify({private:true,type:'module'}));
  const command=JSON.parse(dockerfile.split('\n').find(line=>line.startsWith('CMD ')).slice(4));
  assert.equal(command[0],'node');assert.equal(command.length,2);
  assert.ok(existsSync(resolve(stage,command[1])),'actual entrypoint was copied');
  assert.match(dockerfile,/^USER node$/m);assert.match(dockerfile,/QATFAH_DATA_DIR=\/data/);assert.match(dockerfile,/^EXPOSE 5059$/m);
  const env={...process.env,NODE_ENV:'test',QATFAH_DATA_DIR:join(stage,'test-data'),QATFAH_ADMIN_USER:'package_admin',QATFAH_ADMIN_PASSWORD:'Package-local-test-password-1234',QATFAH_TOKEN_SECRET:'c'.repeat(64),QATFAH_WHATSAPP_ENABLED:'false',QATFAH_WA_CLOUD_ACCOUNTS:'{}'};
  for(const key of ['GOOGLE_CLIENT_ID','GOOGLE_CLIENT_SECRET','GOOGLE_REDIRECT_URI','QATFAH_GOOGLE_TOKEN_KEY'])delete env[key];
  const harness=`
   import assert from 'node:assert/strict';
   import {randomUUID} from 'node:crypto';
   const {createApp}=await import(${JSON.stringify('./'+command[1])});
   const server=createApp();
   await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
   try{
    const base='http://127.0.0.1:'+server.address().port;
    async function api(path,body,token){const response=await fetch(base+path,{method:body?'POST':'GET',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};}
    const health=await api('/api/health');assert.equal(health.status,200);assert.equal(health.body.ok,true);
    const admin=await api('/api/auth/login',{username:'package_admin',password:'Package-local-test-password-1234'});assert.equal(admin.status,200);
    const created=await api('/api/admin/users',{username:'package_client',password:'Package-client-test-1234',storeName:'اختبار حزمة الخادم',expiresAt:'2099-12-31'},admin.body.token);assert.equal(created.status,201);
    const client=await api('/api/auth/login',{username:'package_client',password:'Package-client-test-1234'});assert.equal(client.status,200);
    const token=client.body.token,at='2026-10-22T12:00:00Z',event=(type,payload)=>({id:randomUUID(),type,payload,at});
    const records=[event('party.add',{id:'package-customer',name:'حساب تجريبي'}),event('journal.create',{kind:'credit',method:'cash',partyId:'package-customer',amount:2.35,currency:'USD'})];
    assert.equal((await api('/api/sync/push',{events:records},token)).status,200);
    const restored=await api('/api/sync/pull?after=0',null,token);assert.equal(restored.status,200);assert.equal(restored.body.events.length,2);
    const whatsapp=await api('/api/whatsapp/status',null,token);assert.equal(whatsapp.body.status,'unavailable');
    console.log('PACKAGED_API_VERIFIED');
   }finally{await new Promise(resolve=>server.close(resolve));}
  `;
  const result=await execute(process.execPath,['--input-type=module','-e',harness],{cwd:stage,env,timeout:20000,maxBuffer:1024*1024});
  assert.match(result.stdout,/PACKAGED_API_VERIFIED/);
 }finally{rmSync(stage,{recursive:true,force:true});}
});
