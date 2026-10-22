/* Qatfah silent sender v4. No navigation, clicks, paste, dialogs, or visible
 * chat changes. The native Activity injects the pinned WA-JS asset first.
 * WA-JS is unofficial; contract tests are not evidence of live delivery. */
(function () {
  'use strict';
  if (window.__qatfahDirect?.version === 4) return true;
  const VERSION = '4.7.1', MAX_PDF_BYTES = 5000000, MAX_BASE64 = 4 * Math.ceil(MAX_PDF_BYTES / 3);
  let current = null, libraryInFlight = false;
  // Timed-out WA-JS promises cannot safely be aborted. Keep this guard until
  // settlement, even after caller/native locks release, to prevent duplicates.
  // Remember every invocation, including rejected/uncertain attempts. A timeout
  // can finish before WA-JS later accepts the message; replaying that request ID
  // must never enqueue the same document again in this engine's lifetime.
  const dispatchedRequests = new Set();
  const token = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value);
  const wid = value => typeof value === 'string' ? value : value?.toString?.() || '';
  const error = (code, message) => Object.assign(new Error(message), {code});
  function snapshot(op = current) {
    if (!op) return {phase:'idle',status:'idle',submitted:false,dispatched:false,finished:true,driverVersion:4,wppVersion:VERSION,safeToFallback:false};
    return {requestId:op.requestId,phase:op.phase,status:op.phase,message:op.message,code:op.code,failedStage:op.failedStage,
      driverVersion:4,wppVersion:VERSION,dispatched:op.dispatched,submitted:op.submitted,ack:op.ack,messageId:op.messageId,
      delivered:op.ack >= 2 && op.submitted,deliveryConfirmed:op.ack >= 2 && op.submitted,finished:op.finished,
      safeToFallback:false,retrySafe:!op.dispatched && !libraryInFlight,
      diagnostics:{recipientVerified:op.recipientVerified,attachmentStaged:op.fileValidated}};
  }
  function phase(op, name, message) { if (op === current && !op.finished) { op.phase=name; op.message=message; } }
  function finish(op, name, code, message) {
    if (op !== current || op.finished) return;
    op.failedStage=name === 'submitted' ? '' : op.phase;
    op.phase=name; op.code=code; op.message=message; op.finished=true; op.chunks.length=0;
    if (op.deadline !== null) clearTimeout(op.deadline);
    op.deadline=null;
  }
  const alive = op => current === op && !op.finished;
  const pause = ms => new Promise(resolve => setTimeout(resolve,ms));
  function checkConnection(wpp) {
    if (navigator.onLine === false) throw error('offline','الإنترنت غير متصل؛ لم يُرسل المستند');
    if (!wpp.conn.isAuthenticated()) throw error('session_not_authenticated','جلسة واتساب غير متصلة؛ افتح قسم واتساب لمراجعة الربط');
    return wpp.conn.isMainReady() && wpp.conn.isOnline();
  }
  async function waitReady(op) {
    const deadline=Date.now()+15000;
    while (alive(op)) {
      const wpp=window.WPP;
      if (!wpp || wpp.version !== VERSION) throw error('wpp_version_mismatch','محرك واتساب المرفق غير جاهز؛ يلزم تحديث نسخة قطفة');
      if (wpp.isReady === true || wpp.loader?.isReady === true) {
        if (typeof wpp.chat?.sendFileMessage !== 'function' || typeof wpp.chat?.sendTextMessage !== 'function' ||
            typeof wpp.contact?.queryWidExists !== 'function' || typeof wpp.conn?.isAuthenticated !== 'function' ||
            typeof wpp.conn?.isMainReady !== 'function' || typeof wpp.conn?.isOnline !== 'function') {
          throw error('wpp_api_unavailable','تعذر تهيئة واجهة الإرسال الداخلي؛ لم يُرسل المستند');
        }
        if (checkConnection(wpp)) return wpp;
      }
      if (Date.now() >= deadline) throw error('wpp_not_ready','اتصال واتساب لم يجهز للإرسال بعد؛ لم يُرسل المستند');
      await pause(200);
    }
    return null;
  }
  function pdfContent(op) {
    if (!op.isPdf) return '';
    const base64=op.chunks.join(''); op.chunks.length=0;
    if (!base64 || base64.length > MAX_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4) {
      throw error('invalid_pdf','ملف PDF غير صالح؛ لم يُرسل المستند');
    }
    let decoded;
    try { decoded=atob(base64); } catch { throw error('invalid_pdf','ترميز ملف PDF غير صالح'); }
    if (decoded.length < 5 || decoded.length > MAX_PDF_BYTES || decoded.slice(0,5) !== '%PDF-') {
      throw error('invalid_pdf','يجب إرسال PDF صحيح لا يتجاوز 5 ميجابايت');
    }
    op.fileValidated=true;
    return 'data:application/pdf;base64,'+base64;
  }
  function acceptResult(op,result,recipients) {
    if (!result || typeof result.id !== 'string' || !result.id || result.id.length > 250) {
      throw error('ack_id_missing','لم يُرجع واتساب رقم الرسالة؛ راجع المحادثة قبل إعادة المحاولة');
    }
    const idRecipient=result.id.match(/^true_([^_]+)_[^_]+$/)?.[1],to=wid(result.to);
    if (!idRecipient || !recipients.has(idRecipient) || (to && !recipients.has(to))) {
      throw error('ack_recipient_mismatch','تعذر مطابقة تأكيد واتساب مع رقم العميل؛ راجع المحادثة قبل إعادة المحاولة');
    }
    op.messageId=result.id;
    const ack=result.ack;
    if (!Number.isInteger(ack) || ack < 1 || ack > 4) {
      throw error('ack_not_confirmed','لم يؤكد واتساب قبول الرسالة بعد؛ راجع المحادثة قبل إعادة المحاولة');
    }
    // WA-JS 4.7.1 returns a resolved SendMsgResultObject. Explicit failure
    // must not be hidden by a contradictory positive acknowledgement value.
    const sendStatus=result.sendMsgResult;
    const sendResult=sendStatus && typeof sendStatus === 'object' ? sendStatus.messageSendResult : sendStatus;
    if (sendStatus != null && sendResult !== 'OK') {
      throw error('ack_result_conflict','لم تتطابق نتيجة واتساب مع تأكيد الإرسال؛ راجع المحادثة قبل إعادة المحاولة');
    }
    op.ack=ack; op.submitted=true;
    finish(op,'submitted','',ack >= 2 ? 'تم تسليم المستند للعميل' : 'تم إرسال المستند؛ أكّد خادم واتساب قبوله');
  }
  async function run(op) {
    try {
      const content=pdfContent(op);
      phase(op,'waiting_engine','جارٍ تجهيز محرك واتساب في الخلفية');
      const wpp=await waitReady(op);
      if (!alive(op) || !wpp) return;
      phase(op,'verifying_recipient','جارٍ التحقق من رقم العميل');
      const contact=await wpp.contact.queryWidExists(op.jid);
      if (!alive(op)) return;
      if (!contact) throw error('recipient_not_registered','رقم العميل غير مسجل في واتساب؛ لم يُرسل المستند');
      if (wid(contact.wid) !== op.jid) throw error('recipient_mismatch','لم يتطابق رقم واتساب مع رقم العميل؛ لم يُرسل المستند');
      const recipients=new Set([op.jid]),lid=wid(contact.lid);
      if (/^[0-9]+@lid$/.test(lid)) recipients.add(lid);
      op.recipientVerified=true;
      if (!checkConnection(wpp)) throw error('transport_not_ready','انقطع اتصال واتساب قبل الإرسال؛ لم يُرسل المستند');
      phase(op,'submitting','جارٍ إرسال المستند في الخلفية');
      const options={waitForAck:true,markIsRead:false,detectMentioned:false};
      // Even a rejected WA-JS Promise may have queued a message. No automatic
      // retry, paste, click or native application fallback is safe here.
      op.dispatched=true; libraryInFlight=true; dispatchedRequests.add(op.requestId);
      let result;
      try {
        result=op.isPdf
          ? await wpp.chat.sendFileMessage(op.jid,content,{...options,type:'document',mimetype:'application/pdf',filename:op.filename,caption:op.caption})
          : await wpp.chat.sendTextMessage(op.jid,op.caption,options);
      } finally { libraryInFlight=false; }
      if (!alive(op)) return;
      phase(op,'verifying','جارٍ التحقق من قبول واتساب للمستند');
      acceptResult(op,result,recipients);
    } catch (cause) {
      if (!alive(op)) return;
      const known=typeof cause?.code === 'string' && /^[a-z_]{1,80}$/.test(cause.code);
      const message=known ? cause.message : op.dispatched
        ? 'لم يتأكد إرسال المستند؛ راجع المحادثة قبل إعادة المحاولة'
        : 'تعذر تجهيز الإرسال الداخلي؛ لم يُرسل المستند';
      finish(op,op.dispatched?'uncertain':'error',known?cause.code:'wpp_operation_failed',message);
    }
  }
  window.__qatfahDirect={
    version:4,
    prepare(options={}) {
      if ((current && !current.finished) || libraryInFlight) return false;
      if (!token(options.requestId) || !/^9677[0-9]{8}$/.test(options.phone || '')) return false;
      if (dispatchedRequests.has(options.requestId)) return false;
      const caption=String(options.caption || ''),filename=String(options.filename || 'Qatfah.pdf');
      if (caption.length > 3000 || filename.length > 120 || /[\\/\x00-\x1f]/.test(filename) ||
          (options.isPdf && !/\.pdf$/i.test(filename)) || (!options.isPdf && !caption.trim())) return false;
      current={requestId:options.requestId,phone:options.phone,jid:options.phone+'@c.us',caption,filename,
        isPdf:options.isPdf === true,chunks:[],size:0,phase:'preparing',message:'جارٍ تجهيز الإرسال',
        code:'',failedStage:'',dispatched:false,submitted:false,ack:0,messageId:'',finished:false,
        deadline:null,started:false,fileValidated:false,recipientVerified:false};
      return true;
    },
    addChunk(chunk) {
      if (!current || current.finished || current.started || !current.isPdf || typeof chunk !== 'string') return false;
      if (current.size+chunk.length > MAX_BASE64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(chunk)) {
        finish(current,'error','invalid_pdf','ملف PDF غير صالح أو يتجاوز الحجم المسموح'); return false;
      }
      current.chunks.push(chunk); current.size+=chunk.length; return true;
    },
    start() {
      if (!current) return false;
      if (current.finished) return current.submitted === true;
      if (current.started || libraryInFlight) return false;
      current.started=true;
      const op=current;
      op.deadline=setTimeout(()=>finish(op,op.dispatched?'uncertain':'error','send_timeout',
        op.dispatched?'انتهت مهلة تأكيد واتساب؛ راجع المحادثة قبل إعادة المحاولة':'لم يجهز اتصال واتساب خلال المهلة؛ لم يُرسل المستند'),100000);
      void run(op); return true;
    },
    status() { return JSON.stringify(snapshot()); },
    cancel() {
      if (current && !current.finished) finish(current,current.dispatched?'uncertain':'error','send_interrupted',
        current.dispatched?'توقف التحقق من واتساب؛ راجع المحادثة قبل إعادة المحاولة':'أُوقفت المحاولة قبل الإرسال');
      return true;
    }
  };
  return true;
})();
