/** Optional official WhatsApp Business Cloud API sender. Server-side only. */
export function cloudSender({accounts={},fetcher=globalThis.fetch,version='v24.0'}={}){
 if(typeof accounts==='string')accounts=JSON.parse(accounts);
 return async function send({tenantId,phone,filename,base64,caption=''}) {
  const account=Object.hasOwn(accounts,tenantId)?accounts[tenantId]:null;
  if(!account?.token||!/^[0-9]{6,30}$/.test(String(account.phoneNumberId||'')))return {status:'unavailable'};
  const recipient=String(phone||'').replace(/\D/g,'');
  if(!/^9677[0-9]{8}$/.test(recipient))return {status:'invalid_phone'};
  if(!/^[a-zA-Z0-9_.-]{1,120}\.pdf$/i.test(filename)||typeof base64!=='string'||base64.length>7500000)return {status:'invalid_file'};
  const data=Buffer.from(base64,'base64');
  if(data.length>5000000||data.subarray(0,5).toString()!=='%PDF-')return {status:'invalid_file'};
  const prefix='https://graph.facebook.com/'+version+'/'+account.phoneNumberId;
  const form=new FormData();form.append('messaging_product','whatsapp');
  form.append('file',new Blob([data],{type:'application/pdf'}),filename);
  const headers={Authorization:'Bearer '+account.token};
  const upload=await fetcher(prefix+'/media',{method:'POST',headers,body:form});
  if(!upload.ok)return {status:'rejected',stage:'upload',code:upload.status};
  const media=await upload.json();
  if(!media.id)return {status:'unknown',stage:'upload'};
  const body={messaging_product:'whatsapp',to:recipient,type:'document',document:{id:media.id,filename,caption:String(caption).slice(0,500)}};
  const response=await fetcher(prefix+'/messages',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body)});
  if(!response.ok)return {status:'rejected',stage:'send',code:response.status};
  const sent=await response.json();
  return {status:sent.messages?.[0]?.id?'accepted':'unknown',messageId:sent.messages?.[0]?.id||null,deliveryConfirmed:false};
 };
}
