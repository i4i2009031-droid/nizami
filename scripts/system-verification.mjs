/** Real Chromium UI/IndexedDB/canvas verification. Only the Android transport
 * boundary is simulated. This file never connects to WhatsApp or GitHub. */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,dirname,extname,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const output=resolve(process.env.QATFAH_VERIFICATION_OUTPUT||resolve(root,'verification-output'));
const cycles=Number(process.env.QATFAH_VERIFICATION_CYCLES||5);
const required=['identity','catalog','cash_sales','credit_sales','purchases_vouchers','journals','cash_reports','whatsapp_contract','persistence'];
const requiredPdfKinds=['invoice','voucher','simple-journal','transfer-source','transfer-destination','statement','cashbook','daily-sales','yearly-report'];
const results={schema:1,startedAt:new Date().toISOString(),fixtureData:'Synthetic representative Yemeni merchant data; no real messages sent.',transport:'SIMULATED_ANDROID_BOUNDARY',liveWhatsapp:{status:'NOT_RUN',reason:'No authenticated Android WhatsApp session is attached to this runner.'},cycles:[],documents:[],errors:[]};
let playwright;
try{playwright=await import('playwright');}
catch{
 const moduleRoot=process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES;
 if(!moduleRoot)throw Error('Install playwright or set CODEX_PRIMARY_RUNTIME_NODE_MODULES');
 playwright=await import(pathToFileURL(resolve(moduleRoot,'playwright/index.mjs')).href);
}
const {chromium}=playwright;
await mkdir(resolve(output,'pdfs'),{recursive:true});
await mkdir(resolve(output,'screenshots'),{recursive:true});
const webroot=resolve(root,'dist/client');
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.svg':'image/svg+xml','.webmanifest':'application/manifest+json'};
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname),path=resolve(webroot,'.'+pathname+(pathname.endsWith('/')?'index.html':''));
  if(!path.startsWith(webroot+sep)){res.writeHead(403).end();return;}
  const bytes=await readFile(path);res.writeHead(200,{'Content-Type':mime[extname(path)]||'application/octet-stream','Cache-Control':'no-store'}).end(bytes);
 }catch{res.writeHead(404).end('Not found');}
});
await new Promise((ok,bad)=>{server.once('error',bad);server.listen(0,'127.0.0.1',ok);});
const base=`http://127.0.0.1:${server.address().port}`;
let browser;
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const factor=currency=>currency==='YER'?1:100;
const displayAmount=(units,currency)=>units/factor(currency);
const currencyCodes=['YER','SAR','USD'];
const json=value=>JSON.stringify(value,null,2);
const dialogsByPage=new WeakMap();
// Expected values are formatted from the independent integer-unit oracle. Do
// not use the application's money() or summary() to calculate expected results.
const expectedMoney=(units,currency)=>new Intl.NumberFormat('en-US',{minimumFractionDigits:currency==='YER'?0:2,maximumFractionDigits:currency==='YER'?0:2}).format(displayAmount(units,currency))+' '+({YER:'ر.ي',SAR:'ر.س',USD:'$'}[currency]);
const expectedBalance=(units,currency)=>(units>0?'عليه / مطلوب من العميل':units<0?'له / مستحق للعميل':'خالص')+' '+expectedMoney(Math.abs(units),currency);
const compactPdfText=value=>String(value).replace(/[\u2066-\u2069]/g,'').replace(/\s+/g,'');

function initBoundary({cycle}){
 const audit=window.__qatfahVerification={active:false,forbidden:[],draws:[],requests:[],mode:'accepted',delay:80};
 const forbidden=kind=>{if(audit.active)audit.forbidden.push(kind);throw Error('Verification blocked external UI: '+kind);};
 window.open=()=>forbidden('window.open');
 Object.defineProperty(navigator,'share',{configurable:true,value:()=>forbidden('navigator.share')});
 const originalModal=window.HTMLDialogElement?.prototype.showModal;
 if(originalModal)HTMLDialogElement.prototype.showModal=function(){if(audit.active)return forbidden('showModal');return originalModal.call(this);};
 const originalAnchor=HTMLAnchorElement.prototype.click;
 HTMLAnchorElement.prototype.click=function(){if(audit.active&&(this.href.startsWith('blob:')||this.download))return forbidden('download_or_preview');return originalAnchor.call(this);};
 const originalText=CanvasRenderingContext2D.prototype.fillText;
 CanvasRenderingContext2D.prototype.fillText=function(value,...args){if(audit.active)audit.draws.push({kind:'text',value:String(value),connected:this.canvas.isConnected});return originalText.call(this,value,...args);};
 const originalImage=CanvasRenderingContext2D.prototype.drawImage;
 CanvasRenderingContext2D.prototype.drawImage=function(value,...args){if(audit.active)audit.draws.push({kind:'image',source:value.currentSrc||value.src||'',connected:this.canvas.isConnected});return originalImage.call(this,value,...args);};
 new MutationObserver(changes=>{
  if(!audit.active)return;
  for(const change of changes){
   if(change.type==='attributes'&&change.target.id==='sheet-backdrop'&&change.attributeName==='hidden'&&change.oldValue!==null&&!change.target.hidden)audit.forbidden.push('sheet_opened');
   if(change.type==='childList')for(const item of change.addedNodes){if(item.nodeType===1&&(item.matches?.('dialog,iframe,object,embed')||item.querySelector?.('dialog,iframe,object,embed')))audit.forbidden.push('preview_or_dialog_inserted');}
  }
 }).observe(document,{subtree:true,childList:true,attributes:true,attributeOldValue:true,attributeFilter:['hidden']});
 const plugin={
  whatsappConnectionStatus:async()=>({status:'connected',linked:true,permanentlyLinked:true,transportReady:true}),
  whatsappSendStatus:async({requestId}={})=>({status:'sending',stage:'send_document',requestId}),
  sendWhatsAppInApp:async payload=>{
   audit.requests.push(structuredClone(payload));await new Promise(ok=>setTimeout(ok,audit.delay));
   if(audit.mode==='unlinked')return {status:'error',submitted:false,dispatched:false,safeToFallback:true,code:'not_linked',message:'اربط واتساب من الإعدادات',requestId:payload.requestId};
   return {status:'submitted',submitted:true,dispatched:true,ack:1,messageId:'CONTRACT_ONLY_'+cycle+'_'+audit.requests.length,deliveryConfirmed:false,delivered:false,requestId:payload.requestId};
  },
  sendWhatsAppIntent:()=>forbidden('android_intent'),
  showWhatsApp:()=>forbidden('whatsapp_auth'),
  openWhatsApp:()=>forbidden('whatsapp_auth'),
 };
 window.Capacitor={Plugins:{QatfahNative:plugin,Share:{share:()=>forbidden('native_share_sheet')},Browser:{open:()=>forbidden('native_browser')}}};
 const session={mode:'demo',user:{id:'verification-'+cycle,username:'qa-'+cycle,storeName:'QA',expiresAt:'2099-12-31'},lastChecked:Date.now()};
 localStorage.setItem('qatfah_session',JSON.stringify(session));
}
async function saved(page,note){
 await page.waitForFunction(async value=>{const s=await import('./js/storage.js');return (await s.allEvents()).some(e=>e.payload?.notes===value);},note,{timeout:8000});
 return page.evaluate(async value=>{const s=await import('./js/storage.js');return (await s.allEvents()).find(e=>e.payload?.notes===value);},note);
}
async function events(page){return page.evaluate(async()=>{const s=await import('./js/storage.js');return s.allEvents();});}
async function closeSheets(page){for(let i=0;i<4&&await page.locator('#sheet-backdrop').isVisible();i++)await page.locator('#close-sheet').click();}
async function home(page){await closeSheets(page);await page.locator('[data-nav="home"]').click();}
async function action(page,id){await home(page);await page.locator(`#home-page [data-action="${id}"]`).click();}
async function invoices(page){await closeSheets(page);await page.locator('[data-nav="invoices"]').click();}
async function snapshot(page,ids){return page.evaluate(async({customer,supplier})=>{
 const {allEvents}=await import('./js/storage.js'),ledger=await import('./js/ledger.js'),money=await import('./js/money-services.js'),e=await allEvents();
 const cash={},balances={customer:{},supplier:{}};
 for(const c of ['YER','SAR','USD']){cash[c]=money.cashbook(e,c);balances.customer[c]=ledger.statement(e,customer,'0000-01-01','9999-12-31',c);balances.supplier[c]=ledger.statement(e,supplier,'0000-01-01','9999-12-31',c);}
 return {cash,balances,audit:money.journalAudit(e),accountBalances:money.accountBalances(e),eventCount:e.length};
},ids);}
async function verifyBalances(page,ids,oracle){
 const actual=await snapshot(page,ids);assert.equal(actual.audit.balanced,true,'double entries must balance for each event and currency');
 for(const c of currencyCodes){
  const expected=oracle.cash[c],cash=actual.cash[c],closing=expected.opening+expected.incoming-expected.outgoing;
  for(const key of ['opening','incoming','outgoing'])assert.equal(cash[key],displayAmount(expected[key],c),c+' cash '+key);
  assert.equal(cash.closing,displayAmount(closing,c),c+' cash closing');
  assert.equal(actual.accountBalances[c].cash,cash.closing,c+' dashboard agrees with cashbook');
  let running=0;
  for(const row of cash.rows){running+=(row.direction==='in'?1:-1)*Math.round(row.amount*factor(c));assert.equal(row.runningBalance,displayAmount(running,c),c+' running cash at '+row.id);assert.ok(row.source&&row.at);}
  for(const role of ['customer','supplier']){
   const statement=actual.balances[role][c];assert.equal(statement.closing,displayAmount(oracle.balances[role][c],c),role+' '+c+' balance');
   let balance=statement.opening;
   for(const row of statement.rows){balance=(Math.round(balance*factor(c))+Math.round(row.change*factor(c)))/factor(c);assert.equal(row.balance,balance,'statement running balance');}
  }
 }
 return actual;
}
async function verifyReportMath(page,oracle,date){
 const actual=await page.evaluate(async date=>{
  const {allEvents}=await import('./js/storage.js'),ledger=await import('./js/ledger.js'),records=await allEvents(),year=date.slice(0,4);
  return Object.fromEntries(['YER','SAR','USD'].map(currency=>[currency,{
   day:ledger.summary(records,date,date,currency),
   year:ledger.summary(records,year+'-01-01',year+'-12-31',currency),
   dailyGroups:ledger.groupedSummary(records,date,date,'day',currency),
   annualGroups:ledger.groupedSummary(records,year+'-01-01',year+'-12-31','year',currency)
  }]));
 },date);
 const amounts=['sales','purchases','expenses','receipts','payments','cashSales','cashPurchases'];
 for(const currency of currencyCodes){
  const expected=oracle.activity[currency],cash=oracle.cash[currency],closing=cash.opening+cash.incoming-cash.outgoing;
  for(const period of ['day','year']){
   const report=actual[currency][period];
   for(const field of amounts)assert.equal(report[field],displayAmount(expected[field],currency),`${currency} ${period} report ${field}`);
   assert.equal(report.count,expected.count,`${currency} ${period} report count`);
   assert.equal(report.tradingEstimate,displayAmount(expected.sales-expected.purchases-expected.expenses,currency),`${currency} ${period} trading estimate`);
   for(const [field,units] of Object.entries({cashMovement:cash.incoming-cash.outgoing,cashOpening:cash.opening,cashIncoming:cash.incoming,cashOutgoing:cash.outgoing,cashClosing:closing}))assert.equal(report[field],displayAmount(units,currency),`${currency} ${period} report ${field}`);
  }
  for(const [key,period] of [['dailyGroups',date],['annualGroups',date.slice(0,4)]]){
   assert.equal(actual[currency][key].length,1,`${currency} ${key} has one accounting period`);
   assert.equal(actual[currency][key][0].period,period);
   for(const field of amounts)assert.equal(actual[currency][key][0][field],displayAmount(expected[field],currency),`${currency} ${key} ${field}`);
   assert.equal(actual[currency][key][0].count,expected.count,`${currency} ${key} operation count`);
  }
 }
 return {currencies:currencyCodes,date,periods:['day','year'],independentOracle:true};
}
async function assertDailyReportUi(page,currency,oracle){
 const expected=oracle.activity[currency],values=await page.locator('#daily-results .summary-box b').allTextContents();
 assert.deepEqual(values.map(x=>x.trim()),[expectedMoney(expected.sales,currency),expectedMoney(expected.cashSales,currency),expectedMoney(expected.sales-expected.cashSales,currency),String(expected.salesCount)],'daily visible total, collected, credit and invoice count');
 assert.equal(await page.locator('#daily-results .data-row').count(),expected.salesCount,'daily invoice rows');
}
async function assertAnnualReportUi(page,currency,oracle,year){
 const expected=oracle.activity[currency],cash=oracle.cash[currency];
 const cards=await page.locator('#report-results .summary-box').evaluateAll(elements=>Object.fromEntries(elements.map(el=>[el.querySelector('small').textContent.trim(),el.querySelector('b').textContent.trim()])));
 assert.deepEqual(cards,{
  'المبيعات':expectedMoney(expected.sales,currency),'المشتريات':expectedMoney(expected.purchases,currency),'المصروفات':expectedMoney(expected.expenses,currency),
  'حركة الصندوق':expectedMoney(cash.incoming-cash.outgoing,currency),'سندات قبض':expectedMoney(expected.receipts,currency),'سندات صرف':expectedMoney(expected.payments,currency),
  'نتيجة تقديرية':expectedMoney(expected.sales-expected.purchases-expected.expenses,currency),'عدد العمليات':String(expected.count)
 },'annual visible cards match independent amounts');
 const rows=await page.locator('#report-results .report-table tbody tr').evaluateAll(elements=>elements.map(el=>[...el.querySelectorAll('td')].map(td=>td.textContent.trim())));
 assert.deepEqual(rows,[[year,expectedMoney(expected.sales,currency),expectedMoney(expected.purchases,currency),expectedMoney(expected.expenses,currency)]],'annual visible table matches independent amounts');
}
function assertCycleDocuments(cycle){
 const docs=results.documents.filter(d=>d.cycle===cycle);
 assert.deepEqual(docs.map(d=>d.kind).sort(),[...requiredPdfKinds].sort(),`cycle ${cycle}: every required PDF kind exactly once`);
 assert.equal(new Set(docs.map(d=>d.path)).size,requiredPdfKinds.length,'document captures use distinct files');
 assert.ok(docs.every(d=>d.identityVerified&&d.offscreenVerified&&d.zeroPopupVerified));
 for(const kind of ['statement','cashbook','daily-sales','yearly-report'])assert.equal(docs.find(d=>d.kind===kind).accountingTextVerified,true,kind+' PDF accounting content verified');
 return docs;
}
function assertCycleComplete(record){
 for(const key of required)assert.equal(record.sections[key]?.status,'PASS',`cycle ${record.cycle}: ${key} completed`);
 for(const currency of currencyCodes)for(const kind of ['debit','credit','transfer'])assert.equal(record.metrics.journals[currency][kind],1,`cycle ${record.cycle}: exactly one ${currency} ${kind}`);
 assertCycleDocuments(record.cycle);
}
async function configureIdentity(page,cycle){
 const names=['متجر صنعاء للتجارة','متجر عدن للمواد الغذائية','تموينات تعز','متجر إب التجاري','تجارة حضرموت'];
 const profile={name:names[cycle-1]+' - تجربة '+cycle,address:['صنعاء - حدة','عدن - المنصورة','تعز - شارع جمال','إب - الظهار','المكلا - الديس'][cycle-1],phone:'+967 77 123 45 '+String(60+cycle),currency:'YER'};
 await page.locator('[data-nav="settings"]').click();await page.locator('[data-action="profile"]').click();
 for(const key of ['name','address','phone'])await page.locator(`#profile-form [name="${key}"]`).fill(profile[key]);
 await page.locator('#profile-form [name="currency"]').selectOption('YER');
 await page.locator('#logo-file').setInputFiles(resolve(output,'fixtures','logo-'+cycle+'.png'));
 await page.locator('#profile-form [type="submit"]').click();await page.locator('#profile-form').waitFor({state:'detached'});
 const stored=await page.evaluate(async()=>{const s=await import('./js/storage.js'),l=await import('./js/ledger.js');return l.currentSettings(await s.allEvents());});
 for(const key of ['name','address','phone'])assert.equal(stored[key],profile[key]);
 assert.match(stored.logo,/^data:image\/jpeg;base64,/);assert.equal(await page.locator('#store-name').textContent(),profile.name);
 return stored;
}
async function addParty(page,{name,phone,type='customer'}){
 await action(page,type==='customer'?'customer':'supplier');await page.locator('#party-form [name="name"]').fill(name);await page.locator('#party-form [name="phone"]').fill(phone);await page.locator('#party-form [type="submit"]').click();await page.locator('#party-form').waitFor({state:'detached'});
 const p=(await events(page)).find(e=>e.type==='party.add'&&e.payload.name===name)?.payload;assert.ok(p);assert.equal(p.phone,'967'+phone);return p;
}
async function addItem(page,cycle){
 const item={name:['أرز بسمتي','سكر أبيض','دقيق قمح','زيت طبخ','شاي أحمر'][cycle-1]+' '+cycle,units:{YER:200+cycle*13,SAR:725+cycle*37,USD:240+cycle*9}};
 await action(page,'items');await page.locator('#new-item').click();await page.locator('#item-form [name="name"]').fill(item.name);await page.locator('#item-form [name="barcode"]').fill('62800000000'+cycle);
 for(const c of currencyCodes)await page.locator(`#item-form [name="${c}"]`).fill(String(displayAmount(item.units[c],c)));
 await page.locator('#item-form [type="submit"]').click();await page.locator('#new-item').waitFor();await closeSheets(page);return item;
}
async function opening(page,currency,units,oracle){
 await action(page,'money-services');await page.locator('#fund-open').click();await page.locator('#cash-open-form [name="currency"]').selectOption(currency);await page.locator('#cash-open-form [name="amount"]').fill(String(displayAmount(units,currency)));await page.locator('#cash-open-form button').click();await page.locator('#fund-open').waitFor();oracle.cash[currency].opening+=units;oracle.activity[currency].count++;
}
async function makeInvoice(page,{kind='sale',party,currency,item,qty,priceUnits,paidUnits,note,daily=false,lineCount=1}){
 if(daily){await action(page,'daily-sales');assert.ok((await page.locator('#daily-party').textContent()).includes(party.name));await page.locator('#daily-party').selectOption(party.id);await page.locator('#daily-currency').selectOption(currency);await page.locator('#daily-add-sale').click();}
 else await action(page,kind==='sale'?'sales':'purchases');
 assert.ok((await page.locator('#invoice-party').textContent()).includes(party.name));assert.ok((await page.locator('#qatfah-products').innerHTML()).includes(item.name));
 await page.locator('#invoice-party').selectOption(party.id);await page.locator('#invoice-currency').selectOption(currency);await page.locator('.item-title').fill(item.name);await page.locator('.item-title').dispatchEvent('change');
 assert.equal(Number(await page.locator('.item-price').inputValue()),displayAmount(item.units[currency],currency),'catalog price is live');
 await page.locator('.item-price').fill(String(displayAmount(priceUnits,currency)));await page.locator('.item-qty').fill(String(qty));
 for(let i=1;i<lineCount;i++){await page.locator('#add-invoice-item').click();const row=page.locator('.item-entry').nth(i);await row.locator('.item-title').fill(item.name);await row.locator('.item-title').dispatchEvent('change');await row.locator('.item-price').fill(String(displayAmount(priceUnits,currency)));await row.locator('.item-qty').fill(String(qty));}
 await page.locator('#invoice-paid').fill(String(displayAmount(paidUnits,currency)));await page.locator('#invoice-form [name="notes"]').fill(note);await page.locator('#invoice-form [type="submit"]').click();const e=await saved(page,note);assert.equal(e.payload.total,displayAmount(priceUnits*qty*lineCount,currency));assert.equal(e.payload.paid,displayAmount(paidUnits,currency));await closeSheets(page);return e;
}
async function voucher(page,{kind,party,currency,units,note}){
 await action(page,kind);if(party)await page.locator('#money-form [name="partyId"]').selectOption(party.id);else await page.locator('#money-form [name="category"]').fill('نقل بضائع');
 await page.locator('#money-form [name="currency"]').selectOption(currency);await page.locator('#money-form [name="amount"]').fill(String(displayAmount(units,currency)));await page.locator('#money-form [name="notes"]').fill(note);await page.locator('#money-form [type="submit"]').click();return saved(page,note);
}
async function simpleJournal(page,{kind,party,to,currency,units,method,note}){
 await closeSheets(page);await page.locator('[data-nav="journal"]').click();await page.locator(`[data-journal-kind="${kind}"]`).click();await page.locator('#journal-party').selectOption(party.id);
 if(kind==='transfer'){await page.locator('#journal-to-party').selectOption(to.id);assert.equal(await page.locator('#journal-method').isDisabled(),true);assert.equal(await page.locator('#journal-method').inputValue(),'book');}
 else await page.locator('#journal-method').selectOption(method);
 await page.locator('#journal-currency').selectOption(currency);await page.locator('#journal-amount').fill(String(displayAmount(units,currency)));await page.locator('#journal-notes').fill(note);await page.locator('#journal-save').click();const e=await saved(page,note);assert.equal(e.type,'journal.create');assert.equal(e.payload.amount,displayAmount(units,currency));return e;
}
async function directCash(page,{currency,units,direction,category,note}){
 await action(page,'cashbook');await page.locator(`[data-cash-currency="${currency}"]`).click();await page.locator('#cashbook-add').click();await page.locator('#cash-direction').selectOption(direction);await page.locator('#cash-category').selectOption(category);await page.locator('#cash-amount').fill(String(displayAmount(units,currency)));await page.locator('#cash-movement-form [name="notes"]').fill(note);await page.locator('#cash-save').click();return saved(page,note);
}
async function sendDocument(page,selector,{cycle,kind,phone,profile,doubleClick=false,expectError=false,businessDate='',expectedPdfText=[]}){
 const button=page.locator(selector).first();await button.waitFor();
 const dialogCount=(dialogsByPage.get(page)||[]).length;
 const before=await page.evaluate(()=>{const v=window.__qatfahVerification;v.active=true;v.forbidden=[];v.draws=[];return {calls:v.requests.length,hidden:document.getElementById('sheet-backdrop').hidden,title:document.getElementById('sheet-title').textContent,href:location.href};});
 if(doubleClick)await button.evaluate(el=>{el.click();el.click();});else await button.click();
 const deadline=Date.now()+10000;let state;
 while(Date.now()<deadline){state=await button.getAttribute('data-send-state');if(['sent','delivered','error'].includes(state))break;await sleep(30);}
 const after=await page.evaluate(()=>{const v=window.__qatfahVerification;v.active=false;return {requests:v.requests,forbidden:v.forbidden,draws:v.draws,hidden:document.getElementById('sheet-backdrop').hidden,title:document.getElementById('sheet-title').textContent,href:location.href,rootPreserved:window.__rootRef===document.getElementById('wa-engine-root')};});
 assert.deepEqual(after.forbidden,[],'zero popup/share/preview assertions');assert.deepEqual((dialogsByPage.get(page)||[]).slice(dialogCount),[],'zero alert/confirm/prompt during document sending');assert.equal(after.hidden,before.hidden);assert.equal(after.title,before.title);assert.equal(after.href,before.href);assert.equal(after.rootPreserved,true,'root survives all navigation');
 assert.equal(after.requests.length,before.calls+1,'one native dispatch per button activation');assert.equal(await button.isDisabled(),false,'button unlocks in finally');
 const request=after.requests.at(-1);assert.equal(request.phone,phone,'document sent to selected exact Yemeni phone');assert.ok(request.requestId);assert.match(request.filename,/\.pdf$/i);assert.ok(request.caption.includes(profile.name));
 if(expectError){assert.equal(state,'error','transport failure cannot become success');return {status:'PASS',negative:true};}
 assert.equal(state,'sent',await button.textContent());assert.ok((await button.getAttribute('title')).includes('لم يؤكد وصوله'),'ack1 is not recipient delivery');
 const bytes=Buffer.from(request.base64,'base64');assert.equal(bytes.subarray(0,5).toString(),'%PDF-');assert.ok(bytes.length>10000);assert.ok(bytes.includes(Buffer.from('%%EOF')));
 const texts=after.draws.filter(x=>x.kind==='text').map(x=>x.value);for(const field of ['name','phone','address'])assert.ok(texts.some(x=>x.includes(profile[field])),kind+' PDF includes current '+field);
 const drawnText=compactPdfText(texts.join(' '));
 for(const expected of expectedPdfText)assert.ok(drawnText.includes(compactPdfText(expected)),`${kind} PDF contains independently expected content: ${expected}`);
 if(businessDate)assert.ok(texts.some(x=>x.includes(businessDate)),'invoice PDF uses the Yemen business date');
 assert.ok(after.draws.some(x=>x.kind==='image'&&x.source===profile.logo),kind+' PDF includes current logo');assert.ok(after.draws.every(x=>!x.connected),'PDF canvas remains offscreen');
 const path=resolve(output,'pdfs',`cycle-${String(cycle).padStart(2,'0')}-${kind}.pdf`);await writeFile(path,bytes);
 const entry={cycle,kind,path,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),recipient:phone,identityVerified:true,offscreenVerified:true,zeroPopupVerified:true,accountingTextVerified:expectedPdfText.length>0,expectedPdfText,nativeDispatches:1,transport:'SIMULATED_ANDROID_BOUNDARY',ack:1,liveDelivery:false};results.documents.push(entry);return entry;
}
async function cashUiAssert(page,c,oracle,sourceNumbers=[]){
 await action(page,'cashbook');await page.locator(`[data-cash-currency="${c}"]`).click();
 for(const key of ['opening','incoming','outgoing'])assert.equal(Number(await page.locator('#cashbook-'+key).getAttribute('data-value')),displayAmount(oracle.cash[c][key],c));
 const expected=oracle.cash[c].opening+oracle.cash[c].incoming-oracle.cash[c].outgoing;assert.equal(Number(await page.locator('#cashbook-closing').getAttribute('data-value')),displayAmount(expected,c));
 const rows=await page.locator('#cashbook-table tbody tr[data-event-id]').evaluateAll(elements=>elements.map(el=>({...el.dataset})));
 let running=0;for(const row of rows){running+=(row.direction==='in'?1:-1)*Math.round(Number(row.amount)*factor(c));assert.equal(Number(row.balance),displayAmount(running,c));}assert.equal(running,expected);
 const text=await page.locator('#cashbook-table').textContent();for(const number of sourceNumbers)assert.ok(text.includes(number),'cashbook displays the complete source invoice number '+number);
}
async function runCycle(cycle){
 const record={cycle,status:'RUNNING',sections:{},metrics:{journals:{YER:{debit:0,credit:0,transfer:0},SAR:{debit:0,credit:0,transfer:0},USD:{debit:0,credit:0,transfer:0}}}};results.cycles.push(record);
 const context=await browser.newContext({viewport:{width:430,height:932},deviceScaleFactor:1,timezoneId:'Asia/Aden',locale:'ar-YE',serviceWorkers:'block'});
 await context.route('**/*',route=>route.request().url().startsWith(base+'/')?route.continue():route.abort());
 await context.addInitScript(initBoundary,{cycle});const page=await context.newPage();page.setDefaultTimeout(8000);const pageErrors=[];page.on('pageerror',e=>pageErrors.push(e.message));
 const dialogs=[];dialogsByPage.set(page,dialogs);
 page.on('dialog',async dialog=>{
  const issue={cycle,type:'unexpected_javascript_dialog',dialog:dialog.type(),message:dialog.message()};dialogs.push(issue);results.errors.push(issue);
  try{await dialog.dismiss();}catch(error){pageErrors.push('Could not dismiss unexpected dialog: '+error.message);}
 });
 context.on('page',p=>{if(p!==page)results.errors.push('Unexpected browser window during cycle '+cycle);});
 const section=async(key,work,{deferPdf=false}={})=>{console.log(`Cycle ${cycle}: ${key}`);try{const detail=await work();record.sections[key]={status:deferPdf?'PENDING_PDF':'PASS',...(detail||{})};}catch(error){record.sections[key]={status:'FAIL',error:error.stack};throw error;}};
 try{
  await page.goto(base+'/');await page.locator('#app-shell').waitFor({state:'visible'});
  await page.waitForFunction(()=>{const logo=document.getElementById('store-logo');return logo?.complete&&logo.naturalWidth>0;},null,{timeout:8000});
  record.initialBranding=await page.locator('#store-logo').evaluate(image=>({src:image.getAttribute('src'),naturalWidth:image.naturalWidth,naturalHeight:image.naturalHeight}));
  assert.ok(record.initialBranding.naturalWidth>0,'real restored branding loads before a test logo is configured');
  await page.evaluate(()=>{window.__rootRef=document.getElementById('wa-engine-root');});
  let profile,customer,supplier,item,cashSale,creditSale,cashPurchase,receipt,journal,transfer;
  const oracle={cash:Object.fromEntries(currencyCodes.map(c=>[c,{opening:0,incoming:0,outgoing:0}])),balances:{customer:{YER:0,SAR:0,USD:0},supplier:{YER:0,SAR:0,USD:0}},activity:Object.fromEntries(currencyCodes.map(c=>[c,{sales:0,purchases:0,expenses:0,receipts:0,payments:0,cashSales:0,cashPurchases:0,count:0,salesCount:0}]))};
  const currency=currencyCodes[(cycle-1)%3];
  await section('identity',async()=>{profile=await configureIdentity(page,cycle);return {brand:profile.name,logoChanged:true,documents:'pending actual captures for all document kinds'};},{deferPdf:true});
  await section('catalog',async()=>{
   customer=await addParty(page,{name:['محمد الصنعاني','أحمد العدني','خالد التعزي','علي الإبي','صالح الحضرمي'][cycle-1]+' - اختبار',phone:'77123456'+cycle});
   supplier=await addParty(page,{name:'مورد جملة - تجربة '+cycle,phone:'78123456'+cycle,type:'supplier'});item=await addItem(page,cycle);
   await page.locator('[data-nav="journal"]').click();assert.ok((await page.locator('#journal-party').textContent()).includes(customer.name));assert.ok((await page.locator('#journal-to-party').textContent()).includes(supplier.name));
   await page.locator('#journal-amount').fill('17');await page.locator('#journal-notes').fill('مسودة لا تضيع بعد الإضافة الفورية');await page.locator('#journal-add-party').click();await page.locator('#journal-party-name').fill('حساب فوري '+cycle);await page.locator('#journal-party-phone').fill('73123456'+cycle);await page.locator('#journal-party-save').click();await page.locator('#journal-quick-party').waitFor({state:'hidden'});assert.equal(await page.locator('#journal-amount').inputValue(),'17');assert.equal(await page.locator('#journal-notes').inputValue(),'مسودة لا تضيع بعد الإضافة الفورية');assert.ok((await page.locator('#journal-to-party').textContent()).includes('حساب فوري '+cycle));
   return {customer:customer.phone,supplier:supplier.phone,item:item.name,inlinePartyPreservesDraft:true};
  });
  const ids={customer:customer.id,supplier:supplier.id};
  for(const c of currencyCodes)await opening(page,c,c==='YER'?20000+cycle*250:20000+cycle*125,oracle);
  await verifyBalances(page,ids,oracle);
  await section('cash_sales',async()=>{
   const lineCount=cycle===5?12:1,total=item.units[currency]*2*lineCount;cashSale=await makeInvoice(page,{party:customer,currency,item,qty:2,priceUnits:item.units[currency],paidUnits:total,note:`C${cycle}-cash-sale`,daily:true,lineCount});oracle.cash[currency].incoming+=total;oracle.activity[currency].sales+=total;oracle.activity[currency].cashSales+=total;oracle.activity[currency].count++;oracle.activity[currency].salesCount++;await verifyBalances(page,ids,oracle);assert.equal(cashSale.payload.payment,'cash');return {currency,total:displayAmount(total,currency),customerDebt:0,lineCount};
  });
  await section('credit_sales',async()=>{
   const total=item.units[currency]*3;creditSale=await makeInvoice(page,{party:customer,currency,item,qty:3,priceUnits:item.units[currency],paidUnits:0,note:`C${cycle}-credit-sale`});oracle.balances.customer[currency]+=total;oracle.activity[currency].sales+=total;oracle.activity[currency].count++;oracle.activity[currency].salesCount++;const check=await verifyBalances(page,ids,oracle);assert.equal(check.cash[currency].rows.some(x=>x.id===creditSale.id),false,'credit sale excluded from cashbook');return {currency,total:displayAmount(total,currency),cashEffect:0};
  });
  await section('purchases_vouchers',async()=>{
   const price=Math.floor(item.units[currency]/2);
   cashPurchase=await makeInvoice(page,{kind:'purchase',party:supplier,currency,item,qty:1,priceUnits:price,paidUnits:price,note:`C${cycle}-cash-purchase`});oracle.cash[currency].outgoing+=price;oracle.activity[currency].purchases+=price;oracle.activity[currency].cashPurchases+=price;oracle.activity[currency].count++;
   await makeInvoice(page,{kind:'purchase',party:supplier,currency,item,qty:2,priceUnits:price,paidUnits:0,note:`C${cycle}-credit-purchase`});oracle.balances.supplier[currency]-=price*2;oracle.activity[currency].purchases+=price*2;oracle.activity[currency].count++;
   const received=Math.floor(item.units[currency]*3/4);receipt=await voucher(page,{kind:'receipts',party:customer,currency,units:received,note:`C${cycle}-receipt`});oracle.cash[currency].incoming+=received;oracle.balances.customer[currency]-=received;oracle.activity[currency].receipts+=received;oracle.activity[currency].count++;
   await voucher(page,{kind:'payments',party:supplier,currency,units:price,note:`C${cycle}-payment`});oracle.cash[currency].outgoing+=price;oracle.balances.supplier[currency]+=price;oracle.activity[currency].payments+=price;oracle.activity[currency].count++;
   const expense=currency==='YER'?31+cycle:117+cycle;await voucher(page,{kind:'expenses',currency,units:expense,note:`C${cycle}-expense`});oracle.cash[currency].outgoing+=expense;oracle.activity[currency].expenses+=expense;oracle.activity[currency].count++;await verifyBalances(page,ids,oracle);return {cashPurchase:true,creditPurchase:true,receipt:true,payment:true,expense:true};
  });
  await section('journals',async()=>{
   for(const c of currencyCodes){
    const debit=c==='YER'?300+cycle*11:3001+cycle*11,credit=cycle===5?debit*2:(c==='YER'?100+cycle*3:1003+cycle*7),moved=c==='YER'?50+cycle:501+cycle,method=cycle%2?'cash':'book';
    journal=await simpleJournal(page,{kind:'debit',party:customer,currency:c,units:debit,method,note:`C${cycle}-${c}-debit`});oracle.balances.customer[c]+=debit;if(method==='cash')oracle.cash[c].outgoing+=debit;record.metrics.journals[c].debit++;oracle.activity[c].count++;await verifyBalances(page,ids,oracle);
    await simpleJournal(page,{kind:'credit',party:customer,currency:c,units:credit,method,note:`C${cycle}-${c}-credit`});oracle.balances.customer[c]-=credit;if(method==='cash')oracle.cash[c].incoming+=credit;record.metrics.journals[c].credit++;oracle.activity[c].count++;await verifyBalances(page,ids,oracle);
    transfer=await simpleJournal(page,{kind:'transfer',party:customer,to:supplier,currency:c,units:moved,method:'book',note:`C${cycle}-${c}-transfer`});oracle.balances.customer[c]-=moved;oracle.balances.supplier[c]+=moved;record.metrics.journals[c].transfer++;oracle.activity[c].count++;const check=await verifyBalances(page,ids,oracle);assert.equal(check.cash[c].rows.some(x=>x.id===transfer.id),false);
   }
   await page.screenshot({path:resolve(output,'screenshots',`cycle-${cycle}-journal.png`),fullPage:true});return {perCurrency:record.metrics.journals,cashAndBookModesAcrossCycles:true};
  });
  await section('cash_reports',async()=>{
   if(cycle===5)for(let i=1;i<=12;i++){const units=10+i;await directCash(page,{currency,units,direction:'in',category:'capital',note:`C${cycle}-extra-capital-${i}`});oracle.cash[currency].incoming+=units;oracle.activity[currency].count++;}
   for(const c of currencyCodes){
    const deposit=c==='YER'?1000+cycle*53:4001+cycle*31,expense=c==='YER'?27+cycle:157+cycle;
    await directCash(page,{currency:c,units:deposit,direction:'in',category:'capital',note:`C${cycle}-${c}-capital`});oracle.cash[c].incoming+=deposit;oracle.activity[c].count++;
    await directCash(page,{currency:c,units:expense,direction:'out',category:'expense',note:`C${cycle}-${c}-direct-expense`});oracle.cash[c].outgoing+=expense;oracle.activity[c].expenses+=expense;oracle.activity[c].count++;
    await cashUiAssert(page,c,oracle,c===currency?[cashSale.payload.number||cashSale.payload.invoiceNumber,cashPurchase.payload.number||cashPurchase.payload.invoiceNumber]:[]);
   }
   await verifyBalances(page,ids,oracle);await page.screenshot({path:resolve(output,'screenshots',`cycle-${cycle}-cashbook.png`),fullPage:true});
   const businessDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden'}).format(new Date(cashSale.at));
   const reports=await verifyReportMath(page,oracle,businessDate);
   const future='2099-01-01';await page.locator('#cashbook-from').fill(future);await page.locator('#cashbook-from').dispatchEvent('change');assert.equal(Number(await page.locator('#cashbook-incoming').getAttribute('data-value')),0);assert.equal(Number(await page.locator('#cashbook-outgoing').getAttribute('data-value')),0);assert.equal(Number(await page.locator('#cashbook-closing').getAttribute('data-value')),displayAmount(oracle.cash.USD.opening+oracle.cash.USD.incoming-oracle.cash.USD.outgoing,'USD'));await page.locator('#cashbook-from').fill('');await page.locator('#cashbook-from').dispatchEvent('change');return {currencies:currencyCodes,openingAndDateFilters:true,reportMath:reports};
  },{deferPdf:true});
  await section('whatsapp_contract',async()=>{
   const activity=oracle.activity[currency],cash=oracle.cash[currency],businessDate=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Aden'}).format(new Date(cashSale.at));
   await invoices(page);
   await sendDocument(page,`[data-event="share:${cashSale.id}"]`,{cycle,kind:'invoice',phone:customer.phone,profile,doubleClick:true,businessDate});
   await sendDocument(page,`[data-event="share:${receipt.id}"]`,{cycle,kind:'voucher',phone:customer.phone,profile});
   await sendDocument(page,`[data-event="share:${journal.id}"]`,{cycle,kind:'simple-journal',phone:customer.phone,profile});
   await sendDocument(page,`[data-event="share:${transfer.id}:${customer.id}"]`,{cycle,kind:'transfer-source',phone:customer.phone,profile});
   await sendDocument(page,`[data-event="share:${transfer.id}:${supplier.id}"]`,{cycle,kind:'transfer-destination',phone:supplier.phone,profile});
   await page.evaluate(()=>window.__qatfahVerification.mode='unlinked');await sendDocument(page,`[data-event="share:${cashSale.id}"]`,{cycle,kind:'unlinked-negative',phone:customer.phone,profile,expectError:true});await page.evaluate(()=>window.__qatfahVerification.mode='accepted');
   await action(page,'statements');await page.locator('#statement-form [name="partyId"]').selectOption(customer.id);await page.locator('#statement-form [name="currency"]').selectOption(currency);await page.locator('#statement-form [type="submit"]').click();
   const balanceText=expectedBalance(oracle.balances.customer[currency],currency);
   assert.ok((await page.locator('#statement-result').textContent()).includes(balanceText),'visible statement balance matches independent oracle');
   await sendDocument(page,'#statement-wa',{cycle,kind:'statement',phone:customer.phone,profile,expectedPdfText:[customer.name,'الرصيد النهائي: '+balanceText]});
   await action(page,'cashbook');await page.locator(`[data-cash-currency="${currency}"]`).click();await page.locator('#cashbook-recipient-party').selectOption(customer.id);
   await sendDocument(page,'#cashbook-wa',{cycle,kind:'cashbook',phone:customer.phone,profile,expectedPdfText:[
    'الرصيد الافتتاحي: '+expectedMoney(cash.opening,currency),'الوارد: '+expectedMoney(cash.incoming,currency),'الصادر: '+expectedMoney(cash.outgoing,currency),'صافي الصندوق: '+expectedMoney(cash.opening+cash.incoming-cash.outgoing,currency),
    cashSale.payload.number||cashSale.payload.invoiceNumber,cashPurchase.payload.number||cashPurchase.payload.invoiceNumber
   ]});
   await action(page,'daily-sales');await page.locator('#daily-date').fill(businessDate);await page.locator('#daily-date').dispatchEvent('change');await page.locator('#daily-currency').selectOption(currency);await page.locator('#daily-recipient-party').selectOption(customer.id);assert.ok((await page.locator('#daily-results').textContent()).includes(customer.name));await assertDailyReportUi(page,currency,oracle);
   await sendDocument(page,'#daily-wa',{cycle,kind:'daily-sales',phone:customer.phone,profile,expectedPdfText:['عدد الفواتير: '+activity.salesCount,'إجمالي مبيعات اليوم: '+expectedMoney(activity.sales,currency),'الآجل: '+expectedMoney(activity.sales-activity.cashSales,currency),expectedMoney(activity.cashSales,currency)]});
   await closeSheets(page);await page.locator('[data-nav="reports"]').click();await page.locator('#report-currency').selectOption(currency);await page.locator('#group-mode').selectOption('year');const year=businessDate.slice(0,4);await page.locator('#date-from').fill(year+'-01-01');await page.locator('#date-to').fill(year+'-12-31');await page.locator('#refresh-report').click();await page.locator('#report-recipient-party').selectOption(customer.id);await assertAnnualReportUi(page,currency,oracle,year);
   await sendDocument(page,'#report-wa',{cycle,kind:'yearly-report',phone:customer.phone,profile,expectedPdfText:[year,'عدد العمليات: '+activity.count,'المبيعات '+expectedMoney(activity.sales,currency),'المشتريات '+expectedMoney(activity.purchases,currency),'المصروفات '+expectedMoney(activity.expenses,currency)]});
   const docs=assertCycleDocuments(cycle);
   record.sections.identity={...record.sections.identity,status:'PASS',documents:'actual PDF captures verified',documentsVerified:docs.map(d=>d.kind)};
   record.sections.cash_reports={...record.sections.cash_reports,status:'PASS',pdfKinds:['cashbook','daily-sales','yearly-report'],visibleReportMathVerified:true,pdfAccountingTextVerified:true};
   return {nativeCalls:10,pdfDocuments:9,zeroModal:true,zeroPopup:true,zeroJavascriptDialog:true,zeroShareSheet:true,zeroPreview:true,sameRecipient:true,doubleClickGuard:true,errorUnlock:true,liveWhatsapp:'NOT_RUN'};
  });
  await section('persistence',async()=>{
   const before=await events(page);await page.reload();await page.locator('#app-shell').waitFor({state:'visible'});assert.deepEqual(await events(page),before,'real IndexedDB survives reload');await verifyBalances(page,ids,oracle);await writeFile(resolve(output,`cycle-${cycle}-events.json`),json(before));await writeFile(resolve(output,`cycle-${cycle}-oracle.json`),json(oracle));assert.deepEqual(pageErrors,[],'no browser runtime errors');assert.deepEqual(dialogs,[],'no unexpected JavaScript dialogs in any section');return {eventCount:before.length,indexedDB:true};
  });
  assertCycleComplete(record);record.status='PASS';record.oracle=oracle;
 }catch(error){record.status='FAIL';record.error=error.stack;results.errors.push({cycle,error:error.stack});for(const section of required){if(!record.sections[section])record.sections[section]={status:'BLOCKED',reason:'Earlier prerequisite failed'};else if(record.sections[section].status==='PENDING_PDF')record.sections[section]={...record.sections[section],status:'BLOCKED',reason:'Required PDF captures or their accounting assertions did not complete'};}try{await page.screenshot({path:resolve(output,'screenshots',`cycle-${cycle}-failure.png`),fullPage:true});await writeFile(resolve(output,`cycle-${cycle}-failure.html`),await page.content());}catch{}console.error(error.stack);
 }finally{await context.close();await writeFile(resolve(output,'browser-results.json'),json(results));}
}
try{
 browser=await chromium.launch({headless:true,executablePath:process.env.QATFAH_CHROMIUM_EXECUTABLE||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});results.browser=await browser.version();
 for(let cycle=1;cycle<=cycles;cycle++)await runCycle(cycle);
}catch(error){results.errors.push({infrastructure:error.stack});console.error(error.stack);}
finally{
 if(browser)await browser.close();await new Promise(ok=>server.close(ok));results.finishedAt=new Date().toISOString();
 const requiredSectionsPassed=results.cycles.every(record=>required.every(key=>record.sections[key]?.status==='PASS'));
 const journalCounts=Object.fromEntries(currencyCodes.map(currency=>[currency,Object.fromEntries(['debit','credit','transfer'].map(kind=>[kind,results.cycles.reduce((sum,record)=>sum+(record.metrics.journals[currency]?.[kind]||0),0)]))]));
 const fiveJournalsPerKindAndCurrency=currencyCodes.every(currency=>['debit','credit','transfer'].every(kind=>journalCounts[currency][kind]===5));
 const requiredDocumentsCaptured=results.cycles.every(record=>{
  const docs=results.documents.filter(d=>d.cycle===record.cycle);
  return docs.length===requiredPdfKinds.length&&requiredPdfKinds.every(kind=>docs.filter(d=>d.kind===kind).length===1)&&new Set(docs.map(d=>d.path)).size===requiredPdfKinds.length;
 });
 results.gateChecks={requiredSectionsPassed,journalCounts,fiveJournalsPerKindAndCurrency,requiredDocumentsCaptured,expectedPdfKinds:requiredPdfKinds};
 results.allAutomatedCyclesPassed=cycles===5&&results.cycles.length===5&&new Set(results.cycles.map(x=>x.cycle)).size===5&&results.cycles.every(x=>x.status==='PASS')&&requiredSectionsPassed&&fiveJournalsPerKindAndCurrency&&requiredDocumentsCaptured&&results.errors.length===0;
 await writeFile(resolve(output,'browser-results.json'),json(results));console.log(json({cycles:results.cycles.map(x=>({cycle:x.cycle,status:x.status})),documents:results.documents.length,gateChecks:results.gateChecks,allAutomatedCyclesPassed:results.allAutomatedCyclesPassed,liveWhatsapp:results.liveWhatsapp}));
}
if(results.cycles.length!==cycles||results.cycles.some(x=>x.status!=='PASS')||results.errors.length)process.exitCode=1;
