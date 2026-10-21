/*
 * Qatfah in-process WhatsApp Web send driver.
 * Runs only in the isolated web.whatsapp.com WebView created by Qatfah.
 * DOM automation can break when WhatsApp changes its web client.
 * No successful delivery is inferred from a button click.
 */
(function () {
  'use strict';
  if (window.__qatfahDirect && window.__qatfahDirect.version === 1) return true;
  var job = null, timer = null;
  var state = {phase:'idle',message:'',submitted:false,deliveryConfirmed:false};
  var attempts = 0, buttonClicked = false, beforeOutgoing = 0, clickedAt = 0;
  function result(phase,message){
    state = {phase:phase,message:String(message||''),submitted:phase==='submitted',deliveryConfirmed:false};
  }
  function visible(node){
    return !!node && !!node.getClientRects().length && getComputedStyle(node).visibility !== 'hidden';
  }
  function one(selectors,scope){
    var roots = (scope||document);
    for (var i=0;i<selectors.length;i++){
      var found=roots.querySelectorAll(selectors[i]);
      for (var j=0;j<found.length;j++) if(visible(found[j])) return found[j];
    }
    return null;
  }
  function selectable(selectors,scope){
    for(var i=0;i<selectors.length;i++){
      var nodes=(scope||document).querySelectorAll(selectors[i]);
      for(var j=0;j<nodes.length;j++) if(visible(nodes[j])) return nodes[j];
    }
    return null;
  }
  function sendButton(scope){
    var box=scope||document;
    var direct=selectable(['button[data-testid="compose-btn-send"]','button[aria-label="Send"]','button[aria-label="إرسال"]','[role="button"][aria-label="Send"]','[role="button"][aria-label="إرسال"]'],box);
    if(direct)return direct;
    var icons=box.querySelectorAll('[data-icon="send"],[data-testid="send"]');
    for(var i=0;i<icons.length;i++){var b=icons[i].closest('button,[role="button"]');if(visible(b))return b;}
    return null;
  }
  function outgoingCount(){
    return document.querySelectorAll('.message-out,[data-testid="msg-container"].message-out,[data-id^="true_"]').length;
  }
  function editor(){
    return one(['footer [contenteditable="true"][role="textbox"]','footer [contenteditable="true"]','[data-testid="conversation-compose-box-input"]','[data-lexical-editor="true"]']);
  }
  function chatLoaded(){
    return !!editor() && !!document.querySelector('#main header, #main [data-testid="conversation-header"],[data-testid="conversation-panel-wrapper"] header');
  }
  function isLogin(){
    return !!document.querySelector('[data-testid*="qr"] canvas,canvas[aria-label*="QR"],[data-testid="link-device"]') && !editor();
  }
  function knownFailure(){
    var dialogs=document.querySelectorAll('[role="dialog"],[data-testid="popup-controls"]');
    for(var i=0;i<dialogs.length;i++){
      if(!visible(dialogs[i]))continue;
      var text=(dialogs[i].innerText||'').slice(0,350).toLowerCase();
      if(/invalid|not on whatsapp|phone number isn't|رقم غير صالح|ليس على واتساب/.test(text))return 'رقم المستلم غير متاح في واتساب';
    }
    return '';
  }
  function setEditor(node,text){
    node.focus();
    if((node.innerText||'').trim()) return false; // Do not destroy an existing draft.
    if(document.execCommand){
      try{document.execCommand('insertText',false,text);}catch(e){}
    }
    if((node.innerText||'').trim()!==text.trim()){
      node.textContent=text;
      node.dispatchEvent(new InputEvent('input',{bubbles:true,data:text,inputType:'insertText'}));
    }
    return (node.innerText||'').trim()===text.trim();
  }
  function attachPicker(){
    // WhatsApp uses different hidden file inputs for media and documents.
    var inputs=document.querySelectorAll('input[type="file"]');
    for(var i=0;i<inputs.length;i++){
      var accept=(inputs[i].getAttribute('accept')||'').toLowerCase();
      if(accept.includes('pdf')||accept.includes('application/')||accept.includes('*/*')||accept==='')return inputs[i];
    }
    return null;
  }
  function clickAttachmentMenu(){
    var trigger=selectable(['button[aria-label="Attach"]','button[aria-label="إرفاق"]','[data-testid="attach-menu-plus"]','[data-testid="clip"]','[title="Attach"]','[title="إرفاق"]','[data-icon="plus"]']);
    if(trigger){trigger.click();return true;}
    var buttons=document.querySelectorAll('button,[role="button"]');
    for(var i=0;i<buttons.length;i++){
      if(!visible(buttons[i]))continue;
      var text=(buttons[i].getAttribute('aria-label')||buttons[i].getAttribute('title')||'');
      if(/attach|إرفاق|مرفق/i.test(text)){buttons[i].click();return true;}
    }
    return false;
  }
  function clickDocumentMenu(){
    var candidates=document.querySelectorAll('[role="menuitem"],li,button,[role="button"]');
    for(var i=0;i<candidates.length;i++){
      var el=candidates[i];if(!visible(el))continue;
      var text=(el.innerText||el.getAttribute('aria-label')||'').trim();
      if(/^(document|documents|مستند|المستندات)$/i.test(text)){el.click();return true;}
    }
    return false;
  }
  function stageDocument(){
    var input=attachPicker();
    if(!input){
      if(attempts===0)clickAttachmentMenu();
      if(attempts===2)clickDocumentMenu();
      attempts++;
      if(attempts>20)result('error','لا يوفر واتساب الحالي مدخل PDF يمكن التحكم به من التطبيق');
      return;
    }
    try{
      var base64=job.chunks.join('');
      var raw=atob(base64),bytes=new Uint8Array(raw.length);
      for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      if(bytes.length<5 || bytes.length>5000000 || String.fromCharCode.apply(null,bytes.slice(0,5))!=='%PDF-')throw Error('PDF invalid');
      var file=new File([bytes],job.filename,{type:'application/pdf',lastModified:Date.now()});
      var dt=new DataTransfer();dt.items.add(file);
      input.files=dt.files;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
      if(!input.files||input.files.length!==1)throw Error('Input refused file');
      job.chunks=[];state.phase='await_preview';attempts=0;
    }catch(e){result('error','تعذر تجهيز مرفق PDF داخل واتساب');}
  }
  function previewReady(){
    var all=document.querySelectorAll('[role="dialog"],[data-testid*="preview"],[data-testid*="media-editor"],[data-testid*="media-caption"]');
    for(var i=0;i<all.length;i++){
      if(visible(all[i]) && (all[i].innerText||'').includes(job.filename)) return all[i];
    }
    // Fallback: filename is present in the visible WhatsApp upload preview.
    if((document.body.innerText||'').includes(job.filename))return document.body;
    return null;
  }
  function stagePreview(){
    attempts++;
    if(attempts>45){result('error','لم تظهر معاينة مستند PDF داخل واتساب؛ لم يتم الإرسال');return;}
    var root=previewReady();if(!root)return;
    var caption=job.caption.trim();
    if(caption){
      var fields=root.querySelectorAll('[contenteditable="true"]'),entry=null;
      for(var i=0;i<fields.length;i++)if(visible(fields[i])&&!fields[i].closest('footer')){entry=fields[i];break;}
      if(entry && !(entry.innerText||'').trim())setEditor(entry,caption);
    }
    // Avoid accidentally sending a plain text message from the normal chat footer.
    var send=sendButton(root);
    if(!send || send.closest('footer'))return;
    beforeOutgoing=outgoingCount();buttonClicked=true;send.click();
    clickedAt=Date.now();state.phase='verifying';state.message='يتم التحقق من قبول واتساب للمستند';
  }
  function stageText(){
    var field=editor();
    if(!field)return;
    if(!setEditor(field,job.caption)){result('error','هناك مسودة حالية أو تعذر إدخال الرسالة؛ لم يتم الإرسال');return;}
    var send=sendButton(field.closest('footer')||document);
    if(!send){attempts++;if(attempts>18)result('error','لم يظهر زر إرسال واتساب');return;}
    beforeOutgoing=outgoingCount();buttonClicked=true;send.click();
    clickedAt=Date.now();state.phase='verifying';state.message='يتم التحقق من قبول واتساب للرسالة';
  }
  function tick(){
    if(!job)return;
    if(['submitted','error','not_linked','uncertain'].includes(state.phase))return;
    if(Date.now()-job.startedAt>62000){
      result(buttonClicked?'uncertain':'error',buttonClicked?'لا يمكن تأكيد نتيجة واتساب؛ تحقق من المحادثة قبل إعادة الإرسال':'انتهت مهلة انتظار واتساب دون إرسال');return;
    }
    var fail=knownFailure();
    if(fail){result('error',fail);return;}
    if(state.phase==='await_chat'){
      if(chatLoaded()){state.phase=job.isPdf?'await_attachment':'await_text';attempts=0;return;}
      if(isLogin() && Date.now()-job.startedAt>8000){result('not_linked','واتساب غير مرتبط داخل قطفة؛ افتح قسم الربط أولًا');return;}
    }else if(state.phase==='await_attachment'){stageDocument();}
    else if(state.phase==='await_preview'){stagePreview();}
    else if(state.phase==='await_text'){stageText();}
    else if(state.phase==='verifying'){
      if(outgoingCount()>beforeOutgoing){result('submitted','ظهر المستند أو النص ضمن الرسائل الصادرة. لم يتم تأكيد التسليم.');return;}
      if(Date.now()-clickedAt>14000){result('uncertain','نُفّذ الضغط على زر واتساب لكن لا يمكن تأكيد الإرسال؛ راجع المحادثة قبل المحاولة مجددًا');}
    }
  }
  window.__qatfahDirect={
    version:1,
    prepare:function(opts){
      if(job && !['idle','submitted','error','not_linked','uncertain'].includes(state.phase))return false;
      job={phone:String(opts.phone||''),caption:String(opts.caption||''),filename:String(opts.filename||''),isPdf:!!opts.isPdf,chunks:[],startedAt:Date.now()};
      attempts=0;buttonClicked=false;beforeOutgoing=0;clickedAt=0;
      state={phase:'preparing',message:'',submitted:false,deliveryConfirmed:false};
      if(timer)clearInterval(timer);
      return true;
    },
    addChunk:function(part){if(job&&state.phase==='preparing'){job.chunks.push(part);return true;}return false;},
    start:function(){if(!job||state.phase!=='preparing')return false;state.phase='await_chat';timer=setInterval(tick,450);tick();return true;},
    status:function(){return JSON.stringify(state);},
    cancel:function(){if(timer)clearInterval(timer);timer=null;job=null;state={phase:'idle',message:'',submitted:false,deliveryConfirmed:false};return true;}
  };
  return true;
})()
