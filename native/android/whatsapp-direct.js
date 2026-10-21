/*
 * Driver for the one existing web.whatsapp.com WebView. This never navigates
 * the page, opens a browser, uses private WhatsApp modules, or submits twice.
 * Unsupported DOM layouts fail before dispatch whenever possible.
 */
(function () {
  'use strict';
  if (window.__qatfahDirect && window.__qatfahDirect.version === 2) return true;
  if (window.__qatfahDirect) window.__qatfahDirect.cancel();
  var job = null, timer = null, stepping = false;
  var state = {phase:'idle',message:'',submitted:false,dispatched:false,safeToFallback:true,deliveryConfirmed:false};
  var attempts = 0, buttonClicked = false, clickedAt = 0, outgoingBefore = new Set();
  var previewBefore = new Set(), attachmentStaged = false, draftTouched = false;
  var TERMINAL = ['idle','submitted','error','not_linked','uncertain'];

  function stopTimer(){ if(timer!==null)clearInterval(timer);timer=null; }
  function result(phase,message){
    stopTimer();
    state={phase:phase,message:String(message||''),submitted:phase==='submitted',
      dispatched:buttonClicked,safeToFallback:!buttonClicked&&!draftTouched,deliveryConfirmed:false};
    if(job)job.chunks=[];
  }
  function phase(value,message){state.phase=value;state.message=message;state.safeToFallback=false;}
  function visible(node){return !!node&&!!node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden';}
  function one(selectors,scope){
    for(var i=0;i<selectors.length;i++){
      var found=(scope||document).querySelectorAll(selectors[i]);
      for(var j=0;j<found.length;j++)if(visible(found[j]))return found[j];
    }
    return null;
  }
  function text(node){return String(node&&(node.innerText||node.textContent)||'').trim();}
  function compact(value){return String(value||'').replace(/\s+/g,' ').trim();}
  function main(){return document.querySelector('#main,[data-testid="conversation-panel-wrapper"]');}
  function header(){return main()&&main().querySelector('header,[data-testid="conversation-header"]');}
  function headerLabel(){
    var h=header();if(!h)return '';
    var title=h.querySelector('[title]');
    return compact(title&&title.getAttribute('title')||text(h).split('\n')[0]);
  }
  function editor(){
    return one(['footer [contenteditable="true"][role="textbox"]','footer [contenteditable="true"]','[data-testid="conversation-compose-box-input"]'],main()||document);
  }
  function jidPhone(value){
    var match=String(value||'').match(/(?:^|_)([0-9]{9,15})@(?:c\.us|s\.whatsapp\.net)(?:_|$)/);
    return match?match[1]:'';
  }
  function hasExactPhone(node){
    if(!node)return false;
    var attrs=['data-jid','data-id','title','aria-label'];
    for(var i=0;i<attrs.length;i++){
      var value=node.getAttribute(attrs[i])||'';
      if(jidPhone(value)===job.phone||phoneInText(value))return true;
    }
    return phoneInText(text(node));
  }
  function phoneInText(value){
    var candidates=String(value||'').slice(0,1500).match(/\+?[0-9][0-9 ()-]{7,}[0-9]/g)||[];
    return candidates.some(function(x){return x.replace(/[^0-9]/g,'')===job.phone;});
  }
  function conversationPhones(){
    var root=main(),phones=new Set();if(!root)return phones;
    var nodes=root.querySelectorAll('[data-id]');
    for(var i=0;i<nodes.length;i++){var phone=jidPhone(nodes[i].getAttribute('data-id'));if(phone)phones.add(phone);}
    return phones;
  }
  function recipientReady(){
    if(!header()||!editor())return false;
    if(hasExactPhone(header()))return true;
    var phones=conversationPhones();
    if(phones.size===1&&phones.has(job.phone))return true;
    // A phone-verified search result may show a saved contact name in a new chat.
    // Require the header to change to that selected label; never trust an old chat.
    return !!job.selectedLabel&&headerLabel()===job.selectedLabel&&headerLabel()!==job.oldHeaderLabel;
  }
  function recipientUnchanged(){
    if(!job.recipientVerified)return false;
    var phones=conversationPhones();
    if(phones.size&&(!phones.has(job.phone)||phones.size!==1))return false;
    return headerLabel()===job.recipientLabel;
  }
  function isLogin(){
    return !!one(['[data-testid*="qr"] canvas','canvas[aria-label*="QR"]','[data-testid="link-device"]'])&&!editor();
  }
  function knownFailure(){
    var dialogs=document.querySelectorAll('[role="dialog"],[data-testid="popup-controls"]');
    for(var i=0;i<dialogs.length;i++)if(visible(dialogs[i])&&/invalid|not on whatsapp|phone number isn't|رقم غير صالح|ليس على واتساب/i.test(text(dialogs[i]).slice(0,350)))return 'رقم المستلم غير متاح في واتساب';
    return '';
  }
  function sendButton(scope){
    var direct=one(['button[data-testid="compose-btn-send"]','button[aria-label="Send"]','button[aria-label="إرسال"]','[role="button"][aria-label="Send"]','[role="button"][aria-label="إرسال"]'],scope);
    if(direct&&!direct.disabled&&direct.getAttribute('aria-disabled')!=='true')return direct;
    var icons=scope.querySelectorAll('[data-icon="send"],[data-testid="send"]');
    for(var i=0;i<icons.length;i++){
      var b=icons[i].closest('button,[role="button"]');
      if(visible(b)&&!b.disabled&&b.getAttribute('aria-disabled')!=='true')return b;
    }
    return null;
  }
  function setEditor(node,value){
    if(text(node))return false; // Preserve a draft that was not created by this job.
    node.focus();
    if(document.execCommand){try{document.execCommand('insertText',false,value);}catch(e){}}
    if(compact(text(node))!==compact(value)){
      node.textContent=value;
      node.dispatchEvent(new InputEvent('input',{bubbles:true,data:value,inputType:'insertText'}));
    }
    return compact(text(node))===compact(value);
  }
  function setSearch(node,value){
    if(node.tagName==='INPUT'){
      var set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
      set.call(node,value);node.dispatchEvent(new Event('input',{bubbles:true}));
      return node.value===value;
    }
    return setEditor(node,value);
  }
  function newChatScope(){
    var drawer=one(['[data-testid="new-chat-drawer"]','[data-testid="drawer-left"]','[data-testid="chat-drawer"]']);
    if(drawer)return drawer;
    var side=document.querySelector('#side');
    var heading=side&&side.querySelector('header,[role="heading"]');
    return heading&&/new chat|دردشة جديدة|محادثة جديدة/i.test(text(heading))?side:null;
  }
  function contactMatches(row){
    var id=jidPhone(row.getAttribute('data-jid'))||jidPhone(row.getAttribute('data-id'));
    if(id)return id===job.phone;
    var titles=row.querySelectorAll('[title]');
    for(var i=0;i<titles.length;i++){
      var value=(titles[i].getAttribute('title')||'').trim();
      if(/^[+0-9 ()-]+$/.test(value)&&value.replace(/[^0-9]/g,'')===job.phone)return true;
    }
    // Match a complete phone-number line, not digits inside a message preview.
    return text(row).split('\n').some(function(line){
      return /^[+0-9 ()-]+$/.test(line.trim())&&line.replace(/[^0-9]/g,'')===job.phone;
    });
  }
  function openRecipient(){
    if(recipientReady()){acceptRecipient();return;}
    if(isLogin()){result('not_linked','واتساب غير مرتبط داخل قطفة');return;}
    var trigger=one(['button[aria-label="New chat"]','[role="button"][aria-label="New chat"]','button[title="New chat"]','[role="button"][title="New chat"]','button[aria-label="دردشة جديدة"]','[role="button"][aria-label="دردشة جديدة"]','button[aria-label="محادثة جديدة"]','[role="button"][aria-label="محادثة جديدة"]']);
    if(!trigger){
      var icon=one(['[data-icon="new-chat-outline"]','[data-icon="new-chat"]','[data-testid="chatlist-header-new-chat-btn"]']);
      trigger=icon&&icon.closest('button,[role="button"]');
    }
    if(!trigger){if(++attempts>16)result('error','تعذر فتح رقم المستلم في جلسة واتساب الحالية');return;}
    job.oldHeaderLabel=headerLabel();trigger.click();attempts=0;
    phase('await_search','جاري فتح محادثة المستلم');
  }
  function searchRecipient(){
    var scope=newChatScope();
    var input=scope&&one(['input[type="text"]','input[type="search"]','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'],scope);
    if(!input){if(++attempts>20)result('error','لم يظهر بحث جهة الاتصال في واتساب');return;}
    if(!setSearch(input,job.phone)){result('error','تعذر البحث عن رقم المستلم دون تغيير مسودة حالية');return;}
    attempts=0;phase('await_result','جاري مطابقة رقم المستلم');
  }
  function chooseRecipient(){
    var scope=newChatScope();
    var rows=scope?scope.querySelectorAll('[role="listitem"],[role="row"],[role="option"],[data-testid="cell-frame-container"]'):[];
    for(var i=0;i<rows.length;i++){
      var row=rows[i];
      if(!visible(row)||!contactMatches(row))continue;
      if(row.querySelector('input,[contenteditable="true"]'))continue;
      var title=row.querySelector('[title]');
      job.selectedLabel=compact(title&&title.getAttribute('title')||text(row).split('\n')[0]);
      row.click();attempts=0;phase('await_chat','جاري تجهيز محادثة المستلم');return;
    }
    if(++attempts>28)result('error','لم يتم العثور على جهة اتصال تطابق رقم المستلم بشكل مؤكد');
  }
  function acceptRecipient(){
    job.recipientVerified=true;job.recipientLabel=headerLabel();attempts=0;
    phase(job.isPdf?'await_attachment':'await_text',job.isPdf?'جاري تجهيز مستند PDF':'جاري تجهيز الرسالة');
  }
  function attachPicker(){
    var inputs=document.querySelectorAll('input[type="file"]');
    for(var i=0;i<inputs.length;i++){
      var accept=(inputs[i].getAttribute('accept')||'').toLowerCase();
      if(!inputs[i].disabled&&(accept.includes('pdf')||accept.includes('application/')||accept.includes('*/*')||accept===''))return inputs[i];
    }
    return null;
  }
  function attachmentMenu(){
    var trigger=one(['button[aria-label="Attach"]','button[aria-label="إرفاق"]','[data-testid="attach-menu-plus"]','[data-testid="clip"]','[title="Attach"]','[title="إرفاق"]'],main()||document);
    if(trigger){(trigger.closest('button,[role="button"]')||trigger).click();return;}
    var icon=one(['[data-icon="plus"]'],main()||document);
    if(icon){var button=icon.closest('button,[role="button"]');if(button)button.click();}
  }
  function documentMenu(){
    var candidates=document.querySelectorAll('[role="menuitem"],li,button,[role="button"]');
    for(var i=0;i<candidates.length;i++)if(visible(candidates[i])&&/^(document|documents|مستند|مستندات|المستندات)$/i.test(text(candidates[i]))){candidates[i].click();return;}
  }
  function previews(){return document.querySelectorAll('[role="dialog"],[data-testid*="preview"],[data-testid*="media-editor"]');}
  function stageDocument(){
    if(attachmentStaged)return;
    if(attempts===0){
      var existing=previews();
      previewBefore=new Set();
      for(var k=0;k<existing.length;k++)if(visible(existing[k]))previewBefore.add(existing[k]);
      if(previewBefore.size){result('error','توجد نافذة أو مسودة مرفق سابقة في واتساب؛ لم يتم تغييرها');return;}
    }
    var input=attachPicker();
    if(!input){if(attempts===0)attachmentMenu();if(attempts===2)documentMenu();if(++attempts>20)result('error','لم يوفر واتساب مدخل مستند PDF في الجلسة الحالية');return;}
    try{
      var raw=atob(job.chunks.join('')),bytes=new Uint8Array(raw.length);
      for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      if(bytes.length<5||bytes.length>5000000||String.fromCharCode.apply(null,bytes.slice(0,5))!=='%PDF-')throw Error('Invalid PDF');
      var file=new File([bytes],job.filename,{type:'application/pdf',lastModified:Date.now()});
      var dt=new DataTransfer();dt.items.add(file);input.files=dt.files;
      if(!input.files||input.files.length!==1||input.files[0].type!=='application/pdf')throw Error('PDF was not assigned');
      attachmentStaged=true;draftTouched=true;job.chunks=[];
      // A single attachment mechanism. Combining paste, drop and change duplicates files.
      input.dispatchEvent(new Event('change',{bubbles:true}));
      attempts=0;phase('await_preview','جاري تجهيز معاينة مستند PDF');
    }catch(e){result('error','تعذر تجهيز مرفق PDF داخل واتساب');}
  }
  function previewReady(){
    var all=previews();
    for(var i=0;i<all.length;i++){
      var root=all[i];
      if(visible(root)&&!previewBefore.has(root)&&text(root).includes(job.filename)){
        var button=sendButton(root);
        if(button&&!button.closest('footer'))return {root:root,send:button};
      }
    }
    return null; // Never mistake an old filename in the conversation for an upload preview.
  }
  function outgoing(){return main()?Array.from(main().querySelectorAll('[data-id^="true_"]')):[];}
  function dispatchOnce(button){
    if(buttonClicked)return;
    if(!recipientUnchanged()){result('error','تغيرت محادثة المستلم قبل الإرسال؛ تم إيقاف العملية');return;}
    outgoingBefore=new Set(outgoing().map(function(n){return n.getAttribute('data-id');}));
    buttonClicked=true;clickedAt=Date.now();state.dispatched=true;
    phase('verifying','جاري التحقق من قبول واتساب للمستند أو الرسالة');
    button.click(); // Exactly one activation; never follow a click with Enter or another click.
  }
  function stagePreview(){
    if(++attempts>40){result('error','لم تظهر معاينة جديدة لمستند PDF داخل واتساب');return;}
    var preview=previewReady();if(!preview)return;
    if(job.caption){
      var caption=one(['[contenteditable="true"][role="textbox"]','[contenteditable="true"]'],preview.root);
      if(!caption||caption.closest('footer'))return;
      if(!job.captionNode){
        if(!setEditor(caption,job.caption)){result('error','تعذر إضافة رسالة المستند دون تغيير مسودة أخرى');return;}
        job.captionNode=caption;
      }
      if(compact(text(caption))!==compact(job.caption)){result('error','تغير نص رسالة المستند قبل الإرسال');return;}
    }
    dispatchOnce(preview.send);
  }
  function stageText(){
    var field=editor();if(!field){if(++attempts>20)result('error','لم يظهر حقل الرسالة في محادثة المستلم');return;}
    if(!job.textNode){
      if(!setEditor(field,job.caption)){result('error','توجد مسودة حالية أو تعذر إدخال الرسالة؛ لم يتم الإرسال');return;}
      job.textNode=field;draftTouched=true;
    }
    if(compact(text(field))!==compact(job.caption)){result('error','تغيرت مسودة الرسالة قبل الإرسال');return;}
    var send=sendButton(field.closest('footer')||main());
    if(!send){if(++attempts>18)result('error','لم يظهر زر إرسال واتساب');return;}
    dispatchOnce(send);
  }
  function acceptedOutgoing(){
    var nodes=outgoing();
    for(var i=0;i<nodes.length;i++){
      var node=nodes[i],id=node.getAttribute('data-id');
      if(outgoingBefore.has(id)||jidPhone(id)!==job.phone)continue;
      var body=compact(text(node));
      if(job.isPdf&&!body.includes(job.filename))continue;
      if(job.caption&&!body.includes(compact(job.caption)))continue;
      // A server acknowledgement indicator is stronger evidence than a new bubble alone.
      if(!node.querySelector('[data-icon="msg-check"],[data-icon="msg-dblcheck"],[data-testid="msg-check"],[data-testid="msg-dblcheck"]'))continue;
      return true;
    }
    return false;
  }
  function step(){
    if(!job||TERMINAL.includes(state.phase))return;
    if(Date.now()-job.startedAt>62000){result(buttonClicked?'uncertain':'error',buttonClicked?'تعذر تأكيد نتيجة واتساب؛ راجع المحادثة قبل إعادة الإرسال':'انتهت مهلة انتظار واتساب دون تنفيذ الإرسال');return;}
    var failure=knownFailure();if(failure){result(buttonClicked?'uncertain':'error',failure);return;}
    if(state.phase==='open_chat')openRecipient();
    else if(state.phase==='await_search')searchRecipient();
    else if(state.phase==='await_result')chooseRecipient();
    else if(state.phase==='await_chat'){
      if(recipientReady())acceptRecipient();
      else if(++attempts>30)result('error','تعذر تأكيد فتح رقم المستلم المطلوب');
    }
    else if(state.phase==='await_attachment')stageDocument();
    else if(state.phase==='await_preview')stagePreview();
    else if(state.phase==='await_text')stageText();
    else if(state.phase==='verifying'){
      if(acceptedOutgoing()){result('submitted','قبل واتساب المستند أو الرسالة؛ لم يتم تأكيد التسليم للمستلم');return;}
      if(Date.now()-clickedAt>14000)result('uncertain','لا يمكن تأكيد نتيجة الإرسال؛ راجع المحادثة قبل المحاولة مجددًا');
    }
  }
  function tick(){
    if(stepping)return;stepping=true;
    try{step();}
    catch(e){result(buttonClicked?'uncertain':'error',buttonClicked?'تعذر تأكيد نتيجة واتساب؛ راجع المحادثة قبل إعادة الإرسال':'تعذر إكمال تجهيز الرسالة في واتساب');}
    finally{stepping=false;}
  }
  window.__qatfahDirect={
    version:2,
    prepare:function(opts){
      if(job&&!TERMINAL.includes(state.phase))return false;
      opts=opts||{};
      var phone=String(opts.phone||''),caption=String(opts.caption||'').trim();
      var filename=String(opts.filename||'Qatfah.pdf').replace(/[\\/\x00-\x1F]/g,'_').trim();
      if(!/^[0-9]{9,15}$/.test(phone)||caption.length>3000||filename.length>120||(!opts.isPdf&&!caption))return false;
      if(!/\.pdf$/i.test(filename))filename+='.pdf';
      stopTimer();
      job={phone:phone,caption:caption,filename:filename,isPdf:!!opts.isPdf,chunks:[],chunkLength:0,startedAt:Date.now(),recipientVerified:false,oldHeaderLabel:'',selectedLabel:''};
      attempts=0;buttonClicked=false;clickedAt=0;attachmentStaged=false;draftTouched=false;
      outgoingBefore=new Set();previewBefore=new Set();
      state={phase:'preparing',message:'جاري تجهيز الإرسال',submitted:false,dispatched:false,safeToFallback:false,deliveryConfirmed:false};
      return true;
    },
    addChunk:function(part){
      if(!job||state.phase!=='preparing'||typeof part!=='string'||job.chunkLength+part.length>7000000)return false;
      job.chunks.push(part);job.chunkLength+=part.length;return true;
    },
    start:function(){
      if(!job||state.phase!=='preparing')return false;
      phase('open_chat','جاري فتح محادثة المستلم');timer=setInterval(tick,450);tick();return true;
    },
    status:function(){return JSON.stringify(state);},
    cancel:function(){
      stopTimer();job=null;stepping=false;
      state={phase:'idle',message:'',submitted:false,dispatched:false,safeToFallback:true,deliveryConfirmed:false};return true;
    }
  };
  return true;
})()
