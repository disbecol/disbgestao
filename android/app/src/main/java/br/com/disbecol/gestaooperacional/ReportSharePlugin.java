package br.com.disbecol.gestaooperacional;

import android.content.ClipData;
import android.content.Intent;
import android.net.Uri;
import android.util.Base64;
import androidx.core.content.FileProvider;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import org.json.JSONArray;
import org.json.JSONObject;

@CapacitorPlugin(name = "ReportShare")
public class ReportSharePlugin extends Plugin {
    @PluginMethod
    public void shareImages(PluginCall call) {
        String payload = call.getString("payload");
        if (payload == null || payload.isEmpty()) {
            call.reject("Nenhuma imagem para compartilhar.");
            return;
        }
        try {
            JSONArray images = new JSONArray(payload);
            if (images.length() < 1 || images.length() > 20) throw new IllegalArgumentException("Quantidade de imagens inválida.");
            File directory = new File(getContext().getCacheDir(), "relatorios-compartilhados");
            if (!directory.exists() && !directory.mkdirs()) throw new IllegalStateException("Não foi possível preparar as imagens.");
            File[] oldFiles = directory.listFiles();
            if (oldFiles != null) {
                long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
                for (File old : oldFiles) if (old.isFile() && old.lastModified() < cutoff) old.delete();
            }
            ArrayList<Uri> uris = new ArrayList<>();
            String authority = getContext().getPackageName() + ".fileprovider";
            for (int i = 0; i < images.length(); i++) {
                JSONObject image = images.getJSONObject(i);
                String dataUrl = image.getString("dataUrl");
                int comma = dataUrl.indexOf(',');
                if (!dataUrl.startsWith("data:image/png;base64,") || comma < 0) throw new IllegalArgumentException("Imagem PNG inválida.");
                byte[] bytes = Base64.decode(dataUrl.substring(comma + 1), Base64.DEFAULT);
                if (bytes.length == 0 || bytes.length > 10_000_000) throw new IllegalArgumentException("Imagem muito grande.");
                String name = image.optString("name", "relatorio-" + (i + 1) + ".png").replaceAll("[^a-zA-Z0-9._-]", "_");
                if (!name.endsWith(".png")) name += ".png";
                File file = new File(directory, System.currentTimeMillis() + "-" + i + "-" + name);
                try (FileOutputStream output = new FileOutputStream(file)) { output.write(bytes); }
                uris.add(FileProvider.getUriForFile(getContext(), authority, file));
            }
            Intent share = new Intent(uris.size() == 1 ? Intent.ACTION_SEND : Intent.ACTION_SEND_MULTIPLE);
            share.setType("image/png");
            if (uris.size() == 1) share.putExtra(Intent.EXTRA_STREAM, uris.get(0));
            else share.putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
            ClipData clips = ClipData.newUri(getContext().getContentResolver(), "Relatório", uris.get(0));
            for (int i = 1; i < uris.size(); i++) clips.addItem(new ClipData.Item(uris.get(i)));
            share.setClipData(clips);
            share.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            getActivity().runOnUiThread(() -> {
                try {
                    getActivity().startActivity(Intent.createChooser(share, "Compartilhar relatório"));
                    call.resolve();
                } catch (Exception error) {
                    call.reject("Não foi possível abrir o compartilhamento: " + error.getMessage());
                }
            });
        } catch (Exception error) {
            call.reject("Não foi possível preparar o relatório: " + error.getMessage());
        }
    }
}
