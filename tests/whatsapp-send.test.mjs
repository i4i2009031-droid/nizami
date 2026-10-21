import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync(new URL('../native/android/whatsapp-direct.js',import.meta.url),'utf8');
const PHONE='967782843242';
const CAPTION='كشف الحساب التجريبي';
const PDF='%PDF-1.4\n%test fixture only\n%%EOF';

class Element {
  constructor(tag='DIV',attrs={},value=''){
    this.tagName=tag;this.attrs=attrs;this.textContent=value;this.map=new Map();this.events=[];this.clicks=0;
    this.hidden=false;this.disabled=false;this.parent=null;this.onClick=null;this.onEvent=null;
  }
  get innerText(){return this.textContent;}
  getAttribute(name){return this.attrs[name]??null;}
  contains(node){for(let p=node;p;p=p.parent)if(p===this)return true;return false;}
  getClientRects(){return this.hidden?[]:[{}];}
  querySelectorAll(selector){return this.map.get(selector)||[];}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  closest(selector){
    if(selector==='footer')return this.footer||null;
    if(selector==='button,[role="button"]')return this.tagName==='BUTTON'?this:this.parent;
    return null;
  }
  focus(){if(this.onFocus)this.onFocus();}
  dispatchEvent(event){this.events.push(event.type);if(this.onEvent)this.onEvent(event);return true;}
  click(){this.clicks++;if(this.onClick)this.onClick();}
  set(selector,items){this.map.set(selector,items);return this;}
}

function harness({phone=PHONE,linked=true,pdf=false,caption=CAPTION}={}){
  let now=1000,nextTimer=1,focused=null;
  const timers=new Map(),root=new Element(),head=new Element('HEADER',{},phone),title=new Element('SPAN',{title:phone});
  const field=new Element('DIV',{},''),footer=new Element('FOOTER'),send=new Element('BUTTON',{'aria-label':'Send'});
  const file=new Element('INPUT',{type:'file',accept:'application/pdf'}),preview=new Element('DIV',{},'Invoice.pdf');
  const previewCaption=new Element('DIV'),previewSend=new Element('BUTTON',{'aria-label':'Send'});
  const doc=new Element('DOCUMENT'),qr=new Element('CANVAS');
  let messages=[],previewVisible=false,fileInputs=pdf?[file]:[];
  head.set('[title]',[title]);field.footer=footer;send.footer=footer;
  file.parent=root;head.parent=root;title.parent=head;field.parent=footer;footer.parent=root;
  previewCaption.parent=preview;previewSend.parent=preview;
  field.onFocus=()=>{focused=field;};previewCaption.onFocus=()=>{focused=previewCaption;};
  root.set('header,[data-testid="conversation-header"]',[head]);
  root.set('footer [contenteditable="true"][role="textbox"]',linked?[field]:[]);
  footer.set('button[aria-label="Send"]',[send]);
  preview.set('[contenteditable="true"][role="textbox"]',[previewCaption]);
  preview.set('button[aria-label="Send"]',[previewSend]);
  const oldRootQuery=root.querySelectorAll.bind(root);
  root.querySelectorAll=selector=>{
    if(selector==='[data-id]')return messages;
    if(selector==='[data-id^="true_"]')return messages.filter(x=>x.getAttribute('data-id')?.startsWith('true_'));
    return oldRootQuery(selector);
  };
  const oldDocQuery=doc.querySelectorAll.bind(doc);
  doc.querySelectorAll=selector=>{
    if(selector==='#main,[data-testid="conversation-panel-wrapper"]')return linked?[root]:[];
    if(selector==='input[type="file"]')return fileInputs;
    if(selector==='[role="dialog"],[data-testid*="preview"],[data-testid*="media-editor"]')return previewVisible?[preview]:[];
    if(selector==='[data-testid*="qr"] canvas')return linked?[]:[qr];
    return oldDocQuery(selector);
  };
  doc.execCommand=(_cmd,_ui,value)=>{if(focused)focused.textContent=value;return true;};
  file.onEvent=event=>{if(event.type==='change')previewVisible=true;};
  class FileFixture{constructor(parts,name,options){this.parts=parts;this.name=name;this.type=options.type;}}
  class Transfer{constructor(){this.files=[];this.items={add:file=>this.files.push(file)};}}
  class EventFixture{constructor(type,options){this.type=type;Object.assign(this,options);}}
  const context={window:{},document:doc,getComputedStyle:()=>({visibility:'visible'}),
    Date:{now:()=>now},Set,Uint8Array,File:FileFixture,DataTransfer:Transfer,
    Event:EventFixture,InputEvent:EventFixture,atob:value=>Buffer.from(value,'base64').toString('binary'),
    setInterval:callback=>{const id=nextTimer++;timers.set(id,callback);return id;},
    clearInterval:id=>timers.delete(id)};
  vm.runInNewContext(source,context);
  const driver=context.window.__qatfahDirect;
  function tick(count=1,ms=450){for(let i=0;i<count;i++){now+=ms;for(const callback of [...timers.values()])callback();}}
  function outgoing(id,{phone=PHONE,body=caption,ack=true}={}){
    const node=new Element('DIV',{'data-id':`true_${phone}@c.us_${id}`},body);
    if(ack)node.set('[data-icon="msg-check"],[data-icon="msg-dblcheck"],[data-testid="msg-check"],[data-testid="msg-dblcheck"]',[new Element()]);
    messages.push(node);return node;
  }
  function start(opts={}){
    assert.equal(driver.prepare({phone:PHONE,caption,filename:'Invoice.pdf',isPdf:pdf,...opts}),true);
    if(pdf)assert.equal(driver.addChunk(Buffer.from(PDF).toString('base64')),true);
    assert.equal(driver.start(),true);return driver;
  }
  return {driver,start,tick,outgoing,timers,field,send,preview,previewCaption,previewSend,file,title,doc,root,head,
    status:()=>JSON.parse(driver.status()),setPreview:visible=>{previewVisible=visible;},
    replaceMessages:items=>{messages=items;},setFileInputs:items=>{fileInputs=items;},context};
}

test('unlinked session terminates before dispatch and unlocks a later explicit attempt',()=>{
  const h=harness({linked:false});h.start();
  assert.equal(h.status().phase,'not_linked');assert.equal(h.status().safeToFallback,true);
  assert.equal(h.status().dispatched,false);assert.equal(h.timers.size,0);
  assert.equal(h.driver.prepare({phone:PHONE,caption:'next'}),true);
  assert.equal(h.driver.cancel(),true);assert.equal(h.timers.size,0);
});

test('text sends one activation and needs a new matching acknowledged outgoing message',()=>{
  const h=harness();h.start();h.tick();
  assert.equal(h.send.clicks,1);assert.equal(h.status().phase,'verifying');
  assert.equal(h.status().submitted,false);assert.equal(h.status().safeToFallback,false);
  h.outgoing('NEW');h.tick();
  assert.equal(h.status().phase,'submitted');assert.equal(h.status().dispatched,true);
  assert.equal(h.status().deliveryConfirmed,false);assert.equal(h.timers.size,0);
  h.tick(100);assert.equal(h.send.clicks,1);
});

test('old matching messages and unrelated outgoing activity cannot confirm this send',()=>{
  const h=harness();h.outgoing('OLD');h.start();h.tick();
  h.outgoing('OTHER',{phone:'967700000001'});h.outgoing('DIFFERENT',{body:'رسالة أخرى'});h.tick();
  assert.equal(h.status().phase,'verifying');h.tick(1,15000);
  assert.equal(h.status().phase,'uncertain');assert.equal(h.status().safeToFallback,false);
  assert.equal(h.send.clicks,1);assert.equal(h.timers.size,0);
});

test('a new matching bubble without an acknowledgement is not reported as sent',()=>{
  const h=harness();h.start();h.tick();h.outgoing('QUEUED',{ack:false});h.tick(1,15000);
  assert.equal(h.status().phase,'uncertain');assert.equal(h.status().submitted,false);
  assert.equal(h.status().deliveryConfirmed,false);assert.equal(h.send.clicks,1);
});

test('the PDF is attached with a single change event and sent with its caption once',()=>{
  const h=harness({pdf:true});h.start();h.tick();
  assert.deepEqual(h.file.events,['change']);assert.equal(h.file.files.length,1);
  assert.equal(h.file.files[0].type,'application/pdf');assert.equal(h.file.files[0].name,'Invoice.pdf');
  h.tick();assert.equal(h.previewSend.clicks,1);assert.equal(h.send.clicks,0);
  assert.equal(h.previewCaption.textContent,CAPTION);
  h.outgoing('PDF',{body:'Invoice.pdf '+CAPTION});h.tick();
  assert.equal(h.status().phase,'submitted');assert.equal(h.status().deliveryConfirmed,false);
  h.tick(100);assert.equal(h.previewSend.clicks,1);assert.deepEqual(h.file.events,['change']);
});

test('a filename in an old conversation is not treated as a new PDF upload preview',()=>{
  const h=harness({pdf:true});h.outgoing('OLD',{body:'Invoice.pdf '+CAPTION});
  h.file.onEvent=()=>{};h.start();h.tick(57);
  assert.equal(h.status().phase,'error');assert.equal(h.previewSend.clicks,0);assert.equal(h.send.clicks,0);
  assert.equal(h.status().safeToFallback,false);assert.equal(h.timers.size,0);
});

test('invalid PDF data fails before touching a file input or dispatching',()=>{
  const h=harness({pdf:true});
  assert.equal(h.driver.prepare({phone:PHONE,caption:CAPTION,filename:'Invoice.pdf',isPdf:true}),true);
  h.driver.addChunk(Buffer.from('not a PDF').toString('base64'));h.driver.start();h.tick();
  assert.equal(h.status().phase,'error');assert.equal(h.status().safeToFallback,true);
  assert.equal(h.previewSend.clicks,0);assert.deepEqual(h.file.events,[]);assert.equal(h.timers.size,0);
});

test('existing text drafts remain intact and no send activation occurs',()=>{
  const h=harness();h.field.textContent='مسودة المستخدم';h.start();h.tick();
  assert.equal(h.field.textContent,'مسودة المستخدم');assert.equal(h.send.clicks,0);
  assert.equal(h.status().phase,'error');assert.equal(h.status().dispatched,false);assert.equal(h.status().safeToFallback,false);
});

test('a recipient change after chat preparation stops dispatch',()=>{
  const h=harness();h.start();h.title.attrs.title='967711111111';h.tick();
  assert.equal(h.send.clicks,0);assert.equal(h.status().phase,'error');
  assert.equal(h.status().dispatched,false);
});

test('a different open chat is never used just because its composer is ready',()=>{
  const h=harness({phone:'967711111111'});h.start();h.tick(27);
  assert.equal(h.send.clicks,0);assert.equal(h.field.textContent,'');
  assert.equal(h.status().phase,'error');assert.equal(h.status().safeToFallback,true);
});

test('an exception during click is uncertain, cannot fall back, and releases the timer',()=>{
  const h=harness();h.send.onClick=()=>{throw new Error('after event dispatch');};h.start();h.tick();
  assert.equal(h.status().phase,'uncertain');assert.equal(h.status().dispatched,true);
  assert.equal(h.status().safeToFallback,false);assert.equal(h.timers.size,0);assert.equal(h.send.clicks,1);
});

test('busy attempts and oversized chunks cannot overwrite an active job',()=>{
  const h=harness({pdf:true});h.start();
  assert.equal(h.driver.prepare({phone:PHONE,caption:'other'}),false);
  assert.equal(h.driver.addChunk('ignored after start'),false);
  h.driver.cancel();assert.equal(h.timers.size,0);
  assert.equal(h.driver.prepare({phone:PHONE,caption:CAPTION,isPdf:true}),true);
  assert.equal(h.driver.addChunk('a'.repeat(7000001)),false);
  h.driver.cancel();assert.equal(h.status().phase,'idle');
});

test('live New chat search selects an exact phone result before writing to a saved contact',()=>{
  const h=harness({phone:'967711111111'});
  const trigger=new Element('BUTTON',{'aria-label':'New chat'}),drawer=new Element(),search=new Element();
  const row=new Element('DIV',{'data-jid':`${PHONE}@c.us`},'العميل المقصود\n'+PHONE);
  const rowTitle=new Element('SPAN',{title:'العميل المقصود'});
  drawer.hidden=true;trigger.onClick=()=>{drawer.hidden=false;};
  row.set('[title]',[rowTitle]);
  row.onClick=()=>{h.head.textContent='العميل المقصود';h.title.attrs.title='العميل المقصود';};
  drawer.set('[contenteditable="true"][role="textbox"]',[search]);
  drawer.set('[role="listitem"],[role="row"],[role="option"],[data-testid="cell-frame-container"]',[row]);
  h.doc.set('button[aria-label="New chat"]',[trigger]);h.doc.set('[data-testid="new-chat-drawer"]',[drawer]);
  h.start();assert.equal(h.send.clicks,0);h.tick();assert.equal(search.textContent,PHONE);
  h.tick();assert.equal(row.clicks,1);assert.equal(h.field.textContent,'');
  h.tick(2);assert.equal(h.send.clicks,1);assert.equal(h.field.textContent,CAPTION);
  h.outgoing('VERIFIED_CONTACT');h.tick();assert.equal(h.status().phase,'submitted');
});

test('a phone mentioned inside another contact preview is not a matching recipient',()=>{
  const h=harness({phone:'967711111111'});
  const trigger=new Element('BUTTON',{'aria-label':'New chat'}),drawer=new Element(),search=new Element();
  const row=new Element('DIV',{},'جهة أخرى\nوصلني الرقم '+PHONE+' بالأمس');
  drawer.set('[contenteditable="true"][role="textbox"]',[search]);
  drawer.set('[role="listitem"],[role="row"],[role="option"],[data-testid="cell-frame-container"]',[row]);
  h.doc.set('button[aria-label="New chat"]',[trigger]);h.doc.set('[data-testid="new-chat-drawer"]',[drawer]);
  h.start();h.tick(35);
  assert.equal(row.clicks,0);assert.equal(h.send.clicks,0);assert.equal(h.field.textContent,'');
  assert.equal(h.status().phase,'error');assert.equal(h.status().safeToFallback,true);
});

test('PDF picker supports wildcard and extension accept tokens with one attachment event',()=>{
  for(const accept of ['*','*/*','.pdf','.PDF, image/png','application/*','application/pdf']){
    const h=harness({pdf:true});h.file.attrs.accept=accept;h.start();h.tick(2);
    assert.deepEqual(h.file.events,['change'],accept);assert.equal(h.file.files[0].type,'application/pdf',accept);
    assert.equal(h.previewSend.clicks,1,accept);assert.equal(h.status().safeToFallback,false,accept);
  }
});

test('a PDF is not assigned to incompatible or unrelated global file inputs',()=>{
  for(const accept of ['image/*','video/*','application/zip']){
    const h=harness({pdf:true});h.file.attrs.accept=accept;h.start();h.tick(36);
    assert.deepEqual(h.file.events,[]);assert.equal(h.status().code,'pdf_input_missing');
    assert.equal(h.status().failedStage,'await_attachment');assert.equal(h.status().safeToFallback,true);
  }
  const h=harness({pdf:true});h.file.parent=null;h.file.attrs.accept='';h.start();h.tick(36);
  assert.deepEqual(h.file.events,[]);assert.equal(h.status().code,'pdf_input_missing');
  assert.equal(h.status().diagnostics.fileInputCount,1);
  assert.equal(h.status().diagnostics.compatiblePdfInputCount,1);
});

test('late Attach and Document controls are found, but each is activated only once',()=>{
  const h=harness({pdf:true}),attach=new Element('BUTTON',{'aria-label':'Attach'}),documentButton=new Element('BUTTON',{},'Document');
  h.setFileInputs([]);attach.hidden=true;documentButton.hidden=true;
  h.root.set('button[aria-label="Attach"]',[attach]);
  h.doc.set('button,[role="button"],[role="menuitem"]',[documentButton]);
  documentButton.onClick=()=>{h.file.attrs.accept='*';h.setFileInputs([h.file]);};
  h.start();h.tick(5);assert.equal(attach.clicks,0);
  attach.hidden=false;h.tick(5);assert.equal(attach.clicks,1);assert.equal(documentButton.clicks,0);
  documentButton.hidden=false;h.tick(4);
  assert.equal(attach.clicks,1);assert.equal(documentButton.clicks,1);
  assert.deepEqual(h.file.events,['change']);assert.equal(h.previewSend.clicks,1);
  h.tick(40);assert.equal(attach.clicks,1);assert.equal(documentButton.clicks,1);assert.equal(h.previewSend.clicks,1);
});

test('a document preview may have its own caption and send footer',()=>{
  const h=harness({pdf:true}),previewFooter=new Element('FOOTER');
  previewFooter.parent=h.preview;h.previewSend.footer=previewFooter;h.previewCaption.footer=previewFooter;
  h.start();h.tick(2);
  assert.equal(h.previewCaption.textContent,CAPTION);assert.equal(h.previewSend.clicks,1);assert.equal(h.send.clicks,0);
});

test('a new filename subtree identifies a preview without test IDs or dialog roles',()=>{
  const h=harness({pdf:true}),name=new Element('SPAN',{},'Invoice.pdf');name.parent=h.preview;
  h.file.onEvent=()=>{h.doc.set('[title],[aria-label],span',[name]);};
  h.start();h.tick(2);assert.equal(h.previewSend.clicks,1);assert.equal(h.send.clicks,0);
  assert.deepEqual(h.file.events,['change']);
});

test('an existing filename cannot turn the conversation subtree into a preview',()=>{
  const h=harness({pdf:true}),name=new Element('SPAN',{},'Invoice.pdf');name.parent=h.root;
  h.doc.set('[title],[aria-label],span',[name]);h.root.set('button[aria-label="Send"]',[h.send]);
  h.file.onEvent=()=>{};h.start();h.tick(56);
  assert.equal(h.previewSend.clicks,0);assert.equal(h.send.clicks,0);
  assert.equal(h.status().code,'pdf_preview_missing');assert.equal(h.status().safeToFallback,false);
});

test('a role-based New chat drawer and a button with shortcut text work without test IDs',()=>{
  const h=harness({phone:'967711111111'}),trigger=new Element('BUTTON',{'aria-label':'New chat (Ctrl+Alt+N)'});
  const drawer=new Element('DIV',{'role':'dialog'}),heading=new Element('H2',{},'New chat'),search=new Element('DIV',{},'previous search');
  const row=new Element('DIV',{'role':'listitem'},'العميل\n'+PHONE),title=new Element('SPAN',{title:'العميل'});
  drawer.hidden=true;heading.parent=drawer;search.parent=drawer;
  trigger.onClick=()=>{drawer.hidden=false;};
  row.set('[title]',[title]);row.onClick=()=>{h.head.textContent='العميل';h.title.attrs.title='العميل';drawer.hidden=true;};
  drawer.set('header,[role="heading"],h1,h2,h3',[heading]);
  drawer.set('[contenteditable="true"][role="textbox"]',[search]);
  drawer.set('[role="listitem"],[role="row"],[role="option"],[data-testid="cell-frame-container"]',[row]);
  h.doc.set('button,[role="button"],[role="menuitem"]',[trigger]);h.doc.set('[role="dialog"],aside,section',[drawer]);
  h.start();h.tick(4);
  assert.equal(trigger.clicks,1);assert.equal(search.textContent,PHONE);assert.equal(row.clicks,1);
  assert.equal(h.send.clicks,1);assert.equal(h.field.textContent,CAPTION);
});

test('recipient changes are detected before any PDF is assigned',()=>{
  const h=harness({pdf:true});h.start();h.title.attrs.title='967700000001';h.tick();
  assert.deepEqual(h.file.events,[]);assert.equal(h.status().code,'recipient_changed');
  assert.equal(h.status().safeToFallback,true);assert.equal(h.previewSend.clicks,0);
});

test('a target-looking header cannot win over conflicting history that subsequently unmounts',()=>{
  const h=harness({pdf:true});h.title.attrs.title='+'+PHONE;
  h.outgoing('OTHER',{phone:'967799999999',body:'earlier'});
  h.start();h.replaceMessages([]);h.tick(2);
  assert.deepEqual(h.file.events,[]);assert.equal(h.previewSend.clicks,0);assert.equal(h.send.clicks,0);
  assert.equal(h.status().code,'recipient_conflict');assert.equal(h.status().diagnostics.recipientVerified,false);
  assert.equal(h.status().dispatched,false);assert.equal(h.timers.size,0);
});

test('terminal diagnostics identify the stage without copying private content',()=>{
  const h=harness({phone:'967711111111'});h.start();h.tick(27);
  const status=h.status();assert.equal(status.driverVersion,3);assert.equal(status.code,'new_chat_control_missing');
  assert.equal(status.failedStage,'open_chat');assert.equal(status.diagnostics.recipientVerified,false);
  const diagnostics=JSON.stringify(status.diagnostics);
  assert.ok(!diagnostics.includes(PHONE));assert.ok(!diagnostics.includes(CAPTION));
});

function savedContactHarness({detailPhone=PHONE,about='',hasClose=true}={}){
  const h=harness({phone:'967711111111'}),name='جهة محفوظة';
  const trigger=new Element('BUTTON',{'aria-label':'New chat'}),drawer=new Element(),search=new Element();
  const row=new Element('DIV',{'data-jid':'987654321012345@lid'},name),title=new Element('SPAN',{title:name});
  drawer.hidden=true;trigger.onClick=()=>{drawer.hidden=false;};
  row.set('[title]',[title]);row.onClick=()=>{h.head.textContent=name;h.title.attrs.title=name;drawer.hidden=true;};
  drawer.set('[contenteditable="true"][role="textbox"]',[search]);
  drawer.set('[role="listitem"],[role="row"],[role="option"],[data-testid="cell-frame-container"]',[row]);
  h.doc.set('button[aria-label="New chat"]',[trigger]);h.doc.set('[data-testid="new-chat-drawer"]',[drawer]);
  const info=new Element('ASIDE',{},'Contact info\n'+name+'\n+'+detailPhone+'\nAbout\n'+about);
  const heading=new Element('H2',{},'Contact info'),open=new Element('BUTTON',{'aria-label':'Contact info'}),close=new Element('BUTTON',{'aria-label':'Close'});
  info.hidden=true;heading.parent=info;open.onClick=()=>{info.hidden=false;};close.onClick=()=>{info.hidden=true;};
  info.set('header,[role="heading"],h1,h2,h3',[heading]);
  info.set('button,[role="button"],[role="menuitem"]',hasClose?[close]:[]);
  h.head.set('button,[role="button"],[role="menuitem"]',[open]);
  h.doc.set('[data-testid="contact-info-drawer"],[data-testid="drawer-right"],[role="dialog"],aside,section',[info]);
  return {...h,info,openInfo:open,closeInfo:close,row};
}

test('a name-only saved contact requires its profile phone to match before staging',()=>{
  const h=savedContactHarness();h.start();h.tick(6);
  assert.equal(h.row.clicks,1);assert.equal(h.send.clicks,0);assert.equal(h.field.textContent,'');
  h.tick();assert.equal(h.openInfo.clicks,1);assert.equal(h.send.clicks,0);
  h.tick();assert.equal(h.closeInfo.clicks,1);assert.equal(h.send.clicks,0);
  h.tick(2);assert.equal(h.send.clicks,1);assert.equal(h.field.textContent,CAPTION);
  h.outgoing('SAVED_CONTACT');h.tick();assert.equal(h.status().phase,'submitted');
});

test('contact-info verification cannot accept contradictory history when returning to the chat',()=>{
  const h=savedContactHarness();h.start();h.tick(8);assert.equal(h.closeInfo.clicks,1);
  h.outgoing('OTHER',{phone:'967799999999',body:'earlier'});h.tick();
  assert.equal(h.status().code,'recipient_conflict');assert.equal(h.status().failedStage,'await_contact_close');
  assert.equal(h.status().diagnostics.recipientVerified,false);assert.equal(h.field.textContent,'');assert.equal(h.send.clicks,0);
});

test('a different saved contact with the target number only in About is never used',()=>{
  const h=savedContactHarness({detailPhone:'967799999999',about:PHONE});h.start();h.tick(40);
  assert.equal(h.row.clicks,1);assert.equal(h.openInfo.clicks,1);assert.equal(h.closeInfo.clicks,0);
  assert.equal(h.field.textContent,'');assert.equal(h.send.clicks,0);assert.equal(h.status().code,'recipient_unverified');
  assert.equal(h.status().failedStage,'await_contact_info');assert.equal(h.status().dispatched,false);
});

test('verified saved contact details must close before a message is composed',()=>{
  const h=savedContactHarness({hasClose:false});h.start();h.tick(40);
  assert.equal(h.send.clicks,0);assert.equal(h.field.textContent,'');
  assert.equal(h.status().code,'contact_info_close_missing');assert.equal(h.status().safeToFallback,true);
});

test('an acknowledged opaque ID is accepted only when previously bound to the verified conversation',()=>{
  const h=harness();const old=h.outgoing('OLD',{body:'earlier message'});old.attrs['data-id']='true_998877665544332@lid_OLD';
  h.start();h.tick();const fresh=h.outgoing('NEW');fresh.attrs['data-id']='true_998877665544332@lid_NEW';h.tick();
  assert.equal(h.status().phase,'submitted');assert.equal(h.send.clicks,1);assert.equal(h.status().deliveryConfirmed,false);
});

test('a new or unrelated opaque ID cannot be inferred to be the target phone',()=>{
  for(const withPrior of [false,true]){
    const h=harness();
    if(withPrior){const old=h.outgoing('OLD',{body:'earlier'});old.attrs['data-id']='true_111122223333444@lid_OLD';}
    h.start();h.tick();const fresh=h.outgoing('NEW');fresh.attrs['data-id']='true_998877665544332@lid_NEW';h.tick(1,15000);
    assert.equal(h.status().phase,'uncertain');assert.equal(h.status().safeToFallback,false);assert.equal(h.send.clicks,1);
  }
});

test('existing PDF previews or file drafts block fallback as well as new attachment',()=>{
  const h=harness({pdf:true});h.setPreview(true);h.start();h.tick();
  assert.equal(h.status().code,'existing_attachment_draft');assert.equal(h.status().safeToFallback,false);assert.deepEqual(h.file.events,[]);
  const other=harness({pdf:true});other.file.files=[{name:'earlier.pdf',type:'application/pdf'}];other.start();other.tick();
  assert.equal(other.status().code,'existing_attachment_draft');assert.equal(other.status().safeToFallback,false);
  assert.equal(other.file.files[0].name,'earlier.pdf');assert.deepEqual(other.file.events,[]);
});

test('a previous PDF preview without dialog roles is preserved before any new file is assigned',()=>{
  const h=harness({pdf:true}),oldName=new Element('SPAN',{},'Earlier.pdf');oldName.parent=h.preview;
  h.doc.set('[title],[aria-label],span',[oldName]);
  h.start();h.tick();
  assert.equal(h.status().code,'existing_attachment_draft');assert.equal(h.status().safeToFallback,false);
  assert.deepEqual(h.file.events,[]);assert.equal(h.previewSend.clicks,0);assert.equal(oldName.textContent,'Earlier.pdf');
});

test('a text-input exception after a possible mutation blocks fallback',()=>{
  const h=harness();h.doc.execCommand=()=>false;h.field.onEvent=()=>{throw new Error('input hook failed');};
  h.start();h.tick();assert.equal(h.field.textContent,CAPTION);assert.equal(h.send.clicks,0);
  assert.equal(h.status().code,'driver_exception');assert.equal(h.status().safeToFallback,false);assert.equal(h.timers.size,0);
});

test('a file-assignment exception after a possible mutation blocks fallback',()=>{
  const h=harness({pdf:true});let assigned;
  Object.defineProperty(h.file,'files',{get:()=>assigned,set:value=>{assigned=value;throw new Error('file setter failed');}});
  h.start();h.tick();assert.equal(assigned[0].name,'Invoice.pdf');assert.equal(h.previewSend.clicks,0);
  assert.equal(h.status().code,'pdf_attach_failed');assert.equal(h.status().safeToFallback,false);assert.equal(h.timers.size,0);
});
