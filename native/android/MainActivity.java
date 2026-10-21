package com.qatfah.accounting;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/**
 * The accounting UI remains a single BridgeActivity. The WhatsApp companion
 * is created only once on this Activity, not inside any invoice / bottom sheet.
 * Android may still suspend WebView sockets when the app is backgrounded.
 */
public final class MainActivity extends BridgeActivity {
  @Override public void onCreate(Bundle state) {
    registerPlugin(QatfahNativePlugin.class);
    super.onCreate(state);
    try {
      QatfahWhatsappDirect engine=QatfahWhatsappDirect.getShared();
      if(engine==null)engine=new QatfahWhatsappDirect(this);
      engine.ensureRunning();
    } catch(Exception ignored) {
      // The accounting UI must remain usable even when WhatsApp is unavailable.
    }
  }
  @Override protected void onDestroy() {
    QatfahWhatsappDirect engine=QatfahWhatsappDirect.getShared();
    if(engine!=null)engine.release();
    super.onDestroy();
  }
}
