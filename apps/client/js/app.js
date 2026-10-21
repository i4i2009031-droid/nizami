import {setTenant,allEvents,putEvent,importEvents,commitEvents} from './storage.js';
import {money,dateOnly,activeRecords,parties,itemsCatalog,currentSettings,statement,summary,summaryByCurrency,groupedSummary,describeEvent,CURRENCIES,rounded,balanceDescription} from './ledger.js';
import {makePdf,makeInvoicePdf,downloadBlob,sharePdf} from './pdf.js';
import {buildPortableBackup,parsePortableBackup,backupFileName} from './backup.js';
import {authenticate,readRegistry,isSubscriptionActive} from './subscription.js';
import {persistSessionObject,readSessionObject,clearSessionObject} from './session.js';
import {createMoneyDesk} from './money-ui.js';
import {accountBalances,financialPostings,fromMinor} from './money-services.js';
import {createWhatsappSession,createWhatsappPairing,createWhatsappSender,whatsappSendMessage,whatsappSendProgressMessage,whatsappSendDetails,normalizeYemenPhone,latinPhoneDigits} from './whatsapp-session.js';
import {createEventBatch,invoiceEventEntries} from './event-batch.js';

const $=id=>document.getElementById(id),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const toast=message=>{const e=$('toast');e.textContent=message;e.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>e.classList.remove('show'),3300);};
const localDate=()=>dateOnly(new Date().toISOString());
let state={session:null,events:[],screen:'home'};
let waPollBusy=false;
let waStorage;try{waStorage=window.localStorage;}catch{}
const waSession=createWhatsappSession({storage:waStorage,host:window,online:navigator.onLine});
let waAuthMode=waSession.snapshot().linked?'connected':'qr';
const waSend=createWhatsappSender({getPlugin:()=>window.Capacitor?.Plugins?.QatfahNative,isOnline:()=>navigator.onLine,onProgress:value=>showWaSendProgress(whatsappSendProgressMessage(value))});
waSession.subscribe(value=>{const root=$('wa-engine-root');if(root)root.dataset.linked=String(value.linked);renderWhatsappBadge();});
const icons={
 sale:'<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
 purchase:'<path d="M3 5h2l2 11h11l3-8H7"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
 cash:'<rect x="3" y="5" width="18" height="14" rx="3"/><circle cx="12" cy="12" r="3"/><path d="M6 9h1M17 15h1"/>',
 parties:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 6"/>',
 suppliers:'<path d="M3 10l9-6 9 6v10H3zM7 20v-7h10v7M3 10h18"/>',
 receipt:'<path d="M5 3h14v18l-3-2-4 2-4-2-3 2zM8 8h8M8 12h8M12 6v10"/>',
 payment:'<path d="M3 7h18v11H3zM3 10h18M7 15h4"/>',
 expense:'<circle cx="12" cy="12" r="9"/><path d="m9 9 6 6M15 9l-6 6"/>',
 statement:'<path d="M4 3h16v18H4zM8 8h8M8 12h8M8 16h5"/>',
 reports:'<path d="M5 20V9M10 20V4M15 20v-7M20 20V7M3 20h19"/>',
 whatsapp:'<path d="M21 11.5a9 9 0 0 1-13.3 7.9L3 21l1.6-4.7A9 9 0 1 1 21 11.5Z"/><path d="M8 9c1 4 4 6 8 7l1-2-3-1-1 1c-1-1-2-2-3-3l1-1-1-3z"/>',
 backup:'<path d="M6 19a5 5 0 0 1 0-10 7 7 0 0 1 13.3 1A5 5 0 0 1 18 20H8M12 11v8m-3-3 3 3 3-3"/>',
 items:'<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M8 9h8M8 14h8"/>',
 daily:'<path d="M4 4h16v16H4zM8 2v5M16 2v5M4 9h16M8 14h2"/>',
 settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M4.93 4.93l2.12 2.12m9.9 9.9 2.12 2.12m0-14.14-2.12 2.12M7.05 16.95l-2.12 2.12"/>'
};
const svg=path=>`<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${icons[path]||icons.sale}</svg>`;
const shortcuts=[
 ['sales','فاتورة مبيعات','sale','tile-green'],['purchases','فاتورة مشتريات','purchase','tile-blue'],['daily-sales','مبيعات يومية','daily','tile-cyan'],['cashbook','حركة الصندوق','cash','tile-violet'],
 ['customer','إضافة عميل','parties','tile-amber'],['supplier','إضافة مورد','suppliers','tile-cyan'],['items','الأصناف','items','tile-violet'],['receipts','سند قبض','receipt','tile-rose'],
 ['payments','سند صرف','payment','tile-indigo'],['expenses','مصروفات','expense','tile-orange'],['statements','كشف حساب','statement','tile-lime'],
 ['reports','التقارير','reports','tile-deep'],['money-services','الصرافة والحوالات','cash','tile-indigo'],['whatsapp','واتساب','whatsapp','tile-green'],['backup','نسخ احتياطي','backup','tile-purple'],
 ['settings','الإعدادات','settings','tile-slate']
];
function getParty(id){return parties(state.events).find(p=>p.id===id)||null;}
function store(){return currentSettings(state.events);}
function sessionValidOffline(s){const age=Date.now()-s?.lastChecked;return !!s&&['github','demo'].includes(s.mode)&&isSubscriptionActive({...s.user,active:true})&&Number.isFinite(age)&&age>=0&&age<=7*86400000;}
async function initial(){
 const saved=readSessionObject();
 if(sessionValidOffline(saved)){await activate(saved);if(navigator.onLine&&saved.mode==='github')checkSubscription().catch(()=>{});}else{clearSessionObject();$('login-screen').hidden=false;}
 updateClock();setInterval(updateClock,14000);
 window.addEventListener('online',()=>{setNetworkBadge();if(state.session?.mode==='github')checkSubscription().catch(()=>{});});window.addEventListener('offline',setNetworkBadge);
 if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
 setInterval(()=>{if(state.session?.mode==='github'&&navigator.onLine)checkSubscription().catch(()=>{});},300000);
 setInterval(pollWhatsappConnection,8000);
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)pollWhatsappConnection().catch(()=>{});});
}
async function activate(session){state.session=session;setTenant(session.user.id||'demo');state.events=await allEvents();$('login-screen').hidden=true;$('app-shell').hidden=false;render();pollWhatsappConnection().catch(()=>{});if(session.mode==='github'&&navigator.onLine)checkSubscription().catch(()=>{}); }
function persistSession(){if(state.session)persistSessionObject(state.session);}
async function checkSubscription(){const session=state.session;if(session?.mode!=='github'||!navigator.onLine)return;try{const users=await readRegistry();if(state.session!==session)return;const account=users.find(x=>x.id===session.user.id);if(!isSubscriptionActive(account)){toast('تم إيقاف اشتراكك أو انتهى؛ تواصل مع الإدارة');logout(true);return;}session.user.expiresAt=account.expiresAt;session.lastChecked=Date.now();persistSession();}catch(e){console.warn('Registry temporarily unavailable',e);}}
function updateClock(){const d=new Date();$('live-time').textContent=d.toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit',hour12:false});let hi=d.getHours()<12?'صباح الخير':'مساء الخير';document.querySelector('.hi').textContent=hi+' 👋';}
function renderWhatsappBadge(){
 const pill=$('wa-pill');if(!pill)return;
 const current=waSession.snapshot();
 const connected=current.linked&&current.transportReady&&navigator.onLine;
 const label=connected?'واتساب متصل بجميع أقسام قطفة':current.linked?(navigator.onLine?'واتساب مرتبط · الجلسة محفوظة':'واتساب مرتبط · دون إنترنت'):current.status==='unavailable'?'واتساب متاح في تطبيق أندرويد':'واتساب غير مرتبط';
 pill.classList.toggle('connected',connected);
 pill.innerHTML='<i class="pulse wa"></i> '+label;
}
async function pollWhatsappConnection(){
 if(!state.session||waPollBusy)return;
 const native=window.Capacitor?.Plugins?.QatfahNative;
 if(!native?.whatsappConnectionStatus){waSession.applyNative({status:'unavailable',transportReady:false});return;}
 waPollBusy=true;
 try{waSession.applyNative(await native.whatsappConnectionStatus());}
 catch{waSession.applyNative({status:'unknown',transportReady:false});}
 finally{waPollBusy=false;renderWhatsappBadge();}
}
function setNetworkBadge(){
 const pill=$('server-pill');pill.classList.remove('connected');pill.innerHTML='<i class="pulse"></i> الدفتر محفوظ على الجهاز';
 waSession.setOnline(navigator.onLine);
}
async function record(type,payload){const e={id:crypto.randomUUID(),type,payload,at:new Date().toISOString(),synced:true};await putEvent(e);state.events=await allEvents();render();toast('تم حفظ العملية على الجهاز ✓');return e;}
async function recordBatch(entries){const events=createEventBatch(entries);await commitEvents(events);state.events=await allEvents();render();toast('تم حفظ العملية على الجهاز ✓');return events;}
function render(){if(!state.session)return;const p=store();$('store-name').textContent=p.name||state.session.user.storeName||'قطفة';$('store-subtitle').textContent=state.session.mode==='demo'?'دفتر حسابات محلي':'دفتر حسابات المحل';$('store-logo').src=p.logo||'./assets/icon-192.png';setNetworkBadge();document.querySelectorAll('[data-nav]').forEach(x=>x.classList.toggle('active',x.dataset.nav===state.screen));$('home-page').hidden=state.screen!=='home';$('content-page').hidden=state.screen==='home';if(state.screen==='home')renderHome();else if(state.screen==='invoices')renderInvoices();else if(state.screen==='parties')renderParties();else if(state.screen==='reports')renderReports();else renderSettings();}
function setScreen(page){if($('wa-root-pair'))closeSheet();state.screen=page;render();window.scrollTo({top:0,behavior:'smooth'});}
function renderHome(){const s=summary(state.events),cashYER=accountBalances(state.events).YER.cash,today=summary(state.events,localDate(),localDate());const recent=activeRecords(state.events).filter(e=>!['settings.update','party.add'].includes(e.type)).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,5),people=parties(state.events);
 $('home-page').innerHTML=`
 <section class="balance-card"><small>رصيد صندوق الريال اليمني (يشمل الصرافة والحوالات)</small><strong class="big-number">${money(cashYER)}</strong>
 <div class="balance-sub"><div><small>مبيعات اليوم (يمني)</small><strong>${money(today.sales)}</strong></div><div><small>مشتريات اليوم (يمني)</small><strong>${money(today.purchases)}</strong></div></div></section><div class="currency-strip">${summaryByCurrency(state.events,localDate(),localDate()).map(x=>`<div><small>${x.currency}</small><strong>${money(x.sales,x.currency)}</strong></div>`).join('')}</div>
 <div class="section-title"><h2>الخدمات الرئيسية</h2><span class="chip">${shortcuts.length} خدمة</span></div>
 <div class="app-grid">${shortcuts.map(([action,title,ico,col])=>`<button class="app-tile" data-action="${action}"><span class="tile-icon ${col}">${svg(ico)}</span><b>${title}</b></button>`).join('')}</div>
 <div class="section-title"><h2>آخر العمليات</h2><button class="text-button" data-nav-open="invoices">عرض الكل ←</button></div>
 <div class="recent-list">${recent.length?recent.map(e=>{const d=describeEvent(e,people);return `<div class="recent-item"><span class="recent-icon ${['expense.create','payment.create'].includes(e.type)?'expense':''}">${['invoice.create'].includes(e.type)?'▤':'↔'}</span><div class="recent-info"><b>${esc(d.title)} · ${esc(d.sub)}</b><small>${dateOnly(e.at)}</small></div><span class="recent-number">${money(d.amount,d.currency)}</span></div>`;}).join(''):'<div class="empty"><span class="emoji">🧾</span>لا توجد عمليات بعد. ابدأ بإنشاء فاتورة.</div>'}</div>
 `;}
function renderInvoices(){const p=parties(state.events),records=activeRecords(state.events).filter(e=>['invoice.create','receipt.create','payment.create','expense.create'].includes(e.type)).sort((a,b)=>b.at.localeCompare(a.at));
 $('content-page').innerHTML=`<div class="content-header"><div><h2>الفواتير والعمليات</h2><small>كل الحركات المسجلة في دفتر المحل</small></div><button class="fab" data-action="sales">+ فاتورة</button></div>
 <div class="filters"><select id="entry-filter"><option value="all">كل العمليات</option><option value="invoice.create">الفواتير</option><option value="receipt.create">القبض</option><option value="payment.create">الصرف</option><option value="expense.create">المصروفات</option></select></div>
 <div id="entries-list">${records.map(e=>invoiceCard(e,p)).join('')||'<div class="empty">لا توجد فواتير بعد</div>'}</div>`;
 $('entry-filter').addEventListener('change',ev=>{$('entries-list').innerHTML=records.filter(e=>ev.target.value==='all'||e.type===ev.target.value).map(e=>invoiceCard(e,p)).join('')||'<div class="empty">لا توجد نتائج</div>';});}
function invoiceCard(e,p){const d=describeEvent(e,p);return `<article class="flat-card"><div class="record-head"><div><b>${esc(d.title)} · ${esc(d.sub)}</b><small>${dateOnly(e.at)} · #${esc(e.id.slice(0,8))}</small></div><div><div class="record-amount">${money(d.amount,d.currency)}</div><span class="record-badge">${e.type==='invoice.create'?(e.payload.payment==='credit'?'آجل':'نقدي'):'مسجل'}</span></div></div><div class="actions-inline"><button class="action-link" data-event="pdf:${e.id}">PDF</button><button class="action-link" data-event="share:${e.id}">واتساب</button><button class="action-link" data-event="reverse:${e.id}">إلغاء</button></div></article>`;}
function renderParties(){const list=parties(state.events);$('content-page').innerHTML=`<div class="content-header"><div><h2>حسابات العملاء والموردين</h2><small>حسابات له وعليه والرصيد الجاري</small></div><button class="fab" data-action="customer">+ حساب</button></div><input id="people-filter" placeholder="بحث باسم العميل أو المورد..." style="margin-bottom:13px"/><div id="people-list">${partyCards(list)}</div>`;$('people-filter').addEventListener('input',e=>{$('people-list').innerHTML=partyCards(list.filter(x=>x.name.includes(e.target.value)||x.phone?.includes(e.target.value)));});}
function partyCards(list){return list.map(x=>{
 const details=Object.keys(CURRENCIES).map(currency=>{const b=statement(state.events,x.id,'0000-01-01','9999-12-31',currency),balance=balanceDescription(b.closing,currency);return `<span class="balance-currency" style="color:${balance.side==='debit'?'#b42318':balance.side==='credit'?'#137a4b':'#64748b'}">${currency}: <b>${money(balance.amount,currency)}</b> <small>${esc(balance.label)}</small></span>`;}).join('');
 return `<div class="flat-card"><div class="record-head"><div><b>${esc(x.name)}</b><small>${x.type==='supplier'?'مورد':'عميل'} • ${esc(x.phone?'+'+x.phone:'لا يوجد رقم')}</small></div><button class="action-link" data-action="editparty:${x.id}">✎ تعديل</button></div><div class="party-balances">${details}</div><div class="actions-inline"><button class="action-link" data-action="statement:${x.id}">كشف حساب</button><button class="action-link" data-action="receipts:${x.id}">سند قبض</button><button class="action-link" data-action="payments:${x.id}">سند صرف</button></div></div>`;
 }).join('')||'<div class="empty"><span class="emoji">👥</span>لم تُضف أي حساب بعد</div>';}
function renderReports(){
 const today=localDate(),month=today.slice(0,7)+'-01';
 $('content-page').innerHTML=`<div class="content-header"><div><h2>التقارير المالية</h2><small>مبيعات يومية وشهرية وسنوية لكل عملة</small></div><button class="fab" id="print-report">▤ PDF</button></div><section class="flat-card"><div class="grid-two"><label>من تاريخ<input id="date-from" type="date" value="${month}"/></label><label>إلى تاريخ<input id="date-to" type="date" value="${today}"/></label></div><div class="grid-two"><label>تجميع التقرير<select id="group-mode"><option value="day">يومي</option><option value="month">شهري</option><option value="year">سنوي</option></select></label><label>عملة التقرير<select id="report-currency">${Object.entries(CURRENCIES).map(([k,c])=>`<option value="${k}">${esc(c.label)}</option>`).join('')}</select></label></div><div class="foot-actions"><button class="btn btn-primary" id="refresh-report">عرض التقرير</button><button class="btn btn-light" id="report-wa">واتساب</button><button class="btn btn-light" data-action="daily-sales">مبيعات اليوم</button></div></section><div id="report-results"></div><p class="footer-warning">لا تدمج العملات المختلفة دون تسجيل سعر الصرف. نتيجة النشاط المعروضة تقديرية وليست صافي الربح المحاسبي النهائي حتى احتساب تكلفة البضاعة والمخزون.</p>`;
 $('refresh-report').onclick=showReport;$('print-report').onclick=()=>reportPdf(true).catch(x=>toast(x.message));$('report-wa').onclick=async()=>{const button=$('report-wa');button.disabled=true;try{await reportPdf('whatsapp');}catch(x){toast(x.message);}finally{button.disabled=false;}};showReport();
}
function reportData(){return {from:$('date-from').value,to:$('date-to').value,group:$('group-mode').value,currency:$('report-currency').value};}
function showReport(){
 const {from,to,group,currency}=reportData();if(!from||!to||from>to)return toast('تحقق من تاريخ البداية والنهاية');const x=summary(state.events,from,to,currency),list=groupedSummary(state.events,from,to,group,currency);
 $('report-results').innerHTML=`<div class="summary-boxes">${[['المبيعات',x.sales,'positive'],['المشتريات',x.purchases,''],['المصروفات',x.expenses,'negative'],['حركة الصندوق',x.cashMovement,'positive'],['سندات قبض',x.receipts,''],['سندات صرف',x.payments,''],['نتيجة تقديرية',x.tradingEstimate,'positive'],['عدد العمليات',x.count,'']].map(([title,n,cls])=>`<div class="summary-box ${cls}"><small>${title}</small><b>${title==='عدد العمليات'?n:money(n,currency)}</b></div>`).join('')}</div><div class="flat-card table-scroll"><table class="report-table"><thead><tr><th>الفترة</th><th>المبيعات</th><th>المشتريات</th><th>المصروفات</th></tr></thead><tbody>${list.map(r=>`<tr><td>${r.period}</td><td>${money(r.sales,currency)}</td><td>${money(r.purchases,currency)}</td><td>${money(r.expenses,currency)}</td></tr>`).join('')||'<tr><td colspan="4">لا توجد عمليات</td></tr>'}</tbody></table></div>`;
}
async function reportPdf(share){
 const {from,to,group,currency}=reportData();if(!from||!to||from>to)throw Error('تحقق من تاريخ البداية والنهاية');
 const source=$('report-results'),list=groupedSummary(state.events,from,to,group,currency),s=summary(state.events,from,to,currency),info=store();
 const blob=await makePdf({title:'التقرير المالي',brand:info.name,logo:info.logo,contact:info.phone,address:info.address,currency,meta:[`الفترة ${from} — ${to}`,`العملة: ${CURRENCIES[currency].label}`,`عدد العمليات: ${s.count}`],columns:['الفترة','المبيعات','المشتريات','المصروفات'],rows:list.map(x=>[x.period,money(x.sales,currency),money(x.purchases,currency),money(x.expenses,currency)]),footer:`المبيعات ${money(s.sales,currency)} • المشتريات ${money(s.purchases,currency)} • المصروفات ${money(s.expenses,currency)}`});
 const filename=`Qatfah-report-${from}-${to}-${currency}.pdf`;
 if(share==='whatsapp'){if(source.isConnected)openWhatsappRecipient({blob,filename,caption:`التقرير المالي من ${info.name} • ${from} — ${to} • ${currency}`});return;}
 return share?sharePdf(blob,filename):downloadBlob(blob,filename);
}

function renderSettings(){const p=store();$('content-page').innerHTML=`<div class="content-header"><div><h2>الإعدادات</h2><small>هوية المحل والمزامنة والنسخ الاحتياطي</small></div></div><section class="flat-card"><div class="row"><img class="settings-avatar" src="${esc(p.logo||'./assets/icon-192.png')}" alt="شعار المحل"/><div><h3 style="margin-bottom:3px">${esc(p.name)}</h3><p class="muted" style="margin:0;font-size:11px">${esc(p.address||'اليمن')}</p></div></div><div class="setting-item"><span>تخصيص المحل والفواتير</span><button class="text-button" data-action="profile">تعديل ←</button></div><div class="setting-item"><span>سجل الأصناف والأسعار</span><button class="text-button" data-action="items">فتح ←</button></div><div class="setting-item"><span>النسخ الاحتياطي وGoogle Drive</span><button class="text-button" data-action="backup">فتح ←</button></div><div class="setting-item"><span>واتساب والربط</span><button class="text-button" data-action="whatsapp">الإدارة ←</button></div><div class="setting-item"><span>العمل محليًا دون خادم</span><small>مفعّل ✓</small></div><div class="setting-item"><span>الحساب الحالي</span><small>${esc(state.session.user.username||'دفتر محلي')}</small></div></section><button class="btn btn-danger btn-block" data-action="logout">تسجيل الخروج</button><div class="footer-warning">العمليات محفوظة على هذا الجهاز. احفظ نسخة JSON عبر منتقي ملفات أندرويد بصورة دورية؛ النسخة غير مشفرة وقد تحتوي بيانات مالية خاصة.</div>`;}
const showSheet=(title,html)=>{stopWaPairingPolling();$('sheet').classList.remove('invoice-view');$('sheet-title').textContent=title;$('sheet-body').innerHTML=html;$('sheet-backdrop').hidden=false;document.body.style.overflow='hidden';};
const closeSheet=()=>{stopWaPairingPolling();$('sheet').classList.remove('invoice-view');$('sheet-backdrop').hidden=true;document.body.style.overflow='';$('sheet-body').innerHTML='';};
const partyOptions=(chosen='')=>parties(state.events).map(p=>`<option value="${p.id}" ${p.id===chosen?'selected':''}>${esc(p.name)} (${p.type==='supplier'?'مورد':'عميل'})</option>`).join('');
function openParty(type='customer',id=''){
 const old=id?getParty(id):null;
 const digits=latinPhoneDigits(old?.phone||'').replace(/\D/g,'').replace(/^967/,'').replace(/^0/,'');
 showSheet(old?'تعديل بيانات الحساب':type==='supplier'?'إضافة مورد':'إضافة عميل',`<form id="party-form" class="sheet-form pro-account-form">
 <label>اسم الشخص أو المحل<input name="name" required maxlength="110" value="${esc(old?.name||'')}" placeholder="اسم العميل أو المورد" /></label>
 <label>رقم الجوال اليمني<div class="phone-field"><span class="code-country" dir="ltr">🇾🇪 +967</span><input name="phone" type="tel" inputmode="numeric" dir="ltr" maxlength="9" value="${esc(digits)}" placeholder="7XXXXXXXX"/></div></label>
 <label>العنوان<input name="address" maxlength="140" value="${esc(old?.address||'')}" placeholder="المحافظة والمدينة"/></label>
 <label>النوع<select name="type"><option value="customer" ${(old?.type||type)==='customer'?'selected':''}>عميل</option><option value="supplier" ${(old?.type||type)==='supplier'?'selected':''}>مورد</option></select></label>
 <label>الرصيد الافتتاحي (اختياري)<input name="opening" type="number" min="0" step="0.01" placeholder="0" ${old?'disabled':''}/></label>
 <div class="hint">عليه = مبلغ مستحق للمحل عند العميل. له = مبلغ مستحق للعميل أو المورد على المحل. لكل عملة رصيد مستقل.</div>
 <div class="grid-two"><label>جهة الرصيد<select name="direction" ${old?'disabled':''}><option value="receivable">عليه (لصالح المحل)</option><option value="payable">له (على المحل)</option></select></label><label>العملة<select name="currency">${Object.entries(CURRENCIES).map(([k,c])=>`<option value="${k}">${esc(c.label)}</option>`).join('')}</select></label></div>
 <button type="submit" class="btn btn-primary">${old?'حفظ التعديلات':'إضافة الحساب'}</button></form>`);
 let savingParty=false;
 $('party-form').onsubmit=async e=>{
  e.preventDefault();if(savingParty)return;const form=e.target,f=new FormData(form),raw=String(f.get('phone')||'').trim();
  let phone='';try{if(raw)phone=normalizeYemenPhone(raw);}catch(err){return toast(err.message);}
  const obj={id:old?.id||crypto.randomUUID(),name:String(f.get('name')).trim(),phone,address:String(f.get('address')||''),type:f.get('type')};
  if(!obj.name)return toast('أدخل الاسم');
  const currency=String(f.get('currency')),rawAmount=Number(f.get('opening')||0);
  if(!CURRENCIES[currency]||!Number.isFinite(rawAmount)||rawAmount<0||rawAmount>1e12)return toast('تحقق من الرصيد الافتتاحي والعملة');
  const amount=rounded(rawAmount,currency),batch=[{type:old?'party.update':'party.add',payload:obj}];
  if(!old&&amount>0)batch.push({type:'balance.open',payload:{partyId:obj.id,amount,direction:f.get('direction'),currency}});
  const button=form.querySelector('[type="submit"]');savingParty=true;button.disabled=true;
  try{await recordBatch(batch);if(form.isConnected)closeSheet();toast('تم حفظ الحساب وأصبح متاحًا في جميع الأقسام');}
  catch(err){toast('لم يُحفظ الحساب: '+err.message);}finally{savingParty=false;button.disabled=false;}
 };
 bindYemenPhoneInput($('party-form').elements.phone);
}
function openItems(){
 const list=itemsCatalog(state.events);
 showSheet('الأصناف والخدمات',`<div class="hint">أضف الأصناف مرة واحدة لتظهر تلقائيًا في المبيعات والمشتريات. يمكن حفظ السعر لكل عملة بصورة مستقلة.</div>
 <div class="list-card">${list.map(p=>`<div class="data-row"><div><b>${esc(p.name)}</b><small style="display:block;color:#92a0ae">${esc(p.unit||'وحدة')} • ${esc(p.barcode||'بدون باركود')}</small></div><button class="action-link" data-edit-item="${esc(p.id)}">تعديل</button></div>`).join('')||'<div class="empty">لا توجد أصناف حتى الآن</div>'}</div>
 <div class="foot-actions"><button class="btn btn-primary" id="new-item">＋ إضافة صنف</button></div>`);
 $('new-item').onclick=()=>openItemForm();
 document.querySelectorAll('[data-edit-item]').forEach(x=>x.onclick=()=>openItemForm(x.dataset.editItem));
}
function openItemForm(id=''){
 const old=itemsCatalog(state.events).find(p=>p.id===id);
 showSheet(old?'تعديل صنف':'إضافة صنف جديد',`<form class="sheet-form" id="item-form">
 <label>اسم الصنف<input name="name" required maxlength="120" value="${esc(old?.name||'')}" placeholder="مثال: قات ممتاز / ربطة"/></label>
 <label>الباركود (اختياري)<input name="barcode" dir="ltr" inputmode="numeric" maxlength="70" value="${esc(old?.barcode||'')}"/></label>
 <label>وحدة البيع<select name="unit">${['ربطة','كيلو','حبة','كيس','صندوق','وحدة','خدمة'].map(u=>`<option ${u===(old?.unit||'ربطة')?'selected':''}>${u}</option>`).join('')}</select></label>
 <div class="grid-three"><label>السعر باليمني<input type="number" step="1" min="0" name="YER" value="${old?.prices?.YER??0}"/></label><label>السعر بالدولار<input type="number" step="0.01" min="0" name="USD" value="${old?.prices?.USD??0}"/></label><label>السعر بالسعودي<input type="number" step="0.01" min="0" name="SAR" value="${old?.prices?.SAR??0}"/></label></div>
 <button class="btn btn-primary btn-block" type="submit">حفظ الصنف</button></form>`);
 $('item-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target);const prices={YER:rounded(f.get('YER'),'YER'),USD:rounded(f.get('USD'),'USD'),SAR:rounded(f.get('SAR'),'SAR')};
  if(Object.values(prices).some(p=>p<0||!Number.isFinite(p)||p>1e12))return toast('يرجى مراجعة الأسعار');
  const barcode=String(f.get('barcode')||'').trim();if(barcode&&itemsCatalog(state.events).some(i=>i.barcode===barcode&&i.id!==old?.id))return toast('هذا الباركود مسجل لصنف آخر');
  await record(old?'item.update':'item.add',{id:old?.id||crypto.randomUUID(),name:String(f.get('name')).trim(),barcode,unit:f.get('unit'),prices});closeSheet();openItems();toast('تم حفظ الصنف ومزامنته مع الفواتير');
 };
}
function openDailySales(selectedDate=localDate(),selectedCurrency=store().currency||'YER'){
 showSheet('مبيعات يومية',`<div class="hint">تفاصيل المبيعات اليومية حسب العملة، بدون دمج العملات المختلفة.</div>
 <div class="grid-two"><label>التاريخ<input type="date" id="daily-date" value="${esc(selectedDate)}"/></label><label>العملة<select id="daily-currency">${Object.entries(CURRENCIES).map(([k,c])=>`<option value="${k}" ${k===selectedCurrency?'selected':''}>${esc(c.label)}</option>`).join('')}</select></label></div>
 <div id="daily-results"></div><div class="foot-actions"><button class="btn btn-primary" id="daily-pdf">▣ طباعة / PDF اليوم</button><button class="btn btn-light" id="daily-wa">واتساب</button></div>`);
 const show=()=>{const date=$('daily-date').value,currency=$('daily-currency').value;
 $('daily-pdf').disabled=$('daily-wa').disabled=!date;
 if(!date){$('daily-results').innerHTML='<p class="hint">اختر تاريخ التقرير</p>';return;}
 const sales=activeRecords(state.events).filter(e=>e.type==='invoice.create'&&e.payload.kind==='sale'&&dateOnly(e.at)===date&&(e.payload.currency||'YER')===currency);
 const sum=rounded(sales.reduce((a,e)=>a+e.payload.total,0),currency),paid=rounded(sales.reduce((a,e)=>a+(e.payload.paid??(e.payload.payment==='cash'?e.payload.total:0)),0),currency);
 $('daily-results').innerHTML=`<div class="summary-boxes"><div class="summary-box positive"><small>مبيعات ${date}</small><b>${money(sum,currency)}</b></div><div class="summary-box"><small>المحصل</small><b>${money(paid,currency)}</b></div><div class="summary-box"><small>الآجل</small><b>${money(rounded(sum-paid,currency),currency)}</b></div><div class="summary-box"><small>عدد الفواتير</small><b>${sales.length}</b></div></div><div class="list-card">${sales.map(e=>`<div class="data-row"><div><b>${esc(e.payload.invoiceNumber||e.id.slice(0,8))}</b><small style="display:block">${esc(getParty(e.payload.partyId)?.name||'عميل نقدي')}</small></div><strong>${money(e.payload.total,currency)}</strong></div>`).join('')||'<div class="empty">لا توجد مبيعات في هذا اليوم</div>'}</div>`;
 const info=store(),filename=`Qatfah-Sales-${date}-${currency}.pdf`,spec={title:'تقرير المبيعات اليومية',brand:info.name,logo:info.logo,address:info.address,contact:info.phone,currency,meta:[`التاريخ: ${date}`,`العملة: ${CURRENCIES[currency].label}`,`عدد الفواتير: ${sales.length}`],columns:['رقم الفاتورة','العميل','الإجمالي','المحصل'],rows:sales.map(e=>[e.payload.invoiceNumber||e.id.slice(0,8),getParty(e.payload.partyId)?.name||'نقدي',money(e.payload.total,currency),money(e.payload.paid??(e.payload.payment==='cash'?e.payload.total:0),currency)]),footer:`إجمالي مبيعات اليوم: ${money(sum,currency)} • الآجل: ${money(sum-paid,currency)}`};
 $('daily-pdf').onclick=async()=>{try{await sharePdf(await makePdf(spec),filename);}catch(err){toast(err.message);}};
 $('daily-wa').onclick=async()=>{const source=$('daily-results'),button=$('daily-wa');button.disabled=true;try{const blob=await makePdf(spec);if(source.isConnected)openWhatsappRecipient({blob,filename,caption:`تقرير مبيعات ${date} من ${info.name} • ${currency}`,onBack:()=>openDailySales(date,currency)});}catch(err){toast(err.message);}finally{button.disabled=false;}};
 };$('daily-date').onchange=show;$('daily-currency').onchange=show;show();
}

function itemRow(item={}){
 const currency=$('invoice-currency')?.value||store().currency||'YER';
 return `<article class="invoice-line-card item-entry">
 <label class="floating-label">الصنف أو الخدمة<input class="item-title" type="text" list="qatfah-products" required maxlength="110" placeholder="اختر من الأصناف أو اكتب صنفًا جديدًا" value="${esc(item.title||'')}" autocomplete="off"/></label>
 <div class="item-fields"><button class="remove-item" type="button" aria-label="حذف البند" title="حذف البند">♲</button><label class="floating-label">السعر<input class="item-price" type="number" min="0" max="1000000000000" step="0.01" value="${Number(item.price||0)}" required/></label><label class="floating-label">الكمية<input class="item-qty" type="number" min="0.001" max="1000000" step="0.001" value="${Number(item.qty||1)}" required/></label></div>
 <p class="line-total">الإجمالي: <strong>${money(rounded((item.qty||1)*(item.price||0),currency),currency)}</strong></p>
 </article>`;
}
function invoiceTotal(){
 const currency=$('invoice-currency')?.value||'YER',rows=[...$('items-container').querySelectorAll('.item-entry')];
 const sum=rounded(rows.reduce((n,r)=>n+(Number(r.querySelector('.item-qty').value)||0)*(Number(r.querySelector('.item-price').value)||0),0),currency);
 const paid=Number($('invoice-paid')?.value)||0;
 $('invoice-total').textContent=money(sum,currency);
 $('invoice-outstanding').textContent=money(rounded(sum-paid,currency),currency);
 $('invoice-outstanding').classList.toggle('debt',sum>paid);
 for(const row of rows){const q=Number(row.querySelector('.item-qty').value)||0,p=Number(row.querySelector('.item-price').value)||0;row.querySelector('.line-total strong').textContent=money(rounded(q*p,currency),currency);}
 return {total:sum,paid};
}
function catalogFill(row){
 const title=row.querySelector('.item-title').value.trim();const currency=$('invoice-currency')?.value||'YER';
 const item=itemsCatalog(state.events).find(i=>i.name===title||i.barcode===title);
 if(item){row.querySelector('.item-title').value=item.name;row.querySelector('.item-price').value=item.prices?.[currency]??item.price??0;row.dataset.itemId=item.id;}
 else delete row.dataset.itemId;
 invoiceTotal();
}
function invoiceNumber(kind){const num=activeRecords(state.events).filter(e=>e.type==='invoice.create'&&e.payload.kind===kind).length+1;return `${kind==='sale'?'INV':'PUR'}-${localDate().replaceAll('-','')}-${String(num).padStart(4,'0')}`;}
function openInvoice(kind='sale',editId=''){
 const previous=editId?activeRecords(state.events).find(e=>e.id===editId&&e.type==='invoice.create'):null;
 const data=previous?.payload||{},currency=data.currency||store().currency||'YER',people=parties(state.events),catalog=itemsCatalog(state.events);
 const initialParty=data.partyId||'';
 showSheet(kind==='sale'?(previous?'تعديل فاتورة بيع':'فاتورة بيع جديدة'):(previous?'تعديل فاتورة مشتريات':'فاتورة مشتريات جديدة'),`
 <form id="invoice-form" class="sheet-form pro-invoice-form">
 <div class="invoice-overview"><span>رقم الفاتورة</span><b dir="ltr">${esc(data.invoiceNumber||invoiceNumber(kind))}</b><small>${previous?dateOnly(previous.at):localDate()} • ${esc(store().name)}</small></div>
 <div class="invoice-field-pair"><label>ال${kind==='sale'?'عميل':'مورد'}<select id="invoice-party" name="partyId"><option value="">عميل نقدي / بدون حساب</option>${people.map(p=>`<option value="${p.id}" ${p.id===initialParty?'selected':''}>${esc(p.name)} • ${p.type==='supplier'?'مورد':'عميل'}</option>`).join('')}</select></label><button type="button" class="small-add" id="quick-add-customer" title="إضافة عميل">＋</button></div>
 <div class="quick-party hide" id="quick-party"><label>اسم العميل<input id="quick-party-name" maxlength="110" placeholder="اسم العميل الجديد"/></label><label>رقم اليمن <span dir="ltr">+967</span><div class="phone-field"><b dir="ltr">+967</b><input id="quick-party-phone" type="tel" inputmode="numeric" dir="ltr" placeholder="7XXXXXXXX" maxlength="9"/></div></label><button id="quick-party-save" type="button" class="btn btn-light">إضافة إلى سجل العملاء</button></div>
 <div class="invoice-heading"><b>بنود الفاتورة</b><button class="btn btn-dark" type="button" id="barcode-scan">▦ مسح باركود</button></div>
 <datalist id="qatfah-products">${catalog.map(p=>`<option value="${esc(p.name)}"></option>`).join('')}</datalist>
 <div id="items-container" class="stacked">${(data.items?.length?data.items:[{}]).map(itemRow).join('')}</div>
 <button type="button" class="invoice-add-item" id="add-invoice-item">＋ إضافة بند</button>
 <label class="invoice-large-field">عملة الفاتورة<select id="invoice-currency" name="currency">${Object.entries(CURRENCIES).map(([id,x])=>`<option value="${id}" ${id===currency?'selected':''}>${esc(x.label)} (${id})</option>`).join('')}</select></label>
 <label class="invoice-large-field">المبلغ المدفوع<input id="invoice-paid" name="paid" type="number" inputmode="decimal" min="0" max="1000000000000" step="0.01" value="${Number(data.paid??(data.payment==='cash'?data.total:0))||0}"/></label>
 <div class="invoice-grand"><div><small>إجمالي الفاتورة</small><strong id="invoice-total">${money(0,currency)}</strong></div><div><small>المتبقي (على الحساب)</small><strong id="invoice-outstanding">${money(0,currency)}</strong></div></div>
 <label>ملاحظات الفاتورة<textarea name="notes" maxlength="600" placeholder="اختياري">${esc(data.notes||'')}</textarea></label>
 <button class="btn btn-primary btn-block invoice-save" type="submit">▣ ${previous?'حفظ التصحيح':'حفظ الفاتورة دون انتظار الإنترنت'}</button>
 <small class="invoice-disclaimer">تُحفظ الفاتورة على الجهاز ويُحفظ سجل التصحيحات. للمزامنة اليدوية احفظ نسخة JSON إلى Drive واستعدها على جهاز آخر.</small>
 </form>`);
 $('sheet').classList.add('invoice-view');
 const entries=$('items-container');
 $('add-invoice-item').onclick=()=>{entries.insertAdjacentHTML('beforeend',itemRow());invoiceTotal();};
 entries.addEventListener('input',ev=>{if(ev.target.classList.contains('item-title'))catalogFill(ev.target.closest('.item-entry'));else invoiceTotal();});
 entries.addEventListener('change',ev=>{if(ev.target.classList.contains('item-title'))catalogFill(ev.target.closest('.item-entry'));});
 entries.addEventListener('click',ev=>{if(ev.target.closest('.remove-item')){if(entries.children.length>1){ev.target.closest('.item-entry').remove();invoiceTotal();}else toast('يجب إبقاء بند واحد على الأقل');}});
 $('invoice-paid').addEventListener('input',invoiceTotal);
 $('invoice-currency').addEventListener('change',()=>{for(const row of entries.children){const t=row.querySelector('.item-title').value.trim(),p=itemsCatalog(state.events).find(i=>i.name===t);if(p)row.querySelector('.item-price').value=p.prices?.[$('invoice-currency').value]??0;}invoiceTotal();});
 $('quick-add-customer').onclick=()=>{$('quick-party').classList.toggle('hide');};
 bindYemenPhoneInput($('quick-party-phone'));
 $('quick-party-save').onclick=async()=>{
   const button=$('quick-party-save'),name=$('quick-party-name').value.trim(),raw=$('quick-party-phone').value.trim();
   if(!name)return toast('اسم العميل مطلوب');
   let phone='';try{if(raw)phone=normalizeYemenPhone(raw);}catch(err){return toast(err.message);}
   button.disabled=true;
   try{const party={id:crypto.randomUUID(),name,type:kind==='sale'?'customer':'supplier',phone,address:''};
    await record('party.add',party);if(!$('invoice-party'))return;$('invoice-party').insertAdjacentHTML('beforeend',`<option selected value="${party.id}">${esc(name)}</option>`);$('invoice-party').value=party.id;$('quick-party').classList.add('hide');toast('تمت إضافة العميل وربطه بالفاتورة');
   }catch(err){toast(err.message);}finally{button.disabled=false;}
 };
 $('barcode-scan').onclick=()=>startBarcodeScan(code=>{
   const item=itemsCatalog(state.events).find(i=>i.barcode===code);
   const row=[...entries.children].find(r=>!r.querySelector('.item-title').value.trim())||entries.lastElementChild;
   if(item){row.querySelector('.item-title').value=item.name;catalogFill(row);toast('تم اختيار '+item.name);}else toast('الباركود غير مسجل. يمكنك إضافة الصنف من قسم الأصناف');
 });
 let savingInvoice=false;
 $('invoice-form').onsubmit=async ev=>{ev.preventDefault();if(savingInvoice)return;const form=ev.target,f=new FormData(form),partyId=String(f.get('partyId')||''),curr=String(f.get('currency'));
  const goods=[...entries.children].map(row=>({title:row.querySelector('.item-title').value.trim(),qty:Number(row.querySelector('.item-qty').value),price:rounded(Number(row.querySelector('.item-price').value),curr),itemId:row.dataset.itemId||''}));
  if(!CURRENCIES[curr]||goods.some(i=>!i.title||!Number.isFinite(i.qty)||i.qty<=0||!Number.isFinite(i.price)||i.price<0))return toast('تحقق من الأصناف والكمية والسعر');
  const total=rounded(goods.reduce((n,i)=>n+i.qty*i.price,0),curr),paid=rounded(Number(f.get('paid')),curr);
  if(!(total>0)||!Number.isFinite(total)||!Number.isFinite(paid)||paid<0||paid>total||total>1e12)return toast('المبلغ المدفوع يجب ألا يتجاوز إجمالي الفاتورة');
  if(paid<total&&!partyId)return toast('اختر عميلًا أو موردًا إذا كان هناك مبلغ آجل');
  const batch=[],catalogByName=new Map(itemsCatalog(state.events).map(item=>[item.name,item]));
  for(const item of goods){let known=catalogByName.get(item.title);if(!known){
    known={id:crypto.randomUUID(),name:item.title,unit:'وحدة',barcode:'',prices:{[curr]:item.price},createdFromInvoice:true};batch.push({type:'item.add',payload:known});catalogByName.set(item.title,known);
  }item.itemId=known.id;}
  const payload={kind,payment:paid>=total?'cash':'credit',partyId,items:goods,total,paid,currency:curr,invoiceNumber:data.invoiceNumber||invoiceNumber(kind),notes:String(f.get('notes')||'').trim(),replaces:previous?.id||''};
  batch.push(...invoiceEventEntries(payload,previous));
  const button=form.querySelector('[type="submit"]');savingInvoice=true;button.disabled=true;
  try{const saved=await recordBatch(batch);if(form.isConnected){closeSheet();openEvent(saved.at(-1).id);}}
  catch(err){toast('لم تُحفظ الفاتورة: '+err.message);}finally{savingInvoice=false;button.disabled=false;}
 };
 invoiceTotal();
}
async function startBarcodeScan(onCode){
 const manual=()=>{const code=prompt('أدخل رقم الباركود يدويًا');if(code)onCode(code.trim());};
 if(!navigator.mediaDevices?.getUserMedia||!('BarcodeDetector' in window)){manual();return;}
 let stream,video=null,detector=null,finished=false;
 try{
  detector=new BarcodeDetector({formats:['ean_13','ean_8','code_128','qr_code']});stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  const view=document.createElement('div');view.id='barcode-overlay';view.className='barcode-overlay';view.innerHTML='<p>وجّه الكاميرا إلى الباركود</p><video autoplay playsinline muted></video><button class="btn btn-light" id="close-camera" type="button">إغلاق الكاميرا</button>';
  document.body.appendChild(view);video=view.querySelector('video');video.srcObject=stream;await video.play();
  const close=()=>{if(finished)return;finished=true;stream.getTracks().forEach(t=>t.stop());view.remove();};
  view.querySelector('#close-camera').onclick=close;
  const check=async()=>{if(finished)return;try{const codes=await detector.detect(video);if(codes.length){close();onCode(codes[0].rawValue);return;}}catch{}requestAnimationFrame(check);};check();
 }catch(e){stream?.getTracks().forEach(t=>t.stop());toast('تعذر تشغيل الكاميرا: '+e.message);manual();}
}

function openMoney(kind='receipt',initialParty=''){
 const title=kind==='receipt'?'سند قبض':kind==='payment'?'سند صرف':'مصروف يومي';const type=kind==='receipt'?'receipt.create':kind==='payment'?'payment.create':'expense.create';
 const partyField=kind!=='expense'?`<label>الحساب<select name="partyId" required><option value="">اختر العميل أو المورد</option>${partyOptions(initialParty)}</select></label>`:`<label>نوع المصروف<input name="category" maxlength="100" required placeholder="إيجار / نقل / عمالة"/></label>`;
 showSheet(title,`<form id="money-form" class="sheet-form">${partyField}<label>العملة<select name="currency">${Object.entries(CURRENCIES).map(([k,c])=>`<option value="${k}" ${k===(store().currency||'YER')?'selected':''}>${esc(c.label)} (${k})</option>`).join('')}</select></label><label>المبلغ<input type="number" name="amount" required min="0.01" max="1000000000000" step="0.01" placeholder="0"/></label><label>البيان<textarea name="notes" maxlength="600" placeholder="تفاصيل العملية"></textarea></label><button type="submit" class="btn btn-primary">حفظ ${title}</button></form>`);
 $('money-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target),currency=f.get('currency'),amount=rounded(f.get('amount'),currency);if(!CURRENCIES[currency]||amount<=0||amount>1e12||!Number.isFinite(amount))return toast('أدخل مبلغًا صحيحًا');await record(type,{partyId:f.get('partyId')||'',category:f.get('category')||'',notes:String(f.get('notes')||''),amount,currency});closeSheet();};
}

const openMoneyServices=createMoneyDesk({events:()=>state.events,record,showSheet:(...a)=>showSheet(...a),closeSheet:()=>closeSheet(),toast:(...a)=>toast(...a),store:()=>store(),makePdf,sharePdf});
function openCashbook(){
 showSheet('حركة الصندوق',`<div class="hint">جميع المبيعات المسددة والسندات والصرف والحوالات وحركة الصندوق تدخل في النقدية بالعملة الصحيحة. لا تُخلط العملات ولا يُحسب رصيد البنك ضمن الصندوق.</div><label>عملة الصندوق<select id="cashbook-currency">${Object.entries(CURRENCIES).map(([k,c])=>`<option value="${k}" ${k===(store().currency||'YER')?'selected':''}>${esc(c.label)} (${k})</option>`).join('')}</select></label><div id="cashbook-contents"></div>`);
 const display=()=>{
  const currency=$('cashbook-currency').value,balances=accountBalances(state.events)[currency];
  const journal=financialPostings(state.events).filter(x=>x.currency===currency&&x.account==='cash');
  const group=new Map();for(const p of journal)group.set(p.eventId,(group.get(p.eventId)||0)+(p.side==='debit'?p.units:-p.units));
  const income=[...group.values()].filter(x=>x>0).reduce((a,x)=>a+x,0),outgo=[...group.values()].filter(x=>x<0).reduce((a,x)=>a-x,0);
  const list=activeRecords(state.events).filter(e=>group.has(e.id)).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,70);
  $('cashbook-contents').innerHTML=`<div class="summary-boxes"><div class="summary-box positive"><small>رصيد الصندوق</small><b>${money(balances.cash,currency)}</b></div><div class="summary-box"><small>مقبوضات وودائع</small><b>${money(fromMinor(income,currency),currency)}</b></div><div class="summary-box"><small>صرف نقدي وتحويلات للبنك</small><b>${money(fromMinor(outgo,currency),currency)}</b></div><div class="summary-box"><small>عدد الحركات المسجلة</small><b>${group.size}</b></div></div><div class="list-card">${list.map(e=>{const d=describeEvent(e,parties(state.events));const value=fromMinor(group.get(e.id),currency);return `<div class="data-row"><div><b>${esc(d.title)}</b><small style="display:block;color:#8ca0a4">${dateOnly(e.at)} · ${esc(d.sub)}</small></div><strong>${money(value,currency)}</strong></div>`;}).join('')||'<div class="empty">لا توجد حركات نقدية بهذه العملة</div>'}</div>`;
 };
 $('cashbook-currency').onchange=display;display();
}

function openStatement(partyId=''){
 const currencies=Object.entries(CURRENCIES).map(([k,c])=>`<option value="${k}">${esc(c.label)} (${k})</option>`).join('');
 showSheet('كشف حساب تفصيلي',`<form id="statement-form" class="sheet-form"><label>العميل / المورد<select name="partyId" required><option value="">اختر الحساب</option>${partyOptions(partyId)}</select></label><label>عملة الحساب<select name="currency">${currencies}</select></label><div class="grid-two"><label>من تاريخ<input name="from" type="date" value="${localDate().slice(0,7)}-01" required/></label><label>إلى تاريخ<input name="to" type="date" value="${localDate()}" required/></label></div><button type="submit" class="btn btn-primary">عرض كشف الحساب</button></form><div id="statement-result"></div>`);
 $('statement-form').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),from=f.get('from'),to=f.get('to'),pid=f.get('partyId'),currency=f.get('currency');if(from>to)return toast('تأكد من تواريخ الفترة');const p=getParty(pid),s=statement(state.events,pid,from,to,currency);if(!p)return toast('اختر الحساب');
 const describe=amount=>{const value=balanceDescription(amount,currency);return {...value,text:`${value.label} ${money(value.amount,currency)}`,color:value.side==='debit'?'#b42318':value.side==='credit'?'#137a4b':'#64748b'};};
 const opening=describe(s.opening),closing=describe(s.closing);
 const rows=s.rows.map(x=>{const balance=describe(x.balance);return `<tr><td>${dateOnly(x.at)}</td><td>${esc(x.title)}</td><td style="color:#b42318">${x.change>0?money(x.change,currency):'—'}</td><td style="color:#137a4b">${x.change<0?money(-x.change,currency):'—'}</td><td style="color:${balance.color}">${esc(balance.text)}</td></tr>`;}).join('');
 $('statement-result').innerHTML=`<section class="flat-card" style="margin-top:18px"><div class="row-between"><h3>${esc(p.name)}</h3><span class="chip" style="color:${closing.color};background:${closing.side==='debit'?'#fff1f0':closing.side==='credit'?'#edf9f1':'#f1f5f9'}">${esc(closing.text)}</span></div><div class="hint">رقم الهاتف: ${p.phone?'+'+esc(p.phone):'غير مسجل'} • العملة: ${currency}</div><div class="data-row"><b>الرصيد السابق</b><strong style="color:${opening.color}">${esc(opening.text)}</strong></div><div class="table-scroll"><table class="report-table"><thead><tr><th>التاريخ</th><th>الحركة</th><th style="color:#b42318">عليه / مدين</th><th style="color:#137a4b">له / دائن</th><th>الرصيد</th></tr></thead><tbody>${rows||'<tr><td colspan="5">لا توجد حركات في الفترة</td></tr>'}</tbody></table></div><div class="data-row"><b>الرصيد النهائي</b><strong style="color:${closing.color}">${esc(closing.text)}</strong></div><div class="foot-actions"><button id="statement-pdf" class="btn btn-primary">▤ عرض / PDF</button><button id="statement-wa" class="btn btn-light">إرسال كشف PDF واتساب</button></div></section>`;
 const generate=()=>makePdf({title:`كشف حساب ${p.name}`,brand:store().name,logo:store().logo,address:store().address,contact:store().phone,currency,meta:[`من ${from} إلى ${to}`,`الرصيد السابق: ${opening.text}`,`العملة ${CURRENCIES[currency].label}`],columns:['التاريخ','العملية','عليه / مدين','له / دائن','الرصيد'],rows:s.rows.map(x=>[dateOnly(x.at),x.title,x.change>0?money(x.change,currency):'—',x.change<0?money(-x.change,currency):'—',describe(x.balance).text]),footer:`الرصيد النهائي: ${closing.text}`});
 $('statement-pdf').onclick=async()=>{try{await sharePdf(await generate(),`Qatfah-Statement-${currency}.pdf`);}catch(err){toast(err.message)}};
 $('statement-wa').onclick=async()=>{try{await sendPdfToWhatsapp(p.phone,await generate(),`Qatfah-Statement-${currency}.pdf`,`كشف حساب ${p.name} من ${store().name} • من ${from} إلى ${to} • ${closing.text}`);}catch(err){toast(err.message)}};
 };
}
function openEvent(id){
 const e=activeRecords(state.events).find(x=>x.id===id);if(!e)return toast('العملية غير موجودة');const d=describeEvent(e,parties(state.events)),p=e.payload,person=getParty(p.partyId),currency=p.currency||'YER';
 showSheet(`تفاصيل ${d.title}`,`<section class="flat-card"><div class="row-between"><b>${esc(d.title)}</b><span class="chip">${dateOnly(e.at)}</span></div><div class="data-row"><span>رقم المستند</span><strong dir="ltr">${esc(p.invoiceNumber||e.id.slice(0,12))}</strong></div><div class="data-row"><span>الجهة</span><b>${esc(person?.name||p.category||'نقدي')}</b></div>${e.type==='invoice.create'?`<div class="data-row"><span>الدفع</span><b>${p.payment==='cash'?'نقدي':'آجل / جزئي'}</b></div>${p.items.map(x=>`<div class="data-row"><span>${esc(x.title)} × ${x.qty}</span><b>${money(rounded(x.qty*x.price,currency),currency)}</b></div>`).join('')}<div class="data-row"><span>المدفوع</span><b>${money(p.paid??(p.payment==='cash'?p.total:0),currency)}</b></div><div class="data-row"><span>المتبقي</span><b>${money(p.total-(p.paid??(p.payment==='cash'?p.total:0)),currency)}</b></div>`:''}<div class="data-row"><b>الإجمالي</b><strong>${money(d.amount,currency)}</strong></div>${p.notes?`<p class="hint">${esc(p.notes)}</p>`:''}
 <div class="foot-actions"><button class="btn btn-primary" id="detail-pdf">▤ طباعة / PDF</button><button class="btn btn-light" id="detail-wa">إرسال PDF واتساب</button>${e.type==='invoice.create'?'<button class="btn btn-light" id="detail-edit">✎ تعديل الفاتورة</button>':''}</div></section>`);
 const filename=`Qatfah-${p.invoiceNumber||e.id.slice(0,8)}.pdf`;
 const make=()=>e.type==='invoice.create'?makeInvoicePdf({event:e,brandInfo:store(),party:person||{}}):makePdf({title:d.title,brand:store().name,logo:store().logo,contact:store().phone,address:store().address,currency,meta:[`الرقم: ${e.id.slice(0,12)}`,`التاريخ: ${dateOnly(e.at)}`,`الجهة: ${person?.name||p.category||'نقدي'}`],columns:['البيان','العدد','القيمة'],rows:[[d.title,'1',money(d.amount,currency)]],footer:`الإجمالي ${money(d.amount,currency)} · ${store().phone||''}`});
 $('detail-pdf').onclick=async()=>{try{await sharePdf(await make(),filename);}catch(err){toast('تعذر إنشاء المستند: '+err.message)}};
 $('detail-wa').onclick=async()=>{try{await sendPdfToWhatsapp(person?.phone,await make(),filename,`${d.title} ${p.invoiceNumber||e.id.slice(0,8)} • ${money(d.amount,currency)} • ${store().name}`);}catch(err){toast(err.message)}};
 if(e.type==='invoice.create')$('detail-edit').onclick=()=>openInvoice(p.kind,e.id);
}
function fixWhatsappNumber(phone){return normalizeYemenPhone(phone);}
function openWhatsappRecipient({blob,filename,caption,onBack=()=>closeSheet()}){
 const contacts=parties(state.events);
 showSheet('إرسال PDF عبر واتساب',`<form id="wa-recipient-form" class="sheet-form"><p class="hint">${esc(caption)}</p><label>حساب محفوظ<select id="wa-recipient-party"><option value="">إدخال رقم المستلم</option>${contacts.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}${p.phone?' • +'+esc(p.phone):' • دون رقم'}</option>`).join('')}</select></label><label>رقم المستلم<div class="phone-field"><span class="code-country" dir="ltr">+967</span><input id="wa-recipient-number" type="tel" inputmode="numeric" dir="ltr" maxlength="9" placeholder="7XXXXXXXX" required/></div></label><button class="btn btn-primary btn-block" type="submit">إرسال المستند</button><button id="wa-recipient-back" class="btn btn-light btn-block" type="button">العودة للتقرير</button></form>`);
 const form=$('wa-recipient-form'),input=$('wa-recipient-number');bindYemenPhoneInput(input);
 $('wa-recipient-party').onchange=e=>{const party=contacts.find(x=>x.id===e.target.value);if(!party?.phone){input.value='';return;}try{input.value=normalizeYemenPhone(party.phone).slice(3);}catch(err){input.value='';toast(err.message);}};
 $('wa-recipient-back').onclick=onBack;
 let sending=false;
 form.onsubmit=async e=>{e.preventDefault();if(sending)return;let phone;try{phone=normalizeYemenPhone(input.value);}catch(err){return toast(err.message);}
  const button=form.querySelector('[type="submit"]');sending=true;button.disabled=true;
  try{const result=await sendPdfToWhatsapp(phone,blob,filename,caption);if(form.isConnected&&(result?.submitted===true||result?.openedInWhatsApp===true||result?.status==='submitted'))closeSheet();}
  catch(err){toast(err.message);}finally{sending=false;button.disabled=false;}
 };
}
function bindYemenPhoneInput(input){
 if(!input)return;
 input.oninput=()=>{input.value=latinPhoneDigits(input.value).replace(/\D/g,'').slice(0,9);};
 input.onpaste=e=>{const value=e.clipboardData?.getData('text');if(!value)return;e.preventDefault();try{input.value=normalizeYemenPhone(value).slice(3);}catch(err){toast(err.message);}};
}
function showWaSendProgress(message='',{failure=false,details=''}={}){
 const status=$('wa-send-status');if(!status)return;
 status.hidden=!message;if(!message){status.replaceChildren();return;}
 status.style.background=failure?'#702e2e':'#173e30';status.style.textAlign=failure?'right':'center';
 status.style.whiteSpace='pre-line';status.style.maxHeight='45vh';status.style.overflowY='auto';
 status.setAttribute('role',failure?'alert':'status');
 const text=document.createElement('div');text.textContent=message;status.replaceChildren(text);
 if(failure){
  if(details){const detail=document.createElement('div');detail.textContent=details;detail.style.cssText='margin-top:8px;font-size:12px;opacity:.9';status.append(detail);}
  const close=document.createElement('button');close.type='button';close.textContent='إغلاق';close.setAttribute('aria-label','إغلاق رسالة الإرسال');
  close.style.cssText='display:block;margin-top:10px;padding:5px 14px;border:1px solid #ffffff80;border-radius:7px;background:transparent;color:inherit;font:inherit;cursor:pointer';
  close.onclick=()=>showWaSendProgress();status.append(close);
 }
}
async function sendWhatsappPayload(payload){
 try{
  const result=await waSend(payload),message=whatsappSendMessage(result);
  const completed=result?.openedInWhatsApp===true||result?.submitted===true||['submitted','fallback_opened'].includes(result?.status)||result?.outcome==='submitted';
  if(completed)showWaSendProgress();else showWaSendProgress(message,{failure:true,details:whatsappSendDetails(result)});
  toast(message);return result;
 }catch(error){
  // A rejected duplicate tap belongs to no new send and must not replace the
  // still-running request's progress or its eventual result.
  if(error?.code!=='wa_send_busy')showWaSendProgress(error?.message||'تعذر تأكيد نتيجة الإرسال',{failure:true,details:whatsappSendDetails(error)});
  throw error;
 }
}
async function sendPdfToWhatsapp(phone,blob,filename,caption=''){
 const number=fixWhatsappNumber(phone);
 if(!navigator.onLine)throw Error('اتصل بالإنترنت لإرسال المستند');
 const arr=new Uint8Array(await blob.arrayBuffer());
 if(arr.length>5000000)throw Error('المستند أكبر من 5 ميجابايت');
 let raw='';for(let i=0;i<arr.length;i+=32768)raw+=String.fromCharCode(...arr.subarray(i,i+32768));
 return sendWhatsappPayload({phone:number,caption,base64:btoa(raw),filename});
}
async function shareWhatsapp(phone,text){
 try{
  const number=fixWhatsappNumber(phone);
  await sendWhatsappPayload({phone:number,caption:text});
 }catch(e){toast(e.message);}
}

const waPairing=createWhatsappPairing({session:waSession,getStatus:async()=>{
 const native=window.Capacitor?.Plugins?.QatfahNative;
 if(!native?.whatsappPairingStatus)throw Error('الربط متاح داخل تطبيق قطفة على أندرويد');
 return native.whatsappPairingStatus();
},onChange:renderWaPairing});
function stopWaPairingPolling(){waPairing.close();}
function displayWaView(id,visible,display='block'){const element=$(id);if(!element)return;element.hidden=!visible;element.style.setProperty('display',visible?display:'none','important');}
function renderWaPairing(pair=waPairing.snapshot()){
 const view=$('wa-root-pair');if(!view||!view.isConnected||!pair.active)return;
 const session=waSession.snapshot();waAuthMode=pair.mode;
 view.dataset.authMode=waAuthMode;
 displayWaView('wa-qr-view',waAuthMode==='qr');
 displayWaView('wa-code-view',waAuthMode==='phone_input'||waAuthMode==='pairing_code');
 displayWaView('wa-phone-input',waAuthMode==='phone_input');
 displayWaView('wa-pairing-code',waAuthMode==='pairing_code');
 displayWaView('wa-connected-view',waAuthMode==='connected');
 const label=$('wa-root-state');
 label.style.color=waAuthMode==='connected'&&session.transportReady?'#137a4b':'#20322a';
 if(waAuthMode==='connected'){
  label.textContent=session.transportReady?'واتساب متصل بجميع أقسام قطفة':session.online?'واتساب مرتبط · الجلسة محفوظة':'واتساب مرتبط · لا يوجد إنترنت';
  $('wa-root-connected-note').textContent=session.transportReady?'يمكنك إغلاق هذه النافذة والانتقال بين الأقسام وإرسال المستندات.':'الربط محفوظ. تحتاج الجلسة إلى اتصال فعلي لإرسال المستندات.';
  return;
 }
 label.textContent=waAuthMode==='phone_input'?'الربط برقم الهاتف':waAuthMode==='pairing_code'?'أدخل الرمز في واتساب على هاتفك':'ربط واتساب بالباركود';
 $('wa-root-error').textContent=pair.error;
 $('wa-root-error').hidden=!pair.error;
 if(waAuthMode==='qr'){
  const image=$('wa-root-qr-image');image.hidden=!pair.qr;
  if(pair.qr)image.src=pair.qr;
  $('wa-root-qr-note').hidden=Boolean(pair.qr);
  $('wa-root-qr-note').textContent=session.requiresRetry?'اضغط «بدء ربط جديد» لتحميل الباركود':'جاري تحميل الباركود…';
  $('wa-qr-view').querySelector('[data-wa-reload]').textContent=session.requiresRetry?'بدء ربط جديد':'تحديث الباركود يدويًا';
 }
 const cells=$('wa-root-code').children;
 for(let i=0;i<8;i++)cells[i].textContent=pair.code[i]||'—';
 $('wa-root-code-copy').disabled=pair.code.length!==8;
 displayWaView('wa-phone-start',session.requiresRetry);
 $('wa-root-code-note').textContent=pair.code.length===8?'الرمز: '+pair.code.slice(0,4)+'-'+pair.code.slice(4):'جاري طلب الرمز…';
}
function openWhatsapp(){
 stopWaPairingPolling();
 showSheet('ربط واتساب',`<div id="wa-root-pair" class="qr-box">
 <h3 id="wa-root-state"></h3><p id="wa-root-error" class="hint" hidden></p>
 <div id="wa-connected-view" style="display:none!important"><p id="wa-root-connected-note"></p><button data-wa-reload type="button" class="btn btn-light btn-block">إعادة تحميل الجلسة يدويًا</button><button id="wa-root-logout" type="button" class="btn btn-danger btn-block">فصل واتساب</button></div>
 <div id="wa-qr-view" style="display:none!important"><div style="min-height:210px;display:grid;place-items:center"><img id="wa-root-qr-image" hidden alt="رمز QR لواتساب" style="width:min(100%,260px);height:auto"/><p id="wa-root-qr-note">جاري تحميل الباركود…</p></div>
 <p class="hint">من واتساب على هاتفك: الأجهزة المرتبطة ← ربط جهاز، ثم امسح الباركود.</p><button data-wa-reload type="button" class="btn btn-light btn-block">تحديث الباركود يدويًا</button><button id="wa-root-switch-phone" type="button" class="btn btn-light btn-block">التبديل إلى الربط برقم الهاتف والرمز</button></div>
 <div id="wa-code-view" style="display:none!important"><button id="wa-phone-start" data-wa-reload type="button" class="btn btn-light btn-block" style="display:none!important">بدء ربط جديد</button><div id="wa-phone-input"><label>رقم واتساب<div class="phone-field"><span class="code-country" dir="ltr">+967</span><input id="wa-root-number" type="tel" inputmode="numeric" dir="ltr" maxlength="9" placeholder="7XXXXXXXX"></div></label>
 <button id="wa-root-request" type="button" class="btn btn-primary btn-block">طلب رمز الربط</button>
 </div><div id="wa-pairing-code" style="display:none!important"><div id="wa-root-code" dir="ltr" style="display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:5px;margin:20px 0">${Array.from({length:8},()=>'<span style="display:grid;place-items:center;min-height:42px;border:1px solid #d8e4df;border-radius:8px;font-size:21px;font-weight:700">—</span>').join('')}</div><p id="wa-root-code-note" dir="ltr"></p><button id="wa-root-code-copy" type="button" class="btn btn-primary btn-block" disabled>نسخ الرمز</button><p class="hint">أدخل الرمز في واتساب وانتظر تأكيد الربط هنا.</p><button id="wa-root-change-phone" type="button" class="btn btn-light btn-block">تغيير الرقم</button></div>
 <button id="wa-root-switch-qr" type="button" class="btn btn-light btn-block">العودة للباركود</button></div>
 </div>`);
 bindYemenPhoneInput($('wa-root-number'));
 document.querySelectorAll('[data-wa-reload]').forEach(button=>{button.onclick=async()=>{
  button.disabled=true;
  try{const native=window.Capacitor?.Plugins?.QatfahNative;if(!native?.whatsappRetryBrowser)throw Error('التحديث متاح في تطبيق أندرويد');const result=await native.whatsappRetryBrowser();if(result?.status)waSession.applyNative(result);await waPairing.retry();toast('تم طلب التحديث اليدوي');}
  catch(e){toast(e.message);}finally{button.disabled=false;}
 };});
 $('wa-root-switch-phone').onclick=()=>waPairing.setMode('phone_input');
 $('wa-root-change-phone').onclick=()=>waPairing.setMode('phone_input');
 $('wa-root-switch-qr').onclick=()=>waPairing.setMode('qr');
 $('wa-root-request').onclick=async()=>{
  const button=$('wa-root-request'),view=$('wa-root-pair');button.disabled=true;
  try{const phone=normalizeYemenPhone($('wa-root-number').value);const native=window.Capacitor?.Plugins?.QatfahNative;if(!native?.whatsappPairingPhone)throw Error('الربط متاح في تطبيق أندرويد');const request=native.whatsappPairingPhone({phone});waPairing.setMode('pairing_code');await request;}
  catch(err){if(view.isConnected)waPairing.setMode('phone_input');toast(err.message);}finally{button.disabled=false;}
 };
 $('wa-root-code-copy').onclick=async()=>{try{const code=waPairing.snapshot().code;if(code.length!==8)return;await navigator.clipboard.writeText(code.slice(0,4)+'-'+code.slice(4));toast('تم نسخ الرمز');}catch{toast('تعذر النسخ؛ أدخل الرمز الظاهر يدويًا');}};
 $('wa-root-logout').onclick=async()=>{
  if(!confirm('فصل واتساب عن قطفة؟ ستحتاج إلى ربطه من جديد للإرسال.'))return;
  const button=$('wa-root-logout');button.disabled=true;
  try{const native=window.Capacitor?.Plugins?.QatfahNative;if(!native?.whatsappLogout)throw Error('يلزم تحديث تطبيق قطفة لفصل الجلسة');await native.whatsappLogout();waSession.clear();toast('تم فصل واتساب');}
  catch(err){toast(err.message);}finally{button.disabled=false;}
 };
 waPairing.open();
}

async function resizeLogo(file){if(file.size>5e6)throw Error('الصورة كبيرة جدًا');const image=new Image(),url=URL.createObjectURL(file);try{image.src=url;await image.decode();const scale=Math.min(360/image.width,360/image.height,1),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(image.width*scale));canvas.height=Math.max(1,Math.round(image.height*scale));const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.80);}finally{URL.revokeObjectURL(url);}}
function openProfile(){
 const p=store();showSheet('هوية المحل في كل المستندات',`<form id="profile-form" class="sheet-form">
 <label>اسم المحل<input name="name" required value="${esc(p.name)}" maxlength="120"/></label>
 <label>العنوان<input name="address" value="${esc(p.address)}" maxlength="180"/></label>
 <label>رقم التواصل<input name="phone" type="tel" dir="ltr" value="${esc(p.phone)}" maxlength="30"/></label>
 <label>البريد الإلكتروني<input name="email" type="email" dir="ltr" value="${esc(p.email||'')}" maxlength="120"/></label>
 <label>السجل التجاري / البيانات الإضافية<input name="commercialId" value="${esc(p.commercialId||'')}" maxlength="100"/></label>
 <label>العملة الافتراضية<select name="currency">${Object.entries(CURRENCIES).map(([k,c])=>`<option value="${k}" ${k===(p.currency||'YER')?'selected':''}>${esc(c.label)} (${k})</option>`).join('')}</select></label>
 <label>شعار المحل (PNG, JPEG, WebP)<input id="logo-file" type="file" accept="image/png,image/jpeg,image/webp"/></label>
 <p class="hint">يظهر اسم المحل وشعاره وعنوانه وأرقام التواصل تلقائيًا في التطبيق وجميع الفواتير والكشوف والتقارير.</p>
 <button type="submit" class="btn btn-primary btn-block">حفظ بيانات المحل</button></form>`);
 $('profile-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target),data={name:String(f.get('name')||'').trim(),address:String(f.get('address')||'').trim(),phone:String(f.get('phone')||'').trim(),email:String(f.get('email')||'').trim(),commercialId:String(f.get('commercialId')||'').trim(),currency:f.get('currency')};try{if($('logo-file').files[0])data.logo=await resizeLogo($('logo-file').files[0]);await record('settings.update',data);closeSheet();toast('تم تحديث هوية المحل في جميع المستندات');}catch(e){toast(e.message)}};
}

async function savePortableBackup(){
 const contents=JSON.stringify(buildPortableBackup(state.session.user.id,await allEvents()));
 const filename=backupFileName();const plugin=window.Capacitor?.Plugins?.QatfahNative;
 if(plugin?.saveJson){await plugin.saveJson({filename,content:contents});toast('حُفظت النسخة في الموقع الذي اخترته');return;}
 const blob=new Blob([contents],{type:'application/json'});const file=new File([blob],filename,{type:'application/json'});
 if(navigator.share&&navigator.canShare?.({files:[file]})){await navigator.share({files:[file],title:'نسخة قطفة الاحتياطية'});return;}
 downloadBlob(blob,filename);toast('تم تنزيل نسخة JSON');
}
async function importPortableBackup(contents){
 const data=parsePortableBackup(contents,state.session.user.id);
 if(!confirm(`استعادة ${data.events.length} سجل؟ سيتم دمج السجلات دون حذف البيانات الموجودة.`))return;
 await importEvents(data.events.map(x=>({...x,synced:true})));
 state.events=await allEvents();render();toast('نجحت الاستعادة، وتوفرت الفواتير والعملاء والأصناف والشعار');
}
async function restorePortableBackup(){
 const plugin=window.Capacitor?.Plugins?.QatfahNative;
 if(plugin?.openJson){const r=await plugin.openJson();await importPortableBackup(r.content);return;}
 $('backup-file').click();
}
function openBackup(){
 showSheet('النسخ الاحتياطي عبر الهاتف',`<p class="hint">لا تحتاج إلى Google Cloud أو أي خادم. يحفظ أندرويد الملف في المكان الذي تختاره، بما فيه Google Drive إذا كان مثبتًا ومتصلًا بحسابك.</p>
 <div class="foot-actions"><button class="btn btn-primary" id="backup-save">حفظ نسخة في Google Drive أو الهاتف</button><button class="btn btn-light" id="backup-open">استعادة ملف من Google Drive</button></div>
 <input hidden type="file" accept="application/json,.json" id="backup-file" />
 <div class="hint">يشمل الملف جميع السجلات والعملاء والموردين والأصناف والمبيعات وحسابات العملات الثلاث وهوية المحل وشعاره. ملف JSON غير مشفر؛ اختر حساب Drive خاصًا، ولا ترسله للآخرين.</div>
 <div class="hint">للمزامنة بين جهازين، احفظ نسخة على الأول ثم استعدها على الآخر من نفس حساب التاجر. لا توجد مزامنة فورية أو تلقائية.</div>`);
 $('backup-save').onclick=()=>savePortableBackup().catch(e=>toast(e.message));
 $('backup-open').onclick=()=>restorePortableBackup().catch(e=>toast(e.message));
 $('backup-file').onchange=async e=>{try{if(e.target.files?.[0])await importPortableBackup(await e.target.files[0].text());}catch(err){toast(err.message)}};
}
function logout(force=false){if(!force&&!confirm('تسجيل الخروج؟ العمليات المحلية ستبقى على الجهاز.'))return;clearSessionObject();state.session=null;state.events=[];$('app-shell').hidden=true;$('login-screen').hidden=false;closeSheet();}
function action(id){if(!id)return;if(id==='sales')openInvoice('sale');else if(id==='purchases')openInvoice('purchase');else if(id==='customer')openParty('customer');else if(id==='supplier')openParty('supplier');else if(id==='receipts'||id.startsWith('receipts:'))openMoney('receipt',id.split(':')[1]||'');else if(id==='payments'||id.startsWith('payments:'))openMoney('payment',id.split(':')[1]||'');else if(id==='expenses')openMoney('expense');else if(id==='statements'||id.startsWith('statement:'))openStatement(id.split(':')[1]||'');else if(id==='cashbook')openCashbook();else if(id==='money-services')openMoneyServices();else if(id==='items')openItems();else if(id==='daily-sales')openDailySales();else if(id.startsWith('editparty:'))openParty(getParty(id.split(':')[1])?.type||'customer',id.split(':')[1]);else if(id==='reports'||id==='settings')setScreen(id);else if(id==='whatsapp')openWhatsapp();else if(id==='backup')openBackup();else if(id==='profile')openProfile();else if(id==='logout')logout();}
async function eventAction(cmd){const [name,id]=cmd.split(':');const e=activeRecords(state.events).find(x=>x.id===id);if(!e)return toast('العملية غير موجودة');if(name==='reverse'){if(!confirm('إلغاء هذه العملية؟ سيتم الاحتفاظ بأثر الإلغاء ولا يمكن حذفه من السجل.'))return;await record('event.reverse',{ref:id,notes:'إلغاء من شاشة الفواتير'});return;}openEvent(id);if(name==='pdf')$('detail-pdf').click();if(name==='share')$('detail-wa').click();}
// Delegated handlers keep dynamic views functional after each render.
document.addEventListener('click',e=>{const nav=e.target.closest('[data-nav]');if(nav){setScreen(nav.dataset.nav);return;}const open=e.target.closest('[data-nav-open]');if(open){setScreen(open.dataset.navOpen);return;}const event=e.target.closest('[data-event]');if(event){eventAction(event.dataset.event).catch(x=>toast(x.message));return;}const btn=e.target.closest('[data-action]');if(btn){action(btn.dataset.action);return;}});
$('wa-pill').onclick=()=>state.session&&openWhatsapp();$('notifications-button').onclick=()=>state.session?.mode==='github'?checkSubscription().then(()=>toast('تمت مراجعة حالة الاشتراك')):toast('البيانات محلية. احفظ نسخة احتياطية من قسم الإعدادات.');
$('close-sheet').onclick=closeSheet;$('sheet-backdrop').onclick=ev=>{if(ev.target===$('sheet-backdrop'))closeSheet();};
$('login-form').onsubmit=async ev=>{ev.preventDefault();const f=new FormData(ev.target),button=ev.target.querySelector('button');button.disabled=true;
 try {if(!navigator.onLine)throw Error('أول تسجيل دخول يحتاج إنترنت للتحقق من الاشتراك. بعدها يمكنك العمل دون إنترنت لمدة 7 أيام');
 const user=await authenticate(f.get('username'),f.get('password'));
 const session={token:null,mode:'github',user,lastChecked:Date.now()};persistSessionObject(session);await activate(session);
 }catch(e){toast(e.message)}finally{button.disabled=false;}};


initial().catch(e=>{console.error(e);toast('تعذر فتح قاعدة البيانات المحلية: '+e.message);});
