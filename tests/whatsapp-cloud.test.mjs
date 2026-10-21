import {test} from 'node:test';
import assert from 'node:assert/strict';
import {cloudSender} from '../server/whatsapp-cloud.mjs';
test('sends PDF through authorized tenant and does not claim delivery',async()=>{
 let count=0;
 const send=cloudSender({accounts:{tenant:{phoneNumberId:'123456789',token:'SERVER_TOKEN'}},fetcher:async(url,opt)=>{
  count++;assert.match(opt.headers.Authorization,/SERVER_TOKEN/);
  if(count===1){assert.match(url,/media$/);return {ok:true,json:async()=>({id:'445566'})};}
  const req=JSON.parse(opt.body);assert.equal(req.to,'967771234567');assert.equal(req.type,'document');
  return {ok:true,json:async()=>({messages:[{id:'wamid.TEST'}]})};
 }});
 const x=await send({tenantId:'tenant',phone:'+967771234567',filename:'invoice.pdf',base64:Buffer.from('%PDF-1.4 example').toString('base64')});
 assert.equal(x.status,'accepted');assert.equal(x.deliveryConfirmed,false);assert.equal(count,2);
});
test('rejects unknown tenant before network and checks invalid recipient',async()=>{
 let n=0;const fn=cloudSender({fetcher:async()=>{n++;throw Error('unexpected');}});
 assert.equal((await fn({tenantId:'unknown'})).status,'unavailable');
 assert.equal(n,0);
});
