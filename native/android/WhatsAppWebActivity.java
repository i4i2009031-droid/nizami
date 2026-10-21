package com.qatfah.accounting;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.InputType;
import android.util.Base64;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.ValueCallback;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import java.io.File;
import androidx.core.content.FileProvider;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.EditText;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;
import org.json.JSONObject;

/** QR/code-only presentation for WhatsApp Web login. WebView is non-visible.
 * Selectors and login flows belong to WhatsApp and may change or be blocked.
 * This class never reads messages, sends messages or automates interactions
 * after login. It does not expose cookies or session credentials to JavaScript. */
public final class WhatsAppWebActivity extends Activity {
    private static final String URL="https://web.whatsapp.com/";
    private static final String UA="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
    private WebView hiddenWeb;
    private QatfahWhatsappDirect persistent;
    private boolean reused;
    private TextView status, hint, pairingCode, qrPlaceholder;
    private ImageView qr;
    private EditText phoneInput;
    private View phoneArea;
    private FrameLayout webHost;
    private LinearLayout root;
    private String targetPhone="",targetCaption="",pdfPath="";
    private boolean chatVisible=false;
    private ValueCallback<Uri[]> fileCallback;
    private static final int PICK_PDF=9205;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean closing=false,loaded=false,seenQr=false,pairingRequested=false;
    private final Runnable probe=new Runnable(){ @Override public void run(){
        if(closing||hiddenWeb==null)return;
        if(loaded)readPairingState();
        handler.postDelayed(this,4500);
    }};

    private GradientDrawable bg(int color,int radius){
        GradientDrawable d=new GradientDrawable();d.setColor(color);d.setCornerRadius(radius);return d;
    }
    private TextView text(String str,int size,int color,boolean bold){
        TextView t=new TextView(this);t.setText(str);t.setTextColor(color);t.setTextSize(size);
        t.setGravity(Gravity.CENTER);if(bold)t.setTypeface(null,Typeface.BOLD);return t;
    }
    private int dp(float amount){return Math.round(getResources().getDisplayMetrics().density*amount);}
    // A plain clickable TextView prevents Android themes and dark-mode tints from
    // making labels on green AppCompat/Material buttons unreadable on some devices.
    private TextView button(String label,Runnable onClick){
        TextView b=text(label,14,Color.WHITE,true);
        b.setTextDirection(View.TEXT_DIRECTION_FIRST_STRONG);
        b.setSingleLine(false);b.setMaxLines(2);
        b.setGravity(Gravity.CENTER);
        b.setPadding(dp(8),dp(9),dp(8),dp(9));
        b.setBackground(bg(0xff08775e,dp(14)));
        b.setClickable(true);b.setFocusable(true);
        b.setContentDescription(label);
        b.setOnClickListener(v->onClick.run());
        return b;
    }
    private LinearLayout.LayoutParams lp(int width,int height){return new LinearLayout.LayoutParams(width,height);}
    private void setStatus(String value,boolean connected){
        status.setText((connected?"🟢 ":"🔴 ")+value);
        status.setTextColor(connected?0xff16836a:0xff8c4d45);
    }
    private void openOfficialSite(){startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(URL)));}
    @Override public void onCreate(Bundle state){super.onCreate(state);
        getWindow().setStatusBarColor(0xfff8fafb);
        getWindow().setNavigationBarColor(0xfff8fafb);
        getWindow().getDecorView().setSystemUiVisibility(
            View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);
        root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        targetPhone=getIntent().getStringExtra("phone");if(targetPhone==null)targetPhone="";
        targetCaption=getIntent().getStringExtra("caption");if(targetCaption==null)targetCaption="";
        pdfPath=getIntent().getStringExtra("pdf_path");if(pdfPath==null)pdfPath="";
        root.setBackgroundColor(0xfff8fafb);
        root.setPadding(dp(18),dp(62),dp(18),dp(22));
        scroll.setOnApplyWindowInsetsListener((v,insets)->{
            // Android 15 edge-to-edge otherwise draws the title behind the status bar.
            int top=Math.max(insets.getSystemWindowInsetTop(),dp(25));
            int bottom=Math.max(0,insets.getSystemWindowInsetBottom());
            root.setPadding(dp(18),top+dp(16),dp(18),bottom+dp(22));
            return insets;
        });
        scroll.addView(root);
        TextView title=text("قطفة • ربط واتساب",24,0xff104c42,true);root.addView(title,lp(-1,60));
        TextView subtitle=text("ربط واتساب ومحادثاته داخل قطفة",14,0xff54746b,false);root.addView(subtitle,lp(-1,35));
        status=text("🔴 يتم فحص خدمة واتساب…",15,0xff975244,true);status.setBackground(bg(0xffeef4ef,20));
        LinearLayout.LayoutParams sp=lp(-1,58);sp.topMargin=18;root.addView(status,sp);
        FrameLayout qrCard=new FrameLayout(this);qrCard.setBackground(bg(Color.WHITE,dp(18)));
        qr=new ImageView(this);qr.setScaleType(ImageView.ScaleType.FIT_CENTER);
        qr.setPadding(dp(16),dp(16),dp(16),dp(16));
        qrCard.addView(qr,new FrameLayout.LayoutParams(-1,-1));
        qrPlaceholder=text("جارٍ جلب رمز QR من واتساب…\n\nإذا بقيت المساحة فارغة، فاستخدم زر تحديث أو الربط بالرقم.",14,0xff697d78,false);
        qrPlaceholder.setPadding(dp(18),dp(20),dp(18),dp(20));
        qrCard.addView(qrPlaceholder,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout.LayoutParams qp=lp(-1,dp(276));qp.topMargin=dp(14);root.addView(qrCard,qp);
        hint=text("يُعرض رمز QR هنا فقط عندما يرسله واتساب لهذه الجلسة.",13,0xff687a79,false);
        hint.setPadding(7,12,7,12);root.addView(hint,lp(-1,-2));
        pairingCode=text("رمز الربط\nلم يصدر واتساب رمزًا حتى الآن",17,0xff0d5345,true);
        pairingCode.setMinHeight(dp(80));
        pairingCode.setPadding(dp(14),dp(15),dp(14),dp(15));
        pairingCode.setBackground(bg(0xffe9f3f0,dp(15)));
        pairingCode.setTextIsSelectable(true);
        root.addView(pairingCode,lp(-1,-2));
        LinearLayout buttons=new LinearLayout(this);buttons.setGravity(Gravity.CENTER);buttons.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams bp=lp(-1,dp(66));bp.topMargin=dp(12);root.addView(buttons,bp);
        TextView refresh=button("تحديث الباركود",()->{
            loaded=false;seenQr=false;pairingRequested=false;qr.setImageDrawable(null);
            qrPlaceholder.setVisibility(View.VISIBLE);
            qrPlaceholder.setText("يتم تحديث الباركود…");
            pairingCode.setText("رمز الربط\nلم يصدر واتساب رمزًا حتى الآن");
            setStatus("جارٍ فحص حالة الربط",false);
            if(reused){loaded=true;readPairingState();}
            else hiddenWeb.reload();
        });
        TextView switchMode=button("الربط برقم الهاتف",()->{
            boolean open=phoneArea.getVisibility()!=View.VISIBLE;
            phoneArea.setVisibility(open?View.VISIBLE:View.GONE);
        });
        LinearLayout.LayoutParams first=new LinearLayout.LayoutParams(0,dp(54),1);
        first.setMargins(dp(4),dp(5),dp(4),dp(5));
        LinearLayout.LayoutParams second=new LinearLayout.LayoutParams(0,dp(54),1);
        second.setMargins(dp(4),dp(5),dp(4),dp(5));
        buttons.addView(refresh,first);buttons.addView(switchMode,second);
        LinearLayout inputs=new LinearLayout(this);inputs.setOrientation(LinearLayout.VERTICAL);inputs.setPadding(8,8,8,8);
        phoneArea=inputs;inputs.setVisibility(View.GONE);root.addView(inputs,lp(-1,-2));
        phoneInput=new EditText(this);phoneInput.setSingleLine(true);phoneInput.setHint("رقم الهاتف مع مفتاح الدولة 967…");
        phoneInput.setInputType(InputType.TYPE_CLASS_PHONE);inputs.addView(phoneInput,lp(-1,58));
        inputs.addView(button("طلب رمز ربط الهاتف",this::requestPairingCode),lp(-1,dp(54)));
        TextView warning=text("بعد الربط يمكنك فتح المحادثة داخل قطفة وإرسال الرسالة أو رفع PDF من زر المرفقات داخل واتساب. لا يمكن ضمان التشغيل لأن WhatsApp Web قد يرفض WebView.",11,0xff718681,false);
        warning.setPadding(8,18,8,6);root.addView(warning,lp(-1,-2));
        TextView external=button("فتح المحادثات داخل قطفة",this::showChat);
        LinearLayout.LayoutParams ex=lp(-1,dp(54));ex.topMargin=dp(14);root.addView(external,ex);
        LinearLayout.LayoutParams back=lp(-1,dp(50));back.topMargin=dp(8);
        root.addView(button("العودة إلى قطفة",this::finish),back);
        persistent=QatfahWhatsappDirect.getShared();
        if(persistent!=null){try{hiddenWeb=persistent.takeForLinking();reused=hiddenWeb!=null;}catch(Exception ignored){}}
        if(hiddenWeb==null){
            status.setText("تعذر الوصول إلى جلسة واتساب الحالية. عد إلى قطفة وأعد فتح القسم.");
            setContentView(scroll);return;
        }
        // Keep a desktop-sized layout engine alive without presenting its page.
        // A 1x1 WebView viewport prevented responsive WhatsApp from rendering its QR.
        hiddenWeb.setAlpha(0.01f);hiddenWeb.setVisibility(View.VISIBLE);
        WebSettings s=hiddenWeb.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setUserAgentString(UA);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUseWideViewPort(true);s.setLoadWithOverviewMode(true);s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(hiddenWeb,true);
        if(!reused)hiddenWeb.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView view,ValueCallback<Uri[]> callback,FileChooserParams params){
                if(fileCallback!=null)fileCallback.onReceiveValue(null);
                fileCallback=callback;
                try{
                    if(!pdfPath.isEmpty()){
                        File prepared=new File(pdfPath);
                        File parent=new File(getCacheDir(),"wa-attachments").getCanonicalFile();
                        if(prepared.getCanonicalFile().getParentFile().equals(parent)&&prepared.isFile()&&prepared.length()<=5_000_000){
                            Uri uri=FileProvider.getUriForFile(WhatsAppWebActivity.this,getPackageName()+".waattachments",prepared);
                            callback.onReceiveValue(new Uri[]{uri});fileCallback=null;pdfPath="";return true;
                        }
                    }
                    Intent picker=new Intent(Intent.ACTION_OPEN_DOCUMENT);
                    picker.addCategory(Intent.CATEGORY_OPENABLE);picker.setType("application/pdf");
                    startActivityForResult(picker,PICK_PDF);return true;
                }catch(Exception e){fileCallback=null;callback.onReceiveValue(null);return true;}
            }
        });
        if(!reused)hiddenWeb.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String u){loaded=true;readPairingState();}
            @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r){
                Uri u=r.getUrl();String host=u.getHost();
                if("https".equals(u.getScheme())&&host!=null&&(host.equals("web.whatsapp.com")||host.equals("whatsapp.com")))return false;
                return true;
            }
        });
        // A clipped one-pixel host hides the WebView, while its measured content
        // viewport stays desktop sized so the login canvas can be rendered.
        webHost=new FrameLayout(this);
        webHost.setClipChildren(true);webHost.setClipToPadding(true);
        if(!reused)webHost.addView(hiddenWeb,new FrameLayout.LayoutParams(dp(1150),dp(820)));
        root.addView(webHost,lp(dp(1),dp(1)));
        setContentView(scroll);
        scroll.requestApplyInsets();
        if(!reused)hiddenWeb.loadUrl(URL);
        else{loaded=true;handler.postDelayed(this::readPairingState,900);}
        handler.postDelayed(probe,4000);
    }
    private static final String PAIRING_SCRIPT="(function(){try{"+
        "var ready=!!document.querySelector('[data-testid=chat-list],#pane-side,[data-testid=chatlist-header]');"+
        "if(ready)return JSON.stringify({connected:true});"+
        "var c=[...document.querySelectorAll('[data-testid*=qr] canvas,canvas')].find(x=>x.width>=140&&x.height>=140);"+
        "var qr='';if(c){try{qr=c.toDataURL('image/png')}catch(e){}}"+
        "var im=[...document.images].find(i=>(i.alt||'').toLowerCase().includes('qr')&&i.naturalWidth>120);"+
        "if(!qr&&im&&im.src.startsWith('data:image/'))qr=im.src;"+
        "var els=[...document.querySelectorAll('div,span,p,strong')].filter(e=>e.children.length===0&&e.textContent.length<25);"+
        "var code='';for(var e of els){var t=e.textContent.trim();if(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(t)){code=t;break}}"+
        "return JSON.stringify({connected:false,qr:qr,code:code})"+
        "}catch(e){return JSON.stringify({error:'unavailable'})}})()";
    private void readPairingState(){
        if(hiddenWeb==null||closing||!loaded)return;
        hiddenWeb.evaluateJavascript(PAIRING_SCRIPT,value->{
            if(closing)return;
            try{
                String unwrapped=value;
                if(value.startsWith("\""))unwrapped=(String)new org.json.JSONTokener(value).nextValue();
                JSONObject obj=new JSONObject(unwrapped);
                if(obj.optBoolean("connected")){
                    setStatus("متصل بهذه الجلسة في الوقت الحالي",true);
                    hint.setText("واتساب مرتبط. افتح المحادثات من الزر أدناه واستخدم زر إرسال واتساب نفسه.");
                    if(!targetPhone.isEmpty())showChat();
                    qr.setImageDrawable(null);pairingCode.setText("تم الربط");return;
                }
                String image=obj.optString("qr","");
                if(image.startsWith("data:image/png;base64,")&&image.length()<500_000){
                    byte[] decoded=Base64.decode(image.substring(image.indexOf(',')+1),Base64.DEFAULT);
                    Bitmap bmp=BitmapFactory.decodeByteArray(decoded,0,decoded.length);
                    if(bmp!=null){qr.setImageBitmap(bmp);seenQr=true;setStatus("غير متصل • امسح الباركود",false);
                        hint.setText("من واتساب في هاتفك: الأجهزة المرتبطة ← ربط جهاز، ثم امسح الرمز.");}
                }
                String code=obj.optString("code","");
                if(!code.isEmpty())pairingCode.setText("رمز الربط: "+code);
                if(!seenQr&&!obj.optBoolean("connected"))setStatus("غير متصل • انتظار الرمز",false);
            }catch(Exception e){hint.setText("تعذر قراءة الرمز من نسخة واتساب الحالية. يمكنك استخدام الربط الخارجي.");}
        });
    }
    private void requestPairingCode(){
        if(hiddenWeb==null||!loaded){hint.setText("انتظر تحميل واتساب أولاً، ثم حاول مجددًا.");return;}
        String phone=phoneInput.getText().toString().replaceAll("[^0-9]","");
        if(phone.length()<9||phone.length()>15){hint.setText("أدخل الرقم مع مفتاح الدولة، مثل 9677XXXXXXXX");return;}
        pairingRequested=true;
        pairingCode.setText("رمز الربط\\nيتم طلب الرمز من واتساب…");
        hint.setText("يتم فتح خيار الربط بالرقم. قد يستغرق ظهور الرمز عدة ثوان.");
        // WhatsApp controls the pairing workflow. Open its phone-link choice first;
        // input and submit are separate, to wait for React to render the field.
        String open="(function(){var buttons=[...document.querySelectorAll('button,[role=button]')];"+
          "var b=buttons.find(x=>/link with phone|phone number|رقم الهاتف|ربط.*رقم/i.test(x.innerText||x.textContent||''));"+
          "if(b){b.click();return 'opened'}return 'unavailable'})()";
        hiddenWeb.evaluateJavascript(open,v->handler.postDelayed(()->fillPairingPhone(phone,0),1600));
    }
    private void fillPairingPhone(String phone,int attempt){
        if(closing||hiddenWeb==null||!pairingRequested)return;
        String arg=JSONObject.quote(phone);
        String script="(function(){try{"+
          "var input=document.querySelector('input[type=tel],input[inputmode=tel],input[autocomplete=tel]');"+
          "if(!input)return 'waiting';"+
          "var setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;"+
          "setter.call(input,"+arg+");input.dispatchEvent(new Event('input',{bubbles:true}));"+
          "input.dispatchEvent(new Event('change',{bubbles:true}));"+
          "var next=[...document.querySelectorAll('button,[role=button]')].find(x=>/next|التالي|continue|متابعة/i.test(x.innerText||x.textContent||''));"+
          "if(next&&!next.disabled){next.click();return 'submitted'}return 'entered';"+
          "}catch(e){return 'unavailable'}})()";
        hiddenWeb.evaluateJavascript(script,value->{
            if(closing||!pairingRequested)return;
            if(value.contains("waiting")&&attempt<6){
                handler.postDelayed(()->fillPairingPhone(phone,attempt+1),1200);
                return;
            }
            if(value.contains("submitted")){
                hint.setText("تم طلب الرمز. انتظر ظهوره في الحقل أعلاه.");
                handler.postDelayed(this::readPairingState,1800);
            }else{
                pairingRequested=false;
                pairingCode.setText("رمز الربط\\nلم تصدر الجلسة رمزًا");
                hint.setText("لم تسمح صفحة واتساب المدمجة بإكمال الربط بالرقم. استخدم خيار واتساب الرسمي.");
            }
        });
    }

    private void showChat(){
        if(hiddenWeb==null)return;
        if(chatVisible)return;
        if(reused && (persistent==null||!persistent.detachForChat(hiddenWeb)))return;
        chatVisible=true;
        root.removeView(webHost);
        root.removeAllViews();
        root.setPadding(0,dp(24),0,0);
        LinearLayout controls=new LinearLayout(this);
        controls.setOrientation(LinearLayout.VERTICAL);
        controls.setPadding(dp(12),dp(9),dp(12),dp(9));
        controls.addView(button("العودة إلى قطفة",this::finish),lp(-1,dp(46)));
        TextView notice=text("المحادثة داخل قطفة: أكد الإرسال بنفسك. لإرفاق PDF استخدم مشبك الملفات داخل واتساب.",12,0xff326353,false);
        controls.addView(notice,lp(-1,dp(46)));
        if(!pdfPath.isEmpty()){
           TextView pdfNotice=button("ملف PDF جاهز • اضغط مشبك المرفقات داخل واتساب",()->{
               new AlertDialog.Builder(this).setMessage("اضغط مشبك المرفقات داخل واتساب واختر مستند؛ سيقدم قطفة ملف PDF الجاهز إلى واتساب. راجع المعاينة واضغط إرسال بنفسك.").setPositiveButton("حسنًا",null).show();
           });
           controls.addView(pdfNotice,lp(-1,dp(50)));
        }
        root.addView(controls,lp(-1,-2));
        hiddenWeb.setAlpha(1f);
        hiddenWeb.setVisibility(View.VISIBLE);
        webHost.removeView(hiddenWeb);
        webHost.addView(hiddenWeb,new FrameLayout.LayoutParams(-1,-1));
        LinearLayout.LayoutParams fill=new LinearLayout.LayoutParams(-1,dp(760));
        root.addView(webHost,fill);
        handler.removeCallbacks(probe);
        if(!targetPhone.isEmpty()){
           String url="https://web.whatsapp.com/send?phone="+Uri.encode(targetPhone);
           if(!targetCaption.isEmpty())url+="&text="+Uri.encode(targetCaption);
           hiddenWeb.loadUrl(url);
           targetPhone="";
        }
    }
    @Override protected void onActivityResult(int requestCode,int resultCode,Intent data){
        super.onActivityResult(requestCode,resultCode,data);
        if(requestCode==PICK_PDF&&fileCallback!=null){
            Uri selected=resultCode==RESULT_OK&&data!=null?data.getData():null;
            fileCallback.onReceiveValue(selected==null?null:new Uri[]{selected});
            fileCallback=null;
        }
    }
    @Override protected void onPause(){CookieManager.getInstance().flush();super.onPause();}
    @Override protected void onDestroy(){if(fileCallback!=null){fileCallback.onReceiveValue(null);fileCallback=null;}closing=true;handler.removeCallbacksAndMessages(null);
        if(hiddenWeb!=null){if(reused&&persistent!=null)persistent.returnFromLinking(hiddenWeb);else{hiddenWeb.stopLoading();hiddenWeb.destroy();}hiddenWeb=null;}
        super.onDestroy();
    }
}
