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
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
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
    private TextView status, hint, pairingCode;
    private ImageView qr;
    private EditText phoneInput;
    private View phoneArea;
    private final Handler handler=new Handler(Looper.getMainLooper());
    private boolean closing=false,loaded=false,seenQr=false;
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
    private Button button(String label,Runnable onClick){
        Button b=new Button(this);b.setText(label);b.setAllCaps(false);b.setTextSize(13);
        b.setBackground(bg(0xff0b7559,26));b.setTextColor(Color.WHITE);
        b.setOnClickListener(v->onClick.run());return b;
    }
    private LinearLayout.LayoutParams lp(int width,int height){return new LinearLayout.LayoutParams(width,height);}
    private void setStatus(String value,boolean connected){
        status.setText((connected?"🟢 ":"🔴 ")+value);
        status.setTextColor(connected?0xff16836a:0xff8c4d45);
    }
    private void openOfficialSite(){startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse(URL)));}
    @Override public void onCreate(Bundle state){super.onCreate(state);
        getWindow().setStatusBarColor(0xfff8fafb);
        ScrollView scroll=new ScrollView(this);scroll.setFillViewport(true);
        LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(0xfff8fafb);root.setPadding(26,35,26,22);
        scroll.addView(root);
        TextView title=text("قطفة • ربط واتساب",24,0xff104c42,true);root.addView(title,lp(-1,60));
        TextView subtitle=text("شاشة الباركود والرمز فقط",14,0xff54746b,false);root.addView(subtitle,lp(-1,35));
        status=text("🔴 يتم فحص خدمة واتساب…",15,0xff975244,true);status.setBackground(bg(0xffeef4ef,20));
        LinearLayout.LayoutParams sp=lp(-1,58);sp.topMargin=18;root.addView(status,sp);
        qr=new ImageView(this);qr.setScaleType(ImageView.ScaleType.FIT_CENTER);qr.setBackground(bg(Color.WHITE,20));
        qr.setPadding(20,20,20,20);LinearLayout.LayoutParams qp=lp(-1,350);qp.topMargin=17;root.addView(qr,qp);
        hint=text("جارٍ طلب QR من واتساب. إن لم يظهر، فقد لا يسمح واتساب بالعرض داخل تطبيق مدمج.",12,0xff687a79,false);
        hint.setPadding(7,12,7,12);root.addView(hint,lp(-1,-2));
        pairingCode=text("رمز الربط: غير متاح بعد",18,0xff0d5345,true);pairingCode.setPadding(0,13,0,13);
        pairingCode.setBackground(bg(0xffe9f3f0,17));root.addView(pairingCode,lp(-1,-2));
        LinearLayout buttons=new LinearLayout(this);buttons.setGravity(Gravity.CENTER);buttons.setOrientation(LinearLayout.HORIZONTAL);
        LinearLayout.LayoutParams bp=lp(-1,65);bp.topMargin=13;root.addView(buttons,bp);
        Button refresh=button("تحديث",()->{loaded=false;seenQr=false;setStatus("يتم إعادة طلب الربط",false);hiddenWeb.reload();});
        Button switchMode=button("ربط بالرقم",()->phoneArea.setVisibility(phoneArea.getVisibility()==View.VISIBLE?View.GONE:View.VISIBLE));
        buttons.addView(refresh,new LinearLayout.LayoutParams(0,-1,1));buttons.addView(switchMode,new LinearLayout.LayoutParams(0,-1,1));
        LinearLayout inputs=new LinearLayout(this);inputs.setOrientation(LinearLayout.VERTICAL);inputs.setPadding(8,8,8,8);
        phoneArea=inputs;inputs.setVisibility(View.GONE);root.addView(inputs,lp(-1,-2));
        phoneInput=new EditText(this);phoneInput.setSingleLine(true);phoneInput.setHint("رقم الهاتف مع مفتاح الدولة 967…");
        phoneInput.setInputType(InputType.TYPE_CLASS_PHONE);inputs.addView(phoneInput,lp(-1,58));
        inputs.addView(button("طلب رمز الربط",this::requestPairingCode),lp(-1,54));
        TextView warning=text("قد يتعذر إظهار QR أو رمز الاقتران لأن واتساب لا يوفر واجهة عامة لهذا الاستخدام. لن تُفتح محادثاتك داخل قطفة ولن تُقرأ الرسائل.",11,0xff718681,false);
        warning.setPadding(8,18,8,6);root.addView(warning,lp(-1,-2));
        Button external=button("فتح واتساب في متصفح خارجي عند التعذر",this::openOfficialSite);
        LinearLayout.LayoutParams ex=lp(-1,58);ex.topMargin=8;root.addView(external,ex);
        root.addView(button("عودة إلى قطفة",this::finish),lp(-1,52));
        hiddenWeb=new WebView(this);
        hiddenWeb.setAlpha(0.01f);hiddenWeb.setVisibility(View.INVISIBLE);
        WebSettings s=hiddenWeb.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);
        s.setUserAgentString(UA);s.setAllowFileAccess(false);s.setAllowContentAccess(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setUseWideViewPort(true);s.setLoadWithOverviewMode(true);s.setSupportMultipleWindows(false);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(hiddenWeb,true);
        hiddenWeb.setWebChromeClient(new WebChromeClient());
        hiddenWeb.setWebViewClient(new WebViewClient(){
            @Override public void onPageFinished(WebView view,String u){loaded=true;readPairingState();}
            @Override public boolean shouldOverrideUrlLoading(WebView w, WebResourceRequest r){
                Uri u=r.getUrl();String host=u.getHost();
                if("https".equals(u.getScheme())&&host!=null&&(host.equals("web.whatsapp.com")||host.equals("whatsapp.com")))return false;
                return true;
            }
        });
        // Attached but never presented: the only user-visible content is QR/code/status.
        root.addView(hiddenWeb,lp(1,1));setContentView(scroll);
        hiddenWeb.loadUrl(URL);
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
                    hint.setText("تم رصد شاشة واتساب المسجلة. إرسال PDF من قطفة يظل عبر مشاركة واتساب الأصلية.");
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
        if(hiddenWeb==null||!loaded){hint.setText("انتظر تحميل واتساب أولًا");return;}
        String phone=phoneInput.getText().toString().replaceAll("[^0-9]","");
        if(phone.length()<9||phone.length()>15){hint.setText("أدخل رقمًا صحيحًا مع مفتاح الدولة");return;}
        // Run only from direct user tap, on the unpaired login page. Never touch chats or send messages.
        String argument=JSONObject.quote(phone);
        String script="(function(){try{"+
            "if(document.querySelector('[data-testid=chat-list],#pane-side'))return false;"+
            "var b=[...document.querySelectorAll('button,[role=button]')].find(x=>/link with phone|phone number|رقم الهاتف/i.test(x.textContent||''));"+
            "if(b)b.click();var i=document.querySelector('input[type=tel],input[aria-label*=phone],input[inputmode=tel]');"+
            "if(!i)return false;i.focus();i.value="+argument+";i.dispatchEvent(new Event('input',{bubbles:true}));"+
            "var next=[...document.querySelectorAll('button,[role=button]')].find(x=>/next|التالي|continue/i.test(x.textContent||''));"+
            "if(next)next.click();return true;}catch(e){return false}})()";
        hiddenWeb.evaluateJavascript(script,value->{
            hint.setText("تمت محاولة طلب الرمز. إن لم يظهر رمز الربط، فصفحة واتساب الحالية لا تسمح بهذه الطريقة المدمجة.");
            handler.postDelayed(this::readPairingState,1800);
        });
    }
    @Override protected void onPause(){CookieManager.getInstance().flush();super.onPause();}
    @Override protected void onDestroy(){closing=true;handler.removeCallbacksAndMessages(null);
        if(hiddenWeb!=null){hiddenWeb.stopLoading();hiddenWeb.destroy();hiddenWeb=null;}
        super.onDestroy();
    }
}
