// Enviar para a ficha — Photoshop (ExtendScript)
//
// Rode DEPOIS de separar as cores (ex.: com o BBOXSTAMP). O script lê os canais
// de cor especial (spot) e alfa do documento aberto e grava um arquivo
// "<nome>.ficha.json" com o tamanho real do documento e uma imagem de cada canal.
// Na página de fichas: Produtos → Estampas → "+ Do Photoshop".
//
// Instalar: copie este arquivo para a pasta Presets\Scripts do Photoshop e
// reinicie (aparece em Arquivo → Scripts), ou use Arquivo → Scripts → Procurar.
//
// Nada no documento é alterado: o script só copia os canais para documentos
// temporários e os fecha sem salvar.

#target photoshop

(function () {
    var PX_POR_CM = 30; // resolucao das imagens enviadas (30 px/cm ~ 76 dpi)

    if (!app.documents.length) {
        alert("Abra a arte separada antes de rodar o script.");
        return;
    }
    var doc = app.activeDocument;

    var canais = [];
    for (var i = 0; i < doc.channels.length; i++) {
        if (doc.channels[i].kind != ChannelType.COMPONENT) canais.push(doc.channels[i]);
    }
    if (!canais.length) {
        alert("Nenhum canal de cor especial ou alfa encontrado.\nFaca a separacao de cores antes de enviar para a ficha.");
        return;
    }

    var base = doc.name.replace(/\.[^.]+$/, "");
    var pasta;
    try { pasta = doc.path; } catch (e) { pasta = Folder.desktop; }
    var destino = new File(pasta + "/" + base + ".ficha.json").saveDlg("Salvar arquivo para a ficha", "Ficha:*.json");
    if (!destino) return;

    var unidades = app.preferences.rulerUnits;
    var dialogos = app.displayDialogs;
    app.preferences.rulerUnits = Units.PIXELS;
    app.displayDialogs = DialogModes.NO;

    var temporarios = [];
    try {
        var wPx = doc.width.as("px"), hPx = doc.height.as("px"), res = doc.resolution;
        var wCm = wPx / res * 2.54, hCm = hPx / res * 2.54;
        var outW = Math.max(1, Math.round(wCm * PX_POR_CM)), outH = Math.max(1, Math.round(hCm * PX_POR_CM));
        var saida = { formato: "ficha-photoshop", versao: 1, documento: doc.name, larguraCm: wCm, alturaCm: hCm,
            resolucao: res, pxPorCm: PX_POR_CM, canais: [] };

        for (var c = 0; c < canais.length; c++) {
            var ch = canais[c];
            app.activeDocument = doc;
            doc.activeChannels = [ch];
            doc.selection.selectAll();
            doc.selection.copy();

            var tmp = app.documents.add(UnitValue(wPx, "px"), UnitValue(hPx, "px"), res, "ficha_tmp",
                NewDocumentMode.GRAYSCALE, DocumentFill.WHITE);
            tmp.paste();
            tmp.flatten();
            tmp.resizeImage(UnitValue(outW, "px"), UnitValue(outH, "px"), res, ResampleMethod.BICUBIC);
            var png = new File(Folder.temp + "/ficha_canal_" + c + ".png");
            temporarios.push(png);
            var opt = new PNGSaveOptions();
            opt.compression = 9;
            tmp.saveAs(png, opt, true, Extension.LOWERCASE);
            tmp.close(SaveOptions.DONOTSAVECHANGES);

            var info = { nome: ch.name, tipo: tipoCanal(ch), png: "data:image/png;base64," + base64(png) };
            if (ch.kind == ChannelType.SPOTCOLOR) {
                try {
                    info.hex = "#" + ch.color.rgb.hexValue;
                    info.lab = [ch.color.lab.l, ch.color.lab.a, ch.color.lab.b];
                    info.solidez = ch.opacity;
                } catch (e) {}
            }
            saida.canais.push(info);
        }

        app.activeDocument = doc;
        doc.activeChannels = doc.componentChannels;
        doc.selection.deselect();

        destino.encoding = "UTF-8";
        destino.open("w");
        destino.write(json(saida));
        destino.close();
        alert("Pronto! " + canais.length + " canais enviados.\n\n" + destino.fsName +
            "\n\nNa ficha: Produtos > Estampas > + Do Photoshop.");
    } catch (e) {
        alert("Erro ao enviar para a ficha:\n" + e.message + (e.line ? " (linha " + e.line + ")" : ""));
    } finally {
        for (var t = 0; t < temporarios.length; t++) { try { temporarios[t].remove(); } catch (e) {} }
        app.preferences.rulerUnits = unidades;
        app.displayDialogs = dialogos;
    }

    function tipoCanal(ch) {
        if (ch.kind == ChannelType.SPOTCOLOR) return "spot";
        if (ch.kind == ChannelType.MASKEDAREA) return "mascara";
        return "selecao";
    }

    function base64(arquivo) {
        arquivo.encoding = "BINARY";
        arquivo.open("r");
        var s = arquivo.read();
        arquivo.close();
        var T = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        var out = [], n = s.length;
        for (var i = 0; i < n; i += 3) {
            var a = s.charCodeAt(i) & 255, b = i + 1 < n ? s.charCodeAt(i + 1) & 255 : 0, c = i + 2 < n ? s.charCodeAt(i + 2) & 255 : 0;
            var x = (a << 16) | (b << 8) | c;
            out.push(T.charAt((x >> 18) & 63) + T.charAt((x >> 12) & 63) +
                (i + 1 < n ? T.charAt((x >> 6) & 63) : "=") + (i + 2 < n ? T.charAt(x & 63) : "="));
        }
        return out.join("");
    }

    // ExtendScript nao tem JSON nativo
    function json(v) {
        if (v === null || v === undefined) return "null";
        if (typeof v === "number") return isFinite(v) ? String(v) : "null";
        if (typeof v === "boolean") return String(v);
        if (typeof v === "string") {
            return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r")
                .replace(/\t/g, "\\t").replace(/[\x00-\x1f]/g, "") + '"';
        }
        var partes = [];
        if (v instanceof Array) {
            for (var i = 0; i < v.length; i++) partes.push(json(v[i]));
            return "[" + partes.join(",") + "]";
        }
        for (var k in v) if (v.hasOwnProperty(k)) partes.push(json(k) + ":" + json(v[k]));
        return "{" + partes.join(",") + "}";
    }
})();
