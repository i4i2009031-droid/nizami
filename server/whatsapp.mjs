/** OPTIONAL WhatsApp Web companion. Uses Baileys, an unofficial WhatsApp Web client.
 * Never promise guaranteed pairing or production SLA; WhatsApp may change their protocol.
 * Turn on only with QATFAH_WHATSAPP_ENABLED=true. Sessions remain on the private server.
 */
import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
const enabled=process.env.QATFAH_WHATSAPP_ENABLED==='true';
const roots=resolve(process.env.QATFAH_DATA_DIR||'server/data','whatsapp');
const sockets=new Map();
let deps;
async function libs(){if(!deps){const b=await import('@whiskeysockets/baileys');const q=await import('qrcode');deps={b,q};}return deps;}
const safeTen=t=>String(t).replace(/[^a-z0-9-]/gi,'');
async function start(tenant){
 if(!enabled)return null;
 if(sockets.has(tenant))return sockets.get(tenant);
 const info={status:'connecting',qr:null,socket:null,registered:false,error:null};sockets.set(tenant,info);
 try{
  const {b}=await libs();
  const directory=resolve(roots,safeTen(tenant));await mkdir(directory,{recursive:true});
  const {state,saveCreds}=await b.useMultiFileAuthState(directory);
  const makeSocket=b.default;
  const socket=makeSocket({auth:state,printQRInTerminal:false,markOnlineOnConnect:false,generateHighQualityLinkPreview:false});
  info.socket=socket;info.registered=!!state.creds.registered;
  socket.ev.on('creds.update',saveCreds);
  socket.ev.on('connection.update',({qr,connection,lastDisconnect})=>{
   if(qr){info.qr=qr;info.status='waiting_for_scan';}
   if(connection==='open'){info.qr=null;info.status='linked';info.registered=true;}
   if(connection==='close'){
     info.status='disconnected';info.socket=null;
     const code=lastDisconnect?.error?.output?.statusCode;
     if(code!==b.DisconnectReason?.loggedOut){setTimeout(()=>{sockets.delete(tenant);start(tenant).catch(console.error);},5000).unref?.();}
     else info.error='Logged out';
   }
  });
 }catch(e){info.status='unavailable';info.error=String(e.message).slice(0,140);}
 return info;
}
export async function getWhatsappStatus(tenant){if(!enabled)return 'unavailable';const w=await start(tenant);return w.status;}
export async function getWhatsappQr(tenant){
 if(!enabled)return {status:'unavailable',message:'Enable WhatsApp bridge on your own server.'};
 const w=await start(tenant);if(!w.qr)return {status:w.status};
 const {q}=await libs();return {status:'waiting_for_scan',image:await q.toDataURL(w.qr)};
}
export async function getWhatsappPairingCode(tenant,phone){
 if(!enabled)return {status:'unavailable'};
 const w=await start(tenant);
 if(!/^\d{9,15}$/.test(phone))return {status:'invalid_phone'};
 if(w.status==='linked')return {status:'linked'};
 if(!w.socket||w.registered)return {status:w.status};
 try{return {status:'pairing',code:await w.socket.requestPairingCode(phone)};}
 catch(e){return {status:'error',message:String(e.message).slice(0,160)};}
}
export async function sendWhatsappMessage(tenant,phone,text){
 if(!enabled)return {status:'unavailable'};
 const w=await start(tenant);if(w.status!=='linked')return {status:'not_linked'};
 if(!/^\d{9,15}$/.test(phone)||!text)return {status:'invalid_data'};
 try{await w.socket.sendMessage(`${phone}@s.whatsapp.net`,{text});return {status:'sent'};}
 catch(e){return {status:'error',message:String(e.message).slice(0,180)};}
}

/** Send a PDF directly from the linked tenant's WhatsApp session.
 * Can work only while the optional unofficial WhatsApp bridge is connected. */
export async function sendWhatsappDocument(tenant,phone,filename,base64,caption=''){
 if(!enabled)return {status:'unavailable',message:'WhatsApp gateway is not enabled'};
 const w=await start(tenant);
 if(w.status!=='linked'||!w.socket)return {status:'not_linked',message:'ربط واتساب غير نشط'};
 if(!/^\d{9,15}$/.test(phone)||!/^[\w .-]{1,120}$/.test(filename)||!filename.toLowerCase().endsWith('.pdf'))return {status:'invalid_data',message:'بيانات المستند غير صحيحة'};
 if(typeof base64!=='string'||base64.length>7_000_000||!/^[-A-Za-z0-9+/=]+$/.test(base64))return {status:'invalid_data',message:'المستند كبير أو غير صالح'};
 try{const buffer=Buffer.from(base64,'base64');if(buffer.length>5_000_000||buffer.subarray(0,5).toString()!=='%PDF-')return {status:'invalid_data',message:'يجب إرسال ملف PDF صالح بحد أقصى 5 ميجابايت'};
  await w.socket.sendMessage(`${phone}@s.whatsapp.net`,{document:buffer,mimetype:'application/pdf',fileName:filename,caption:String(caption).slice(0,500)});
  return {status:'sent'};
 }catch(e){return {status:'error',message:String(e.message).slice(0,180)};}
}
