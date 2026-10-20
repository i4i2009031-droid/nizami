/** Public, pseudonymous GitHub subscription registry: never put raw passwords or phones here. */
export const REGISTRY_URL='https://raw.githubusercontent.com/i4i2009031-droid/nizami/main/users.json';
export const REGISTRY_API='https://api.github.com/repos/i4i2009031-droid/nizami/contents/users.json';
export const HASH_ROUNDS=240000;
export function randomHex(bytes=16){const b=new Uint8Array(bytes);crypto.getRandomValues(b);return Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');}
export async function hashPassword(password,salt,rounds=HASH_ROUNDS){
 if(!/^[0-9a-f]{32}$/.test(salt)||!Number.isInteger(rounds)||rounds<240000||rounds>600000)throw Error('إعداد التحقق غير صالح');
 const bytes=new Uint8Array(salt.match(/../g).map(x=>parseInt(x,16)));
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
 const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:bytes,hash:'SHA-256',iterations:rounds},key,256);
 return Array.from(new Uint8Array(bits),x=>x.toString(16).padStart(2,'0')).join('');
}
export function equalSecret(a,b){if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a.charCodeAt(i)^b.charCodeAt(i);return x===0;}
export async function readRegistry(){
 const r=await fetch(REGISTRY_URL+'?refresh='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(16000)});
 if(!r.ok)throw Error('لم يمكن قراءة اشتراكات GitHub: '+r.status);
 const data=await r.json();if(!data||!Array.isArray(data.subscribers))throw Error('سجل المشتركين غير صالح');return data.subscribers;
}
export async function authenticate(username,password){
 const subscribers=await readRegistry();const user=subscribers.find(x=>x.username===String(username||'').trim());
 if(!user||!user.passwordHash||!user.salt)throw Error('بيانات الدخول غير صحيحة');
 const digest=await hashPassword(String(password),user.salt,user.rounds);
 if(!equalSecret(digest,user.passwordHash))throw Error('بيانات الدخول غير صحيحة');
 if(!user.active||user.expiresAt<new Date().toISOString().slice(0,10))throw Error('الاشتراك موقوف أو منتهي');
 return {id:user.id,username:user.username,storeName:user.storeName||user.username,expiresAt:user.expiresAt};
}
