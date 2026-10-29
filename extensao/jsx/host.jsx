// Separação Estamparia — lado Photoshop (ExtendScript, Photoshop 2020+).
// O painel (index.html) faz a separação; aqui fica só o que exige o Photoshop:
// exportar a arte, criar os canais de cor especial e gerar os fotolitos.
// Cada função recebe um texto JSON e devolve um texto JSON {ok, ...} ou {ok:false, erro}.
// Textos sem acento: o ExtendScript lê este arquivo sem garantia de UTF-8.

function _json(v) {
    if (v === null || v === undefined) return "null";
    var t = typeof v;
    if (t === "number") return isFinite(v) ? String(v) : "null";
    if (t === "boolean") return String(v);
    if (t === "string") return '"' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/[\x00-\x1f]/g, "") + '"';
    var p = [], i;
    if (v instanceof Array) { for (i = 0; i < v.length; i++) p.push(_json(v[i])); return "[" + p.join(",") + "]"; }
    for (var k in v) if (v.hasOwnProperty(k)) p.push(_json(k) + ":" + _json(v[k]));
    return "{" + p.join(",") + "}";
}
function _ler(s) { return eval("(" + s + ")"); }
function _erro(e) { return _json({ ok: false, erro: (e && e.message ? e.message : String(e)) + (e && e.line ? " (linha " + e.line + ")" : "") }); }
function _comPixels(fn) {
    var u = app.preferences.rulerUnits, d = app.displayDialogs;
    app.preferences.rulerUnits = Units.PIXELS; app.displayDialogs = DialogModes.NO;
    try { return fn(); } finally { app.preferences.rulerUnits = u; app.displayDialogs = d; }
}
function _pasta(doc) { try { return doc.path.fsName; } catch (e) { return Folder.desktop.fsName; } }
function _cor(lab) { var c = new SolidColor(); c.lab.l = lab[0]; c.lab.a = lab[1]; c.lab.b = lab[2]; return c; }
function _preto() { var c = new SolidColor(); c.rgb.red = 0; c.rgb.green = 0; c.rgb.blue = 0; return c; }
function _branco() { var c = new SolidColor(); c.rgb.red = 255; c.rgb.green = 255; c.rgb.blue = 255; return c; }
function _abrirRaw(caminho, w, h, dpi) {
    var o = new RawFormatOpenOptions();
    o.width = w; o.height = h; o.channelNumber = 1; o.bitsPerChannel = 8; o.headerSize = 0;
    o.interleaveChannels = true; o.byteOrder = ByteOrder.IBM; o.retainHeader = false;
    var d = app.open(new File(caminho), o);
    d.resizeImage(undefined, undefined, dpi, ResampleMethod.NONE);
    return d;
}

/** Dados do documento ativo. */
function infoDoc() {
    try {
        if (!app.documents.length) return _json({ ok: false, erro: "Nenhum documento aberto." });
        return _comPixels(function () {
            var d = app.activeDocument;
            return _json({ ok: true, nome: d.name, w: d.width.as("px"), h: d.height.as("px"), dpi: d.resolution, pasta: _pasta(d), modo: String(d.mode) });
        });
    } catch (e) { return _erro(e); }
}

/** Salva a arte (camadas mescladas, sem canais extras) num PNG em a.pasta. */
function exportarArte(s) {
    try {
        var a = _ler(s);
        return _comPixels(function () {
            var doc = app.activeDocument;
            var dup = doc.duplicate("sep_tmp", true);
            try {
                if (dup.mode != DocumentMode.RGB) dup.changeMode(ChangeMode.RGB);
                if (dup.bitsPerChannel != BitsPerChannelType.EIGHT) dup.bitsPerChannel = BitsPerChannelType.EIGHT;
                for (var i = dup.channels.length - 1; i >= 0; i--) if (dup.channels[i].kind != ChannelType.COMPONENT) dup.channels[i].remove();
                var f = new File(a.pasta + "/arte.png");
                var o = new PNGSaveOptions(); o.compression = 1;
                dup.saveAs(f, o, true, Extension.LOWERCASE);
            } finally { dup.close(SaveOptions.DONOTSAVECHANGES); }
            app.activeDocument = doc;
            return _json({ ok: true, png: f.fsName, nome: doc.name, w: doc.width.as("px"), h: doc.height.as("px"), dpi: doc.resolution, pasta: _pasta(doc) });
        });
    } catch (e) { return _erro(e); }
}

// copia o canal cinza de "origem" para o canal ativo do documento ativo (Imagem > Aplicar imagem)
function _aplicarImagem(origem) {
    var d = new ActionDescriptor(), w = new ActionDescriptor(), r = new ActionReference();
    r.putEnumerated(charIDToTypeID("Chnl"), charIDToTypeID("Chnl"), charIDToTypeID("Gry "));
    r.putName(charIDToTypeID("Dcmn"), origem);
    w.putReference(charIDToTypeID("T   "), r);
    w.putEnumerated(charIDToTypeID("Clcl"), charIDToTypeID("Clcn"), charIDToTypeID("Nrml"));
    d.putObject(charIDToTypeID("With"), charIDToTypeID("Clcl"), w);
    executeAction(charIDToTypeID("AppI"), d, DialogModes.NO);
}

/**
 * Cria um canal de cor especial por tela, na ordem recebida.
 * a = {w, h, dpi, substituir, canais:[{nome, raw, lab:[L,a,b], solidez}]}
 * Os .raw têm 8 bits, 1 canal, preto = tinta (a mesma convenção dos canais de cor especial).
 */
function criarCanais(s) {
    try {
        var a = _ler(s);
        return _comPixels(function () {
            var doc = app.activeDocument;
            if (doc.width.as("px") != a.w || doc.height.as("px") != a.h) return _json({ ok: false, erro: "O documento ativo mudou de tamanho. Leia a arte de novo." });
            if (a.substituir) {
                for (var i = doc.channels.length - 1; i >= 0; i--) {
                    var n = doc.channels[i].name;
                    if (doc.channels[i].kind != ChannelType.COMPONENT && (/^#\d\d /.test(n) || n == "Camiseta (previa)")) doc.channels[i].remove();
                }
            }
            var feitos = [];
            for (var k = 0; k < a.canais.length; k++) {
                var c = a.canais[k];
                var tmp = _abrirRaw(c.raw, a.w, a.h, a.dpi), nomeTmp = tmp.name;
                app.activeDocument = doc;
                var ch = doc.channels.add();
                ch.kind = ChannelType.SPOTCOLOR;
                ch.name = c.nome;
                ch.color = _cor(c.lab);
                ch.opacity = c.solidez || 100;
                doc.activeChannels = [ch];
                try { _aplicarImagem(nomeTmp); }
                catch (e1) { // plano B: copiar e colar no canal
                    app.activeDocument = tmp; tmp.selection.selectAll(); tmp.selection.copy();
                    app.activeDocument = doc; doc.activeChannels = [ch]; doc.paste(); doc.selection.deselect();
                }
                tmp.close(SaveOptions.DONOTSAVECHANGES);
                feitos.push(c.nome);
            }
            app.activeDocument = doc;
            doc.activeChannels = doc.componentChannels;
            return _json({ ok: true, canais: feitos });
        });
    } catch (e) { return _erro(e); }
}

// cruz de registro: duas barras + quadrado vazado, centrada em (x, y)
function _marca(doc, x, y, t) {
    var preto = _preto(), e = Math.max(2, Math.round(t / 24)), q = Math.round(t * 0.32);
    doc.selection.select([[x - t / 2, y - e / 2], [x + t / 2, y - e / 2], [x + t / 2, y + e / 2], [x - t / 2, y + e / 2]]); doc.selection.fill(preto);
    doc.selection.select([[x - e / 2, y - t / 2], [x + e / 2, y - t / 2], [x + e / 2, y + t / 2], [x - e / 2, y + t / 2]]); doc.selection.fill(preto);
    doc.selection.select([[x - q, y - q], [x + q, y - q], [x + q, y + q], [x - q, y + q]]); doc.selection.stroke(preto, e, StrokeLocation.CENTER);
    doc.selection.deselect();
}

/**
 * Gera um PDF por fotolito.
 * O .raw já vem pronto do painel: 1 bit de fato (0 ou 255), na resolução de saída, com o chapado e os
 * pontos de retícula. Aqui só entram margem, marcas de registro, título e a gravação em PDF.
 * a = {saida, margemCm, espelhar, fotolitos:[{arquivo, titulo, raw, w, h, dpi}]}
 */
function gerarFotolitos(s) {
    try {
        var a = _ler(s);
        return _comPixels(function () {
            var pasta = new Folder(a.saida); if (!pasta.exists) pasta.create();
            var feitos = [];
            var fundo = app.backgroundColor; app.backgroundColor = _branco();
            try {
                for (var k = 0; k < a.fotolitos.length; k++) {
                    var f = a.fotolitos[k], m = Math.round(a.margemCm / 2.54 * f.dpi);
                    var d = _abrirRaw(f.raw, f.w, f.h, f.dpi);
                    try {
                        d.resizeCanvas(UnitValue(f.w + 2 * m, "px"), UnitValue(f.h + 2 * m, "px"), AnchorPosition.MIDDLECENTER);
                        var W = f.w + 2 * m, H = f.h + 2 * m, t = Math.round(m * 0.55);
                        _marca(d, W / 2, m / 2, t); _marca(d, W / 2, H - m / 2, t); _marca(d, m / 2, H / 2, t); _marca(d, W - m / 2, H / 2, t);
                        var cam = d.artLayers.add(); cam.kind = LayerKind.TEXT;
                        var ti = cam.textItem;
                        ti.contents = f.titulo; ti.size = 11; ti.color = _preto();
                        ti.position = [UnitValue(m + t, "px"), UnitValue(Math.round(m * 0.62), "px")];
                        d.flatten();
                        // PDF em 1 bit (o título, suavizado, também vira preto/branco no limiar)
                        var o = new BitmapConversionOptions();
                        o.resolution = f.dpi;
                        o.method = BitmapConversionType.HALFTHRESHOLD;
                        d.changeMode(ChangeMode.BITMAP, o);
                        if (a.espelhar) d.flipCanvas(Direction.HORIZONTAL);
                        var p = new PDFSaveOptions(); p.layers = false; p.preserveEditing = false;
                        var arq = new File(pasta.fsName + "/" + f.arquivo);
                        d.saveAs(arq, p, true, Extension.LOWERCASE);
                        feitos.push(arq.fsName);
                    } finally { d.close(SaveOptions.DONOTSAVECHANGES); }
                }
            } finally { app.backgroundColor = fundo; }
            return _json({ ok: true, arquivos: feitos, pasta: pasta.fsName });
        });
    } catch (e) { return _erro(e); }
}

/**
 * Salva a seleção atual como máscara de região: .raw 8 bits do tamanho do documento,
 * 255 = selecionado (respeita seleção suavizada/difusa). A seleção do usuário não é alterada.
 * a = {arquivo}
 */
function exportarSelecao(s) {
    try {
        var a = _ler(s);
        return _comPixels(function () {
            var doc = app.activeDocument;
            try { doc.selection.bounds; } catch (e0) { return _json({ ok: false, erro: "Nada selecionado. Selecione a regiao (laco, varinha, intervalo de cores...) e tente de novo." }); }
            var w = doc.width.as("px"), h = doc.height.as("px"), nomeDoc = doc.name;
            var f = new File(a.arquivo), ch = null, tmp = null;
            // aconteça o que acontecer, não deixa documento auxiliar aberto nem canal temporário na arte
            try {
                ch = doc.channels.add(); ch.name = "sep_regiao_tmp";
                doc.selection.store(ch, SelectionType.REPLACE);
                doc.activeChannels = doc.componentChannels;
                tmp = app.documents.add(UnitValue(w, "px"), UnitValue(h, "px"), doc.resolution, "sep_regiao", NewDocumentMode.GRAYSCALE, DocumentFill.WHITE);
                // copia o canal temporário do documento da arte para o cinza deste documento
                var d = new ActionDescriptor(), wd = new ActionDescriptor(), r = new ActionReference();
                r.putName(charIDToTypeID("Chnl"), "sep_regiao_tmp");
                r.putName(charIDToTypeID("Dcmn"), nomeDoc);
                wd.putReference(charIDToTypeID("T   "), r);
                wd.putEnumerated(charIDToTypeID("Clcl"), charIDToTypeID("Clcn"), charIDToTypeID("Nrml"));
                d.putObject(charIDToTypeID("With"), charIDToTypeID("Clcl"), wd);
                executeAction(charIDToTypeID("AppI"), d, DialogModes.NO);
                var o = new RawSaveOptions(); o.alphaChannels = false; o.spotColors = false;
                tmp.saveAs(f, o, true, Extension.LOWERCASE);
            } finally {
                if (tmp) { try { tmp.close(SaveOptions.DONOTSAVECHANGES); } catch (e1) {} }
                for (var i = app.documents.length - 1; i >= 0; i--) if (app.documents[i].name.indexOf("sep_regiao") == 0) { try { app.documents[i].close(SaveOptions.DONOTSAVECHANGES); } catch (e2) {} }
                app.activeDocument = doc;
                if (ch) { try { ch.remove(); } catch (e3) {} }
                for (var j = doc.channels.length - 1; j >= 0; j--) if (doc.channels[j].name == "sep_regiao_tmp") { try { doc.channels[j].remove(); } catch (e4) {} }
                doc.activeChannels = doc.componentChannels;
            }
            return _json({ ok: true, raw: f.fsName, w: w, h: h });
        });
    } catch (e) { return _erro(e); }
}

/** Abre a prova de cor (PNG) como documento novo, no tamanho e dpi da arte. */
function abrirProva(s) {
    try {
        var a = _ler(s);
        return _comPixels(function () {
            var d = app.open(new File(a.arquivo));
            d.resizeImage(undefined, undefined, a.dpi, ResampleMethod.NONE);
            return _json({ ok: true, nome: d.name });
        });
    } catch (e) { return _erro(e); }
}

/** Abre a pasta no Explorer. */
function abrirPasta(s) { try { new Folder(_ler(s).pasta).execute(); return _json({ ok: true }); } catch (e) { return _erro(e); } }
