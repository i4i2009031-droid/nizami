/** Exchange, remittance and cash/bank desk: same Qatfah event store & theme.
 * This is fresh bookkeeping code informed by the supplied app's feature categories,
 * not a copy of compiled Flutter application code. */
import {CURRENCIES, money, dateOnly, activeRecords, parties} from './ledger.js';
import {validateExchange,validateRemittance,validateAccountTransfer,validateSettlement,unsettledRemittances,journalAudit,accountBalances,financialPostings,fromMinor,toMinor} from './money-services.js';

const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const $=id=>document.getElementById(id);
const choices=(chosen='YER')=>Object.entries(CURRENCIES).map(([v,c])=>`<option value="${v}" ${v===chosen?'selected':''}>${esc(c.label)} (${v})</option>`).join('');
const dateNow=()=>dateOnly(new Date().toISOString());
const getForm=(id)=>Object.fromEntries(new FormData($(id)));

/** Pass only existing Qatfah interface adapters, never create a competing store. */
export function createMoneyDesk({events,record,showSheet,closeSheet,toast,store,makePdf,sharePdf}){
  let savingMovement=false;
  const move=async(kind,payload)=>{
    if(savingMovement)return false;
    savingMovement=true;
    const buttons=[...document.querySelectorAll('#sheet-body form button[type="submit"], #sheet-body form button:not([type])')].map(button=>({button,disabled:button.disabled}));
    try{
      for(const {button} of buttons)button.disabled=true;
      await record(kind,payload);desk();toast('تم تسجيل العملية وربطها بالصندوق والتقارير');
      return true;
    }finally{
      savingMovement=false;
      for(const {button,disabled} of buttons)if(button.isConnected)button.disabled=disabled;
    }
  };
  function desk(){
    const balances=accountBalances(events()),pending=unsettledRemittances(events());
    const rows=Object.entries(balances).map(([c,b])=>`<div class="fx-balance-row"><div><b>${c}</b><small>${esc(CURRENCIES[c].label)}</small></div><div><small>الصندوق</small><b>${money(b.cash,c)}</b></div><div><small>البنك</small><b>${money(b.bank,c)}</b></div><div><small>حوالات معلقة</small><b>${money(b.remittanceDue,c)}</b></div></div>`).join('');
    showSheet('الصرافة وحركة الأموال',`<div class="hint">دفتر نقدي مستقل لكل عملة. عمليات الصرف تسجل مبلغًا واردًا ومبلغًا صادرًا وسعر الصرف، دون تحويل تلقائي للأرصدة بين العملات.</div>
      <div class="fx-balance-list">${rows}</div>
      <div class="fx-actions"><button type="button" class="btn btn-primary" id="fx-start">⇆ صرف عملة</button><button type="button" class="btn btn-light" id="rem-start">↗ إنشاء حوالة</button><button type="button" class="btn btn-light" id="rem-complete">✓ صرف حوالة (${pending.length})</button><button type="button" class="btn btn-light" id="fund-move">⇄ صندوق / بنك</button><button type="button" class="btn btn-light" id="fund-open">＋ رصيد افتتاحي</button><button type="button" class="btn btn-light" id="journal-open">▤ سجل القيود / PDF</button></div>
      <div class="hint">ملاحظات: لا يوجد احتساب تلقائي لفروق تقييم العملات أو تحويلات البنوك الفعلية. العمليات تسجل في هذا الجهاز وتدخل في النسخة الاحتياطية.</div>
      <h3 style="margin-top:18px">آخر حركات الصرافة والحوالات</h3>
      <div class="list-card">${activeRecords(events()).filter(e=>['money.exchange','fund.transfer','remittance.issue','remittance.settle','cash.open'].includes(e.type)).sort((a,b)=>b.at.localeCompare(a.at)).slice(0,20).map(e=>{const p=e.payload;let t=e.type==='money.exchange'?`صرف ${money(p.fromAmount,p.fromCurrency)} ⇆ ${money(p.toAmount,p.toCurrency)}`:e.type==='remittance.issue'?`حوالة ${esc(p.reference)} • ${money(p.amount,p.currency)}`:e.type==='remittance.settle'?`تسوية حوالة ${esc(p.reference)}`:e.type==='cash.open'?`رصيد افتتاحي ${money(p.amount,p.currency)}`:`تحويل صندوق / بنك ${money(p.amount,p.currency)}`;return `<div class="data-row"><div><b>${t}</b><small style="display:block;color:#7a8792">${esc(dateOnly(e.at))}</small></div></div>`;}).join('')||'<p class="hint">لا توجد حركات حتى الآن</p>'}</div>`);
    $('fx-start').onclick=exchangeForm;$('rem-start').onclick=remittanceForm;
    $('rem-complete').onclick=settleForm;$('fund-move').onclick=transferForm;
    $('fund-open').onclick=openingForm;$('journal-open').onclick=journalForm;
  }
  function exchangeForm(){
    showSheet('صرف العملات',`<div class="hint">حدد ما استلمه المحل وما دفعه للعميل؛ السعر الناتج هو كمية العملة المدفوعة مقابل وحدة من العملة المستلمة.</div>
      <form id="fx-form" class="sheet-form"><div class="grid-two"><label>العملة المستلمة<select name="fromCurrency">${choices('USD')}</select></label><label>العملة المصروفة<select name="toCurrency">${choices('YER')}</select></label></div>
      <div class="grid-two"><label>المبلغ المستلم<input name="fromAmount" type="number" inputmode="decimal" min="0.01" step="0.01" required></label><label>المبلغ المصروف<input name="toAmount" type="number" inputmode="decimal" min="0.01" step="0.01" required></label></div>
      <div class="grid-two"><label>رسوم العملية<input name="fee" type="number" min="0" step="0.01" value="0"></label><label>عملة الرسوم<select name="feeCurrency">${choices('YER')}</select></label></div>
      <label>العميل (اختياري)<select name="partyId"><option value="">عملية نقدية عامة</option>${parties(events()).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>
      <label>ملاحظات<input name="notes" maxlength="140" placeholder="اختياري"></label><div id="fx-live" class="hint"></div>
      <button class="btn btn-primary" type="submit">حفظ حركة الصرف</button></form>`);
    const f=$('fx-form'),preview=()=>{const x=getForm('fx-form');const a=Number(x.fromAmount),b=Number(x.toAmount);$('fx-live').textContent=a>0&&b>0&&x.fromCurrency!==x.toCurrency?`السعر التقريبي: ${Number((b/a).toFixed(6))} ${x.toCurrency} لكل 1 ${x.fromCurrency}`:'أدخل عملتين مختلفتين والمبلغين لعرض سعر الصرف';};
    f.addEventListener('input',preview);f.addEventListener('change',preview);preview();
    f.onsubmit=async ev=>{ev.preventDefault();try{const x=getForm('fx-form');if(x.fee==='')x.fee=0;const v=validateExchange(x);await move('money.exchange',{...v,partyId:x.partyId||'',notes:String(x.notes||'').trim()});}catch(err){toast(err.message);}};
  }
  function remittanceForm(){
    const ref=`QTF-${Date.now().toString(36).toUpperCase()}`;
    showSheet('إصدار حوالة',`<p class="hint">عند إنشاء حوالة، يستلم المحل قيمة الحوالة والرسوم، وتظهر عليه قيمة مستحقة إلى أن تُصرف. هذه سجلات داخلية فقط؛ لا ترسل أموالًا عبر بنك.</p>
      <form id="rem-form" class="sheet-form"><label>المرجع الفريد<input name="reference" value="${ref}" required maxlength="64"/></label>
      <label>المستفيد<input name="beneficiary" required maxlength="110" placeholder="اسم المستفيد"/></label>
      <label>المرسل المسجل (اختياري)<select name="partyId"><option value="">مرسل نقدي</option>${parties(events()).map(x=>`<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('')}</select></label>
      <label>العملة<select name="currency">${choices()}</select></label>
      <div class="grid-two"><label>المبلغ<input name="amount" type="number" min="0.01" step="0.01" required/></label><label>رسوم الحوالة<input name="fee" type="number" min="0" step="0.01" value="0"/></label></div>
      <label>البيان<input name="notes" maxlength="200"/></label><button class="btn btn-primary" type="submit">تسجيل الحوالة</button></form>`);
    $('rem-form').onsubmit=async e=>{e.preventDefault();try{const x=getForm('rem-form');x.beneficiary=x.beneficiary.trim();if(!x.beneficiary)throw Error('اسم المستفيد مطلوب');if(activeRecords(events()).some(e=>e.type==='remittance.issue'&&e.payload.reference===x.reference.trim()))throw Error('رقم الحوالة مستخدم مسبقًا');const p=validateRemittance(x);await move('remittance.issue',p);}catch(err){toast(err.message)}};
  }
  function settleForm(){
    const list=unsettledRemittances(events());
    showSheet('صرف الحوالات',`<p class="hint">اختَر الحوالة من السجل وتأكد من استلام المستفيد قبل تسجيل الصرف؛ لا يمكن صرفها مرتين.</p>${list.length?`<form id="rem-settle-form" class="sheet-form"><label>الحوالة المعلقة<select name="reference">${list.map(x=>`<option value="${esc(x.payload.reference)}">${esc(x.payload.reference)} — ${esc(x.payload.beneficiary)} — ${money(x.payload.amount,x.payload.currency)}</option>`).join('')}</select></label><button class="btn btn-primary" type="submit">تأكيد تسوية الحوالة</button></form>`:'<p class="hint">لا توجد حوالات معلقة</p>'}`);
    if($('rem-settle-form'))$('rem-settle-form').onsubmit=async ev=>{ev.preventDefault();try{const x=getForm('rem-settle-form'),issued=validateSettlement(events(),x.reference);if(!confirm(`تأكيد صرف ${money(issued.payload.amount,issued.payload.currency)} للمستفيد ${issued.payload.beneficiary}؟`))return;await move('remittance.settle',{issuedId:issued.id,reference:x.reference,currency:issued.payload.currency,amount:issued.payload.amount});}catch(err){toast(err.message)}};
  }
  function transferForm(){showSheet('تحويل النقدية بين الصندوق والبنك',`<div class="hint">ينقل المبلغ بين حسابي النقدية والبنك بنفس العملة، ولا يُنشئ دخلًا أو مصروفًا جديدًا.</div>
      <form id="fund-form" class="sheet-form"><label>العملة<select name="currency">${choices()}</select></label><div class="grid-two"><label>من<select name="from"><option value="cash">الصندوق</option><option value="bank">البنك</option></select></label><label>إلى<select name="to"><option value="bank">البنك</option><option value="cash">الصندوق</option></select></label></div>
      <label>المبلغ<input name="amount" type="number" required min="0.01" step="0.01"/></label><button class="btn btn-primary">حفظ التحويل</button></form>`);
      $('fund-form').onsubmit=async e=>{e.preventDefault();try{await move('fund.transfer',validateAccountTransfer(getForm('fund-form')));}catch(x){toast(x.message)}};
  }
  function openingForm(){showSheet('رصيد افتتاحي للصندوق',`<div class="hint">لإدخال رصيد المحل النقدي قبل بدء تسجيل العمليات. لا تضف الرصيد نفسه مرتين.</div><form id="cash-open-form" class="sheet-form"><label>العملة<select name="currency">${choices()}</select></label><label>الحساب<select name="account"><option value="cash">الصندوق</option><option value="bank">البنك</option></select></label><label>المبلغ<input name="amount" type="number" required min="0.01" step="0.01"/></label><button class="btn btn-primary">تسجيل الرصيد</button></form>`);
    $('cash-open-form').onsubmit=async e=>{e.preventDefault();const x=getForm('cash-open-form');try{const amount=fromMinor(toMinor(x.amount,x.currency),x.currency);if(amount<=0)throw Error('أدخل مبلغًا صحيحًا');await move('cash.open',{...x,amount});}catch(err){toast(err.message)}};
  }
  function journalForm(){const audit=journalAudit(events()),postings=audit.postings.slice().reverse();showSheet('سجل القيود المزدوجة',`<p class="hint">${audit.balanced?'✓ جميع القيود المالية متوازنة داخل كل عملة':'تنبيه: توجد قيود غير متوازنة؛ راجع البيانات.'} • القيد يعرض المدين والدائن لكل عملية بعملة مستقلة. لا يمثل احتسابًا كاملًا للأرباح أو فروق أسعار الصرف.</p>
    <div class="table-scroll"><table class="report-table"><thead><tr><th>التاريخ</th><th>العملة</th><th>الحساب</th><th>مدين</th><th>دائن</th></tr></thead><tbody>${postings.slice(0,65).map(x=>`<tr><td>${dateOnly(x.at)}</td><td>${x.currency}</td><td>${esc(x.account)}</td><td>${x.side==='debit'?money(fromMinor(x.units,x.currency),x.currency):'—'}</td><td>${x.side==='credit'?money(fromMinor(x.units,x.currency),x.currency):'—'}</td></tr>`).join('')||'<tr><td colspan="5">لا توجد قيود</td></tr>'}</tbody></table></div><div class="foot-actions"><button id="journal-pdf" class="btn btn-primary">إنشاء PDF لكامل القيود</button><button id="journal-back" class="btn btn-light">رجوع</button></div>`);
    $('journal-back').onclick=desk;
    $('journal-pdf').onclick=async()=>{try{const s=store(),blob=await makePdf({title:'سجل القيود المزدوجة',brand:s.name,logo:s.logo,address:s.address,contact:s.phone,columns:['التاريخ','العملة','الحساب','مدين','دائن'],rows:postings.map(x=>[dateOnly(x.at),x.currency,x.account,x.side==='debit'?money(fromMinor(x.units,x.currency),x.currency):'—',x.side==='credit'?money(fromMinor(x.units,x.currency),x.currency):'—']),footer:audit.balanced?'جميع القيود متوازنة حسب العملة':'توجد قيود غير متوازنة'});await sharePdf(blob,`Qatfah-Journal-${dateNow()}.pdf`);}catch(e){toast(e.message)}};
  }
  return desk;
}
