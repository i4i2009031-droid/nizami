package com.qatfah.accounting;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.webkit.WebSettings;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;

/** Separate native browser with no bridge to WhatsApp's page, and persistent cookies.
 * WhatsApp may reject an embedded browser or alter its pairing experience. */
public class WhatsAppWebActivity extends Activity {
 private WebView web;
 @Override public void onCreate(Bundle saved){super.onCreate(saved);
   LinearLayout root=new LinearLayout(this);root.setOrientation(LinearLayout.VERTICAL);root.setBackgroundColor(Color.WHITE);
   LinearLayout bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setPadding(18,14,18,14);
   Button close=new Button(this);close.setText("إغلاق");close.setOnClickListener(v->finish());bar.addView(close);
   TextView title=new TextView(this);title.setText("WhatsApp Web — الربط عبر واتساب");title.setTextSize(15);title.setPadding(10,0,10,0);bar.addView(title,new LinearLayout.LayoutParams(0,-2,1));
   Button browser=new Button(this);browser.setText("المتصفح");browser.setOnClickListener(v->{startActivity(new Intent(Intent.ACTION_VIEW,Uri.parse("https://web.whatsapp.com")));});bar.addView(browser);
   root.addView(bar);
   ProgressBar progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);root.addView(progress,new LinearLayout.LayoutParams(-1,6));
   web=new WebView(this);WebSettings s=web.getSettings();s.setJavaScriptEnabled(true);s.setDomStorageEnabled(true);s.setDatabaseEnabled(true);
   s.setAllowFileAccess(false);s.setAllowContentAccess(false);s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
   s.setUserAgentString("Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36");
   s.setLoadWithOverviewMode(true);s.setUseWideViewPort(true);
   CookieManager.getInstance().setAcceptCookie(true);CookieManager.getInstance().setAcceptThirdPartyCookies(web,true);
   web.setWebChromeClient(new WebChromeClient(){@Override public void onProgressChanged(WebView v,int x){progress.setProgress(x);progress.setVisibility(x==100?View.GONE:View.VISIBLE);}});
   web.setWebViewClient(new WebViewClient(){@Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest req){Uri uri=req.getUrl();String host=uri.getHost();if("https".equals(uri.getScheme())&&host!=null&&(host.equals("web.whatsapp.com")||host.endsWith(".whatsapp.com")))return false;try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}return true;}});
   root.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(root);web.loadUrl("https://web.whatsapp.com/");
 }
 @Override public void onBackPressed(){if(web!=null&&web.canGoBack())web.goBack();else super.onBackPressed();}
 @Override protected void onPause(){CookieManager.getInstance().flush();super.onPause();}
 @Override protected void onDestroy(){if(web!=null){web.stopLoading();web.destroy();web=null;}super.onDestroy();}
}
