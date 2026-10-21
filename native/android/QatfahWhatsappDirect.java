package com.qatfah.accounting;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
import android.view.ViewParent;
import android.webkit.WebChromeClient;
import android.widget.FrameLayout;
import android.webkit.CookieManager;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebResourceRequest;
import android.net.Uri;
import com.getcapacitor.PluginCall;
import com.getcapacitor.JSObject;
import org.json.JSONObject;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/** Best-effort, in-process WhatsApp Web companion. No external window or sharesheet.
 * Never reports delivery confirmed; DOM changes and WebView blocking must be handled.
 */
public final class QatfahWhatsappDirect {
 private static QatfahWhatsappDirect shared;
 private final Activity activity;
 private FrameLayout parkedFrame;
 private boolean inLinkScreen=false;
 private boolean chatVisible=false;
 private long lastLinkedAt=0L;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private WebView web;
 private PluginCall pending;
 private String script;
 private boolean loaded=false,injected=false,uploading=false,atRecipient=false;
 private long startedAt;
 private static final String UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
 public QatfahWhatsappDirect(Activity activity){this.activity=activity;shared=this;}
 public static QatfahWhatsappDirect getShared(){return shared;}
 private void init() throws Exception{
  if(web!=null)return;
  try(InputStream in=activity.getAssets().open("whatsapp-direct.js")){
    byte[] bytes=new byte[in.available()];
    int off=0,n;while(off<bytes.length&&(n=in.read(bytes,off,bytes.length-off))>0)off+=n;
    script=new String(bytes,0,off,StandardCharsets.UTF_8);
  }
  web=new WebView(activity);
  WebSettings settings=web.getSettings();
  settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
  settings.setUserAgentString(UA);settings.setUseWideViewPort(true);
  settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
  settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager.getInstance().setAcceptCookie(true);
  CookieManager.getInstance().setAcceptThirdPartyCookies(web,true);
  web.setAlpha(0.01f);
  web.setVisibility(View.VISIBLE);
  ViewGroup host=activity.findViewById(android.R.id.content);
  parkedFrame=new FrameLayout(activity);
  parkedFrame.setClipChildren(true);parkedFrame.setClipToPadding(true);
  FrameLayout.LayoutParams desktopSize=new FrameLayout.LayoutParams((int)(1100*activity.getResources().getDisplayMetrics().density),(int)(800*activity.getResources().getDisplayMetrics().density));
  parkedFrame.addView(web,desktopSize);
  FrameLayout.LayoutParams params=new FrameLayout.LayoutParams(2,2,android.view.Gravity.BOTTOM|android.view.Gravity.RIGHT);
  host.addView(parkedFrame,params);
  installWebClient();
  web.loadUrl("https://web.whatsapp.com/");
  handler.postDelayed(new Runnable(){@Override public void run(){
   if(web!=null&&pending==null&&!inLinkScreen)web.evaluateJavascript("document.readyState",null);
   handler.postDelayed(this,5000);
  }},5000);
 }
 private void installWebClient(){
  web.setWebViewClient(new WebViewClient(){
    @Override public void onPageFinished(WebView view,String url){
      if(!url.startsWith("https://web.whatsapp.com/"))return;
      loaded=true;injected=false;
      if(pending!=null){if(atRecipient)handler.postDelayed(()->injectAndSend(),1400);else navigate(pending.getString("phone",""),pending.getString("caption",""));}
    }
    @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
      Uri url=request.getUrl();return !("https".equals(url.getScheme())&&"web.whatsapp.com".equals(url.getHost()));
    }
  });
 }
 public void ensureRunning() throws Exception {init();}
 /** The QR screen observes the same WebView without detaching or reloading it. */
 public WebView takeForLinking() throws Exception {
  init();
  if(pending!=null)return null;
  inLinkScreen=true;
  return web;
 }
 /** Manual chats are optional: only detach on explicit request to display them. */
 public boolean detachForChat(WebView requested){
  if(requested!=web||!inLinkScreen||pending!=null)return false;
  ViewParent old=web.getParent();
  if(old instanceof ViewGroup)((ViewGroup)old).removeView(web);
  chatVisible=true;
  return true;
 }
 public void returnFromLinking(WebView borrowed){
  if(borrowed==null||borrowed!=web||parkedFrame==null)return;
  if(chatVisible){
   ViewParent old=web.getParent();
   if(old instanceof ViewGroup)((ViewGroup)old).removeView(web);
   FrameLayout.LayoutParams desktop=new FrameLayout.LayoutParams(
    (int)(1100*activity.getResources().getDisplayMetrics().density),
    (int)(800*activity.getResources().getDisplayMetrics().density));
   parkedFrame.addView(web,desktop);
   web.setWebChromeClient(new WebChromeClient());
   installWebClient();
  }
  web.setAlpha(0.01f);
  chatVisible=false;inLinkScreen=false;atRecipient=false;
  CookieManager.getInstance().flush();
 }
 public void getConnectionStatus(PluginCall call){
  activity.runOnUiThread(()->{
   if(web==null){JSObject out=new JSObject();out.put("status","not_started");call.resolve(out);return;}
   String js="(function(){try{"+
    "if(!navigator.onLine)return 'offline';"+
    "if(document.querySelector('#pane-side,[data-testid=chat-list],[data-testid=chatlist-header],#main footer'))return 'connected';"+
    "if(document.querySelector('[data-testid*=qr] canvas,canvas[aria-label*=QR]'))return 'not_linked';"+
    "return document.readyState==='loading'?'loading':'reconnecting';"+
    "}catch(e){return 'unknown'}})()";
   web.evaluateJavascript(js,value->{
    String status=decode(value);
    if("connected".equals(status))lastLinkedAt=System.currentTimeMillis();
    else if("reconnecting".equals(status)&&lastLinkedAt>0L)status="reconnecting";
    if(inLinkScreen&&!"connected".equals(status)&&!"offline".equals(status))status="linking";
    JSObject out=new JSObject();out.put("status",status);
    out.put("sessionAlive",true);
    out.put("previouslyLinked",lastLinkedAt>0L);
    call.resolve(out);
   });
  });
 }
 private static final String PAIRING_STATE="(function(){try{"+
  "if(document.querySelector('#pane-side,[data-testid=chat-list],[data-testid=chatlist-header],#main footer'))return JSON.stringify({status:'connected'});"+
  "var canv=[...document.querySelectorAll('canvas')].find(x=>x.width>=140&&x.height>=140);"+
  "var qr='';if(canv){try{qr=canv.toDataURL('image/png')}catch(e){}}"+
  "var code='';for(var el of document.querySelectorAll('div,span,strong')){var t=(el.textContent||'').trim();if(el.children.length===0&&/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(t)){code=t;break}}"+
  "return JSON.stringify({status:qr?'not_linked':'checking',qr:qr,code:code})"+
  "}catch(e){return JSON.stringify({status:'unknown'})}})()";
 public void pairingStatus(PluginCall call){
  activity.runOnUiThread(()->{
   try{init();web.evaluateJavascript(PAIRING_STATE,value->{
    try{JSONObject state=new JSONObject(decode(value));JSObject out=new JSObject();
     out.put("status",state.optString("status","unknown"));
     String qr=state.optString("qr","");
     out.put("qr",qr.length()<500000?qr:"");
     out.put("code",state.optString("code",""));call.resolve(out);
    }catch(Exception e){call.reject("تعذر فحص الربط",e);}
   });}catch(Exception e){call.reject("تعذر تشغيل واتساب",e);}
  });
 }
 public void pairingPhone(PluginCall call,String phone){
  activity.runOnUiThread(()->{
   if(!phone.matches("[0-9]{9,15}")){call.reject("رقم غير صحيح");return;}
   if(pending!=null){call.reject("عملية إرسال جارية");return;}
   try{init();String js="(function(){var b=[...document.querySelectorAll('button,[role=button]')].find(x=>/link with phone|phone number|رقم الهاتف|ربط.*رقم/i.test(x.innerText||x.textContent||''));if(b){b.click();return 'ok'}return 'no'})()";
    web.evaluateJavascript(js,value->handler.postDelayed(()->fillPairingPhone(phone,call,0),1500));
   }catch(Exception e){call.reject("تعذر طلب الرمز",e);}
  });
 }
 private void fillPairingPhone(String phone,PluginCall call,int attempt){
  String js="(function(){var x=document.querySelector('input[type=tel],input[inputmode=tel]');if(!x)return 'waiting';"+
   "var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(x,"+JSONObject.quote(phone)+");"+
   "x.dispatchEvent(new Event('input',{bubbles:true}));"+
   "var btn=[...document.querySelectorAll('button,[role=button]')].find(b=>/next|التالي|continue|متابعة/i.test(b.innerText||b.textContent||''));"+
   "if(btn&&!btn.disabled){btn.click();return 'sent'}return 'waiting'})()";
  web.evaluateJavascript(js,value->{
   if(value.contains("sent")){JSObject out=new JSObject();out.put("requested",true);call.resolve(out);}
   else if(attempt<7)handler.postDelayed(()->fillPairingPhone(phone,call,attempt+1),1200);
   else call.reject("واتساب لم يوفر حقل الربط بالرقم");
  });
 }
 private void fail(String message){
  PluginCall call=pending;pending=null;uploading=false;
  if(call!=null)call.reject(message);
 }
 private String decode(String value){
  if(value==null)return "";
  try{return (String)new org.json.JSONTokener(value).nextValue();}catch(Exception e){return value;}
 }
 private void injectAndSend(){
  if(web==null||pending==null||!loaded)return;
  if(!injected){
   web.evaluateJavascript(script,v->{if(pending==null)return;injected=true;injectAndSend();});return;
  }
  String phone=pending.getString("phone","");
  String caption=pending.getString("caption","");
  String filename=pending.getString("filename","Qatfah.pdf");
  String base64=pending.getString("base64","");
  try{
   JSONObject options=new JSONObject();options.put("phone",phone);options.put("caption",caption);
   options.put("filename",filename);options.put("isPdf",!base64.isEmpty());
   web.evaluateJavascript("window.__qatfahDirect.prepare("+options.toString()+")",ok->{
    if(pending==null)return;
    if(!"true".equals(ok)){fail("واتساب مشغول بمحاولة إرسال أخرى");return;}
    if(base64.isEmpty()){beginSend();return;}
    // Chunked injection avoids very large evaluateJavascript arguments.
    int chunkSize=200000;sendChunk(base64,0,chunkSize,phone,caption);
   });
  }catch(Exception e){fail("تعذر تجهيز رسالة واتساب");}
 }
 private void sendChunk(String b64,int index,int size,String phone,String caption){
  if(pending==null||web==null)return;
  if(index>=b64.length()){beginSend();return;}
  String chunk=JSONObject.quote(b64.substring(index,Math.min(b64.length(),index+size)));
  web.evaluateJavascript("window.__qatfahDirect.addChunk("+chunk+")",v->{
   if(!"true".equals(v)){fail("فشل نقل مرفق PDF إلى واتساب");return;}
   sendChunk(b64,index+size,size,phone,caption);
  });
 }
 private void navigate(String phone,String caption){
  if(pending==null||web==null)return;
  atRecipient=true;loaded=false;
  String url="https://web.whatsapp.com/send?phone="+Uri.encode(phone);
  web.loadUrl(url);
 }
 private void beginSend(){
  if(pending==null||web==null)return;
  web.evaluateJavascript("window.__qatfahDirect.start()",started->{
   if(!"true".equals(started)){fail("تعذر بدء الإرسال داخل واتساب");return;}
   check();
  });
 }
 private void check(){
  if(pending==null||web==null)return;
  if(System.currentTimeMillis()-startedAt>70000){fail("تعذر تأكيد الإرسال؛ راجع المحادثة قبل إعادة المحاولة");return;}
  web.evaluateJavascript("window.__qatfahDirect&&window.__qatfahDirect.status()",v->{
   if(pending==null)return;
   try{
    JSONObject state=new JSONObject(decode(v));
    String phase=state.optString("phase","");
    if("submitted".equals(phase)){
     PluginCall call=pending;pending=null;uploading=false;
     JSObject out=new JSObject();out.put("status","submitted");out.put("deliveryConfirmed",false);
     out.put("message","ظهرت الرسالة ضمن الرسائل الصادرة؛ لم يتأكد التسليم");
     call.resolve(out);return;
    }
    if("error".equals(phase)||"not_linked".equals(phase)||"uncertain".equals(phase)){
     fail(state.optString("message","تعذر تأكيد إرسال واتساب"));return;
    }
   }catch(Exception ignored){}
   handler.postDelayed(this::check,900);
  });
 }
 public void send(PluginCall call){
  activity.runOnUiThread(()->{
   if(pending!=null){call.reject("يوجد إرسال جارٍ بالفعل");return;}
   try{
    pending=call;startedAt=System.currentTimeMillis();uploading=true;atRecipient=false;
    init();
    if(loaded)navigate(call.getString("phone",""),call.getString("caption",""));
    else handler.postDelayed(()->{if(pending!=null&&!loaded)fail("واتساب ويب لم يحمل داخل التطبيق؛ افتح شاشة الربط أولًا");},20000);
   }catch(Exception e){fail("تعذر بدء واتساب المدمج: "+e.getMessage());}
  });
 }
}
