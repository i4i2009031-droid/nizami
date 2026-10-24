package com.qatfah.accounting;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.provider.ContactsContract;
import android.database.Cursor;
import android.util.Base64;
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

  /** Android's contact picker grants access only to a single selected phone row. */
  @PluginMethod public void pickPhoneContact(PluginCall call) {
    if(getActivity()==null){call.reject("شاشة التطبيق غير متاحة");return;}
    try {
      Intent picker=new Intent(Intent.ACTION_PICK,ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
      startActivityForResult(call,picker,"pickPhoneContactResult");
    }catch(Exception ex){call.reject("تعذر فتح جهات الاتصال على الجهاز",ex);}
  }
  @ActivityCallback private void pickPhoneContactResult(PluginCall call,ActivityResult result) {
    if(call==null)return;
    if(result.getResultCode()!=Activity.RESULT_OK||result.getData()==null||result.getData().getData()==null){
      JSObject cancelled=new JSObject();cancelled.put("cancelled",true);call.resolve(cancelled);return;
    }
    Uri uri=result.getData().getData();
    if(!"content".equalsIgnoreCase(uri.getScheme())){call.reject("جهة الاتصال المختارة غير صالحة");return;}
    String[] projection={ContactsContract.CommonDataKinds.Phone.NUMBER,ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME};
    try(Cursor cursor=getContext().getContentResolver().query(uri,projection,null,null,null)){
      if(cursor==null||!cursor.moveToFirst()){call.reject("لم يتم العثور على رقم لجهة الاتصال");return;}
      int phoneCol=cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.NUMBER);
      int nameCol=cursor.getColumnIndex(ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME);
      String phone=phoneCol>=0?cursor.getString(phoneCol):"";
      String name=nameCol>=0?cursor.getString(nameCol):"";
      if(phone==null||phone.trim().isEmpty()){call.reject("جهة الاتصال لا تحتوي على رقم هاتف");return;}
      JSObject selected=new JSObject();selected.put("phone",phone);selected.put("name",name==null?"":name);call.resolve(selected);
    }catch(Exception ex){call.reject("تعذر قراءة الرقم المختار من جهات الاتصال",ex);}
  }
  private boolean validWhatsAppPayload(PluginCall call) {
    String phone=call.getString("phone","");
    String caption=call.getString("caption","");
    String base64=call.getString("base64","");
    String filename=call.getString("filename","Qatfah.pdf");
    if(!phone.matches("9677[0-9]{8}")){call.reject("رقم المستلم غير صالح");return false;}
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
