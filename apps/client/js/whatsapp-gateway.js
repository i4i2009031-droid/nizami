const MODES=['qr','phone_input','pairing_code','connected'];
export const validAuthMode=m=>MODES.includes(m);
export function pairingDigits(code){const v=String(code||'').replace(/[^a-z0-9]/gi,'').toUpperCase();return /^[A-Z0-9]{8}$/.test(v)?v.split(''):[];}
export function normalizeWhatsappPhone(raw){
 let s=String(raw||'').replace(/\D/g,'');
 if(s.startsWith('00'))s=s.slice(2);
 if(s.startsWith('0')&&s.length===10)s='967'+s.slice(1);
 if(s.length===9&&s[0]==='7')s='967'+s;
 if(!/^9677\d{8}$/.test(s))throw Error('أدخل رقمًا يمنيًا صحيحًا مثل +9677XXXXXXXX');
 return s;
}
export function normalizeGatewayUrl(value){
 const raw=String(value||'').trim();if(!raw)return '';
 const u=new URL(raw);
 if(u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('أدخل عنوان الخادم الأساسي فقط');
 if(u.protocol!=='https:'&&!(u.protocol==='http:'&&['localhost','127.0.0.1'].includes(u.hostname)))throw Error('الربط يتطلب خادم HTTPS آمنًا');
 return u.origin;
}
function b64(bytes){let s='';for(let i=0;i<bytes.length;i+=32768)s+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(s);}
export function createWhatsappGateway({getTenant,showSheet,toast,escapeHtml,onStatus}){
 const $=id=>document.getElementById(id),key=p=>p+String(getTenant()||'demo');
 let apiBase='',token='',username='',waAuthMode='qr',status='unavailable',readyTenant='',active=false,qrTimer=null,statusTimer=null,qrBusy=false,statusBusy=false,sending=false;
 const emit=()=>onStatus?.({status,linked:!!token&&status==='linked'});
 const stopQr=()=>{if(qrTimer!==null){clearInterval(qrTimer);qrTimer=null;}};
 function stop(){active=false;stopQr();if(statusTimer!==null){clearInterval(statusTimer);statusTimer=null;}}
 function clearAuth(){token='';sessionStorage.removeItem(key('qatfah-wa-token-'));status='unavailable';stopQr();emit();}
 async function configure(){
  const t=String(getTenant()||'demo');
  if(t!==readyTenant){stop();apiBase='';token='';username='';status='unavailable';readyTenant=t;}
  if(apiBase||token)return;
  let url=localStorage.getItem(key('qatfah-wa-url-'))||'';
  if(!url){try{const r=await fetch('./config.json',{cache:'no-store'});if(r.ok)url=(await r.json()).apiBase||'';}catch{}}
  try{apiBase=normalizeGatewayUrl(url);}catch{apiBase='';}
  token=sessionStorage.getItem(key('qatfah-wa-token-'))||'';
 }
 async function api(path,{method='GET',body,auth=true}={}){
  if(!apiBase)throw Error('أدخل عنوان بوابة قطفة');
  if(!navigator.onLine)throw Error('يتطلب الربط والإرسال اتصالًا بالإنترنت');
  const response=await fetch(apiBase+path,{method,cache:'no-store',headers:{Accept:'application/json',...(body?{'Content-Type':'application/json'}:{}),...(auth?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(25000)});
  const data=await response.json().catch(()=>({}));
  if([401,403].includes(response.status)){clearAuth();if(active)loginView();throw Error(data.message||'انتهت جلسة البوابة؛ سجل دخولك مجددًا');}
  if(!response.ok)throw Error(data.message||'خطأ الاتصال بالخادم '+response.status);
  return data;
 }
 function loginView(){if($('wa-login-view'))$('wa-login-view').hidden=false;if($('wa-dashboard-view'))$('wa-dashboard-view').hidden=true;}
 function panelView(){if($('wa-login-view'))$('wa-login-view').hidden=true;if($('wa-dashboard-view'))$('wa-dashboard-view').hidden=false;if($('wa-tenant'))$('wa-tenant').textContent=username?'الحساب: '+username:'جلسة خاصة بالمحل';setMode(waAuthMode);}
 function label(msg=''){const el=$('wa-status-text');if(el)el.textContent=msg||({linked:'🟢 متصل وجاهز للإرسال',waiting_for_scan:'امسح الباركود من هاتفك',connecting:'جارٍ الاتصال بواتساب',disconnected:'اتصال واتساب متوقف',unavailable:'بوابة واتساب غير مفعّلة على الخادم'}[status]||'انتظار الاتصال');}
 function setMode(next){
  if(!validAuthMode(next))throw Error('حالة واتساب غير صحيحة');
  waAuthMode=next;if(next!=='qr')stopQr();
  for(const id of ['wa-qr-view','wa-code-view','wa-connected-view']){const node=$(id);if(node)node.hidden=(id!==(next==='qr'?'wa-qr-view':next==='connected'?'wa-connected-view':'wa-code-view'));}
  if($('wa-phone-step'))$('wa-phone-step').hidden=next!=='phone_input';
  if($('wa-pairing-step'))$('wa-pairing-step').hidden=next!=='pairing_code';
  if(next==='qr'&&active&&token)startQr();
 }
 async function readQr(){
  if(!active||!token||waAuthMode!=='qr'||qrBusy)return;qrBusy=true;
  try{
   const r=await api('/api/whatsapp/qr');if(!active||waAuthMode!=='qr')return;
   if(r.status==='linked'){status='linked';setMode('connected');emit();label();return;}
   status=r.status||status;emit();label(r.message);
   if(typeof r.image==='string'&&/^data:image\/png;base64,[a-z0-9+/=]+$/i.test(r.image)){const img=$('wa-qr-image');if(img){img.src=r.image;img.hidden=false;}if($('wa-qr-placeholder'))$('wa-qr-placeholder').hidden=true;}
  }catch(e){if(active)label(e.message);}finally{qrBusy=false;}
 }
 function startQr(){if(qrTimer!==null)return;readQr();qrTimer=setInterval(readQr,7000);}
 async function refreshStatus(){
  if(!token||statusBusy)return;statusBusy=true;
  try{
   const r=await api('/api/whatsapp/status');status=r.status||'unavailable';emit();
   if(active){if(status==='linked'&&waAuthMode!=='connected')setMode('connected');else if(status!=='linked'&&waAuthMode==='connected')setMode('qr');label();}
  }catch(e){if(active)label(e.message);}finally{statusBusy=false;}
 }
 function startStatus(){if(statusTimer===null)statusTimer=setInterval(refreshStatus,5000);}
 function paintCode(code){const cells=$('wa-pairing-cells'),chars=pairingDigits(code);if(cells)cells.innerHTML=Array.from({length:8},(_,i)=>'<span class="wa-code-cell">'+escapeHtml(chars[i]||'·')+'</span>').join('');}
 async function pair(){
  stopQr();const button=$('wa-pair-submit');button.disabled=true;
  try{
   const phone=normalizeWhatsappPhone($('wa-pair-number').value);
   const r=await api('/api/whatsapp/pair',{method:'POST',body:{phone}});
   if(r.status==='linked'){status='linked';setMode('connected');emit();label();return;}
   if(r.status!=='pairing'||pairingDigits(r.code).length!==8)throw Error(r.message||'لم يصدر واتساب رمز ربط صالحًا');
   paintCode(r.code);setMode('pairing_code');label('أدخل الرمز على هاتفك في الأجهزة المرتبطة');
  }catch(e){toast(e.message);setMode('phone_input');}finally{button.disabled=false;}
 }
 async function login(e){
  e.preventDefault();const button=$('wa-login-button');button.disabled=true;
  try{
   const u=normalizeGatewayUrl($('wa-api-url').value),name=$('wa-username').value.trim(),password=$('wa-password').value;
   if(!u||!name||!password)throw Error('أدخل الرابط وبيانات حساب بوابة واتساب');
   apiBase=u;const r=await api('/api/auth/login',{method:'POST',auth:false,body:{username:name,password}});
   if(!r.token||r.user?.role!=='client')throw Error('يلزم حساب محل فعال على بوابة قطفة');
   token=r.token;username=r.user.username||name;status='connecting';waAuthMode='qr';
   sessionStorage.setItem(key('qatfah-wa-token-'),token);localStorage.setItem(key('qatfah-wa-url-'),apiBase);
   panelView();await refreshStatus();startStatus();toast('تم ربط حساب البوابة بنجاح');
  }catch(e){toast(e.message);}finally{button.disabled=false;}
 }
 function render(){
  showSheet('واتساب | إرسال مباشر',`<div class="wa-gateway">
   <div class="wa-status-strip" id="wa-status-text" role="status" aria-live="polite">جارٍ التحقق من الاتصال...</div>
   <section id="wa-login-view"><p class="hint">للإرسال المباشر دون مشاركة، اربط قطفة بخادم واتساب HTTPS المخصص للمحل.</p>
    <form id="wa-login-form" class="sheet-form">
     <label>رابط خادم قطفة<input id="wa-api-url" type="url" dir="ltr" placeholder="https://api.example.com" value="${escapeHtml(apiBase)}" required /></label>
     <label>اسم مستخدم بوابة الإرسال<input id="wa-username" autocomplete="username" required /></label>
     <label>كلمة المرور<input id="wa-password" type="password" autocomplete="current-password" required /></label>
     <button type="submit" id="wa-login-button" class="btn btn-primary">اتصال بالخادم</button></form></section>
   <section id="wa-dashboard-view" hidden><p class="muted" id="wa-tenant"></p>
    <div id="wa-qr-view" class="wa-auth-view"><p class="hint">واتساب ← الأجهزة المرتبطة ← ربط جهاز، ثم امسح هذا الرمز.</p>
     <div class="wa-qr-frame"><img id="wa-qr-image" alt="باركود واتساب" hidden /><p id="wa-qr-placeholder">جارٍ إنشاء الباركود من الخادم...</p></div>
     <button id="wa-refresh-qr" class="btn btn-light btn-block" type="button">تحديث الباركود</button>
     <button id="wa-switch-phone" class="btn btn-primary btn-block" type="button">التبديل إلى الربط برقم الهاتف والرمز</button></div>
    <div id="wa-code-view" class="wa-auth-view" hidden>
     <div id="wa-phone-step"><p class="hint">أدخل رقم واتساب اليمني لتوليد رمز الربط.</p>
      <div class="wa-country-phone"><b dir="ltr">+967</b><input id="wa-pair-number" type="tel" inputmode="numeric" maxlength="12" dir="ltr" placeholder="7XXXXXXXX"/></div>
      <button id="wa-pair-submit" class="btn btn-primary btn-block" type="button">طلب رمز الربط</button></div>
     <div id="wa-pairing-step" hidden><p class="hint">أدخل هذه الخانات الثماني في واتساب ← الأجهزة المرتبطة ← ربط برقم الهاتف.</p>
      <div class="wa-code-cells" id="wa-pairing-cells" dir="ltr"></div><button id="wa-new-code" class="btn btn-light btn-block" type="button">طلب رمز جديد</button></div>
     <button id="wa-switch-qr" class="btn btn-light btn-block" type="button">العودة إلى الباركود</button></div>
    <div id="wa-connected-view" class="wa-auth-view" hidden>
     <p class="wa-connected-mark">✓ تم ربط واتساب، ويمكن إرسال الفواتير PDF مباشرة من داخل قطفة.</p>
     <form id="wa-text-form" class="sheet-form"><label>رقم المستلم<input id="wa-send-number" type="tel" dir="ltr" placeholder="+9677XXXXXXXX" required /></label>
      <label>الرسالة<textarea id="wa-send-text" rows="3" maxlength="5000" required></textarea></label>
      <button id="wa-send-button" class="btn btn-primary" type="submit">إرسال رسالة مباشرة</button></form>
     <button id="wa-embedded-web" class="btn btn-light btn-block" type="button">فتح متصفح واتساب المدمج</button>
     <p class="hint">لإرسال الفواتير والكشوف، اضغط «إرسال PDF واتساب» من المستند نفسه.</p></div>
    <button id="wa-change-account" class="btn btn-light btn-block" type="button">تغيير حساب بوابة الإرسال</button></section>
   <p class="wa-caution">الإرسال عبر جلسة الخادم المرتبطة، دون نافذة مشاركة. قبول الطلب لا يعني تسليم الرسالة أو قراءتها، واستخدم الإرسال للمستلمين الموافقين.</p></div>`);
  active=true;
  $('wa-login-form').onsubmit=login;
  $('wa-refresh-qr').onclick=readQr;
  $('wa-switch-phone').onclick=()=>{setMode('phone_input');label('أدخل رقمك لتوليد رمز الربط');};
  $('wa-pair-submit').onclick=pair;
  $('wa-new-code').onclick=()=>{paintCode('');setMode('phone_input');};
  $('wa-switch-qr').onclick=()=>{paintCode('');setMode('qr');label();};
  $('wa-change-account').onclick=()=>{clearAuth();loginView();toast('أدخل بيانات البوابة الجديدة');};
  $('wa-text-form').onsubmit=async e=>{e.preventDefault();const b=$('wa-send-button');b.disabled=true;try{await sendText($('wa-send-number').value,$('wa-send-text').value);$('wa-send-text').value='';}catch(err){toast(err.message);}finally{b.disabled=false;}};
  $('wa-embedded-web').onclick=async()=>{try{const p=window.Capacitor?.Plugins?.QatfahNative;if(!p?.openWhatsAppWeb)throw Error('المتصفح المدمج متاح لأندرويد فقط');await p.openWhatsAppWeb();}catch(e){toast(e.message);}};
  if(token)panelView();else loginView();label();
 }
 async function open(){
  await configure();render();
  if(token){try{const me=await api('/api/auth/me');username=me.user?.username||'';panelView();await refreshStatus();startStatus();}catch(e){toast(e.message);loginView();}}
 }
 async function linked(){
  await configure();
  if(!token){await open();throw Error('اربط بوابة واتساب ثم أعد إرسال المستند');}
  const s=await api('/api/whatsapp/status');status=s.status||'unavailable';emit();
  if(status!=='linked'){await open();throw Error('واتساب غير متصل؛ امسح الباركود أو أدخل رمز الهاتف أولًا');}
 }
 async function sendText(raw,text){
  if(sending)throw Error('هناك عملية إرسال جارية');
  const phone=normalizeWhatsappPhone(raw),message=String(text||'').trim();if(!message||message.length>5000)throw Error('نص الرسالة غير صالح');
  await linked();sending=true;
  try{const r=await api('/api/whatsapp/send',{method:'POST',body:{phone,text:message}});if(!['sent','accepted'].includes(r.status))throw Error(r.message||'لم يتم إرسال الرسالة: '+r.status);toast('تم قبول إرسال الرسالة من واتساب؛ تحقق من تسليمها');return r;}
  finally{sending=false;}
 }
 async function sendPdf(raw,blob,filename,caption=''){
  if(sending)throw Error('هناك عملية إرسال جارية');
  const phone=normalizeWhatsappPhone(raw);
  if(!(blob instanceof Blob)||blob.size<5||blob.size>5000000)throw Error('ملف PDF يجب ألا يزيد عن 5 ميجابايت');
  if(!/^[a-z0-9_.-]{1,120}\.pdf$/i.test(filename))throw Error('اسم ملف PDF غير صالح');
  await linked();sending=true;
  try{const bytes=new Uint8Array(await blob.arrayBuffer());const r=await api('/api/whatsapp/send-document',{method:'POST',body:{phone,filename,caption:String(caption).slice(0,500),base64:b64(bytes)}});if(!['sent','accepted'].includes(r.status))throw Error(r.message||'لم يقبل واتساب المستند: '+r.status);toast('قبل واتساب ملف PDF للإرسال المباشر؛ تحقق من التسليم');return r;}
  finally{sending=false;}
 }
 async function refreshBadge(){await configure();if(!token||!navigator.onLine){emit();return;}try{const r=await api('/api/whatsapp/status');status=r.status||'unavailable';emit();}catch{emit();}}
 function logout(){stop();clearAuth();readyTenant='';apiBase='';username='';}
 return {open,sendPdf,sendText,refreshBadge,stop,logout,getState:()=>({mode:waAuthMode,status,linked:!!token&&status==='linked'})};
}
