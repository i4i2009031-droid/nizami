/** Qatfah server: tenant-isolated licence and append-only event synchronization. Node 22+ required. */
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID,randomBytes,scryptSync,createHmac,timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getWhatsappStatus,getWhatsappQr,getWhatsappPairingCode,sendWhatsappMessage,sendWhatsappDocument } from './whatsapp.mjs';
import {cloudSender} from './whatsapp-cloud.mjs';
const cloudDispatch=cloudSender({accounts:process.env.QATFAH_WA_CLOUD_ACCOUNTS||'{}'});
import {googleDrive,driveConfigured} from './google-drive.mjs';
import {validateSimpleJournal,validateCashMovement,validateExchange,validateRemittance,validateAccountTransfer,financialPostings} from '../apps/client/js/money-services.js';
import {prepareEventImport} from '../apps/client/js/storage.js';

const PORT = Number(process.env.QATFAH_PORT || 5059);
const dataDir = resolve(process.env.QATFAH_DATA_DIR || resolve(fileURLToPath(new URL('./data/',import.meta.url))));
const SECRET = process.env.QATFAH_TOKEN_SECRET || '';
const initialPass=process.env.QATFAH_ADMIN_PASSWORD || '';
const adminName=process.env.QATFAH_ADMIN_USER || 'admin';
if (SECRET.length < 32 || initialPass.length < 12) {
 console.error('Set QATFAH_TOKEN_SECRET (min 32 chars) and QATFAH_ADMIN_PASSWORD (min 12 chars).');
 process.exit(1);
}
mkdirSync(dataDir,{recursive:true});
const db = new DatabaseSync(resolve(dataDir,'qatfah.sqlite'));
db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
 CREATE TABLE IF NOT EXISTS users (
   id TEXT PRIMARY KEY, username TEXT NOT NULL UNIQUE COLLATE NOCASE,
   store_name TEXT NOT NULL, pass_hash TEXT NOT NULL, role TEXT NOT NULL,
   phone TEXT NOT NULL DEFAULT '', expires_at TEXT NOT NULL DEFAULT '2099-12-31',
   active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS events (
   seq INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id TEXT NOT NULL, id TEXT NOT NULL,
   type TEXT NOT NULL, payload TEXT NOT NULL, at TEXT NOT NULL,
   received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
   UNIQUE (tenant_id,id)
 );
 CREATE INDEX IF NOT EXISTS idx_events_tenant_seq ON events(tenant_id,seq);`);
const drive=googleDrive(db);

function hashPassword(password){const salt=randomBytes(24).toString('hex');const key=scryptSync(password,salt,64).toString('hex');return salt+':'+key;}
function verifyPassword(password,stored){try{const [salt,key]=stored.split(':'); const a=Buffer.from(key,'hex'),b=scryptSync(password,salt,a.length); return a.length===b.length&&timingSafeEqual(a,b);}catch{return false;}}
function b64(x){return Buffer.from(JSON.stringify(x)).toString('base64url');}
function sign(user){const now=Math.floor(Date.now()/1000);const payload=b64({uid:user.id,role:user.role,iat:now,exp:now+86400});const sig=createHmac('sha256',SECRET).update(payload).digest('base64url');return `${payload}.${sig}`;}
function authenticate(req,required){try{const token=(req.headers.authorization||'').match(/^Bearer (\S+)$/i)?.[1]; if(!token)throw Error('No token');const [data,sig]=token.split('.'); const good=createHmac('sha256',SECRET).update(data).digest('base64url'); const a=Buffer.from(good),b=Buffer.from(sig||''); if(a.length!==b.length||!timingSafeEqual(a,b))throw Error('Signature');const p=JSON.parse(Buffer.from(data,'base64url').toString());if(p.exp<Math.floor(Date.now()/1000))throw Error('Expired');const user=db.prepare('SELECT * FROM users WHERE id=?').get(p.uid);if(!user||!user.active)throw Error('Disabled');if(user.role==='client'&&user.expires_at < new Date().toISOString().slice(0,10))throw Error('Subscription expired');if(required&&user.role!==required)throw Error('Access denied');return user;}catch{throw httpError(401,'UNAUTHORIZED','انتهت الجلسة أو الاشتراك، أو الحساب غير مفعل');}}
function httpError(status,code,message){return Object.assign(new Error(message),{status,code});}
function secureUser(x){return {id:x.id,username:x.username,storeName:x.store_name,role:x.role,phone:x.phone,expiresAt:x.expires_at,active:!!x.active,createdAt:x.created_at};}
function str(v,max=140){return typeof v==='string'?v.trim().slice(0,max):'';}
function validMoney(n,currency='YER'){return typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1e12&&(currency==='YER'?Number.isSafeInteger(n):Math.abs(n*100-Math.round(n*100))<0.00001);}
function assertValidEvent(e){
 const allowed=['party.add','party.update','item.add','item.update','balance.open','invoice.create','receipt.create','payment.create','expense.create','settings.update','event.reverse','journal.create','cash.movement','cash.open','money.exchange','fund.transfer','remittance.issue','remittance.settle'];
 if(!e||!/^[-a-f\d]{16,48}$/i.test(e.id||'')||!allowed.includes(e.type)||typeof e.payload!=='object'||!e.payload||!/^\d{4}-\d\d-\d\dT/.test(e.at||''))throw httpError(422,'EVENT_INVALID','سجل عملية غير صالح');
 const p=e.payload;const currency=p.currency||'YER';
 if(!['YER','USD','SAR'].includes(currency))throw httpError(422,'CURRENCY_INVALID','عملة غير مدعومة');
 if(e.type==='invoice.create'){
   if(!['sale','purchase'].includes(p.kind)||!['cash','credit'].includes(p.payment)||!Array.isArray(p.items)||!p.items.length||p.items.length>80||!validMoney(p.total,currency))throw httpError(422,'INVOICE_INVALID','بيانات الفاتورة غير صالحة');
   const sum=p.items.reduce((s,x)=>s+Number(x.qty)*Number(x.price),0);
   const rounded=currency==='YER'?Math.round(sum):Math.round(sum*100)/100;
   const paid=p.paid??(p.payment==='cash'?p.total:0);
   if(!validMoney(paid,currency)||paid>p.total||(p.payment==='cash'&&paid!==p.total)||(p.payment==='credit'&&!p.partyId))throw httpError(422,'PAID_INVALID','المبلغ المدفوع غير صحيح');
   if(p.items.some(x=>!str(x.title,200)||!(Number(x.qty)>0)||Number(x.qty)>1e6||!validMoney(x.price,currency))||Math.abs(rounded-p.total)>0.00001)throw httpError(422,'INVOICE_TOTAL','الإجمالي لا يطابق الأصناف');
 }else if(['receipt.create','payment.create','expense.create'].includes(e.type)){
   if(!validMoney(p.amount,currency)||p.amount===0)throw httpError(422,'AMOUNT_INVALID','المبلغ غير صالح');
 }else if(e.type==='balance.open'){if(!p.partyId||!['receivable','payable'].includes(p.direction)||!validMoney(p.amount,currency)||p.amount===0)throw httpError(422,'OPENING_INVALID','الرصيد الافتتاحي غير صالح');
 }else if(['item.add','item.update'].includes(e.type)){if(!p.id||!str(p.name,120)||!(p.prices&&typeof p.prices==='object')||Object.entries(p.prices).some(([curr,price])=>!['YER','USD','SAR'].includes(curr)||!validMoney(price,curr)))throw httpError(422,'ITEM_INVALID','بيانات الصنف غير صالحة');
 }else if(['party.add','party.update'].includes(e.type)){
   if(!p.id||!str(p.name))throw httpError(422,'PARTY_INVALID','الاسم مطلوب');
 }else if(e.type==='event.reverse'){
   if(!str(p.ref,48))throw httpError(422,'REVERSE_INVALID','مرجع الإلغاء مفقود');
 }else if(['journal.create','cash.movement'].includes(e.type)){
   try{if(!validMoney(p.amount,currency)||!p.currency)throw Error('المبلغ أو العملة غير صالح');(e.type==='journal.create'?validateSimpleJournal:validateCashMovement)(p);}
   catch(error){throw httpError(422,'ACCOUNTING_INVALID',error.message);}
 }else if(e.type==='cash.open'){
   if(!['cash','bank'].includes(p.account)||!validMoney(p.amount,currency)||p.amount<=0)throw httpError(422,'CASH_OPENING_INVALID','الرصيد الافتتاحي للصندوق غير صالح');
 }else if(['money.exchange','fund.transfer','remittance.issue'].includes(e.type)){
   try{({'money.exchange':validateExchange,'fund.transfer':validateAccountTransfer,'remittance.issue':validateRemittance}[e.type])(p);}
   catch(error){throw httpError(422,'FINANCIAL_INVALID',error.message);}
 }else if(e.type==='remittance.settle'){
   if(!str(p.reference,64)||!str(p.issuedId,48))throw httpError(422,'SETTLEMENT_INVALID','مرجع الحوالة غير صالح');
 }
 if(JSON.stringify(e).length>220000)throw httpError(413,'EVENT_TOO_LARGE','حجم العملية كبير');
}
if(!db.prepare("SELECT id FROM users WHERE role='admin' LIMIT 1").get()){
 db.prepare('INSERT INTO users(id,username,store_name,pass_hash,role,active) VALUES(?,?,?,?,?,1)').run(randomUUID(),adminName,'إدارة قطفة',hashPassword(initialPass),'admin');
 console.log('Bootstrap admin created:',adminName);
}
const loginAttempts=new Map();
function allowLogin(ip){const now=Date.now(),v=loginAttempts.get(ip)||[];const fresh=v.filter(x=>now-x<600000);fresh.push(now);loginAttempts.set(ip,fresh);return fresh.length<=12;}
async function bodyJson(req,maxBytes=1_500_000){return new Promise((ok,fail)=>{let length=0,chunks=[];req.on('data',buf=>{length+=buf.length;if(length>maxBytes){fail(httpError(413,'PAYLOAD_TOO_BIG','الطلب كبير'));req.destroy();return;}chunks.push(buf);});req.on('end',()=>{try{ok(chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{});}catch{fail(httpError(400,'BAD_JSON','JSON غير صالح'));}});req.on('error',fail);});}
function response(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(data));}
const adminList=db.prepare('SELECT * FROM users WHERE role=\'client\' ORDER BY created_at DESC');
function ensureAdmin(req){return authenticate(req,'admin');}
function ensureClient(req){return authenticate(req,'client');}
function newCustomer(body){
 const username=str(body.username,50).toLowerCase(),store=str(body.storeName,120),phone=str(body.phone,30),pass=body.password;
 if(!/^[a-z0-9_.-]{3,50}$/i.test(username)||!store||typeof pass!=='string'||pass.length<8)throw httpError(422,'USER_INVALID','الاسم أو كلمة المرور غير صالحة');
 const expires=str(body.expiresAt,10)||'2099-12-31';if(!/^\d{4}-\d{2}-\d{2}$/.test(expires))throw httpError(422,'DATE_INVALID','تاريخ الاشتراك غير صالح');
 const id=randomUUID();
 try{db.prepare('INSERT INTO users(id,username,store_name,pass_hash,role,phone,expires_at,active) VALUES(?,?,?,?,?,?,?,?)').run(id,username,store,hashPassword(pass),'client',phone,expires,body.active===false?0:1);}catch(e){if(String(e).includes('UNIQUE'))throw httpError(409,'USERNAME_EXISTS','اسم المستخدم مستخدم مسبقا');throw e;}
 return secureUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}
function updateCustomer(id,body){const old=db.prepare("SELECT * FROM users WHERE id=? AND role='client'").get(id);if(!old)throw httpError(404,'NOT_FOUND','لم يتم العثور على الحساب');
 const store=body.storeName===undefined?old.store_name:str(body.storeName,120),phone=body.phone===undefined?old.phone:str(body.phone,30),expires=body.expiresAt===undefined?old.expires_at:str(body.expiresAt,10),active=body.active===undefined?old.active:body.active?1:0;
 if(!store||!/^\d{4}-\d\d-\d\d$/.test(expires))throw httpError(422,'INVALID_FIELD','بيانات الحساب غير صالحة');
 const password=(typeof body.password==='string'&&body.password.length>0)?body.password:null;
 if(password&&password.length<8)throw httpError(422,'WEAK_PASSWORD','كلمة المرور قصيرة');
 db.prepare('UPDATE users SET store_name=?,phone=?,expires_at=?,active=?,pass_hash=? WHERE id=?').run(store,phone,expires,active,password?hashPassword(password):old.pass_hash,id);
 return secureUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}
export function createApp(){return createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET, POST, PATCH, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Authorization, Content-Type');
  res.setHeader('Vary','Origin');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  try{
   const url=new URL(req.url,'http://localhost');const path=url.pathname;
   if(req.method==='GET'&&path==='/api/health'){response(res,200,{ok:true,service:'qatfah',version:'0.2.0',driveConfigured:driveConfigured()});return;}
   if(req.method==='GET'&&path==='/api/google/callback'){if(!url.searchParams.get('code'))throw httpError(400,'OAUTH_DENIED','لم يتم منح تفويض Google Drive');await drive.finish(url.searchParams.get('code'),url.searchParams.get('state'));res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Frame-Options':'DENY'});res.end(`<html lang="ar" dir="rtl"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>قطفة - Google Drive</title><body style="font:18px Tahoma;text-align:center;padding:60px 15px"><h1>✓ تم ربط Google Drive بنجاح</h1><p>يمكنك العودة إلى تطبيق قطفة والضغط على تحديث الحالة.</p></body></html>`);return;}
   if(req.method==='POST'&&path==='/api/auth/login'){
     if(!allowLogin(req.socket.remoteAddress||''))throw httpError(429,'RATE_LIMIT','محاولات دخول كثيرة، أعد المحاولة لاحقا');
     const b=await bodyJson(req);const user=db.prepare('SELECT * FROM users WHERE username=? COLLATE NOCASE').get(str(b.username,50));
     if(!user||typeof b.password!=='string'||!verifyPassword(b.password,user.pass_hash))throw httpError(401,'LOGIN_FAILED','اسم المستخدم أو كلمة المرور غير صحيح');
     if(!user.active)throw httpError(403,'ACCOUNT_DISABLED','الحساب موقوف');
     if(user.role==='client'&&user.expires_at<new Date().toISOString().slice(0,10))throw httpError(403,'SUBSCRIPTION_EXPIRED','انتهى الاشتراك');
     response(res,200,{token:sign(user),user:secureUser(user),serverTime:new Date().toISOString()});return;
   }
   if(req.method==='GET'&&path==='/api/auth/me'){const user=authenticate(req);response(res,200,{user:secureUser(user),token:sign(user),serverTime:new Date().toISOString()});return;}
   if(req.method==='GET'&&path==='/api/admin/users'){ensureAdmin(req);response(res,200,{users:adminList.all().map(secureUser)});return;}
   if(req.method==='POST'&&path==='/api/admin/users'){ensureAdmin(req);response(res,201,{user:newCustomer(await bodyJson(req))});return;}
   if(req.method==='PATCH'&&/^\/api\/admin\/users\/[-a-zA-Z0-9]+$/.test(path)){
     ensureAdmin(req);const id=path.split('/').pop();response(res,200,{user:updateCustomer(id,await bodyJson(req))});return;
   }
   if(req.method==='POST'&&path==='/api/sync/push'){
     const user=ensureClient(req),b=await bodyJson(req);if(!Array.isArray(b.events)||b.events.length>100)throw httpError(422,'INVALID_BATCH','الحزمة غير صالحة');
     for(const e of b.events)assertValidEvent(e);
     const insert=db.prepare('INSERT OR IGNORE INTO events (tenant_id,id,type,payload,at) VALUES(?,?,?,?,?)');
     db.exec('BEGIN IMMEDIATE');try{
       const existing=db.prepare('SELECT id,type,payload,at FROM events WHERE tenant_id=? ORDER BY seq').all(user.id).map(row=>({...row,payload:JSON.parse(row.payload)}));
       let additions;
       try{additions=prepareEventImport(existing,b.events);financialPostings([...existing,...additions]);}
       catch(error){throw httpError(422,'ACCOUNTING_CONFLICT',error.message);}
       for(const e of additions)insert.run(user.id,e.id,e.type,JSON.stringify(e.payload),e.at);db.exec('COMMIT');
     }catch(err){db.exec('ROLLBACK');throw err;}
     response(res,200,{ok:true,acceptedIds:b.events.map(e=>e.id)});return;
   }
   if(req.method==='GET'&&path==='/api/sync/pull'){
     const user=ensureClient(req),after=Math.max(0,Number(url.searchParams.get('after'))||0);
     const rows=db.prepare('SELECT seq,id,type,payload,at FROM events WHERE tenant_id=? AND seq>? ORDER BY seq ASC LIMIT 250').all(user.id,after);
     response(res,200,{events:rows.map(r=>({seq:r.seq,id:r.id,type:r.type,payload:JSON.parse(r.payload),at:r.at})),cursor:rows.length?rows.at(-1).seq:after,hasMore:rows.length===250});return;
   }
   if(req.method==='GET'&&path==='/api/drive/status'){const user=ensureClient(req);response(res,200,drive.connected(user.id));return;}
   if(req.method==='POST'&&path==='/api/drive/start'){const user=ensureClient(req);response(res,200,drive.start(user.id));return;}
   if(req.method==='POST'&&path==='/api/drive/upload'){const user=ensureClient(req),b=await bodyJson(req,8_000_000);response(res,200,await drive.upload(user.id,b.encrypted,b.filename));return;}
   if(req.method==='GET'&&path==='/api/drive/backups'){const user=ensureClient(req);response(res,200,{files:await drive.list(user.id)});return;}
   if(req.method==='GET'&&path.startsWith('/api/drive/backups/')){const user=ensureClient(req);response(res,200,await drive.download(user.id,path.split('/').pop()));return;}
   if(req.method==='POST'&&path==='/api/drive/disconnect'){const user=ensureClient(req);response(res,200,drive.disconnect(user.id));return;}
   if(path.startsWith('/api/whatsapp/')){
     const user=ensureClient(req),tenant=user.id;
     if(req.method==='GET'&&path==='/api/whatsapp/status'){response(res,200,{status:await getWhatsappStatus(tenant)});return;}
     if(req.method==='GET'&&path==='/api/whatsapp/qr'){response(res,200,await getWhatsappQr(tenant));return;}
     if(req.method==='POST'&&path==='/api/whatsapp/pair'){const b=await bodyJson(req);response(res,200,await getWhatsappPairingCode(tenant,str(b.phone,18)));return;}
     if(req.method==='POST'&&path==='/api/whatsapp/send-document'){const b=await bodyJson(req,8_000_000);const input={tenantId:tenant,phone:str(b.phone,18),filename:str(b.filename,120),base64:b.base64,caption:str(b.caption,500)};const result=await cloudDispatch(input);response(res,200,result.status==='unavailable'?await sendWhatsappDocument(tenant,input.phone,input.filename,input.base64,input.caption):result);return;}
     if(req.method==='POST'&&path==='/api/whatsapp/send'){const b=await bodyJson(req);response(res,200,await sendWhatsappMessage(tenant,str(b.phone,18),str(b.text,5000)));return;}
   }
   throw httpError(404,'NOT_FOUND','المسار غير موجود');
  }catch(error){const status=error.status||500;if(status===500)console.error('Request error:',error);if(!res.headersSent)response(res,status,{error:error.code||'SERVER_ERROR',message:status===500?'خطأ غير متوقع في الخادم':error.message});}
 });}
if(process.env.NODE_ENV!=='test')createApp().listen(PORT,'0.0.0.0',()=>console.log('Qatfah API listening',PORT));
