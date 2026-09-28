package br.com.disbecol.gestaooperacional;

import android.content.Context;
import android.graphics.Bitmap;
import android.os.Handler;
import android.os.Looper;
import android.print.PrintAttributes;
import android.print.PrintDocumentAdapter;
import android.print.PrintJob;
import android.print.PrintManager;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.PluginMethod;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "NativePrint")
public class NativePrintPlugin extends Plugin {
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final List<WebView> printViews = new ArrayList<>();

    @PluginMethod
    public void printHtml(PluginCall call) {
        String html = call.getString("html");
        if (html == null || html.trim().isEmpty()) {
            call.reject("Nenhum documento para imprimir.");
            return;
        }

        getActivity().runOnUiThread(() -> {
            WebView view = new WebView(getActivity());
            final boolean[] loadStarted = { false };
            printViews.add(view);
            view.getSettings().setJavaScriptEnabled(true);
            view.setWebViewClient(new WebViewClient() {
                @Override
                public WebResourceResponse shouldInterceptRequest(WebView webView, WebResourceRequest request) {
                    return bridge.getLocalServer().shouldInterceptRequest(request);
                }

                @Override
                public void onPageFinished(WebView webView, String url) {
                    if (loadStarted[0] || !printViews.contains(webView)) return;
                    loadStarted[0] = true;
                    waitForImages(webView, call, 0);
                }

                @Override
                public void onReceivedError(WebView webView, WebResourceRequest request, WebResourceError error) {
                    if (request.isForMainFrame()) {
                        call.reject("Não foi possível preparar a etiqueta para impressão.");
                        releaseView(webView);
                    }
                }
            });
            view.loadDataWithBaseURL(bridge.getLocalUrl(), html, "text/html", "UTF-8", null);
        });
    }

    private void waitForImages(WebView view, PluginCall call, int attempt) {
        if (!printViews.contains(view)) return;
        view.evaluateJavascript("Array.from(document.images).every(function(img){return img.complete})", result -> {
            if (!printViews.contains(view)) return;
            if ("true".equals(result) || attempt >= 30) {
                openPrintDialog(view, call);
            } else {
                handler.postDelayed(() -> waitForImages(view, call, attempt + 1), 200);
            }
        });
    }

    private void openPrintDialog(WebView view, PluginCall call) {
        try {
            PrintManager manager = (PrintManager) getActivity().getSystemService(Context.PRINT_SERVICE);
            if (manager == null) {
                throw new IllegalStateException("Serviço de impressão do Android indisponível.");
            }
            String jobName = "Etiquetas NRI";
            PrintDocumentAdapter adapter = view.createPrintDocumentAdapter(jobName);
            PrintAttributes attributes = new PrintAttributes.Builder()
                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                .setColorMode(PrintAttributes.COLOR_MODE_COLOR)
                .build();
            PrintJob job = manager.print(jobName, adapter, attributes);
            if (job == null) {
                throw new IllegalStateException("O Android não abriu as opções de impressão.");
            }
            call.resolve();
            releaseWhenFinished(view, job);
        } catch (Exception error) {
            call.reject(error.getMessage() == null ? "Falha ao abrir a impressão." : error.getMessage());
            releaseView(view);
        }
    }

    private void releaseWhenFinished(WebView view, PrintJob job) {
        handler.postDelayed(() -> {
            if (job.isCompleted() || job.isCancelled() || job.isFailed()) {
                releaseView(view);
            } else if (printViews.contains(view)) {
                releaseWhenFinished(view, job);
            }
        }, 2000);
    }

    private void releaseView(WebView view) {
        printViews.remove(view);
        view.destroy();
    }

    @Override
    protected void handleOnDestroy() {
        for (WebView view : new ArrayList<>(printViews)) {
            releaseView(view);
        }
        super.handleOnDestroy();
    }
}
