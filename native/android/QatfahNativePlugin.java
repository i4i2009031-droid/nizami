package com.qatfah.accounting;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
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
