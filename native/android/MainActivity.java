package com.qatfah.accounting;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

/** The WhatsApp surface belongs to the Activity root, outside the HTML router. */
public final class MainActivity extends BridgeActivity {
  private QatfahWhatsappDirect whatsapp;
  @Override public void onCreate(Bundle state) {
    registerPlugin(QatfahNativePlugin.class);
    super.onCreate(state);
    try {
      whatsapp=QatfahWhatsappDirect.forActivity(this);
      whatsapp.ensureRunning();
    } catch(Exception ignored) {
      // The accounting UI stays usable; an explicit WhatsApp retry reports errors.
    }
  }
  @Override protected void onDestroy() {
    // Real obsolete Activities release views/callbacks, preserving origin storage
    // and the durable pairing preference for the next Activity/process startup.
    if(whatsapp!=null){whatsapp.release();whatsapp=null;}
    super.onDestroy();
  }
}
