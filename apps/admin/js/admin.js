import {hashPassword,randomHex,REGISTRY_API,HASH_ROUNDS,subscriptionDate,isSubscriptionActive} from './subscription.js';
const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toDate=()=>subscriptionDate();
const KEY='qatfah_admin_local_auth_2',VAULT='qatfah_admin_encrypted_vault_2';
let credentials=null;try{credentials=JSON.parse(localStorage.getItem(KEY)||'null');}catch{}
let key=null,vault={token:'',metadata:{},cache:[]},users=[],registrySha=null,registryWriteBusy=false,registryReadBusy=false;
let sessionGeneration=0,registryReadSequence=0,vaultSaveQueue=Promise.resolve();
const staleSession=()=>Object.assign(new Error('تغيرت جلسة المدير؛ أعد فتح الحساب'),{staleSession:true});
const sessionCurrent=(generation,sessionKey=key)=>generation===sessionGeneration&&sessionKey!==null&&sessionKey===key;
function requireSession(generation,sessionKey=key){if(!sessionCurrent(generation,sessionKey))throw staleSession();}
function resetRegistry(){registrySha=null;registryWriteBusy=false;registryReadBusy=false;registryReadSequence++;vaultSaveQueue=Promise.resolve();}
function requireEditable(expectedSha=registrySha,generation=sessionGeneration){
 requireSession(generation);
 if(!navigator.onLine)throw Error('لإدارة الاشتراكات على GitHub يلزم الاتصال بالإنترنت');
 if(registryReadBusy)throw Error('انتظر اكتمال تحديث سجل المشتركين');
 if(registryWriteBusy)throw Error('يجري حفظ تعديل الاشتراك الحالي');
 if(!registrySha||!expectedSha)throw Error('حدّث اتصال GitHub قبل تعديل الاشتراكات');
 if(expectedSha!==registrySha)throw Error('تغيّر سجل المشتركين؛ أغلق النموذج وأعد فتح الحساب قبل الحفظ');
}
const toast=message=>{const el=$('toast');el.textContent=message;el.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>el.classList.remove('show'),4500);};
const randPass=()=>{const chars='ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#-';let s='';const b=new Uint8Array(28);crypto.getRandomValues(b);for(const x of b)s+=chars[x%chars.length];return s;};
const bytes=s=>Uint8Array.from(s.match(/../g).map(h=>parseInt(h,16)));
const b64=b=>{const bytes=new Uint8Array(b);let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(text);};
const unb64=s=>Uint8Array.from(atob(s.replace(/\s/g,'')),c=>c.charCodeAt(0));
async function aesKey(password,salt){const raw=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveKey']);return crypto.subtle.deriveKey({name:'PBKDF2',salt:bytes(salt),iterations:HASH_ROUNDS,hash:'SHA-256'},raw,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);}
async function loadVault(generation=sessionGeneration){
 const sessionKey=key;requireSession(generation,sessionKey);
 const raw=localStorage.getItem(VAULT);if(!raw)return;const v=JSON.parse(raw);
 let decoded;try{decoded=JSON.parse(new TextDecoder().decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(v.iv)},sessionKey,unb64(v.content))));}
 catch(error){if(!sessionCurrent(generation,sessionKey))throw staleSession();throw Error('تعذر فتح المخزن المحمي — كلمة المرور غير صحيحة أو البيانات تالفة');}
 requireSession(generation,sessionKey);vault={...decoded,token:decoded.token||'',metadata:decoded.metadata||{},cache:Array.isArray(decoded.cache)?decoded.cache:[]};
}
function saveVault(generation=sessionGeneration){
 const sessionKey=key,sessionVault=vault,snapshot=JSON.stringify(vault);
 const save=vaultSaveQueue.catch(()=>{}).then(async()=>{
  requireSession(generation,sessionKey);if(vault!==sessionVault)throw staleSession();
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const content=await crypto.subtle.encrypt({name:'AES-GCM',iv},sessionKey,new TextEncoder().encode(snapshot));
  requireSession(generation,sessionKey);if(vault!==sessionVault)throw staleSession();
  localStorage.setItem(VAULT,JSON.stringify({iv:b64(iv),content:b64(content)}));
 });
 vaultSaveQueue=save;return save;
}
function refreshLogin(){const setup=!credentials;$('login-headline').textContent=setup?'إنشاء حساب المدير على هذا الهاتف':'دخول المدير';$('login-description').textContent=setup?'حدد اسم مستخدم وكلمة مرور قوية لحماية الإدارة على هذا الهاتف. لا تُرسل كلمة المرور إلى GitHub.':'اكتب بيانات دخول المدير المحلية ثم اربط حساب GitHub مرة واحدة من الإعدادات.';$('confirm-wrap').hidden=!setup;$('login-submit').textContent=setup?'إنشاء حساب المدير':'دخول لوحة الإدارة';if(!setup)$('username').value=credentials.username;}
async function authSubmit(e){e.preventDefault();const fd=new FormData(e.target),username=String(fd.get('username')||'').trim(),password=String(fd.get('password')||'');const btn=$('login-submit');btn.disabled=true;
const generation=++sessionGeneration;resetRegistry();key=null;vault={token:'',metadata:{},cache:[]};users=[];
try{
 if(!credentials){if(username.length<3||password.length<12)throw Error('اسم المدير 3 أحرف وكلمة المرور 12 حرفًا على الأقل');if(password!==fd.get('confirmPassword'))throw Error('تأكيد كلمة المرور غير مطابق');const salt=randomHex(),next={username,salt,verifier:await hashPassword(password,salt)};if(generation!==sessionGeneration)return;localStorage.setItem(KEY,JSON.stringify(next));credentials=next;}
 else {const valid=username===credentials.username&&await hashPassword(password,credentials.salt)===credentials.verifier;if(generation!==sessionGeneration)return;if(!valid)throw Error('اسم المستخدم أو كلمة المرور غير صحيحة');}
 const unlocked=await aesKey(password,credentials.salt);if(generation!==sessionGeneration)return;
 key=unlocked;await loadVault(generation);requireSession(generation,unlocked);$('login-view').hidden=true;$('dashboard').hidden=false;users=vault.cache||[];render();if(vault.token&&navigator.onLine)await loadUsers(generation);else toast('مرحبًا. اربط GitHub من زر الاتصال لإدارة الاشتراكات.');
}catch(err){if(generation===sessionGeneration&&!err.staleSession)toast(err.message)}finally{if(generation===sessionGeneration)btn.disabled=false;}}
async function gh(path='',opts={},token=vault.token){if(!token)throw Error('يلزم تفويض GitHub للمدير مرة واحدة');const res=await fetch(REGISTRY_API+path,{signal:AbortSignal.timeout(16000),...opts,headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28',...(opts.headers||{})}});const data=await res.json().catch(()=>({}));if(!res.ok){if(res.status===409)throw Error('تغيّر سجل المشتركين في GitHub؛ حدّث الاتصال ثم أعد حفظ التعديل');throw Error(data.message||'فشل اتصال GitHub: '+res.status);}return data;}
function parseGithubContent(content){return JSON.parse(new TextDecoder().decode(unb64(content)));}
async function loadUsers(generation=sessionGeneration){
 const sessionKey=key,sessionVault=vault,token=vault.token;requireSession(generation,sessionKey);
 if(registryWriteBusy)throw Error('انتظر اكتمال حفظ الاشتراك قبل تحديث السجل');
 const request=++registryReadSequence;registryReadBusy=true;registrySha=null;render();
 const current=()=>sessionCurrent(generation,sessionKey)&&vault===sessionVault&&vault.token===token&&request===registryReadSequence;
 try{
  const res=await gh('?ref=main&t='+Date.now(),{},token);if(!current())throw staleSession();
  const d=parseGithubContent(res.content);if(!Array.isArray(d.subscribers)||typeof res.sha!=='string'||!res.sha)throw Error('سجل المشتركين غير صالح');
  registrySha=res.sha;users=d.subscribers.filter(x=>x&&x.id);vault.cache=users;
  $('server-status').innerHTML='<i class="pulse"></i> GitHub متصل';$('server-status').classList.add('connected');
  let localSaved=true;try{await saveVault(generation);}catch(error){if(!current())throw staleSession();localSaved=false;toast('اتصلنا بـ GitHub؛ تعذر تحديث النسخة المحمية على الجهاز');}
  if(!current())throw staleSession();return {users,localSaved};
 }catch(error){if(current()){$('server-status').textContent='GitHub غير متصل';$('server-status').classList.remove('connected');}throw error;}
 finally{if(current()){registryReadBusy=false;render();}}
}
async function pushUsers(next,{expectedSha,generation=sessionGeneration}={}){
 if(typeof expectedSha!=='string'||!expectedSha)throw Error('أعد فتح نموذج الاشتراك من السجل الحالي');
 requireEditable(expectedSha,generation);
 const sessionKey=key,sessionVault=vault,token=vault.token;
 const current=()=>sessionCurrent(generation,sessionKey)&&vault===sessionVault&&vault.token===token;
 registryWriteBusy=true;render();
 try{
  const registry={version:2,notice:'Public status registry; no phones or plaintext passwords',subscribers:next};
  const raw=new TextEncoder().encode(JSON.stringify(registry,null,2));
  const saved=await gh('',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'chore: update Qatfah subscription registry',content:b64(raw),sha:expectedSha,branch:'main'})},token);
  // An acknowledged remote save remains successful even if its UI session ended.
  if(!current())return {remoteSaved:true,current:false,localSaved:false};
  registrySha=typeof saved.content?.sha==='string'?saved.content.sha:null;users=next;vault.cache=next;render();
  let localSaved=true;try{await saveVault(generation);}catch(error){localSaved=false;if(current())toast('حُفظ التعديل في GitHub؛ تعذر تحديث النسخة المحلية');}
  return {remoteSaved:true,current:current(),localSaved};
 }finally{if(current()){registryWriteBusy=false;render();}}
}
function render(){const now=toDate(),active=users.filter(x=>isSubscriptionActive(x)).length,expired=users.filter(x=>x.expiresAt<now).length;
 const editable=!!key&&!!registrySha&&!registryReadBusy&&!registryWriteBusy;$('new-user').disabled=!editable;$('github-connect').disabled=registryWriteBusy||registryReadBusy;
 $('stats').innerHTML=`<div class="stat-card"><small>المشتركون</small><strong>${users.length}</strong></div><div class="stat-card active"><small>حسابات فعالة</small><strong>${active}</strong></div><div class="stat-card stopped"><small>موقوفة أو منتهية</small><strong>${users.length-active}</strong></div>`;
 $('count-label').textContent=`${users.length} حساب • ${expired} منتهٍ`;
 const query=$('search').value.toLowerCase().trim();$('subscriber-list').innerHTML=users.filter(u=>{const m=vault.metadata[u.id]||{};return [u.username,m.storeName,m.phone].some(t=>String(t||'').toLowerCase().includes(query))}).map(u=>{const m=vault.metadata[u.id]||{},valid=isSubscriptionActive(u);return `<article class="person-card"><div class="person-top"><div><h3>${esc(m.storeName||u.username)}</h3><p>@${esc(u.username)}</p></div><span class="chip ${valid?'':'red'}">${!u.active?'موقوف':valid?'فعال':'منتهي / تاريخ غير صالح'}</span></div><div class="person-info"><span class="pill-info">☏ ${esc(m.phone||'محفوظ لدى المدير فقط')}</span><span class="pill-info">ينتهي ${esc(u.expiresAt)}</span></div><div class="person-controls"><button class="tiny-btn" data-edit="${esc(u.id)}" ${editable?'':'disabled'}>إدارة الحساب</button><button class="tiny-btn ${u.active?'stop':''}" data-toggle="${esc(u.id)}" ${editable?'':'disabled'}>${u.active?'إيقاف':'تفعيل'}</button></div></article>`}).join('')||'<div class="empty">لا توجد حسابات بعد. اتصل بمستودع GitHub لإضافتها.</div>';}
function showSheet(title,content){$('sheet-title').textContent=title;$('sheet-content').innerHTML=content;$('sheet-overlay').hidden=false;}
function closeSheet(){$('sheet-overlay').hidden=true;$('sheet-content').innerHTML='';}
function settings(){
 if(!key||registryWriteBusy||registryReadBusy){toast('انتظر اكتمال العملية الحالية');return;}
 const generation=sessionGeneration,sessionVault=vault;let connecting=false;
 showSheet('تفويض GitHub مرة واحدة',`<p class="hint">GitHub لا يسمح للتطبيق بتحديث المستودع باسم مستخدم وكلمة مرور فقط. أنشئ Fine-grained personal access token لحساب المدير بصلاحية Contents: Read and write على مستودع nizami. سيُشفّر على الجهاز بكلمة مرور المدير. لا ترسله لأحد ولا تضعه في users.json.</p><form id="gh-form" class="sheet-form"><label>GitHub token (مرة واحدة)<input name="token" type="password" autocomplete="off" required placeholder="github_pat_..."/></label><button class="btn btn-primary">حفظ التفويض وفحص المستودع</button></form><p class="hint">فور الاتصال يمكن إنشاء وتعديل المشتركين على خطة GitHub المجانية. لا يرسل التطبيق أرقام هواتف العملاء أو أسماء المحلات إلى المستودع العام.</p>`);
 $('gh-form').onsubmit=async e=>{
  e.preventDefault();if(connecting||!sessionCurrent(generation)||vault!==sessionVault)return;
  const token=String(new FormData(e.target).get('token')||'').trim();if(!token){toast('أدخل التفويض');return;}
  const previous=vault.token;connecting=true;vault.token=token;
  try{const result=await loadUsers(generation);if(!sessionCurrent(generation)||vault!==sessionVault)return;closeSheet();toast(result.localSaved?'تم ربط GitHub وحفظ التفويض مشفرًا ✓':'تم ربط GitHub؛ تعذر حفظ التفويض مشفرًا على الجهاز');}
  catch(ex){if(sessionCurrent(generation)&&vault===sessionVault){vault.token=previous;if(!ex.staleSession)toast(ex.message);}}
  finally{connecting=false;}
 };
}
function accountForm(u){
 try{requireEditable();}catch(error){toast(error.message);return;}
 const generation=sessionGeneration,expectedSha=registrySha,original=u?{...u}:null;
 u=original;let saving=false;
 const m=u?vault.metadata[u.id]||{}:{};showSheet(u?'إدارة اشتراك':'مشترك جديد',`<form id="account-form" class="sheet-form"><label>اسم المحل (يُحفظ على جهاز المدير فقط)<input name="storeName" required value="${esc(m.storeName||'')}" maxlength="120"/></label><label>اسم المستخدم<input name="username" required ${u?'disabled':''} dir="ltr" pattern="[A-Za-z0-9_.-]{4,50}" value="${esc(u?.username||'')}"/></label><label>رقم الجوال +967 (محلي فقط)<input name="phone" type="tel" dir="ltr" value="${esc(m.phone||'+967')}"/></label><label>${u?'كلمة مرور جديدة (اختياري)':'كلمة مرور عشوائية قوية'}</label><div class="row-between"><input name="password" id="new-pass" type="text" dir="ltr" value="${u?'':randPass()}" autocomplete="off" style="flex:1"/><button class="tiny-btn" type="button" id="regen">توليد</button></div><label>نهاية الاشتراك<input name="expiresAt" required type="date" value="${esc(u?.expiresAt||subscriptionDate(new Date(Date.now()+30*86400000)))}"/></label><label>التفعيل<select name="active"><option value="true" ${u?.active===false?'':'selected'}>فعال</option><option value="false" ${u?.active===false?'selected':''}>موقوف</option></select></label><button class="btn btn-primary">${u?'حفظ':'إنشاء'} الحساب في GitHub</button><p class="hint">احتفظ بكلمة مرور المشترك وشاركها معه بشكل خاص. لن يُحفظ النص الأصلي في المستودع ولا في التطبيق.</p></form>`);
 $('regen').onclick=()=>{$('new-pass').value=randPass()};
 $('account-form').onsubmit=async e=>{e.preventDefault();if(saving)return;
 const form=e.target,button=form.querySelector('button.btn-primary'),f=new FormData(form),pass=String(f.get('password')||''),username=String(f.get('username')||u?.username||'').trim(),id=u?.id||crypto.randomUUID(),entry={...(u||{}),id,username,expiresAt:String(f.get('expiresAt')),active:f.get('active')==='true'};
 saving=true;if(button)button.disabled=true;
 try{
  requireEditable(expectedSha,generation);
  if(!u||pass){if(pass.length<20)throw Error('كلمة مرور المشترك لا تقل عن 20 رمزًا عشوائيًا');entry.salt=randomHex();entry.rounds=HASH_ROUNDS;entry.passwordHash=await hashPassword(pass,entry.salt,entry.rounds);}
  // Recheck the form's version after asynchronous hashing, before constructing a PUT.
  requireEditable(expectedSha,generation);if(!form.isConnected)return;
  if(!u&&users.some(x=>x.username===username))throw Error('اسم المستخدم موجود');
  const result=await pushUsers(u?users.map(x=>x.id===id?entry:x):[...users,entry],{expectedSha,generation});
  if(!result.current||!sessionCurrent(generation))return;
  vault.metadata[id]={storeName:String(f.get('storeName')),phone:String(f.get('phone'))};
  let localSaved=true;try{await saveVault(generation);}catch{localSaved=false;}
  if(!sessionCurrent(generation))return;
  closeSheet();toast(localSaved?'تم حفظ الاشتراك في GitHub':'حُفظ الاشتراك في GitHub؛ احفظ بيانات العميل، تعذر تحديث النسخة المحلية');if(pass)window.alert(`بيانات الاشتراك (اعرضها للعميل فقط):\nاسم المستخدم: ${username}\nكلمة المرور: ${pass}\nالانتهاء: ${entry.expiresAt}`);
 }catch(ex){if(sessionCurrent(generation)&&!ex.staleSession)toast(ex.message);}
 finally{saving=false;if(button&&sessionCurrent(generation))button.disabled=false;}
 };}
$('login-form').onsubmit=authSubmit;
$('search').oninput=render;
$('new-user').onclick=()=>accountForm();
$('sheet-close').onclick=closeSheet;$('sheet-overlay').onclick=e=>{if(e.target===$('sheet-overlay'))closeSheet()};
$('logout').onclick=()=>{sessionGeneration++;resetRegistry();key=null;vault={token:'',metadata:{},cache:[]};users=[];closeSheet();$('login-view').hidden=false;$('dashboard').hidden=true;$('login-form').reset();$('login-submit').disabled=false;refreshLogin();};
$('github-connect').onclick=settings;
document.addEventListener('click',async e=>{
 const edit=e.target.closest('[data-edit]'),toggle=e.target.closest('[data-toggle]');
 if(edit){const u=users.find(x=>x.id===edit.dataset.edit);if(u)accountForm(u);}
 if(toggle){
  const generation=sessionGeneration,expectedSha=registrySha;
  try{requireEditable(expectedSha,generation);const u=users.find(x=>x.id===toggle.dataset.toggle);if(!u||!confirm(`${u.active?'إيقاف':'تفعيل'} اشتراك ${u.username}؟`))return;
   const result=await pushUsers(users.map(x=>x.id===u.id?{...u,active:!u.active}:x),{expectedSha,generation});if(result.current&&sessionCurrent(generation))toast('تم التحديث في GitHub');
  }catch(ex){if(sessionCurrent(generation)&&!ex.staleSession)toast(ex.message);}
 }
});
function clock(){$('clock').textContent=new Date().toLocaleTimeString('ar-YE',{hour:'2-digit',minute:'2-digit'});}clock();setInterval(clock,15000);refreshLogin();
