/** Per-tenant Google Drive OAuth connection. Server-side code only.
 * Refresh tokens are encrypted at rest. Uses drive.file scope and an app-created folder.
 * Needs GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI and
 * QATFAH_GOOGLE_TOKEN_KEY (64-char hex = 32 bytes). */
import {randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';

const auth='https://accounts.google.com/o/oauth2/v2/auth';
const tokenUrl='https://oauth2.googleapis.com/token';
const api='https://www.googleapis.com/drive/v3';
const uploadApi='https://www.googleapis.com/upload/drive/v3';
const params=()=>({id:process.env.GOOGLE_CLIENT_ID||'',secret:process.env.GOOGLE_CLIENT_SECRET||'',redirect:process.env.GOOGLE_REDIRECT_URI||'',key:process.env.QATFAH_GOOGLE_TOKEN_KEY||''});
export const driveConfigured=()=>{const x=params();return !!(x.id&&x.secret&&/^https:\/\//.test(x.redirect)&&/^[a-f\d]{64}$/i.test(x.key));};
function issue(message,status=502){return Object.assign(new Error(message),{status});}
const key=()=>{if(!driveConfigured())throw issue('لم تتم تهيئة Google OAuth في خادم قطفة',503);return Buffer.from(params().key,'hex');};
function encrypt(object){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(),iv);const ct=Buffer.concat([cipher.update(JSON.stringify(object)),cipher.final()]);return JSON.stringify({iv:iv.toString('base64url'),tag:cipher.getAuthTag().toString('base64url'),cipher:ct.toString('base64url')});}
function decrypt(str){const p=JSON.parse(str),iv=Buffer.from(p.iv,'base64url'),cipher=createDecipheriv('aes-256-gcm',key(),iv);cipher.setAuthTag(Buffer.from(p.tag,'base64url'));return JSON.parse(Buffer.concat([cipher.update(Buffer.from(p.cipher,'base64url')),cipher.final()]).toString());}
async function postToken(data){const result=await fetch(tokenUrl,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(data)});const body=await result.json();if(!result.ok||!body.access_token)throw issue('فشل تفويض Google: '+(body.error||result.status),401);return body;}
export function googleDrive(db){
 db.exec(`CREATE TABLE IF NOT EXISTS google_drive_links (
  tenant_id TEXT PRIMARY KEY, tokens_encrypted TEXT NOT NULL,
  folder_id TEXT NOT NULL DEFAULT '', linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE IF NOT EXISTS google_oauth_states (
  state TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, expires_at INTEGER NOT NULL);
 `);
 const get=(tenant)=>db.prepare('SELECT * FROM google_drive_links WHERE tenant_id=?').get(tenant);
 const put=(tenant,tokens,folderId)=>db.prepare('INSERT INTO google_drive_links(tenant_id,tokens_encrypted,folder_id) VALUES(?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET tokens_encrypted=excluded.tokens_encrypted,folder_id=excluded.folder_id,linked_at=CURRENT_TIMESTAMP').run(tenant,encrypt(tokens),folderId||'');
 function connected(tenant){return {connected:!!get(tenant),configured:driveConfigured(),folderName:'Qatfah_Backup'};}
 function start(tenant){key();const x=params(),state=randomBytes(24).toString('base64url');db.prepare('DELETE FROM google_oauth_states WHERE expires_at < ?').run(Date.now());db.prepare('INSERT INTO google_oauth_states(state,tenant_id,expires_at) VALUES(?,?,?)').run(state,tenant,Date.now()+10*60000);
  const u=new URL(auth);for(const [k,v] of Object.entries({client_id:x.id,redirect_uri:x.redirect,response_type:'code',access_type:'offline',prompt:'consent',scope:'https://www.googleapis.com/auth/drive.file',state}))u.searchParams.set(k,v);return {url:u.toString()};
 }
 async function finish(code,state){key();const row=db.prepare('SELECT * FROM google_oauth_states WHERE state=?').get(state);if(!row||row.expires_at<Date.now())throw issue('رابط التفويض منتهي أو مستخدم',403);db.prepare('DELETE FROM google_oauth_states WHERE state=?').run(state);
  const x=params(),v=await postToken({code,client_id:x.id,client_secret:x.secret,redirect_uri:x.redirect,grant_type:'authorization_code'});
  if(!v.refresh_token)throw issue('لم يُعد Google رمز التحديث؛ أعد التفويض مع الموافقة',401);
  put(row.tenant_id,{access_token:v.access_token,refresh_token:v.refresh_token,expires_at:Date.now()+v.expires_in*1000},'');return row.tenant_id;
 }
 async function access(tenant){const row=get(tenant);if(!row)throw issue('لم يتم ربط Google Drive بهذا المحل',409);let info=decrypt(row.tokens_encrypted);
  if(info.expires_at>Date.now()+60000)return {token:info.access_token,row};
  const x=params(),result=await postToken({client_id:x.id,client_secret:x.secret,refresh_token:info.refresh_token,grant_type:'refresh_token'});
  info={...info,access_token:result.access_token,expires_at:Date.now()+result.expires_in*1000};put(tenant,info,row.folder_id);return {token:info.access_token,row:get(tenant)};
 }
 async function driveFetch(tenant,url,options={}){const {token}=await access(tenant);const r=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,...options.headers}});
  if(!r.ok){const msg=(await r.text()).slice(0,180);throw issue('Google Drive '+r.status+' '+msg,r.status===401?401:502);}return r;
 }
 async function folder(tenant){let {row}=await access(tenant);if(row.folder_id)return row.folder_id;
  const q="name = 'Qatfah_Backup' and mimeType = 'application/vnd.google-apps.folder' and trashed = false";
  let r=await driveFetch(tenant,`${api}/files?q=${encodeURIComponent(q)}&fields=files(id,name)&page_size=100`);let found=(await r.json()).files?.[0];
  if(!found){r=await driveFetch(tenant,`${api}/files`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Qatfah_Backup',mimeType:'application/vnd.google-apps.folder'})});found=await r.json();}
  row=get(tenant);put(tenant,decrypt(row.tokens_encrypted),found.id);return found.id;
 }
 async function upload(tenant,encrypted,filename){if(typeof encrypted!=='string'||encrypted.length<20||Buffer.byteLength(encrypted)>5_000_000)throw issue('النسخة الاحتياطية غير صالحة أو كبيرة',422);
  const json=JSON.parse(encrypted);if(json.format!=='QatfahBackupEnvelope')throw issue('يجب رفع نسخة مشفرة من قطفة فقط',422);
  const parent=await folder(tenant),boundary='qatfah_'+randomBytes(12).toString('hex');const name=String(filename||`Qatfah_${new Date().toISOString().slice(0,10)}.qtf`).replace(/[^\w.-]/g,'_').slice(0,100);
  const meta=JSON.stringify({name,mimeType:'application/octet-stream',parents:[parent]});
  const start=`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`;
  const body=Buffer.concat([Buffer.from(start),Buffer.from(encrypted),Buffer.from(`\r\n--${boundary}--`)]);
  const r=await driveFetch(tenant,`${uploadApi}/files?uploadType=multipart&fields=id,name`,{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});return r.json();
 }
 async function list(tenant){const parent=await folder(tenant),q=`'${parent}' in parents and trashed = false`;
  const r=await driveFetch(tenant,`${api}/files?q=${encodeURIComponent(q)}&fields=files(id,name,createdTime,size,mimeType),nextPageToken&orderBy=createdTime%20desc&pageSize=100`);return (await r.json()).files||[];
 }
 async function download(tenant,id){if(!/^[A-Za-z\d_-]{10,200}$/.test(id))throw issue('معرف النسخة غير صالح',422);
  const parent=await folder(tenant),meta=await driveFetch(tenant,`${api}/files/${encodeURIComponent(id)}?fields=id,name,parents,mimeType`);const m=await meta.json();if(!m.parents?.includes(parent))throw issue('الملف لا ينتمي لنسخ المحل',403);
  const r=await driveFetch(tenant,`${api}/files/${encodeURIComponent(id)}?alt=media`);const buffer=Buffer.from(await r.arrayBuffer());if(buffer.length>5_000_000)throw issue('ملف النسخة أكبر من المسموح',413);return {name:m.name,encrypted:buffer.toString('utf8')};
 }
 function disconnect(tenant){db.prepare('DELETE FROM google_drive_links WHERE tenant_id=?').run(tenant);return {connected:false};}
 return {connected,start,finish,upload,list,download,disconnect};
}
