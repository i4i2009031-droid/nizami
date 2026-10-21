package com.qatfah.accounting;

import android.app.Activity;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.ViewGroup;
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
 private final Activity activity;
 private final Handler handler=new Handler(Looper.getMainLooper());
 private WebView web;
 private PluginCall pending;
 private String script;
 private boolean loaded=false,injected=false,uploading=false,atRecipient=false;
 private long startedAt;
 private static final String UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
 public QatfahWhatsappDirect(Activity activity){this.activity=activity;}
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
  ViewGroup host=activity.findViewById(android.R.id.content);
  host.addView(web,new ViewGroup.LayoutParams(1,1));
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
  web.loadUrl("https://web.whatsapp.com/");
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
   if(pending!=null){call.reject("هناك محاولة إرسال قيد التنفيذ");return;}
   try{
    pending=call;startedAt=System.currentTimeMillis();uploading=true;atRecipient=false;
    init();
    if(loaded)navigate(call.getString("phone",""),call.getString("caption",""));
    else handler.postDelayed(()->{if(pending!=null&&!loaded)fail("واتساب ويب لم يحمل داخل التطبيق؛ افتح شاشة الربط أولًا");},20000);
   }catch(Exception e){fail("تعذر بدء واتساب المدمج: "+e.getMessage());}
  });
 }
}
