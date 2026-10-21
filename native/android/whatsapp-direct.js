/*
 * Driver for the one existing web.whatsapp.com WebView. This never navigates
 * the page, opens a browser, uses private WhatsApp modules, or submits twice.
 * Unsupported DOM layouts fail before dispatch whenever possible.
 */
(function () {
  'use strict';
  if (window.__qatfahDirect && window.__qatfahDirect.version === 3) return true;
  if (window.__qatfahDirect) window.__qatfahDirect.cancel();
  var job = null, timer = null, stepping = false;
  var state = {phase:'idle',message:'',code:'',failedStage:'',driverVersion:3,submitted:false,dispatched:false,safeToFallback:true,deliveryConfirmed:false};
  var attempts = 0, buttonClicked = false, clickedAt = 0, outgoingBefore = new Set();
  var previewBefore = new Set(), filenameBefore = new Set(), attachmentStaged = false, draftTouched = false;
  var TERMINAL = ['idle','submitted','error','not_linked','uncertain'];

  function stopTimer(){ if(timer!==null)clearInterval(timer);timer=null; }
  function diagnostics(){return {recipientVerified:!!(job&&job.recipientVerified),attachmentStaged:attachmentStaged,
    draftTouched:draftTouched,fileInputCount:job&&job.fileInputCount||0,
    compatiblePdfInputCount:job&&job.compatiblePdfInputCount||0,searchResultCount:job&&job.searchResultCount||0};}
  function result(phase,message,code){
    stopTimer();
    var previous=state.phase;
    state={phase:phase,message:String(message||''),code:code||'',failedStage:phase==='submitted'?'':previous,driverVersion:3,
      diagnostics:diagnostics(),submitted:phase==='submitted',
      dispatched:buttonClicked,safeToFallback:!buttonClicked&&!draftTouched,deliveryConfirmed:false};
    if(job)job.chunks=[];
  }
  function phase(value,message){state.phase=value;state.message=message;state.code='';state.failedStage='';state.safeToFallback=false;}
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
  function parent(node){return node&&(node.parentElement||node.parentNode||node.parent);}
  function contains(root,node){
    if(!root||!node)return false;
    if(root.contains)return root.contains(node);
    for(var p=node;p;p=parent(p))if(p===root)return true;
    return false;
  }
  function labelledButton(scope,pattern){
    var nodes=(scope||document).querySelectorAll('button,[role="button"],[role="menuitem"]');
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i];if(!visible(n)||n.disabled||n.getAttribute('aria-disabled')==='true')continue;
      if(pattern.test(compact(n.getAttribute('aria-label')))||pattern.test(compact(n.getAttribute('title')))||pattern.test(compact(text(n))))return n;
    }
    return null;
  }
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
  function jidIdentity(value){
    var match=String(value||'').match(/(?:^|_)([0-9]{5,30})@(c\.us|s\.whatsapp\.net|lid)(?:_|$)/);
    return match?match[1]+'@'+(match[2]==='lid'?'lid':'phone'):'';
  }
  function hasExactPhone(node){
    if(!node)return false;
    var attrs=['data-jid','data-id','title','aria-label'];
    for(var i=0;i<attrs.length;i++){
      var value=node.getAttribute(attrs[i])||'';
      if(jidPhone(value)===job.phone||exactPhone(value))return true;
    }
    var titles=node.querySelectorAll('[title]');
    for(var j=0;j<titles.length;j++)if(exactPhone(titles[j].getAttribute('title')))return true;
    return exactPhone(text(node).split('\n')[0]);
  }
  function exactPhone(value){
    value=String(value||'').replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,'').trim();
    return /^[+0-9 ()-]+$/.test(value)&&value.replace(/[^0-9]/g,'')===job.phone;
  }
  function conversationPhones(){
    var root=main(),phones=new Set();if(!root)return phones;
    var nodes=root.querySelectorAll('[data-id]');
    for(var i=0;i<nodes.length;i++){var phone=jidPhone(nodes[i].getAttribute('data-id'));if(phone)phones.add(phone);}
    return phones;
  }
  function conversationIdentities(){
    var root=main(),identities=new Set();if(!root)return identities;
    var nodes=root.querySelectorAll('[data-id]');
    for(var i=0;i<nodes.length;i++){var id=jidIdentity(nodes[i].getAttribute('data-id'));if(id)identities.add(id);}
    return identities;
  }
  function canonicalRecipientConflict(phones){
    phones=phones||conversationPhones();
    return phones.size>0&&(phones.size!==1||!phones.has(job.phone));
  }
  function rejectRecipientConflict(){result('error','تعارض رقم المستلم مع المحادثة الظاهرة في واتساب؛ أُوقف الإرسال التلقائي','recipient_conflict');}
  function recipientReady(){
    if(!header()||!editor())return false;
    var phones=conversationPhones(),headerMatches=hasExactPhone(header());
    // A phone-verified search result may show a saved contact name in a new chat.
    // Require the header to change to that selected label; never trust an old chat.
    var selectedMatches=!!job.selectedPhoneVerified&&!!job.selectedLabel&&headerLabel()===job.selectedLabel&&headerLabel()!==job.oldHeaderLabel;
    if(canonicalRecipientConflict(phones)){
      // A target-looking header can render before the old chat is unmounted.
      // Removing that contradictory history must not turn it into verified evidence.
      if(headerMatches||selectedMatches)job.recipientConflict=true;
      return false;
    }
    if(job.recipientConflict)return false;
    return headerMatches||(phones.size===1&&phones.has(job.phone))||selectedMatches;
  }
  function recipientUnchanged(){
    if(!job.recipientVerified)return false;
    var phones=conversationPhones();
    if(phones.size&&(!phones.has(job.phone)||phones.size!==1))return false;
    var identities=conversationIdentities();
    if(job.recipientIdentity&&identities.size&&(!identities.has(job.recipientIdentity)||identities.size!==1))return false;
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
    direct=labelledButton(scope,/^(?:send|إرسال)(?:\s*\([^)]*\))?$/i);
    if(direct)return direct;
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
    // This is the explicitly identified contact-search field, never a composer.
    // WhatsApp can keep the last query when its New chat drawer is reopened.
    if(text(node)){node.textContent='';node.dispatchEvent(new InputEvent('input',{bubbles:true,data:'',inputType:'deleteContentBackward'}));}
    return setEditor(node,value);
  }
  var NEW_CHAT=/^(?:new chat|دردشة جديدة|محادثة جديدة)(?:\s*\([^)]*\))?$/i;
  function searchIn(scope){return scope&&one(['input[type="text"]','input[type="search"]','[contenteditable="true"][role="textbox"]','[contenteditable="true"]'],scope);}
  function newChatHeading(scope){
    var headings=scope.querySelectorAll('header,[role="heading"],h1,h2,h3');
    for(var i=0;i<headings.length;i++)if(visible(headings[i])&&NEW_CHAT.test(compact(text(headings[i]))))return headings[i];
    return null;
  }
  function newChatScope(){
    var drawer=one(['[data-testid="new-chat-drawer"]','[data-testid="drawer-left"]','[data-testid="chat-drawer"]']);
    if(drawer)return drawer;
    var side=document.querySelector('#side');
    if(side&&newChatHeading(side)&&searchIn(side))return side;
    // Current SPA builds need not expose test IDs or put their drawer in #side.
    // A New chat heading plus its search field identifies the pane without using
    // a global message search, another conversation's composer, or navigation.
    var scopes=document.querySelectorAll('[role="dialog"],aside,section');
    for(var i=0;i<scopes.length;i++)if(visible(scopes[i])&&newChatHeading(scopes[i])&&searchIn(scopes[i]))return scopes[i];
    var headings=document.querySelectorAll('header,[role="heading"],h1,h2,h3');
    for(var j=0;j<headings.length;j++){
      if(!visible(headings[j])||!NEW_CHAT.test(compact(text(headings[j]))))continue;
      for(var p=parent(headings[j]),depth=0;p&&depth<5;p=parent(p),depth++){
        if(p===document.body||p===document.documentElement||p===main()||contains(p,main()))break;
        if(searchIn(p))return p;
      }
    }
    return null;
  }
  function contactMatches(row){
    var id=jidPhone(row.getAttribute('data-jid'))||jidPhone(row.getAttribute('data-id'));
    if(id)return id===job.phone;
    var titles=row.querySelectorAll('[title]');
    for(var i=0;i<titles.length;i++){
      var value=(titles[i].getAttribute('title')||'').trim();
      if(exactPhone(value))return true;
    }
    // Match a complete phone-number line, not digits inside a message preview.
    return text(row).split('\n').some(function(line){
      return exactPhone(line);
    });
  }
  function selectContact(row,verified){
    var title=row.querySelector('[title]');
    job.selectedLabel=compact(title&&title.getAttribute('title')||text(row).split('\n')[0]);
    job.selectedPhoneVerified=verified;
    row.click();attempts=0;phase('await_chat','جاري تجهيز محادثة المستلم');
  }
  function openRecipient(){
    if(recipientReady()){acceptRecipient();return;}
    if(job.recipientConflict){rejectRecipientConflict();return;}
    if(isLogin()){result('not_linked','واتساب غير مرتبط داخل قطفة','not_linked');return;}
    if(newChatScope()){
      job.oldHeaderLabel=headerLabel();attempts=0;phase('await_search','جاري فتح بحث جهة الاتصال');return;
    }
    var trigger=one(['button[aria-label="New chat"]','[role="button"][aria-label="New chat"]','button[title="New chat"]','[role="button"][title="New chat"]','button[aria-label="دردشة جديدة"]','[role="button"][aria-label="دردشة جديدة"]','button[aria-label="محادثة جديدة"]','[role="button"][aria-label="محادثة جديدة"]']);
    if(!trigger){
      var icon=one(['[data-icon="new-chat-outline"]','[data-icon="new-chat"]','[data-testid="chatlist-header-new-chat-btn"]']);
      trigger=icon&&icon.closest('button,[role="button"]');
    }
    if(!trigger)trigger=labelledButton(document,NEW_CHAT);
    if(!trigger){if(++attempts>24)result('error','تعذر العثور على زر محادثة جديدة في جلسة واتساب الحالية','new_chat_control_missing');return;}
    job.oldHeaderLabel=headerLabel();trigger.click();attempts=0;
    phase('await_search','جاري فتح محادثة المستلم');
  }
  function searchRecipient(){
    var scope=newChatScope();
    var input=searchIn(scope);
    if(!input){if(++attempts>28)result('error','لم يظهر بحث جهة الاتصال في واتساب','contact_search_missing');return;}
    if(!setSearch(input,job.phone)){result('error','تعذر إدخال رقم المستلم في بحث جهات الاتصال','contact_search_input_failed');return;}
    job.searchNode=input;
    attempts=0;phase('await_result','جاري مطابقة رقم المستلم');
  }
  function chooseRecipient(){
    var scope=newChatScope();
    var rows=scope?scope.querySelectorAll('[role="listitem"],[role="row"],[role="option"],[data-testid="cell-frame-container"]'):[];
    job.searchResultCount=rows.length;
    if(!job.searchNode||compact(job.searchNode.value||text(job.searchNode))!==job.phone){result('error','تغير رقم البحث قبل اختيار المستلم؛ تم إيقاف العملية','recipient_search_changed');return;}
    for(var i=0;i<rows.length;i++){
      var row=rows[i];
      if(!visible(row)||!contactMatches(row))continue;
      if(row.querySelector('input,[contenteditable="true"]'))continue;
      selectContact(row,true);return;
    }
    // Saved contacts can be rendered as a name and an opaque @lid. A sole,
    // stable search result may be opened for inspection, but this is not proof
    // of its number and cannot authorize writing a message or attaching a file.
    var candidates=[];
    for(var j=0;j<rows.length;j++){
      var candidate=rows[j],candidateTitle=candidate.querySelector('[title]');
      var knownPhone=jidPhone(candidate.getAttribute('data-jid'))||jidPhone(candidate.getAttribute('data-id'));
      if(!visible(candidate)||!candidateTitle||!compact(candidateTitle.getAttribute('title'))||
        candidate.querySelector('input,[contenteditable="true"]')||(knownPhone&&knownPhone!==job.phone))continue;
      var nested=false;
      for(var k=0;k<rows.length;k++)if(k!==j&&contains(candidate,rows[k])&&rows[k].querySelector('[title]'))nested=true;
      if(!nested)candidates.push(candidate);
    }
    if(candidates.length===1){
      if(job.savedCandidate===candidates[0])job.savedCandidateTicks=(job.savedCandidateTicks||0)+1;
      else{job.savedCandidate=candidates[0];job.savedCandidateTicks=1;}
      if(attempts>=4&&job.savedCandidateTicks>=3){selectContact(candidates[0],false);return;}
    }else{job.savedCandidate=null;job.savedCandidateTicks=0;}
    if(++attempts>32)result('error','لم يتم العثور على جهة اتصال تطابق رقم المستلم بشكل مؤكد','recipient_unverified');
  }
  var CONTACT_INFO=/^(?:contact info|contact details|معلومات جهة الاتصال|معلومات الاتصال)$/i;
  function contactInfoScope(){
    var roots=document.querySelectorAll('[data-testid="contact-info-drawer"],[data-testid="drawer-right"],[role="dialog"],aside,section');
    for(var i=0;i<roots.length;i++){
      if(!visible(roots[i]))continue;
      var headings=roots[i].querySelectorAll('header,[role="heading"],h1,h2,h3');
      for(var j=0;j<headings.length;j++)if(visible(headings[j])&&CONTACT_INFO.test(compact(text(headings[j]))))return roots[i];
    }
    var all=document.querySelectorAll('header,[role="heading"],h1,h2,h3');
    for(var k=0;k<all.length;k++){
      if(!visible(all[k])||!CONTACT_INFO.test(compact(text(all[k]))))continue;
      for(var p=parent(all[k]),depth=0;p&&depth<5;p=parent(p),depth++){
        if(p===main()||p===document.body||p===document.documentElement||contains(p,main()))break;
        if(text(p).split('\n').some(function(line){return compact(line)===job.selectedLabel;}))return p;
      }
    }
    return null;
  }
  function openContactInfo(){
    if(contactInfoScope()){result('error','توجد نافذة معلومات جهة اتصال سابقة؛ لم يتم تجهيز الرسالة','contact_info_already_open');return;}
    var h=header(),trigger=h&&labelledButton(h,CONTACT_INFO);
    if(!trigger&&h){
      var titles=h.querySelectorAll('[title]');
      for(var i=0;i<titles.length;i++)if(compact(titles[i].getAttribute('title'))===job.selectedLabel){
        trigger=titles[i].closest('button,[role="button"]')||titles[i];break;
      }
    }
    if(!trigger){if(++attempts>20)result('error','تعذر فتح معلومات جهة الاتصال للتحقق من رقمها','contact_info_control_missing');return;}
    trigger.click();attempts=0;phase('await_contact_info','جاري التحقق من رقم جهة الاتصال المحفوظة');
  }
  function contactInfoVerified(root){
    // Accept the dedicated phone field or the phone directly below the selected
    // name in the profile header. A number in About, a description, or a message
    // never verifies an otherwise unrelated saved contact.
    var fields=root.querySelectorAll('[data-testid="contact-info-phone"],[data-testid="contact-info-subtitle"]');
    for(var i=0;i<fields.length;i++)if(visible(fields[i])&&exactPhone(text(fields[i])))return true;
    var lines=text(root).split('\n').map(compact).filter(Boolean);
    for(var j=0;j<Math.min(lines.length-1,5);j++)if(lines[j]===job.selectedLabel)return exactPhone(lines[j+1]);
    return false;
  }
  function inspectContactInfo(){
    if(headerLabel()!==job.selectedLabel){result('error','تغيرت المحادثة أثناء التحقق من رقم المستلم','recipient_changed');return;}
    var info=contactInfoScope();
    if(!info){if(++attempts>24)result('error','لم تظهر معلومات جهة الاتصال للتحقق من رقمها','contact_info_missing');return;}
    if(!contactInfoVerified(info)){
      if(++attempts>24)result('error','لم يؤكد واتساب رقم جهة الاتصال المحفوظة؛ لم يتم الإرسال','recipient_unverified');
      return;
    }
    var close=labelledButton(info,/^(?:close|back|إغلاق|اغلاق|رجوع)$/i);
    if(!close){
      var icon=one(['[data-icon="x"]','[data-icon="back"]','[data-icon="close"]'],info);
      close=icon&&icon.closest('button,[role="button"]');
    }
    if(!close){if(++attempts>24)result('error','تعذر إغلاق معلومات جهة الاتصال بأمان','contact_info_close_missing');return;}
    job.contactInfo=info;job.contactInfoVerified=true;close.click();attempts=0;
    phase('await_contact_close','جاري العودة إلى محادثة المستلم بعد تأكيد الرقم');
  }
  function acceptRecipient(){
    // Re-check here as well: the contact-info path reaches this method directly.
    if(job.recipientConflict||canonicalRecipientConflict()){rejectRecipientConflict();return;}
    job.recipientVerified=true;job.recipientLabel=headerLabel();attempts=0;
    var identities=conversationIdentities();
    // Opaque IDs are recorded only after number verification, never decoded or
    // assumed to be phone numbers. This binds later acknowledgement to this chat.
    job.recipientIdentity=identities.size===1?Array.from(identities)[0]:'';
    phase(job.isPdf?'await_attachment':'await_text',job.isPdf?'جاري تجهيز مستند PDF':'جاري تجهيز الرسالة');
  }
  var DOCUMENT_LABEL=/^(?:document|documents|مستند|مستندات|المستندات)$/i;
  function pdfCompatible(input){
    var accept=(input.getAttribute('accept')||'').toLowerCase();
    if(!accept.trim())return true;
    return accept.split(',').some(function(token){
      return /^(?:\*|\*\/\*|\.pdf|application\/(?:pdf|\*))$/.test(token.trim());
    });
  }
  function documentInputContext(input){
    if(contains(main(),input))return true;
    // A fresh input created by this job's Attach menu may be in a React portal.
    if(job.attachMenuClicked&&job.fileInputsBefore&&!job.fileInputsBefore.has(input))return true;
    for(var p=parent(input),depth=0;p&&depth<3;p=parent(p),depth++){
      if(DOCUMENT_LABEL.test(compact(text(p))))return true;
    }
    return false;
  }
  function attachPicker(){
    var inputs=document.querySelectorAll('input[type="file"]');
    var candidates=[];job.fileInputCount=inputs.length;job.compatiblePdfInputCount=0;
    for(var i=0;i<inputs.length;i++){
      var input=inputs[i];
      if(input.disabled||!pdfCompatible(input))continue;
      job.compatiblePdfInputCount++;
      if(input.files&&input.files.length){
        if(documentInputContext(input))job.existingFileDraft=true;
        continue; // Do not replace a staged attachment.
      }
      if(documentInputContext(input))candidates.push(input);
    }
    // Ambiguous controls need the Document menu; never choose the first global input.
    return candidates.length===1?candidates[0]:null;
  }
  function attachmentMenu(){
    var trigger=one(['button[aria-label="Attach"]','button[aria-label="إرفاق"]','[data-testid="attach-menu-plus"]','[data-testid="clip"]','[title="Attach"]','[title="إرفاق"]'],main()||document);
    if(!trigger)trigger=labelledButton(main()||document,/^(?:attach|إرفاق|إرفاق ملف)(?:\s*\([^)]*\))?$/i);
    if(trigger){(trigger.closest('button,[role="button"]')||trigger).click();return true;}
    var icon=one(['[data-icon="plus"]'],main()||document);
    if(icon){var button=icon.closest('button,[role="button"]');if(button){button.click();return true;}}
    return false;
  }
  function documentMenu(){
    var labelled=labelledButton(document,DOCUMENT_LABEL);
    if(labelled){labelled.click();return true;}
    var candidates=document.querySelectorAll('[role="menuitem"],li,button,[role="button"]');
    for(var i=0;i<candidates.length;i++)if(visible(candidates[i])&&DOCUMENT_LABEL.test(text(candidates[i]))){candidates[i].click();return true;}
    return false;
  }
  function previews(){return document.querySelectorAll('[role="dialog"],[data-testid*="preview"],[data-testid*="media-editor"]');}
  function filenameNodes(anyPdf){
    var nodes=document.querySelectorAll('[title],[aria-label],span'),matches=[];
    for(var i=0;i<nodes.length;i++){
      if(!visible(nodes[i]))continue;
      var labels=[nodes[i].getAttribute('title'),nodes[i].getAttribute('aria-label'),text(nodes[i])];
      if(labels.some(function(value){return value===job.filename||(anyPdf&&typeof value==='string'&&/^[^\r\n]{1,120}\.pdf$/i.test(value));}))matches.push(nodes[i]);
    }
    return matches;
  }
  function previewAround(node){
    for(var p=parent(node),depth=0;p&&depth<8;p=parent(p),depth++){
      if(p===main()||p===document.body||p===document.documentElement||contains(p,main())||p.getAttribute('data-id'))break;
      if(!visible(p)||previewBefore.has(p))continue;
      var send=sendButton(p);
      if(send)return {root:p,send:send};
    }
    return null;
  }
  function stageDocument(){
    if(attachmentStaged)return;
    if(!job.fileInputsBefore){
      var existing=previews();
      previewBefore=new Set();
      for(var k=0;k<existing.length;k++)if(visible(existing[k]))previewBefore.add(existing[k]);
      if(previewBefore.size){draftTouched=true;result('error','توجد نافذة أو مسودة مرفق تمنع الإرسال التلقائي؛ لم يتم تغييرها','existing_attachment_draft');return;}
      var oldFiles=filenameNodes(true);
      for(var f=0;f<oldFiles.length;f++)if(previewAround(oldFiles[f])){
        draftTouched=true;result('error','توجد مسودة مرفق تمنع الإرسال التلقائي؛ لم يتم تغييرها','existing_attachment_draft');return;
      }
      job.fileInputsBefore=new Set(document.querySelectorAll('input[type="file"]'));
      filenameBefore=new Set(filenameNodes());
    }
    var input=attachPicker();
    if(job.existingFileDraft){draftTouched=true;result('error','توجد مسودة مرفق تمنع الإرسال التلقائي؛ لم يتم تغييرها','existing_attachment_draft');return;}
    if(!input){
      // Retry finding late-rendered controls, not their actions. Each menu is
      // activated at most once; the attachment itself still gets one event.
      if(!job.attachMenuClicked){if(attachmentMenu())job.attachMenuClicked=true;}
      else if(!job.documentMenuClicked){if(documentMenu())job.documentMenuClicked=true;}
      if(++attempts>32)result('error','لم يوفر واتساب مدخل مستند PDF في الجلسة الحالية','pdf_input_missing');
      return;
    }
    try{
      var raw=atob(job.chunks.join('')),bytes=new Uint8Array(raw.length);
      for(var i=0;i<raw.length;i++)bytes[i]=raw.charCodeAt(i);
      if(bytes.length<5||bytes.length>5000000||String.fromCharCode.apply(null,bytes.slice(0,5))!=='%PDF-')throw Error('Invalid PDF');
      var file=new File([bytes],job.filename,{type:'application/pdf',lastModified:Date.now()});
      var dt=new DataTransfer();dt.items.add(file);
      // Assignment/event hooks can mutate React before throwing. Once touching
      // a send draft is possible, a second transport must never be attempted.
      draftTouched=true;input.files=dt.files;
      if(!input.files||input.files.length!==1||input.files[0].type!=='application/pdf')throw Error('PDF was not assigned');
      attachmentStaged=true;draftTouched=true;job.chunks=[];
      // A single attachment mechanism. Combining paste, drop and change duplicates files.
      input.dispatchEvent(new Event('change',{bubbles:true}));
      attempts=0;phase('await_preview','جاري تجهيز معاينة مستند PDF');
    }catch(e){result('error','تعذر تجهيز مرفق PDF داخل واتساب','pdf_attach_failed');}
  }
  function previewReady(){
    var all=previews();
    for(var i=0;i<all.length;i++){
      var root=all[i];
      if(visible(root)&&!previewBefore.has(root)&&text(root).includes(job.filename)){
        var button=sendButton(root);
        // The document preview can have its own footer. Scope, not the footer
        // tag, separates its Send button from the conversation composer.
        if(button&&root!==main()&&!contains(root,main()))return {root:root,send:button};
      }
    }
    // Production builds can omit test IDs and dialog roles. A newly introduced
    // filename node plus its own Send control is sufficient only inside a
    // separate preview subtree, never a message bubble or the whole chat.
    var names=filenameNodes();
    for(var j=0;j<names.length;j++){
      if(filenameBefore.has(names[j]))continue;
      var preview=previewAround(names[j]);if(preview)return preview;
    }
    return null; // Never mistake an old filename in the conversation for an upload preview.
  }
  function outgoing(){return main()?Array.from(main().querySelectorAll('[data-id^="true_"]')):[];}
  function dispatchOnce(button){
    if(buttonClicked)return;
    if(!recipientUnchanged()){result('error','تغيرت محادثة المستلم قبل الإرسال؛ تم إيقاف العملية','recipient_changed');return;}
    outgoingBefore=new Set(outgoing().map(function(n){return n.getAttribute('data-id');}));
    buttonClicked=true;clickedAt=Date.now();state.dispatched=true;
    phase('verifying','جاري التحقق من قبول واتساب للمستند أو الرسالة');
    button.click(); // Exactly one activation; never follow a click with Enter or another click.
  }
  function stagePreview(){
    if(++attempts>52){result('error','لم تظهر معاينة جديدة لمستند PDF داخل واتساب','pdf_preview_missing');return;}
    var preview=previewReady();if(!preview)return;
    if(job.caption){
      var caption=one(['[contenteditable="true"][role="textbox"]','[contenteditable="true"]'],preview.root);
      if(!caption)return;
      if(!job.captionNode){
        draftTouched=true;
        if(!setEditor(caption,job.caption)){result('error','تعذر إضافة رسالة المستند دون تغيير مسودة أخرى','caption_input_failed');return;}
        job.captionNode=caption;
      }
      if(compact(text(caption))!==compact(job.caption)){result('error','تغير نص رسالة المستند قبل الإرسال','caption_changed');return;}
    }
    dispatchOnce(preview.send);
  }
  function stageText(){
    var field=editor();if(!field){if(++attempts>20)result('error','لم يظهر حقل الرسالة في محادثة المستلم','composer_missing');return;}
    if(!job.textNode){
      draftTouched=true;
      if(!setEditor(field,job.caption)){result('error','توجد مسودة حالية أو لم يكتمل إدخال الرسالة؛ أُوقف الإرسال التلقائي','text_draft_conflict');return;}
      job.textNode=field;draftTouched=true;
    }
    if(compact(text(field))!==compact(job.caption)){result('error','تغيرت مسودة الرسالة قبل الإرسال','text_draft_changed');return;}
    var send=sendButton(field.closest('footer')||main());
    if(!send){if(++attempts>18)result('error','لم يظهر زر إرسال واتساب','send_control_missing');return;}
    dispatchOnce(send);
  }
  function acceptedOutgoing(){
    var nodes=outgoing();
    for(var i=0;i<nodes.length;i++){
      var node=nodes[i],id=node.getAttribute('data-id');
      if(outgoingBefore.has(id))continue;
      var matchesPhone=jidPhone(id)===job.phone;
      var matchesVerifiedIdentity=job.recipientIdentity&&job.recipientIdentity.endsWith('@lid')&&
        jidIdentity(id)===job.recipientIdentity&&recipientUnchanged();
      if(!matchesPhone&&!matchesVerifiedIdentity)continue;
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
    if(Date.now()-job.startedAt>62000){result(buttonClicked?'uncertain':'error',buttonClicked?'تعذر تأكيد نتيجة واتساب؛ راجع المحادثة قبل إعادة الإرسال':'انتهت مهلة انتظار واتساب دون تنفيذ الإرسال','send_timeout');return;}
    var failure=knownFailure();if(failure){result(buttonClicked?'uncertain':'error',failure,'recipient_unavailable');return;}
    if(['await_attachment','await_preview','await_text'].includes(state.phase)&&!recipientUnchanged()){
      result('error','تغيرت محادثة المستلم قبل الإرسال؛ تم إيقاف العملية','recipient_changed');return;
    }
    if(state.phase==='open_chat')openRecipient();
    else if(state.phase==='await_search')searchRecipient();
    else if(state.phase==='await_result')chooseRecipient();
    else if(state.phase==='await_chat'){
      if(recipientReady())acceptRecipient();
      else if(job.recipientConflict)rejectRecipientConflict();
      else if(job.selectedLabel&&headerLabel()===job.selectedLabel&&editor())openContactInfo();
      else if(++attempts>30)result('error','تعذر تأكيد فتح رقم المستلم المطلوب','recipient_unverified');
    }
    else if(state.phase==='await_contact_info')inspectContactInfo();
    else if(state.phase==='await_contact_close'){
      if(!visible(job.contactInfo)&&headerLabel()===job.selectedLabel&&editor())acceptRecipient();
      else if(++attempts>20)result('error','لم يتأكد الرجوع إلى محادثة المستلم بعد فحص الرقم','contact_info_close_failed');
    }
    else if(state.phase==='await_attachment')stageDocument();
    else if(state.phase==='await_preview')stagePreview();
    else if(state.phase==='await_text')stageText();
    else if(state.phase==='verifying'){
      if(acceptedOutgoing()){result('submitted','قبل واتساب المستند أو الرسالة؛ لم يتم تأكيد التسليم للمستلم');return;}
      if(Date.now()-clickedAt>14000)result('uncertain','لا يمكن تأكيد نتيجة الإرسال؛ راجع المحادثة قبل المحاولة مجددًا','send_ack_timeout');
    }
  }
  function tick(){
    if(stepping)return;stepping=true;
    try{step();}
    catch(e){result(buttonClicked?'uncertain':'error',buttonClicked?'تعذر تأكيد نتيجة واتساب؛ راجع المحادثة قبل إعادة الإرسال':'تعذر إكمال تجهيز الرسالة في واتساب','driver_exception');}
    finally{stepping=false;}
  }
  window.__qatfahDirect={
    version:3,
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
      outgoingBefore=new Set();previewBefore=new Set();filenameBefore=new Set();
      state={phase:'preparing',message:'جاري تجهيز الإرسال',code:'',failedStage:'',driverVersion:3,submitted:false,dispatched:false,safeToFallback:false,deliveryConfirmed:false};
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
    status:function(){state.diagnostics=diagnostics();return JSON.stringify(state);},
    cancel:function(){
      stopTimer();job=null;stepping=false;
      state={phase:'idle',message:'',code:'',failedStage:'',driverVersion:3,submitted:false,dispatched:false,safeToFallback:true,deliveryConfirmed:false};return true;
    }
  };
  return true;
})()
