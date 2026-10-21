package com.qatfah.accounting;

import android.app.Activity;
import android.content.Intent;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.net.Uri;
import android.util.Base64;
import java.io.File;
import java.io.FileOutputStream;
import androidx.core.content.FileProvider;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.JSObject;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.UUID;

@CapacitorPlugin(name="QatfahNative")
public class QatfahNativePlugin extends Plugin {
  private static final int MAX_BYTES=40*1024*1024;

  private interface EngineAction { void run(QatfahWhatsappDirect engine) throws Exception; }
  private void withEngine(PluginCall call, EngineAction action) {
    if(getActivity()==null){call.reject("شاشة التطبيق غير متاحة");return;}
    getActivity().runOnUiThread(()->{
      try { action.run(QatfahWhatsappDirect.forActivity(getActivity())); }
      catch(Exception e) { call.reject("تعذر الوصول إلى جلسة واتساب المدمجة",e); }
    });
  }
  @PluginMethod public void startWhatsAppSession(PluginCall call){
    withEngine(call,engine->{engine.ensureRunning();call.resolve();});
  }
  @PluginMethod public void whatsappConnectionStatus(PluginCall call){
    withEngine(call,engine->engine.getConnectionStatus(call));
  }
  @PluginMethod public void whatsappSendStatus(PluginCall call){
    withEngine(call,engine->engine.getSendStatus(call));
  }
  @PluginMethod public void whatsappShowBrowser(PluginCall call){
    call.reject("الربط داخل قطفة متاح بالباركود أو رمز الهاتف فقط");
  }
  @PluginMethod public void whatsappHideBrowser(PluginCall call){ call.resolve(); }
  @PluginMethod public void whatsappRetryBrowser(PluginCall call){
    withEngine(call,engine->engine.retryLoading(call));
  }
  @PluginMethod public void whatsappPairingStatus(PluginCall call){
    withEngine(call,engine->engine.pairingStatus(call));
  }
  @PluginMethod public void whatsappPairingPhone(PluginCall call){
    withEngine(call,engine->engine.pairingPhone(call,call.getString("phone","")));
  }
  @PluginMethod public void whatsappLogout(PluginCall call){
    withEngine(call,engine->engine.logout(call));
  }
  @PluginMethod public void openWhatsAppWeb(PluginCall call) {
    call.reject("الربط داخل قطفة متاح بالباركود أو رمز الهاتف فقط");
  }

  private boolean validWhatsAppPayload(PluginCall call) {
    String phone=call.getString("phone","");
    String caption=call.getString("caption","");
    String base64=call.getString("base64","");
    String filename=call.getString("filename","Qatfah.pdf");
    if(!phone.matches("[0-9]{9,15}")){call.reject("رقم المستلم غير صالح");return false;}
    if(caption.length()>3000||filename.length()>120||base64.length()>7000000){call.reject("الملف أو الرسالة غير صالح");return false;}
    if(base64.isEmpty()&&caption.trim().isEmpty()){call.reject("لا توجد رسالة أو مستند للإرسال");return false;}
    if(!base64.isEmpty()){
      try{
        byte[] pdf=Base64.decode(base64,Base64.DEFAULT);
        if(pdf.length<5||pdf.length>5000000||!new String(pdf,0,5,StandardCharsets.US_ASCII).equals("%PDF-")){
          call.reject("يجب اختيار ملف PDF صحيح لا يتجاوز 5 ميجابايت");return false;
        }
      }catch(Exception e){call.reject("ملف PDF غير صالح");return false;}
    }
    return true;
  }
  @PluginMethod public void sendWhatsAppInApp(PluginCall call) {
    if(!validWhatsAppPayload(call))return;
    withEngine(call,engine->engine.send(call));
  }

  private String sendRequestId(PluginCall call) {
    String requestId=call.getString("requestId","");
    return requestId.matches("[a-zA-Z0-9_-]{1,100}")?requestId:"";
  }
  private void rejectWhatsAppFallback(PluginCall call,String stage,String code,String message) {
    JSObject data=new JSObject();data.put("requestId",sendRequestId(call));
    data.put("phase","error");data.put("failedStage",stage);data.put("code",code);data.put("finished",true);
    data.put("submitted",false);data.put("dispatched",false);data.put("safeToFallback",false);data.put("deliveryConfirmed",false);
    // Stage codes diagnose packaging/launch failures without exposing paths or PDF data.
    call.reject(message,code,null,data);
  }

  /** Explicit fallback only. Opening WhatsApp is not an acknowledgement of sending. */
  @PluginMethod public void sendWhatsAppIntent(PluginCall call) {
    if(!validWhatsAppPayload(call))return;
    Activity owner=getActivity();
    if(owner==null){rejectWhatsAppFallback(call,"fallback_preparing","fallback_activity_unavailable","شاشة التطبيق غير متاحة");return;}
    owner.runOnUiThread(()->{
      File attachment=null;
      String stage="fallback_preparing";
      try {
        if(owner.isFinishing()||owner.isDestroyed()){
          rejectWhatsAppFallback(call,stage,"fallback_activity_unavailable","أعد فتح شاشة التطبيق ثم حاول الإرسال");return;
        }
        String phone=call.getString("phone","");
        String caption=call.getString("caption","");
        String base64=call.getString("base64","");
        Intent intent=new Intent(Intent.ACTION_SEND);
        intent.putExtra("jid",phone+"@s.whatsapp.net");
        intent.putExtra(Intent.EXTRA_TEXT,caption);
        if(!base64.isEmpty()){
          stage="fallback_attachment_write";
          File root=new File(getContext().getCacheDir(),"wa-attachments");
          File directory=new File(root,UUID.randomUUID().toString());
          if(!directory.mkdirs())throw new IllegalStateException("Attachment directory unavailable");
          String name=call.getString("filename","Qatfah.pdf").replaceAll("[\\\\/\\x00-\\x1F]","_").trim();
          if(name.isEmpty())name="Qatfah.pdf";
          if(!name.toLowerCase(java.util.Locale.ROOT).endsWith(".pdf"))name+=".pdf";
          attachment=new File(directory,name);
          try(FileOutputStream output=new FileOutputStream(attachment)){
            output.write(Base64.decode(base64,Base64.DEFAULT));output.flush();
          }
          stage="fallback_provider";
          Uri uri=FileProvider.getUriForFile(getContext(),getContext().getPackageName()+".waattachments",attachment);
          intent.setType("application/pdf");
          intent.putExtra(Intent.EXTRA_STREAM,uri);
          intent.setClipData(ClipData.newRawUri("PDF",uri));
          intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        } else intent.setType("text/plain");
        stage="fallback_opening";
        intent.setPackage("com.whatsapp");
        try { owner.startActivity(intent); }
        catch(ActivityNotFoundException missingPersonal) {
          intent.setPackage("com.whatsapp.w4b");
          owner.startActivity(intent);
        }
        JSObject out=new JSObject();
        out.put("requestId",sendRequestId(call));out.put("status","fallback_opened");out.put("phase","fallback_opened");out.put("openedInWhatsApp",true);
        out.put("finished",true);out.put("code","");out.put("failedStage","");out.put("driverVersion",0);
        out.put("submitted",false);out.put("dispatched",false);out.put("deliveryConfirmed",false);
        out.put("safeToFallback",false);
        out.put("message",base64.isEmpty()?"فُتح واتساب بالرسالة للمراجعة والإرسال":"فُتح واتساب بالمستند للمراجعة والإرسال");
        call.resolve(out);
      } catch(ActivityNotFoundException missing) {
        if(attachment!=null){attachment.delete();attachment.getParentFile().delete();}
        rejectWhatsAppFallback(call,stage,"fallback_whatsapp_not_installed","تطبيق واتساب غير مثبت على هذا الجهاز");
      } catch(Exception e) {
        if(attachment!=null){attachment.delete();attachment.getParentFile().delete();}
        String message="fallback_provider".equals(stage)?"تعذر مشاركة ملف PDF بسبب إعداد موفر الملفات في نسخة التطبيق":
          "fallback_attachment_write".equals(stage)?"تعذر تجهيز ملف PDF للمشاركة؛ تحقق من المساحة المتاحة":
          "تعذر فتح تطبيق واتساب بالمستند";
        rejectWhatsAppFallback(call,stage,stage+"_failed",message);
      }
    });
  }

  @PluginMethod public void saveJson(PluginCall call) {
    String contents=call.getString("content");
    if(contents==null||contents.getBytes(StandardCharsets.UTF_8).length>MAX_BYTES){call.reject("النسخة غير صالحة أو كبيرة جدًا");return;}
    String name=call.getString("filename","Qatfah_Backup.json");
    Intent intent=new Intent(Intent.ACTION_CREATE_DOCUMENT);
    intent.setType("application/json"); intent.addCategory(Intent.CATEGORY_OPENABLE);
    intent.putExtra(Intent.EXTRA_TITLE,name);
    startActivityForResult(call,intent,"saveResult");
  }
  @ActivityCallback private void saveResult(PluginCall call,ActivityResult result) {
    if(call==null)return;
    if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){call.reject("تم إلغاء الحفظ");return;}
    try {
      Uri uri=result.getData().getData();
      try(OutputStream out=getContext().getContentResolver().openOutputStream(uri,"w")) {
        if(out==null)throw new IllegalStateException("No output stream");
        out.write(call.getString("content","").getBytes(StandardCharsets.UTF_8));
        out.flush();
      }
      JSObject reply=new JSObject();reply.put("saved",true);reply.put("uri",uri.toString());call.resolve(reply);
    } catch(Exception ex){call.reject("فشل حفظ النسخة",ex);}
  }
  @PluginMethod public void openJson(PluginCall call) {
    Intent intent=new Intent(Intent.ACTION_OPEN_DOCUMENT);
    intent.setType("application/json");intent.addCategory(Intent.CATEGORY_OPENABLE);
    startActivityForResult(call,intent,"openResult");
  }
  @ActivityCallback private void openResult(PluginCall call,ActivityResult result) {
    if(call==null)return;
    if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){call.reject("تم إلغاء الاستعادة");return;}
    try(InputStream in=getContext().getContentResolver().openInputStream(result.getData().getData());ByteArrayOutputStream out=new ByteArrayOutputStream()){
      if(in==null)throw new IllegalStateException("No input stream");
      byte[] b=new byte[8192];int n;int length=0;
      while((n=in.read(b))!=-1){length+=n;if(length>MAX_BYTES)throw new IllegalStateException("ملف كبير جدًا");out.write(b,0,n);}
      JSObject reply=new JSObject();reply.put("content",out.toString("UTF-8"));call.resolve(reply);
    }catch(Exception ex){call.reject("تعذر قراءة النسخة",ex);}
  }
}
