/**
 * Mahwor home page: presentation only. No accounting write operations are performed here.
 * All links delegate to the original HASEELA app.js handlers and business modules.
 */
const paths = {
  journal:'<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/><path d="m15 17 2 2 4-4"/>',
  purchase:'<path d="M5 3h14v18H5zM9 8h6M9 12h6M9 16h4"/>',
  sale:'<path d="M3 5h2l2 10h12l2-7H7"/><path d="M10 12h7"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  cash:'<rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M7 9h10M7 15h10"/><circle cx="12" cy="12" r="2.6"/>',
  cube:'<path d="m12 2 9 5v10l-9 5-9-5V7l9-5ZM3 7l9 5 9-5M12 12v10"/>',
  users:'<circle cx="9" cy="8" r="3"/><path d="M3 20v-2a6 6 0 0 1 12 0v2M16 5a3 3 0 0 1 0 6m2 3a6 6 0 0 1 3 6"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4m10-4v4M3 10h18M8 15h3m3 0h3"/>',
  chart:'<path d="M3 21h18M6 17V9h3v8m3 0V3h3v14m3 0v-6h3v6"/>',
  stock:'<path d="M4 21V9l8-5 8 5v12H4zM9 21v-8h6v8M4 10h16"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3M5 5l2 2m10 10 2 2M19 5l-2 2M7 17l-2 2"/>',
  backup:'<ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v7c0 2 16 2 16 0V5M4 12v7c0 3 16 3 16 0v-7"/>',
  doc:'<path d="M6 3h9l4 4v14H6zM15 3v5h4M9 13h7m-7 4h7"/>',
  wallet:'<rect x="3" y="6" width="18" height="14" rx="2"/><path d="M3 10h18M15 15h3"/>',
  box:'<path d="M3 7 12 3l9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10"/>',
  bell:'<path d="M18 8a6 6 0 1 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>'
};
const icon = key => `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths[key]||paths.box}</svg>`;
const mainTiles = [
  ['simple-journal','قيد بسيط','القيود المحاسبية','journal','mint'],
  ['purchases','فاتورة مشتريات','إدارة المشتريات','purchase','gold'],
  ['sales','فاتورة مبيعات','إنشاء وإدارة المبيعات','sale','blue'],
  ['cashbook','حركة الصندوق','إيرادات ومصروفات','cash','sky'],
  ['items','الأصناف والمنتجات','إدارة الأصناف','cube','rose'],
  ['customer','إضافة عميل','إدارة العملاء والموردين','users','violet'],
  ['daily-sales','مبيعات يومية','إحصائيات اليوم','calendar','violet'],
  ['reports','التقارير','تقارير شاملة ودقيقة','chart','mint'],
  ['inventory','المخزون','متابعة المخزون','stock','gold']
];
const tools = [
  ['settings','الإعدادات','settings','sky'],
  ['users','المستخدمين','users','gold'],
  ['backup','النسخ الاحتياطي','backup','violet'],
  ['documents','المستندات','doc','mint']
];
// All operational sections from the top search are now visible on the home page.
const extra = [
  ['supplier','إضافة مورد','users'],['receipts','سند قبض','wallet'],
  ['payments','سند صرف','wallet'],['expenses','المصروفات','cash'],
  ['statements','كشف الحساب','doc'],['money-services','الصرافة والحوالات','wallet'],
  ['whatsapp','ربط واتساب','bell'],['trial-balance','ميزان المراجعة','chart']
];
export function renderMahworHome({target,events,summary,accountBalances,itemsCatalog,parties,activeRecords,describeEvent,chronologicalOrder,localDate,money,esc}) {
  const today = summary(events,localDate(),localDate());
  const cash = accountBalances(events)?.YER?.cash ?? 0;
  const people = parties(events);
  const itemCount = itemsCatalog(events).length;
  const customers = people.filter(p=>p.type!=='supplier').length;
  const recent=activeRecords(events).filter(e=>!['settings.update','party.add'].includes(e.type)).sort((a,b)=>chronologicalOrder(b,a)).slice(0,5);
  const kpis = [
    ['رصيد الصندوق',money(cash),'wallet','mint'],
    ['مبيعات اليوم',money(today.sales),'doc','violet'],
    ['إجمالي العملاء',String(customers),'users','mint'],
    ['إجمالي الأصناف',String(itemCount),'box','blue']
  ];
  target.innerHTML=`
    <section class="mahwor-hero" aria-label="إدارة أعمالك بكل سهولة">
      <div class="mahwor-hero-copy" dir="rtl"><span>إدارة أعمالك</span><strong>بكل سهولة</strong><i></i><p>محاسبة · مبيعات · مخزون<br>تقارير دقيقة لنمو أكثر</p></div>
      <img class="mahwor-hero-art" src="./assets/mahwor-hero.webp" alt="مخطط نمو المبيعات والمخزون" loading="eager" />
    </section>
    <section class="mahwor-kpis" aria-label="ملخص أعمالك">${kpis.map(([label,value,key,shade])=>`<div class="mahwor-kpi ${shade}"><span class="mahwor-kpi-icon">${icon(key)}</span><small>${label}</small><b dir="auto">${esc(value)}</b></div>`).join('')}</section>
    <section class="mahwor-tiles" aria-label="الخدمات الرئيسية">${mainTiles.map(([action,label,desc,key,shade])=>`<button type="button" data-action="${action}" class="mahwor-tile ${shade}"><span class="mahwor-tile-icon">${icon(key)}</span><strong>${label}</strong><small>${desc}</small><span class="mahwor-tile-arrow" aria-hidden="true">›</span></button>`).join('')}</section>
    <div class="mahwor-heading"><h2>أدوات سريعة</h2><span class="mahwor-heading-line"></span></div>
    <section class="mahwor-tools" aria-label="أدوات سريعة">${tools.map(([action,label,key,shade])=>`<button type="button" data-action="${action}" ${action==='settings'?'data-nav="settings"':''} class="mahwor-tool ${shade}">${icon(key)}<span>${label}</span></button>`).join('')}</section>
    <div class="mahwor-heading"><h2>بقية الأقسام المحاسبية</h2><span class="mahwor-heading-line"></span></div>
    <section class="mahwor-services" aria-label="جميع الأقسام المحاسبية">${extra.map(([action,label,key])=>`<button type="button" data-action="${action}" class="mahwor-service"><span class="mahwor-service-icon">${icon(key)}</span><span class="mahwor-service-label">${label}</span><span class="mahwor-service-arrow" aria-hidden="true">←</span></button>`).join('')}</section>
    <div class="mahwor-heading mahwor-recent-heading"><h2>آخر العمليات</h2><button type="button" data-nav-open="invoices">عرض الكل ←</button></div>
    <section class="mahwor-recent">${recent.length?recent.map(e=>{const d=describeEvent(e,people);return `<div class="mahwor-recent-row"><span class="mahwor-recent-icon">${icon('doc')}</span><div><b>${esc(d.title)} · ${esc(d.sub)}</b><small>${esc(String(e.at).slice(0,10))}</small></div><strong>${esc(money(d.amount,d.currency))}</strong></div>`;}).join(''):'<p class="mahwor-empty">لا توجد عمليات بعد. ابدأ بإنشاء فاتورة مبيعات.</p>'}</section>
  `;
}
