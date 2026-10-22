package com.qatfah.accounting;

import android.app.Activity;
import android.content.Context;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.CookieManager;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebStorage;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import androidx.webkit.WebStorageCompat;
import androidx.webkit.WebViewFeature;
import com.getcapacitor.JSObject;
import com.getcapacitor.PluginCall;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.json.JSONObject;

/** One Activity-owned surface independent of Capacitor routes and dialogs.
 * Saved pairing, live transport readiness and confirmed delivery are distinct.
 */
public final class QatfahWhatsappDirect {
 private static final String URL="https://web.whatsapp.com/";
 private static final String ORIGIN="https://web.whatsapp.com";
 private static final String LINKED_KEY="WA_PERMANENTLY_LINKED";
 private static final String REVOKED_KEY="WA_AUTH_REVOKED";
 private static final String RETRY_KEY="WA_EXPLICIT_RETRY_REQUIRED";
 private static final String LOGOUT_PENDING_KEY="WA_LOGOUT_PENDING";
 private static QatfahWhatsappDirect shared;
 private final Activity activity;
 private final SharedPreferences preferences;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private FrameLayout parkedFrame;
 private WebView web;
 private String script,wppScript;
 private static final String WPP_VERSION="4.7.1";
 private static final String WPP_SHA256="ed4cc6b17ce18d726b0bd89c0b30021c5b8266f823f13509c08170b7ace96126";
 private boolean released=false,loaded=false,injected=false,wppInjected=false,uploading=false;
 private boolean permanentlyLinked,authRevoked,requiresRetry;
 private boolean authenticated=false,transportReady=false,probing=false,cleanupInProgress=false;
 private String transportStatus="not_started",lastLoadError="";
 private long lastLinkedAt=0L,documentGeneration=0L,sendGeneration=0L;
 private PluginCall pending,pairingCall,logoutCall;
 private boolean driverMayHaveStarted=false;
 private Runnable sendDeadline,logoutDeadline;
 private String sendRequestId="";
 private JSObject cachedSendStatus=new JSObject();

 private QatfahWhatsappDirect(Activity activity){
  this.activity=activity;
  preferences=activity.getApplicationContext().getSharedPreferences("qatfah_whatsapp",Context.MODE_PRIVATE);
  permanentlyLinked=preferences.getBoolean(LINKED_KEY,false);
  authRevoked=preferences.getBoolean(REVOKED_KEY,false);
  requiresRetry=preferences.getBoolean(RETRY_KEY,false);
 }
 /** UI-thread singleton: an obsolete Activity is never retained by a new owner. */
 public static QatfahWhatsappDirect forActivity(Activity activity){
  if(Looper.myLooper()!=Looper.getMainLooper())throw new IllegalStateException("WhatsApp requires the UI thread");
  if(shared!=null&&(shared.released||shared.activity!=activity)){
   QatfahWhatsappDirect obsolete=shared;shared=null;obsolete.release();
  }
  if(shared==null)shared=new QatfahWhatsappDirect(activity);
  return shared;
 }
 public static QatfahWhatsappDirect getShared(){return shared;}
 private int dp(int value){return Math.round(value*activity.getResources().getDisplayMetrics().density);}
 private static String desktopUserAgent(Activity activity){
  Matcher match=Pattern.compile("Chrome/([0-9.]+)").matcher(WebSettings.getDefaultUserAgent(activity));
  String version=match.find()?match.group(1):"131.0.0.0";
  return "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/"+version+" Safari/537.36";
 }
 private String readAsset(String name) throws Exception {
  try(InputStream in=activity.getAssets().open(name);ByteArrayOutputStream out=new ByteArrayOutputStream()){
   byte[] buffer=new byte[8192];int length;
   while((length=in.read(buffer))!=-1)out.write(buffer,0,length);
   return new String(out.toByteArray(),StandardCharsets.UTF_8);
  }
 }
 private String loadWppAsset() throws Exception {
  if(wppScript==null){
   String candidate=readAsset("wppconnect-wa.js");
   byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(candidate.getBytes(StandardCharsets.UTF_8));
   StringBuilder hex=new StringBuilder();for(byte value:digest)hex.append(String.format(java.util.Locale.ROOT,"%02x",value&255));
   if(!WPP_SHA256.equals(hex.toString()))throw new IllegalStateException("Bundled WPP integrity mismatch");
   wppScript=candidate;
  }
  return wppScript;
 }
 private void init() throws Exception {
  if(released)throw new IllegalStateException("Activity has been destroyed");
  if(web!=null||requiresRetry||cleanupInProgress||preferences.getBoolean(LOGOUT_PENDING_KEY,false))return;
  if(script==null)script=readAsset("whatsapp-direct.js");
  ViewGroup host=activity.findViewById(android.R.id.content);
  if(host==null)throw new IllegalStateException("Activity root is not ready");
  web=new WebView(activity);
  WebSettings settings=web.getSettings();
  settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
  settings.setUserAgentString(desktopUserAgent(activity));settings.setUseWideViewPort(true);
  settings.setLoadWithOverviewMode(true);settings.setSupportMultipleWindows(false);
  settings.setJavaScriptCanOpenWindowsAutomatically(false);
  settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);
  settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
  CookieManager.getInstance().setAcceptCookie(true);
  CookieManager.getInstance().setAcceptThirdPartyCookies(web,true);
  web.setAlpha(0.01f);web.setVisibility(View.VISIBLE);
  web.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
  parkedFrame=new FrameLayout(activity);
  parkedFrame.setClipChildren(true);parkedFrame.setClipToPadding(true);
  parkedFrame.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO_HIDE_DESCENDANTS);
  // Clip only presentation; never resize the desktop child on modal/router changes.
  parkedFrame.addView(web,new FrameLayout.LayoutParams(dp(1100),dp(800)));
  host.addView(parkedFrame,0,new FrameLayout.LayoutParams(dp(2),dp(2),Gravity.BOTTOM|Gravity.RIGHT));
  installWebClient();transportStatus="loading";
  web.loadUrl(URL); // Initial startup only; sends and UI observation never navigate.
  handler.removeCallbacks(sessionObserver);handler.postDelayed(sessionObserver,1500);
 }
 public void ensureRunning() throws Exception {
  if(preferences.getBoolean(LOGOUT_PENDING_KEY,false)){
   if(!cleanupInProgress)startSiteLogout(null);
   return;
  }
  init();
 }
 private final Runnable sessionObserver=new Runnable(){@Override public void run(){
  if(released)return;
  observeSession();handler.postDelayed(this,3500);
 }};
 private void installWebClient(){
  web.setWebViewClient(new WebViewClient(){
   @Override public void onPageStarted(WebView view,String url,android.graphics.Bitmap favicon){
    documentGeneration++;loaded=false;injected=false;wppInjected=false;probing=false;
    authenticated=false;transportReady=false;transportStatus="loading";lastLoadError="";
    if(pending!=null)finishFailure("تغيرت صفحة واتساب أثناء الإرسال؛ راجع المحادثة قبل إعادة المحاولة",!driverMayHaveStarted);
   }
   @Override public void onReceivedError(WebView view,WebResourceRequest request,android.webkit.WebResourceError error){
    if(!request.isForMainFrame())return;
    lastLoadError=String.valueOf(error.getDescription());authenticated=false;transportReady=false;
    transportStatus="reconnecting"; // Network failure never clears saved pairing.
   }
   @Override public void onPageFinished(WebView view,String url){
    if(released||view!=web||!isWhatsAppUrl(url))return;
    loaded=true;injected=false;wppInjected=false;observeSession();
   }
   @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
    return !isWhatsAppUrl(request.getUrl().toString());
   }
  });
 }
 private static boolean isWhatsAppUrl(String value){
  Uri url=Uri.parse(value);return "https".equals(url.getScheme())&&"web.whatsapp.com".equals(url.getHost());
 }
 // Passive live probe: no QR extraction, clicks, reload, or authentication request.
 // A missing selector cannot revoke the latch. A visible signed-out screen can.
 private static final String SESSION_STATE="(function(){try{"+
  "var visible=function(n){return !!n&&!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'};"+
  "var revoked=[].some.call(document.querySelectorAll('[data-testid=logged-out],[data-testid=logout-screen]'),function(n){return visible(n)&&/you (?:have been|were) logged out|you.re logged out|تم تسجيل خروجك|تم تسجيل الخروج من حسابك/i.test(n.innerText||'')});"+
  "if(revoked)return JSON.stringify({status:'not_linked',authRevoked:true});"+
  "if(!navigator.onLine)return JSON.stringify({status:'offline'});"+
  "var auth=[].some.call(document.querySelectorAll('#pane-side,[data-testid=chat-list],[data-testid=chatlist-header],#main footer'),visible);"+
  "var reconnect=[].some.call(document.querySelectorAll('[data-testid=alert-phone],[data-testid=alert-computer],[data-testid=connection-status],[role=alert]'),function(n){return visible(n)&&/reconnecting|connecting|trying to reach|computer not connected|phone not connected|إعادة الاتصال|جار.*الاتصال|غير متصل/i.test(n.innerText||'')});"+
  "if(auth&&!reconnect)return JSON.stringify({status:'connected',authenticated:true,transportReady:true});"+
  "return JSON.stringify({status:document.readyState==='loading'?'loading':'reconnecting'});"+
  "}catch(e){return JSON.stringify({status:'unknown'})}})()";
 private void observeSession(){
  if(web==null||released||requiresRetry||probing||!loaded)return;
  probing=true;final WebView observed=web;final long generation=documentGeneration;
  observed.evaluateJavascript(SESSION_STATE,value->{
   if(released||observed!=web||generation!=documentGeneration)return;
   probing=false;
   try{applySessionState(new JSONObject(decode(value)));}catch(Exception ignored){
    authenticated=false;transportReady=false;transportStatus="unknown";
   }
  });
 }
 private void applySessionState(JSONObject state){
  if(requiresRetry)return;
  if(state.optBoolean("authRevoked",false)){
   permanentlyLinked=false;authRevoked=true;requiresRetry=true;
   preferences.edit().putBoolean(LINKED_KEY,false).putBoolean(REVOKED_KEY,true).putBoolean(RETRY_KEY,true).apply();
  }else if(state.optBoolean("authenticated",false)){
   boolean changed=!permanentlyLinked||authRevoked;
   permanentlyLinked=true;authRevoked=false;lastLinkedAt=System.currentTimeMillis();
   if(changed){
    preferences.edit().putBoolean(LINKED_KEY,true).putBoolean(REVOKED_KEY,false).apply();
    CookieManager.getInstance().flush();
   }
  }
  authenticated=state.optBoolean("authenticated",false)&&!authRevoked;
  transportReady=authenticated&&state.optBoolean("transportReady",false);
  transportStatus=state.optString("status","unknown");
  if("connected".equals(transportStatus)&&!transportReady)transportStatus="reconnecting";
 }
 private JSObject snapshot(){
  // A deletion callback from an obsolete Activity may finish after recreation.
  permanentlyLinked=preferences.getBoolean(LINKED_KEY,permanentlyLinked);
  authRevoked=preferences.getBoolean(REVOKED_KEY,authRevoked);
  requiresRetry=preferences.getBoolean(RETRY_KEY,requiresRetry);
  if(authRevoked||requiresRetry){authenticated=false;transportReady=false;}
  boolean logoutPending=cleanupInProgress||preferences.getBoolean(LOGOUT_PENDING_KEY,false);
  JSObject out=new JSObject();out.put("status",logoutPending?"logging_out":requiresRetry?"not_linked":transportStatus);
  out.put("linked",permanentlyLinked);out.put("previouslyLinked",permanentlyLinked);
  out.put("authenticated",authenticated);out.put("transportReady",transportReady);
  out.put("authRevoked",authRevoked);out.put("requiresRetry",requiresRetry);
  out.put("logoutPending",logoutPending);
  out.put("sessionAlive",web!=null&&!released);out.put("lastLinkedAt",lastLinkedAt);
  if(!lastLoadError.isEmpty())out.put("error",lastLoadError);
  return out;
 }
 /** Pure cache read; badge and modal refreshes cannot start authentication. */
 public void getConnectionStatus(PluginCall call){activity.runOnUiThread(()->call.resolve(snapshot()));}
 private static final String PAIRING_STATE="(function(){try{"+
  "var visible=function(n){return !!n&&!!n.getClientRects().length&&getComputedStyle(n).visibility!=='hidden'};"+
  "if(navigator.onLine&&[].some.call(document.querySelectorAll('#pane-side,[data-testid=chat-list],[data-testid=chatlist-header],#main footer'),visible))return JSON.stringify({status:'connected',authenticated:true,transportReady:true});"+
  "var canv=[].find.call(document.querySelectorAll('[data-testid*=qr] canvas,canvas[aria-label*=QR],[data-ref] canvas'),function(x){return visible(x)&&x.width>=140&&x.height>=140});"+
  "var qr='';if(canv){try{qr=canv.toDataURL('image/png')}catch(e){}}"+
  "var code='';for(var el of document.querySelectorAll('div,span,strong')){var t=(el.textContent||'').trim();if(visible(el)&&el.children.length===0&&/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(t)){code=t;break}}"+
  "return JSON.stringify({status:qr?'not_linked':'checking',qr:qr,code:code});"+
  "}catch(e){return JSON.stringify({status:'unknown'})}})()";
 public void pairingStatus(PluginCall call){
  activity.runOnUiThread(()->{
   // The latch short circuit precedes every DOM/QR operation.
   if(permanentlyLinked||requiresRetry||web==null||released){call.resolve(snapshot());return;}
   final WebView observed=web;final long generation=documentGeneration;
   observed.evaluateJavascript(PAIRING_STATE,value->{
    if(released||observed!=web||generation!=documentGeneration||permanentlyLinked||requiresRetry){call.resolve(snapshot());return;}
    try{
     JSONObject state=new JSONObject(decode(value));
     if(state.optBoolean("authenticated",false)){applySessionState(state);call.resolve(snapshot());return;}
     JSObject out=snapshot();out.put("status",state.optString("status","unknown"));
     String qr=state.optString("qr","");out.put("qr",qr.length()<500000?qr:"");
     out.put("code",state.optString("code",""));call.resolve(out);
    }catch(Exception e){call.reject("تعذر قراءة بيانات الربط",e);}
   });
  });
 }
 public void pairingPhone(PluginCall call,String phone){
  activity.runOnUiThread(()->{
   if(permanentlyLinked){call.resolve(snapshot());return;}
   if(!phone.matches("[0-9]{9,15}")){call.reject("رقم غير صحيح");return;}
   if(pending!=null||pairingCall!=null||preferences.getBoolean(LOGOUT_PENDING_KEY,false)){call.reject("هناك عملية واتساب جارية");return;}
   if(web==null||requiresRetry||!loaded){call.reject("اضغط تحديث لبدء جلسة الربط أولًا");return;}
   pairingCall=call;final long generation=documentGeneration;
   String js="(function(){var b=[...document.querySelectorAll('button,[role=button]')].find(x=>/link with phone|phone number|رقم الهاتف|ربط.*رقم/i.test(x.innerText||x.textContent||''));if(b){b.click();return 'ok'}return 'no'})()";
   web.evaluateJavascript(js,value->handler.postDelayed(()->fillPairingPhone(phone,call,generation,0),1200));
  });
 }
 private void fillPairingPhone(String phone,PluginCall call,long generation,int attempt){
  if(pairingCall!=call)return;
  if(permanentlyLinked){pairingCall=null;call.resolve(snapshot());return;}
  if(released||web==null||generation!=documentGeneration){pairingCall=null;call.reject("تغيرت جلسة الربط؛ حاول مرة أخرى");return;}
  String js="(function(){var x=document.querySelector('input[type=tel],input[inputmode=tel]');if(!x)return 'waiting';"+
   "var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;setter.call(x,"+JSONObject.quote(phone)+");"+
   "x.dispatchEvent(new Event('input',{bubbles:true}));x.dispatchEvent(new Event('change',{bubbles:true}));"+
   "var btn=[...document.querySelectorAll('button,[role=button]')].find(b=>/next|التالي|continue|متابعة/i.test(b.innerText||b.textContent||''));"+
   "if(btn&&!btn.disabled){btn.click();return 'sent'}return 'waiting'})()";
  web.evaluateJavascript(js,value->{
   if(pairingCall!=call)return;
   if("sent".equals(decode(value))){pairingCall=null;JSObject out=new JSObject();out.put("requested",true);call.resolve(out);}
   else if(attempt<7)handler.postDelayed(()->fillPairingPhone(phone,call,generation,attempt+1),1200);
   else{pairingCall=null;call.reject("واتساب لم يوفر حقل الربط بالرقم");}
  });
 }
 /** Only an explicit retry reloads. It never clears a saved pairing. */
 public void retryLoading(PluginCall call){
  activity.runOnUiThread(()->{
   if(pending!=null||pairingCall!=null||cleanupInProgress||preferences.getBoolean(LOGOUT_PENDING_KEY,false)){
    call.reject("هناك عملية واتساب جارية؛ انتظر اكتمالها قبل إعادة التحميل");return;
   }
   try{
    requiresRetry=false;preferences.edit().putBoolean(RETRY_KEY,false).apply();lastLoadError="";
    if(web==null)init();else web.reload();call.resolve(snapshot());
   }catch(Exception e){call.reject("تعذر تحديث واتساب",e);}
  });
 }
 // Legacy endpoints cannot reveal or reparent the WhatsApp page.
 public void showPairingPage(PluginCall call){call.reject("الربط متاح من نافذة QR أو رمز الهاتف داخل قطفة");}
 public void hidePairingPage(){}
 public void hidePairingPage(PluginCall call){call.resolve();}
 public WebView takeForLinking(){return null;}
 public boolean detachForChat(WebView requested){return false;}
 public void returnFromLinking(WebView borrowed){}
 /** Explicit local logout waits for Chromium's site-deletion completion callback. */
 public void logout(PluginCall call){
  activity.runOnUiThread(()->startSiteLogout(call));
 }
 private void startSiteLogout(PluginCall call){
  if(cleanupInProgress){if(call!=null)call.reject("تسجيل الخروج جارٍ بالفعل");return;}
  if(!WebViewFeature.isFeatureSupported(WebViewFeature.DELETE_BROWSING_DATA)){
   lastLoadError="حدّث Android System WebView لإتمام تسجيل الخروج بأمان";
   if(call!=null)call.reject(lastLoadError);return;
  }
  if(pending!=null)finishFailure("أوقفت عملية الإرسال لتسجيل الخروج؛ راجع المحادثة قبل إعادة المحاولة",!driverMayHaveStarted);
  if(pairingCall!=null){PluginCall old=pairingCall;pairingCall=null;old.reject("تم إلغاء الربط لتسجيل الخروج");}
  logoutCall=call;cleanupInProgress=true;requiresRetry=true;authenticated=false;transportReady=false;
  // Keep the latch until deletion actually completes, and block startup meanwhile.
  preferences.edit().putBoolean(LOGOUT_PENDING_KEY,true).putBoolean(RETRY_KEY,true).apply();
  destroySurface();
  logoutDeadline=()->{
   lastLoadError="تنظيف جلسة واتساب لم يؤكد اكتماله بعد؛ لم يبدأ ربط جديد";
   PluginCall waiting=logoutCall;logoutCall=null;
   if(waiting!=null)waiting.reject(lastLoadError);
  };
  handler.postDelayed(logoutDeadline,20000);
  try{
   // Scoped to whatsapp.com: Capacitor's app origin and accounting data are untouched.
   WebStorageCompat.deleteBrowsingDataForSite(WebStorage.getInstance(),ORIGIN,()->{
    permanentlyLinked=false;authRevoked=true;requiresRetry=true;cleanupInProgress=false;
    preferences.edit().putBoolean(LINKED_KEY,false).putBoolean(REVOKED_KEY,true)
      .putBoolean(RETRY_KEY,true).putBoolean(LOGOUT_PENDING_KEY,false).apply();
    transportStatus="not_linked";lastLoadError="";
    if(logoutDeadline!=null)handler.removeCallbacks(logoutDeadline);logoutDeadline=null;
    PluginCall waiting=logoutCall;logoutCall=null;if(waiting!=null)waiting.resolve(snapshot());
   });
  }catch(Exception error){
   cleanupInProgress=false;handler.removeCallbacks(logoutDeadline);logoutDeadline=null;
   lastLoadError="تعذر إكمال تنظيف جلسة واتساب؛ أعد تسجيل الخروج";
   PluginCall waiting=logoutCall;logoutCall=null;if(waiting!=null)waiting.reject(lastLoadError,error);
  }
 }
 private String decode(String value){
  if(value==null)return "";
  try{Object decoded=new org.json.JSONTokener(value).nextValue();return decoded instanceof String?(String)decoded:value;}catch(Exception e){return value;}
 }
 private boolean active(long generation){return pending!=null&&!released&&web!=null&&generation==sendGeneration;}
 /** Passive send progress only: no DOM evaluation, session probe or navigation. */
 public void getSendStatus(PluginCall call){
  activity.runOnUiThread(()->{
   if(cachedSendStatus.length()==0){
    JSObject idle=sendResult("idle","",false,false);idle.put("finished",true);call.resolve(idle);
   }else call.resolve(cachedSendStatus);
  });
 }
 private JSObject sendResult(String status,String message,Boolean dispatched,boolean safeToFallback){
  JSObject out=new JSObject();out.put("requestId",sendRequestId);out.put("status",status);out.put("phase",status);out.put("message",message);
  out.put("dispatched",dispatched==null?JSONObject.NULL:dispatched);
  out.put("submitted","submitted".equals(status));
  out.put("safeToFallback",false);out.put("retrySafe",safeToFallback&&Boolean.FALSE.equals(dispatched));
  out.put("code","");out.put("failedStage","");out.put("driverVersion",0);out.put("finished",false);
  out.put("ack",0);out.put("messageId","");out.put("delivered",false);out.put("deliveryConfirmed",false);return out;
 }
 private void sendProgress(String phase,String message,boolean driverStarted){
  cachedSendStatus=sendResult(phase,message,driverStarted?null:Boolean.FALSE,!driverStarted);
 }
 private static String diagnosticToken(JSONObject state,String key){
  String value=state.optString(key,"");return value.matches("[a-zA-Z0-9_]{1,80}")?value:"";
 }
 private JSObject driverSendResult(JSONObject state,String phase){
  Boolean dispatched=state.opt("dispatched") instanceof Boolean?(Boolean)state.opt("dispatched"):null;
  int ack=state.optInt("ack",0);
  String messageId=state.optString("messageId","");
  boolean accepted="submitted".equals(phase)&&state.optBoolean("submitted",false)&&ack>=1&&ack<=4&&!messageId.isEmpty()&&messageId.length()<=250;
  if("submitted".equals(phase)&&!accepted)phase="uncertain";
  if(accepted)dispatched=Boolean.TRUE;
  String message=state.optString("message","");if(message.length()>500)message=message.substring(0,500);
  boolean safe=Boolean.TRUE.equals(state.opt("retrySafe"))&&Boolean.FALSE.equals(state.opt("dispatched"));
  JSObject out=sendResult(phase,message,dispatched,safe);
  out.put("code",diagnosticToken(state,"code"));out.put("failedStage",diagnosticToken(state,"failedStage"));
  out.put("driverVersion",Math.max(0,Math.min(100,state.optInt("driverVersion",0))));
  out.put("wppVersion",WPP_VERSION);out.put("submitted",accepted);out.put("ack",accepted?ack:0);
  out.put("messageId",messageId.length()<=250?messageId:"");out.put("delivered",accepted&&ack>=2);out.put("deliveryConfirmed",accepted&&ack>=2);
  JSONObject source=state.optJSONObject("diagnostics");
  if(source!=null){
   JSObject diagnostics=new JSObject();
   for(String key:new String[]{"recipientVerified","attachmentStaged","draftTouched"}){
    if(source.opt(key) instanceof Boolean)diagnostics.put(key,source.optBoolean(key,false));
   }
   for(String key:new String[]{"fileInputCount","compatiblePdfInputCount","searchResultCount"}){
    if(source.opt(key) instanceof Number)diagnostics.put(key,Math.max(0,Math.min(10000,source.optInt(key,0))));
   }
   out.put("diagnostics",diagnostics);
  }
  return out;
 }
 private void finish(JSObject result){
  result.put("requestId",sendRequestId);result.put("finished",true);cachedSendStatus=result;
  PluginCall call=pending;pending=null;uploading=false;driverMayHaveStarted=false;sendGeneration++;
  if(sendDeadline!=null)handler.removeCallbacks(sendDeadline);sendDeadline=null;
  try{if(web!=null&&injected)web.evaluateJavascript("window.__qatfahDirect&&window.__qatfahDirect.cancel()",null);}
  catch(Exception ignored){}
  finally{if(call!=null)call.resolve(result);}
 }
 private void finishFailure(String message,boolean safeToFallback){
  finishFailure(message,safeToFallback,"native_send_interrupted");
 }
 private void finishFailure(String message,boolean safeToFallback,String code){
  if(pending==null)return;
  JSObject out=sendResult(safeToFallback?"error":"uncertain",message,safeToFallback?Boolean.FALSE:null,safeToFallback);
  out.put("code",code);out.put("failedStage",cachedSendStatus.optString("phase","preparing"));
  out.put("driverVersion",cachedSendStatus.optInt("driverVersion",0));
  if(cachedSendStatus.has("diagnostics"))out.put("diagnostics",cachedSendStatus.opt("diagnostics"));
  finish(out);
 }
 private void injectAndSend(long generation){
  if(!active(generation))return;
  if(!wppInjected){
   try{
    String js="(function(){try{if(window.WPP)return window.WPP.version==="+JSONObject.quote(WPP_VERSION)+";\n"+
      loadWppAsset()+"\n;return !!window.WPP&&window.WPP.version==="+JSONObject.quote(WPP_VERSION)+";}catch(e){return false}})()";
    web.evaluateJavascript(js,value->{
     if(!active(generation))return;
     if(!"true".equals(value)){finishFailure("تعذر تجهيز مكتبة الإرسال الصامت؛ لم يُرسل المستند",true,"native_wpp_injection_failed");return;}
     wppInjected=true;injectAndSend(generation);
    });
   }catch(Exception e){finishFailure("تعذر تحميل مكتبة واتساب المرفقة؛ لم يُرسل المستند",true,"native_wpp_asset_failed");}
   return;
  }
  if(!injected){
   web.evaluateJavascript(script,value->{
    if(!active(generation))return;
    if(!"true".equals(value)){finishFailure("تعذر تجهيز محرك إرسال واتساب",true,"native_driver_injection_failed");return;}
    injected=true;injectAndSend(generation);
   });return;
  }
  String base64=pending.getString("base64","");
  try{
   JSONObject options=new JSONObject();options.put("requestId",sendRequestId);options.put("phone",pending.getString("phone",""));
   options.put("caption",pending.getString("caption",""));options.put("filename",pending.getString("filename","Qatfah.pdf"));
   options.put("isPdf",!base64.isEmpty());
   web.evaluateJavascript("window.__qatfahDirect.prepare("+options.toString()+")",value->{
    if(!active(generation))return;
    if(!"true".equals(value)){finishFailure("المحاولة السابقة لم تنتهِ بعد؛ تحقق من نتيجتها قبل إعادة الإرسال",false,"native_prior_dispatch_pending");return;}
    if(!base64.isEmpty())sendProgress("uploading","جارٍ تجهيز مرفق PDF داخل واتساب",false);
    if(base64.isEmpty())beginSend(generation);else sendChunk(base64,0,generation);
   });
  }catch(Exception e){finishFailure("تعذر تجهيز رسالة واتساب",true,"native_prepare_failed");}
 }
 private void sendChunk(String base64,int index,long generation){
  if(!active(generation))return;
  if(index>=base64.length()){beginSend(generation);return;}
  int end=Math.min(base64.length(),index+200000);
  String chunk=JSONObject.quote(base64.substring(index,end));
  web.evaluateJavascript("window.__qatfahDirect.addChunk("+chunk+")",value->{
   if(!active(generation))return;
   if(!"true".equals(value)){finishFailure("فشل نقل مرفق PDF إلى واتساب",true,"native_pdf_transfer_failed");return;}
   sendChunk(base64,end,generation);
  });
 }
 private void beginSend(long generation){
  if(!active(generation))return;
  driverMayHaveStarted=true;
  sendProgress("starting","جارٍ إرسال المستند بصمت في الخلفية",true);
  web.evaluateJavascript("window.__qatfahDirect.start()",value->{
   if(!active(generation))return;
   if(!"true".equals(value)){finishFailure("تعذر تأكيد بدء الإرسال؛ راجع المحادثة قبل إعادة المحاولة",false,"native_start_unconfirmed");return;}
   check(generation);
  });
 }
 private void check(long generation){
  if(!active(generation))return;
  web.evaluateJavascript("window.__qatfahDirect&&window.__qatfahDirect.status()",value->{
   if(!active(generation))return;
   try{
    JSONObject state=new JSONObject(decode(value));String phase=diagnosticToken(state,"phase");
    if(!sendRequestId.equals(state.optString("requestId",""))){
     finishFailure("تعذر مطابقة نتيجة محاولة الإرسال؛ راجع المحادثة قبل إعادة المحاولة",false,"native_request_mismatch");return;
    }
    if(!phase.isEmpty())cachedSendStatus=driverSendResult(state,phase);
    if("submitted".equals(phase)){
     finish(cachedSendStatus);return;
    }
    if("error".equals(phase)||"not_linked".equals(phase)||"uncertain".equals(phase)){
     finish(cachedSendStatus);return;
    }
   }catch(Exception ignored){}
   handler.postDelayed(()->check(generation),850);
  });
 }
 public void send(PluginCall call){
  activity.runOnUiThread(()->{
   if(pending!=null||uploading){call.reject("يوجد إرسال جارٍ بالفعل");return;}
   String requestId=call.getString("requestId","");
   sendRequestId=requestId.matches("[a-zA-Z0-9_-]{1,100}")?requestId:java.util.UUID.randomUUID().toString();
   sendProgress("preparing","جارٍ تجهيز الإرسال داخل واتساب",false);
   if(web==null||released||!loaded||requiresRetry||!permanentlyLinked){
    JSObject result=sendResult("error","جلسة واتساب غير جاهزة للإرسال داخل قطفة",false,true);
    result.put("code","native_session_not_ready");result.put("failedStage","preparing");result.put("finished",true);
    cachedSendStatus=result;call.resolve(result);return;
   }
   pending=call;uploading=true;driverMayHaveStarted=false;final long generation=++sendGeneration;
   sendDeadline=()->{if(active(generation))finishFailure("تعذر تأكيد نتيجة واتساب؛ راجع المحادثة قبل إعادة المحاولة",!driverMayHaveStarted,"native_send_timeout");};
   handler.postDelayed(sendDeadline,120000);
   try{injectAndSend(generation);}catch(Exception e){finishFailure("تعذر بدء الإرسال داخل واتساب",!driverMayHaveStarted,"native_send_exception");}
  });
 }
 private void destroySurface(){
  documentGeneration++;loaded=false;injected=false;wppInjected=false;probing=false;authenticated=false;transportReady=false;
  WebView obsolete=web;web=null;
  if(parkedFrame!=null){
   if(parkedFrame.getParent() instanceof ViewGroup)((ViewGroup)parkedFrame.getParent()).removeView(parkedFrame);
   parkedFrame.removeAllViews();parkedFrame=null;
  }
  if(obsolete!=null){obsolete.stopLoading();obsolete.setWebViewClient(new WebViewClient());obsolete.destroy();}
 }
 /** Real Android Activity destruction only; routes/modal close never call this. */
 public void release(){
  if(released)return;
  if(logoutCall!=null){logoutCall.reject("أغلق أندرويد التطبيق؛ سيُستكمل تنظيف الجلسة عند فتحه");logoutCall=null;}
  if(pending!=null)finishFailure("أغلق أندرويد جلسة التطبيق أثناء الإرسال؛ تحقق من المحادثة",!driverMayHaveStarted);
  if(pairingCall!=null){pairingCall.reject("أغلق أندرويد شاشة التطبيق");pairingCall=null;}
  released=true;handler.removeCallbacksAndMessages(null);CookieManager.getInstance().flush();
  destroySurface();if(shared==this)shared=null;
 }
}
