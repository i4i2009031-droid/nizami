export const WA_LINK_KEY='WA_PERMANENTLY_LINKED';

// A confirmed pairing survives UI navigation and temporary transport failures.
// This flag describes the pairing, never whether a message was sent or delivered.
export function createWhatsappSession({storage,host={},online=true}={}){
 let linked=false;
 try{linked=storage?.getItem(WA_LINK_KEY)==='true';}catch{}
 let transportReady=false,sessionAlive=false,requiresRetry=false,status=linked?'linked':'not_started';
 const listeners=new Set();
 const snapshot=()=>({linked,transportReady:transportReady&&online,sessionAlive,requiresRetry,status,online});
 const persist=()=>{
  try{if(linked)storage?.setItem(WA_LINK_KEY,'true');else storage?.removeItem(WA_LINK_KEY);}catch{}
  host.WA_PERMANENTLY_LINKED=linked;host.WA_SESSION_ACTIVE=linked;
 };
 const publish=()=>{const value=snapshot();for(const listener of listeners)listener(value);return value;};
 persist();
 return {
  snapshot,
  subscribe(listener){listeners.add(listener);return()=>listeners.delete(listener);},
  applyNative(result={}){
   if(!result||typeof result!=='object')result={status:'unknown',transportReady:false};
   if(typeof result.requiresRetry==='boolean')requiresRetry=result.requiresRetry;
   if(result.authRevoked===true){linked=false;transportReady=false;sessionAlive=false;status='not_linked';persist();return publish();}
   const live=result.transportReady===true||(result.transportReady===undefined&&result.status==='connected');
   if(result.linked===true||result.authenticated===true||live){linked=true;persist();}
   if(result.authenticated===true||live)requiresRetry=false;
   transportReady=live;
   if(typeof result.sessionAlive==='boolean')sessionAlive=result.sessionAlive;
   status=result.status||(linked?'linked':'unknown');
   return publish();
  },
  setOnline(value){online=Boolean(value);return publish();},
  clear(){linked=false;transportReady=false;sessionAlive=false;requiresRetry=true;status='not_linked';persist();return publish();}
 };
}

// This controller belongs to the application, not to a sheet's DOM. Closing a
// sheet cancels only its presentation timers and invalidates stale callbacks.
export function createWhatsappPairing({session,getStatus,onChange=()=>{},schedule=setInterval,cancel=clearInterval,interval=5000}){
 let active=false,mode=session.snapshot().linked?'connected':'qr',qr='',code='',error='';
 let qrTimer=null,codeTimer=null,generation=0,pendingGeneration=null;
 const snapshot=()=>({active,mode,qr,code,error});
 const publish=()=>{onChange(snapshot());return snapshot();};
 const stopTimers=()=>{if(qrTimer!==null)cancel(qrTimer);if(codeTimer!==null)cancel(codeTimer);qrTimer=null;codeTimer=null;};
 const invalidate=()=>{generation++;pendingGeneration=null;stopTimers();};
 async function refresh(){
  if(!active||session.snapshot().linked||session.snapshot().requiresRetry||!['qr','pairing_code'].includes(mode))return;
  const requestGeneration=generation;
  if(pendingGeneration===requestGeneration)return;
  pendingGeneration=requestGeneration;
  try{
   const result=await getStatus();
   if(!active||requestGeneration!==generation)return;
   session.applyNative(result);
   if(session.snapshot().linked||requestGeneration!==generation)return;
   if(mode==='qr'&&typeof result.qr==='string'&&result.qr.startsWith('data:image/png;base64,'))qr=result.qr;
   if(mode==='pairing_code'&&typeof result.code==='string'){
    const normalized=result.code.replace(/[^A-Za-z0-9]/g,'').toUpperCase();
    if(normalized.length===8)code=normalized;
   }
   error='';publish();
  }catch(err){if(active&&requestGeneration===generation){error=err?.message||'تعذر قراءة حالة الربط';publish();}}
  finally{if(pendingGeneration===requestGeneration)pendingGeneration=null;}
 }
 function startTimer(){
  if(!active||session.snapshot().linked||session.snapshot().requiresRetry)return;
  if(mode==='qr')qrTimer=schedule(refresh,interval);
  else if(mode==='pairing_code')codeTimer=schedule(refresh,interval);
 }
 function setMode(value){
  if(!['qr','phone_input','pairing_code','connected'].includes(value))throw Error('Invalid WhatsApp authentication mode');
  invalidate();mode=session.snapshot().linked?'connected':value==='connected'?'qr':value;error='';
  if(mode==='pairing_code')code='';
  publish();startTimer();
  if(mode==='qr'||mode==='pairing_code')void refresh();
 }
 session.subscribe(value=>{
  if(value.requiresRetry)stopTimers();
  if(value.linked){if(mode!=='connected'){invalidate();mode='connected';qr='';code='';}publish();}
  else if(mode==='connected'){invalidate();mode='qr';publish();startTimer();void refresh();}
  else publish();
 });
 return {
  snapshot,refresh,setMode,
  open(){invalidate();active=true;mode=session.snapshot().linked?'connected':'qr';error='';publish();startTimer();void refresh();},
  close(){invalidate();active=false;},
  retry(){invalidate();error='';publish();startTimer();return refresh();}
 };
}

export function latinPhoneDigits(value){
 return String(value||'').replace(/[٠-٩]/g,c=>String(c.charCodeAt(0)-1632)).replace(/[۰-۹]/g,c=>String(c.charCodeAt(0)-1776));
}

export function normalizeYemenPhone(rawPhone){
 let digits=latinPhoneDigits(rawPhone).replace(/[\s()-]/g,'');
 if(digits.startsWith('00967'))digits=digits.slice(5);
 else if(digits.startsWith('+967'))digits=digits.slice(4);
 else if(digits.startsWith('967'))digits=digits.slice(3);
 if(digits.startsWith('0'))digits=digits.slice(1);
 if(!/^7\d{8}$/.test(digits))throw Error('رقم الجوال اليمني يبدأ بـ 7 ويتكون من 9 أرقام بعد +967');
 return '967'+digits;
}

// A failed bridge call may have happened after dispatch. Only an explicit,
// pre-dispatch safe result permits opening the direct recipient fallback.
export function createWhatsappSender({getPlugin,isOnline=()=>true}){
 let busy=false;
 return async payload=>{
  if(busy)throw Error('يوجد مستند قيد الإرسال، انتظر نتيجته');
  const plugin=getPlugin();
  if(!plugin?.sendWhatsAppInApp)throw Error('الإرسال الداخلي يتطلب نسخة قطفة الجديدة على أندرويد');
  if(!isOnline())throw Error('اتصل بالإنترنت لإرسال المستند');
  busy=true;
  try{
   const result=await plugin.sendWhatsAppInApp(payload);
   if(result?.safeToFallback===true&&result.dispatched!==true&&result.submitted!==true&&plugin.sendWhatsAppIntent)return await plugin.sendWhatsAppIntent(payload);
   if(!result)throw Error('لم تصل نتيجة الإرسال. راجع المحادثة قبل إعادة المحاولة');
   return result;
  }finally{busy=false;}
 };
}

export function whatsappSendMessage(result){
 if(result?.openedInWhatsApp===true||result?.status==='fallback_opened')return 'فتحنا المحادثة بالمرفق؛ أكمل الإرسال في واتساب';
 if(result?.submitted===true||result?.status==='submitted'||result?.outcome==='submitted')return 'تم تقديم المستند إلى واتساب للإرسال';
 if(result?.dispatched===true||result?.status==='uncertain'||result?.outcome==='uncertain')return 'لم يتأكد الإرسال؛ راجع المحادثة قبل إعادة المحاولة';
 return result?.message||'تعذر إرسال المستند. افتح قسم واتساب لمراجعة الجلسة';
}
