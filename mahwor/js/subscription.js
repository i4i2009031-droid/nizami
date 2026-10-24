/** Secure login uses the optional HTTPS license gateway. For GitHub-only installations
 * with NO configured gateway, the public nizami/users.json registry is read directly.
 * IMPORTANT: public password hashes + client-side checks cannot enforce commercial licenses.
 * Never embed or transmit a GitHub personal access token in client software.
 */
export const REGISTRY_URL='https://raw.githubusercontent.com/i4i2009031-droid/nizami/main/users.json';
export const HASH_ROUNDS=240000;
export const LICENSE_API_STORAGE_KEY='mahwor_license_api_url';
const serverDayFormatter=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden',year:'numeric',month:'2-digit',day:'2-digit'});
export function subscriptionDate(date=new Date()){
 const p=Object.fromEntries(serverDayFormatter.formatToParts(date).map(x=>[x.type,x.value]));
 return p.year+'-'+p.month+'-'+p.day;
}
export function isSubscriptionActive(u,date=new Date()){
 if(!u||u.active!==true||typeof u.id!=='string'||!u.id||!/^\d{4}-\d{2}-\d{2}$/.test(u.expiresAt||''))return false;
 const expiry=new Date(u.expiresAt+'T00:00:00Z');
 return Number.isFinite(expiry.getTime())&&expiry.toISOString().slice(0,10)===u.expiresAt&&u.expiresAt>=subscriptionDate(date);
}
// Retained for compatibility with existing login tests and administrator-side password generation.
export function randomHex(bytes=16){const b=new Uint8Array(bytes);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
export async function hashPassword(password,salt,rounds=HASH_ROUNDS){
 if(!/^[0-9a-f]{32}$/.test(salt)||!Number.isInteger(rounds)||rounds<240000||rounds>600000)throw Error('إعداد التحقق غير صالح');
 const bytes=new Uint8Array(salt.match(/../g).map(x=>parseInt(x,16)));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes,hash:'SHA-256',iterations:rounds},key,256);
 return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
}
export function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
export function validateLicenseServerURL(url){
 if(typeof url!=='string'||!url.trim())throw Error('أدخل عنوان خادم الاشتراكات HTTPS');
 let parsed;try{parsed=new URL(url.trim());}catch{throw Error('رابط الخادم غير صالح');}
 if(parsed.username||parsed.password||parsed.search||parsed.hash)throw Error('اكتب عنوان الخادم فقط دون بيانات دخول أو مفاتيح');
 const local=['localhost','127.0.0.1','[::1]'].includes(parsed.hostname);
 if(parsed.protocol!=='https:'&&!(local&&parsed.protocol==='http:'))throw Error('يجب استخدام HTTPS لحماية كلمة المرور');
 if(parsed.pathname!=='/'&&parsed.pathname!=='')throw Error('أدخل عنوان الخادم الأساسي دون مسار إضافي');
 return parsed.origin;
}
export function saveLicenseServerURL(url,storage=globalThis.localStorage){
 const value=validateLicenseServerURL(url);
 storage?.setItem(LICENSE_API_STORAGE_KEY,value);
 return value;
}
async function optionalLicenseServerURL(storage=globalThis.localStorage){
 const custom=storage?.getItem(LICENSE_API_STORAGE_KEY);
 if(custom)return validateLicenseServerURL(custom);
 let config;
 try{
  const r=await fetch('./config.json',{cache:'no-store',signal:AbortSignal.timeout(10000)});
  if(r.ok)config=await r.json();
 }catch{}
 return config?.apiBase?validateLicenseServerURL(config.apiBase):null;
}
export async function getLicenseServerURL(storage=globalThis.localStorage){
 const origin=await optionalLicenseServerURL(storage);
 if(!origin)throw Error('لم يتم ربط خادم الاشتراكات. افتح «إعداد الاتصال» وأدخل عنوان خادم HTTPS الذي جهزته الإدارة.');
 return origin;
}
export async function readRegistry(){
 // Attempt the official public subscription registry first; CDN fallback improves reachability.
 // This compatibility mode is not a secure commercial licensing boundary.
 const endpoints=[REGISTRY_URL,
   'https://cdn.jsdelivr.net/gh/i4i2009031-droid/nizami@main/users.json',
   'https://raw.githack.com/i4i2009031-droid/nizami/main/users.json'];
 for(const endpoint of endpoints){
  try{
   const response=await fetch(endpoint+'?refresh='+Date.now(),{cache:'no-store',credentials:'omit',signal:AbortSignal.timeout(9000)});
   if(!response.ok)continue;
   const data=await response.json();
   if(Array.isArray(data?.subscribers))return data.subscribers;
  }catch{}
 }
 throw Error('تعذر الاتصال بسجل اشتراكات قطفة. تحقق من الإنترنت أو تواصل مع الإدارة.');
}
async function requestLicense(path,{password,username,licenseToken}={},opts={}){
 const origin=opts.apiBase?validateLicenseServerURL(opts.apiBase):await getLicenseServerURL();
 let response;
 try{
  const login=path==='login';
  response=await fetch(origin+'/api/license/'+path,{
   method:login?'POST':'GET',cache:'no-store',credentials:'omit',
   headers:{'Accept':'application/json',...(login?{'Content-Type':'application/json'}:{}),...(licenseToken?{Authorization:'Bearer '+licenseToken}:{})},
   ...(login?{body:JSON.stringify({username:String(username||'').trim(),password:String(password||'')})}:{}),
   signal:AbortSignal.timeout(16000)
  });
 }catch{throw Error('تعذر الوصول إلى خادم الاشتراكات، تحقق من الإنترنت وعنوان الخادم');}
 let data={};try{data=await response.json();}catch{}
 if(!response.ok){
  const e=new Error(data.message||('فشل التحقق من الاشتراك: '+response.status));
  e.status=response.status;e.code=data.error||'LICENSE_ERROR';
  throw e;
 }
 if(!data?.user||typeof data.user.id!=='string'||!data.user.id||typeof data.user.username!=='string'||typeof data.user.expiresAt!=='string'||typeof data.licenseToken!=='string'||data.licenseToken.length<16)
  throw Error('استجابة التحقق من الاشتراك غير صالحة');
 return {user:data.user,licenseToken:data.licenseToken};
}
export async function authenticate(username,password,opts={}){
 // An explicitly configured gateway always takes precedence and preserves secure login.
 const origin=opts.apiBase?validateLicenseServerURL(opts.apiBase):await optionalLicenseServerURL(opts.storage);
 if(origin)return requestLicense('login',{username,password},{apiBase:origin});
 // GitHub-only compatibility mode, usable ONLY when the registry is public.
 // The password is hashed locally and is NEVER sent to GitHub.
 const people=await readRegistry();
 const account=people.find(u=>u?.username===String(username||'').trim());
 if(!account||typeof account.passwordHash!=='string'||typeof account.salt!=='string')
  throw Error('اسم المستخدم أو كلمة المرور غير صحيحة');
 let digest;
 try{digest=await hashPassword(String(password||''),account.salt,account.rounds);}
 catch{throw Error('إعداد التحقق من الحساب غير صالح، تواصل مع الإدارة');}
 if(!equalSecret(digest,account.passwordHash))throw Error('اسم المستخدم أو كلمة المرور غير صحيحة');
 if(!isSubscriptionActive(account))throw Error('الاشتراك موقوف أو منتهي، تواصل مع الإدارة');
 return {user:{id:account.id,username:account.username,storeName:account.storeName||account.username,expiresAt:account.expiresAt},licenseToken:null};
}
export function checkLicense(licenseToken,opts){
 if(typeof licenseToken!=='string'||!licenseToken)throw Error('لإعادة التحقق، سجل الدخول أولاً للحصول على جلسة آمنة');
 return requestLicense('check',{licenseToken},opts);
}
