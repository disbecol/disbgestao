package br.com.disbecol.gestaooperacional;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        registerPlugin(NativePrintPlugin.class);
        registerPlugin(ReportSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
