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

  private QatfahWhatsappDirect direct;
  @PluginMethod public void sendWhatsAppInApp(PluginCall call) {
    String phone=call.getString("phone","");
    String caption=call.getString("caption","");
    String base64=call.getString("base64","");
    String filename=call.getString("filename","Qatfah.pdf");
    if(!phone.matches("[0-9]{9,15}")){call.reject("رقم المستلم غير صالح");return;}
    if(caption.length()>3000||filename.length()>120||base64.length()>7000000){call.reject("الملف أو الرسالة غير صالح");return;}
    if(!base64.isEmpty()){
      try{
        byte[] header=Base64.decode(base64.substring(0,Math.min(16,base64.length())),Base64.DEFAULT);
        if(header.length<5||!new String(header,0,5,StandardCharsets.US_ASCII).equals("%PDF-")){call.reject("يجب اختيار ملف PDF صحيح");return;}
      }catch(Exception e){call.reject("ملف PDF غير صالح");return;}
    }
    if(direct==null)direct=new QatfahWhatsappDirect(getActivity());
    direct.send(call);
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
