package com.qatfah.accounting;

import android.app.Activity;
import android.content.Intent;
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

@CapacitorPlugin(name="QatfahNative")
public class QatfahNativePlugin extends Plugin {
  private static final int MAX_BYTES=40*1024*1024;

  @PluginMethod public void openWhatsAppWeb(PluginCall call) {
    try { getActivity().startActivity(new Intent(getActivity(),WhatsAppWebActivity.class));call.resolve(); }
    catch(Exception ex) { call.reject("تعذر فتح واتساب ويب",ex); }
  }

  /** Opens the embedded WhatsApp Web session; no Android Sharesheet or external WhatsApp app. */
  @PluginMethod public void sendWhatsAppInApp(PluginCall call) {
    String phone=call.getString("phone","");
    String caption=call.getString("caption","");
    String base64=call.getString("base64","");
    String filename=call.getString("filename","Qatfah.pdf");
    if(!phone.matches("[0-9]{9,15}")){call.reject("رقم المستلم غير صالح");return;}
    if(caption.length()>3000||filename.length()>120){call.reject("محتوى طويل");return;}
    try {
      Intent intent=new Intent(getActivity(),WhatsAppWebActivity.class);
      intent.putExtra("phone",phone);intent.putExtra("caption",caption);
      if(!base64.isEmpty()) {
        byte[] bytes=Base64.decode(base64,Base64.DEFAULT);
        if(bytes.length>5_000_000||bytes.length<5||!(new String(bytes,0,5,StandardCharsets.US_ASCII).equals("%PDF-"))){call.reject("ملف PDF غير صالح أو كبير");return;}
        String safeName=filename.replaceAll("[^a-zA-Z0-9_.-]","_");
        if(!safeName.toLowerCase().endsWith(".pdf"))safeName+=".pdf";
        File folder=new File(getContext().getCacheDir(),"wa-attachments");
        if(!folder.exists()&&!folder.mkdirs())throw new IllegalStateException("Cannot create cache folder");
        File pdf=new File(folder,safeName);
        try(FileOutputStream out=new FileOutputStream(pdf)){out.write(bytes);}
        intent.putExtra("pdf_path",pdf.getAbsolutePath());
        intent.putExtra("pdf_name",safeName);
      }
      getActivity().startActivity(intent);
      JSObject result=new JSObject();result.put("opened",true);result.put("sent",false);
      result.put("message","تم فتح المحادثة داخل قطفة؛ يرجى تأكيد الإرسال داخل واتساب.");
      call.resolve(result);
    }catch(Exception ex){call.reject("تعذر فتح الإرسال الداخلي",ex);}
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
