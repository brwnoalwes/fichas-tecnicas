// Painel "Separação Estamparia" (CEP 9 / Photoshop 2020 — Chromium 61, Node 8: até ES2017).
// A separação roda aqui, com o mesmo motor da página de teste (js/motor.js = motor/separacao.js).
// Prévia em resolução reduzida; canais e fotolitos em resolução cheia, processados em faixas.
// Fora do Photoshop (navegador comum) funciona em modo de teste: carrega uma imagem e mostra a prévia.
"use strict";
const M = window.MotorSeparacao, $ = s => document.querySelector(s);
const CEP = !!window.__adobe_cep__;
const nreq = window.cep_node ? window.cep_node.require : (typeof require === "function" ? require : null);
const fs = CEP && nreq ? nreq("fs") : null, path = fs && nreq("path"), os = fs && nreq("os"), Buf = fs && nreq("buffer").Buffer;
const TMP = fs ? path.join(os.tmpdir(), "estamparia-separacao") : null;
const PREV_MAX = 900, FAIXA = 256;
const fmt = n => n.toLocaleString("pt-BR", { maximumFractionDigits: 1 });
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const espera = () => new Promise(r => setTimeout(r, 0));

// regioes: cada uma com a sua paleta; a última é sempre o "Resto da arte" (o que nenhuma região cobre)
const st = { doc: null, full: null, W: 0, H: 0, dpi: 300, prev: null, regioes: [], plano: null, grupos: null, sep: null, assin: "", raws: null, modos: {} };

/* ---------- Photoshop ---------- */
function host(fn, arg) {
  return new Promise((res, rej) => {
    if (!CEP) return rej(new Error("Disponível só dentro do Photoshop."));
    const chamada = arg === undefined ? fn + "()" : fn + "(" + JSON.stringify(JSON.stringify(arg)) + ")";
    window.__adobe_cep__.evalScript(chamada, r => {
      let o;
      try { o = JSON.parse(r); } catch (e) { return rej(new Error("Resposta inesperada do Photoshop: " + r)); }
      o.ok ? res(o) : rej(new Error(o.erro));
    });
  });
}
function status(id, txt, tipo) { const el = $(id); el.textContent = txt; el.className = "status" + (tipo ? " " + tipo : ""); }
const barra = f => { $("#barra").style.width = Math.round(f * 100) + "%"; };

/* ---------- 1. ler a arte ---------- */
const urlArquivo = p => "file:///" + encodeURI(p.replace(/\\/g, "/")).replace(/#/g, "%23") + "?t=" + Date.now();
function modoFonte(f) {
  st.fonte = f; document.body.classList.toggle("modo-canais", f === "canais");
  // canais feitos por você já trazem as marcas do gabarito: fotolito 1:1, sem margem/cruzes/título
  $("#marcasExt").checked = f !== "canais";
}

/* ---------- gabarito de registro da loja ---------- */
const imagemDe = arq => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = () => rej(new Error("Não consegui abrir " + arq)); im.src = urlArquivo(arq); });
// máscara das marcas do gabarito (resolução cheia e prévia), para escondê-las na prova; os fotolitos mantêm as marcas
async function prepararGabarito() {
  st.gabMask = null; st.gabMaskPrev = null;
  const arq = $("#gabarito").value.trim();
  if (!arq) { status("#stGab", "Sem gabarito: a prova mostra as marcas que estão nos canais. Clique em “Escolher…” e indique o PDF do gabarito."); return; }
  if (!st.W || !fs) return;
  try {
    if (!fs.existsSync(arq)) throw new Error("Gabarito não encontrado: " + arq);
    if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
    status("#stGab", "Lendo o gabarito…"); await espera();
    let g;
    if (/\.pdf$/i.test(arq)) g = window.Gabarito.lerPDF(fs, path, nreq("zlib"), arq, TMP);
    else { const im = await imagemDe(arq); g = { paginaW: im.naturalWidth, paginaH: im.naturalHeight, imagens: [{ arquivo: arq, x: 0, y: 0, w: im.naturalWidth, h: im.naturalHeight }], linhas: [] }; }
    const dif = Math.abs(g.paginaW / g.paginaH - st.W / st.H) / (st.W / st.H);
    st.gabMask = await window.Gabarito.mascara(g, st.W, st.H, 0.3 / 25.4 * st.dpi, M, imagemDe);
    st.gabMaskPrev = reduzirMascara(st.gabMask, st.W, st.H, st.prev.w, st.prev.h).map(v => v > 0 ? 255 : 0);
    status("#stGab", dif > 0.01 ? "Gabarito carregado, mas com proporção diferente da arte: confira o tamanho." : "Gabarito carregado: as marcas dele não aparecem na prova (continuam nos fotolitos).", dif > 0.01 ? "erro" : "ok");
  } catch (e) { status("#stGab", e.message, "erro"); }
}
$("#btnGabarito").onclick = async () => {
  try {
    const r = await host("escolherArquivo", { titulo: "Gabarito de registro" });
    if (r.caminho) { $("#gabarito").value = r.caminho; salvarPreferencias(); await prepararGabarito(); separar(); }
  } catch (e) { status("#stGab", "Não consegui abrir a janela de arquivos (" + e.message + "). Cole o caminho do gabarito no campo e tecle Enter.", "erro"); }
};
$("#gabarito").addEventListener("change", async () => { salvarPreferencias(); await prepararGabarito(); separar(); });
$("#escondeMarcas").addEventListener("change", () => { salvarPreferencias(); separar(); });
const marcasNaProva = () => st.fonte === "canais" && $("#escondeMarcas").checked;
$("#btnLer").onclick = async () => {
  try {
    modoFonte("auto");
    if (CEP) {
      status("#stArte", "Exportando a arte do Photoshop…");
      if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
      const r = await host("exportarArte", { pasta: TMP });
      st.doc = { nome: r.nome, pasta: r.pasta };
      st.dpi = r.dpi;
      await carregarImagem(urlArquivo(r.png));
    } else {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return; st.doc = { nome: f.name, pasta: null }; st.dpi = 300; await carregarImagem(URL.createObjectURL(f)); };
      inp.click();
    }
  } catch (e) { status("#stArte", e.message, "erro"); }
};
// usar a separação já feita no PSD (BBOXSTAMP ou manual): os canais viram as telas, na ordem do painel Canais
$("#btnCanaisDoc").onclick = async () => {
  try {
    if (!CEP) throw new Error("Disponível só dentro do Photoshop.");
    if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
    const inf = await host("infoDoc");
    st.doc = { nome: inf.nome, pasta: inf.pasta };
    // rápido: lê os canais direto do PSD salvo (segundos). Sem arquivo salvo: copia canal por canal no Photoshop (lento)
    if (inf.caminho && /\.ps[db]$/i.test(inf.caminho) && inf.salvo) {
      const n2 = i => (i < 10 ? "0" : "") + i;
      const r = await window.lerPSD(fs, Buf, inf.caminho,
        (e, nome, tipo) => tipo === "spot" && !/camiseta/i.test(nome) ? path.join(TMP, "canal" + n2(e) + ".raw") : null,
        async txt => { status("#stArte", txt); await espera(); });
      st.dpi = r.dpi;
      aplicarArte(r.W, r.H, (cv, w, h) => {
        const g = cv.getContext("2d"); g.putImageData(new ImageData(r.rgba, r.W, r.H), 0, 0);
      }, true);
      usarCanais(r.canais);
      await prepararGabarito(); separar();
    } else {
      status("#stArte", inf.caminho ? "PSD com alterações não salvas: lendo canal por canal no Photoshop (lento). Salve (Ctrl+S) para ser rápido." : "Documento nunca salvo: lendo canal por canal no Photoshop (lento).");
      const arte = await host("exportarArte", { pasta: TMP });
      st.dpi = arte.dpi;
      await carregarImagem(urlArquivo(arte.png), true);
      const r = await host("exportarCanais", { pasta: TMP });
      usarCanais(r.canais);
      await prepararGabarito(); separar();
    }
  } catch (e) { status("#stArte", e.message, "erro"); }
};
// número "#NN" que já vem no nome do canal (ex.: "ok #03 Amarelo 1") e o nome sem ele
function numeroDoCanal(nome, ordem) {
  const m = /#\s*(\d+)/.exec(nome);
  const limpo = m ? nome.replace(m[0], "").replace(/^\s*ok\b\s*/i, "").trim() : nome.trim();
  return { num: "#" + String(m ? +m[1] : ordem).padStart(2, "0"), nome: limpo || nome };
}
// chapado × retícula de um canal feito à mão: fração da tinta em degradê LARGO (glow), medida em meia
// resolução. Na prévia reduzida as bordas finas parecem degradê e enganam; aqui a hachura não conta.
function tomDoCanal(buf) {
  const w = st.W >> 1, h = st.H >> 1, red = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = 2 * y * st.W + 2 * x;
    red[y * w + x] = 255 - ((buf[i] + buf[i + 1] + buf[i + st.W] + buf[i + st.W + 1]) >> 2);
  }
  return M.fracaoDegrade(red, w, h, 0.3 / 25.4 * st.dpi / 2) > 0.15 ? "degrade" : "chapado";
}
function usarCanais(listaToda) {
  const p = st.prev, telas = [];
  // telas = canais de cor especial; canais alfa ("Transparência", "Alfa 1"…) são seleções guardadas.
  // Se o documento só tiver alfas, usa os alfas.
  const spots = listaToda.filter(c => c.tipo === "spot"), lista = spots.length ? spots : listaToda;
  let ordem = 0;
  for (const c of lista) {
    if (/camiseta/i.test(c.nome)) { if (c.hex) $("#camisetaCanais").value = c.hex; continue; }
    if (!c.raw || /^(alfa|alpha)\s*\d*$/i.test(c.nome.trim()) || /transpar/i.test(c.nome)) continue;
    const buf = fs.readFileSync(c.raw);
    // cor especial chega com preto = tinta (lida do arquivo, ou já desinvertida no Photoshop).
    // Só canal alfa (sem cor especial no documento) pode vir ao contrário: aí vale a cobertura
    if (c.tipo !== "spot") {
      let soma = 0, n = 0;
      for (let q = 0; q < buf.length; q += 97) { soma += buf[q]; n++; }
      const cob = 1 - soma / (n * 255);
      let inv = c.tipo === "mascara";
      if ((inv ? 1 - cob : cob) > 0.85) inv = !inv;
      if (inv) { for (let q = 0; q < buf.length; q++) buf[q] = 255 - buf[q]; fs.writeFileSync(c.raw, buf); }
    }
    const canal = reduzirMascara(buf, st.W, st.H, p.w, p.h).map(v => 255 - v);
    if (M.cobertura(canal) < 0.00005) continue;
    const hex = c.hex || "#888888", nn = numeroDoCanal(c.nome, ++ordem);
    telas.push({ tipo: "canal", num: nn.num, nome: nn.nome, original: c.nome, hex, lab: c.lab || M.rgb2lab.apply(null, M.hex2rgb(hex)),
      canal, raw: c.raw, tom: tomDoCanal(buf), base: /base/i.test(c.nome) && /branc/i.test(c.nome), traco: false });
  }
  if (!telas.length) throw new Error("Os canais do documento estão vazios.");
  st.planoCanais = telas;
  modoFonte("canais");
  const ign = listaToda.length - lista.length;
  status("#stArte", `${st.doc.nome}: ${telas.length} canais lidos, na ordem do painel Canais` + (ign ? ` (${ign} canais alfa ignorados)` : "") + ".", "ok");
  separarAgora();
}
// monta a arte em resolução cheia (desenhar(canvas, W, H)) e a prévia reduzida
function aplicarArte(W, H, desenhar, semPaleta) {
  const full = document.createElement("canvas"); full.width = W; full.height = H;
  desenhar(full, W, H);
  const k = Math.min(1, PREV_MAX / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
  const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
  const g = cv.getContext("2d"); g.drawImage(full, 0, 0, w, h);
  Object.assign(st, { full, W, H, prev: { w, h, k, cv, px: g.getImageData(0, 0, w, h).data }, raws: null, modos: {}, regioes: [novaRegiao("Resto da arte", null, null)] });
  const cm = v => fmt(v / st.dpi * 2.54);
  status("#stArte", `${st.doc.nome} · ${W} × ${H} px · ${cm(W)} × ${cm(H)} cm a ${Math.round(st.dpi)} dpi`, "ok");
  $("#cvOrig").width = w; $("#cvOrig").height = h; $("#cvOrig").getContext("2d").drawImage(cv, 0, 0);
  if (!semPaleta) calcPaleta();
}
function carregarImagem(src, semPaleta) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      aplicarArte(im.naturalWidth, im.naturalHeight, cv => cv.getContext("2d").drawImage(im, 0, 0), semPaleta);
      res();
    };
    im.onerror = () => rej(new Error("Não consegui abrir a imagem exportada."));
    im.src = src;
  });
}

/* ---------- 2. paleta ---------- */
function nomeCor(lab) {
  const L = lab[0], a = lab[1], b = lab[2], C = Math.hypot(a, b), hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
  if (C < 12) return L > 88 ? "Branco" : L < 22 ? "Preto" : "Sombra";
  if (L > 60 && C < 38 && hue >= 30 && hue < 80) return "Pele";
  return [[20, "Rosa"], [50, "Vermelho"], [75, "Laranja"], [105, "Amarelo"], [190, "Verde"], [250, "Ciano"], [300, "Azul"], [345, "Roxo"], [361, "Rosa"]].find(x => hue < x[0])[1];
}
function novaRegiao(nome, raw, mPrev) { return { nome, raw, mPrev, maxCores: 3, pal: null, papeis: [], base: [], nomes: [] }; }
const ehResto = ri => ri === st.regioes.length - 1;
// resto = o que nenhuma região cobre: 255 − (máscara mais forte)
function mascaraResto(masks, N) {
  if (!masks.length) return null;
  const m = new Uint8Array(N).fill(255);
  for (const k of masks) for (let i = 0; i < N; i++) { const v = 255 - k[i]; if (v < m[i]) m[i] = v; }
  return m;
}
function pxDaRegiao(px, m) {
  if (!m) return px;
  const out = new Uint8ClampedArray(px);
  for (let i = 0; i < m.length; i++) out[i * 4 + 3] = px[i * 4 + 3] * m[i] / 255;
  return out;
}
// máscara da resolução cheia → prévia (média por área)
function reduzirMascara(buf, W, H, w, h) {
  const acc = new Float32Array(w * h), cnt = new Float32Array(w * h);
  for (let y = 0; y < H; y++) {
    const ry = Math.min(h - 1, Math.floor(y * h / H)) * w;
    for (let x = 0; x < W; x++) { const k = ry + Math.min(w - 1, Math.floor(x * w / W)); acc[k] += buf[y * W + x]; cnt[k]++; }
  }
  const m = new Uint8Array(w * h);
  for (let k = 0; k < m.length; k++) m[k] = Math.round(acc[k] / cnt[k]);
  return m;
}
function adicionarRegiao(nome, raw, mPrev) {
  st.regioes.splice(st.regioes.length - 1, 0, novaRegiao(nome, raw, mPrev));
  calcPaleta();
}
$("#btnRegiao").onclick = async () => {
  try {
    if (!st.prev) throw new Error("Leia a arte primeiro.");
    const nome = $("#nomeRegiao").value.trim() || "Região " + st.regioes.length;
    status("#stReg", "Lendo a seleção…");
    const r = await host("exportarSelecao", { arquivo: path.join(TMP, "regiao" + Date.now() + ".raw") });
    adicionarRegiao(nome, r.raw, reduzirMascara(fs.readFileSync(r.raw), st.W, st.H, st.prev.w, st.prev.h));
    $("#nomeRegiao").value = "";
    status("#stReg", `Região “${nome}” adicionada. Selecione a próxima ou ajuste as cores abaixo.`, "ok");
  } catch (e) { status("#stReg", e.message, "erro"); }
};

function calcPaleta(so) {
  if (!st.prev) return;
  const p = st.prev, N = p.w * p.h;
  st.regioes[st.regioes.length - 1].mPrev = mascaraResto(st.regioes.slice(0, -1).map(r => r.mPrev), N);
  st.regioes.forEach((r, ri) => {
    if (so != null && ri !== so) return;
    const resto = ehResto(ri);
    r.pal = M.paleta(pxDaRegiao(p.px, r.mPrev), p.w, p.h, { maxCores: resto ? +$("#maxCores").value : r.maxCores, mesclarDE: +$("#mesclar").value });
    const cam = resto ? r.pal.camiseta : -1;
    // quase-preto dentro da arte é traço (contorno/hachura); a cor de fundo é a camiseta
    r.papeis = r.pal.cores.map((c, i) => i === cam ? "camiseta" : (cam < 0 || !resto) && c.lab[0] < 18 && Math.hypot(c.lab[1], c.lab[2]) < 10 ? "traco" : "imprimir");
    r.base = r.pal.cores.map(c => c.lab[0] > 25);
    if (resto) {
      const conta = {}, seq = {}, nomes = r.pal.cores.map(c => nomeCor(c.lab));
      nomes.forEach(n => { conta[n] = (conta[n] || 0) + 1; });
      r.nomes = nomes.map(n => conta[n] > 1 ? n + " " + (seq[n] = (seq[n] || 0) + 1) : n);
      if (cam >= 0) $("#camiseta").value = r.pal.cores[cam].hex;
    } else {
      r.nomes = r.pal.cores.map((_, i) => r.pal.cores.length > 1 ? r.nome + " " + (i + 1) : r.nome);
    }
  });
  desenharPaleta(); separar();
}
function desenharPaleta() {
  const multi = st.regioes.length > 1;
  $("#paleta").innerHTML = st.regioes.map((r, ri) => `
    ${multi ? `<div class="reg">${ehResto(ri) ? `<b>Resto da arte</b><span class="hint">máx. no controle acima</span>` :
      `<input type="text" data-rnome="${ri}" value="${esc(r.nome)}"><label class="hint">cores <input type="number" data-rmax="${ri}" value="${r.maxCores}" min="1" max="12" style="width:42px"></label><button class="btn" data-rdel="${ri}" title="Remover região">×</button>`}</div>` : ""}
    ${r.pal.cores.map((c, i) => `<div class="cor">
      <span class="sw" style="background:${c.hex}" title="${c.hex}"></span>
      <div><input type="text" data-r="${ri}" data-nome="${i}" value="${esc(r.nomes[i])}" ${r.papeis[i] !== "imprimir" ? "disabled" : ""}>
        <div class="row"><small>${fmt(c.cobertura * 100)}%</small><label class="chk"><input type="checkbox" data-r="${ri}" data-base="${i}" ${r.base[i] ? "checked" : ""} ${r.papeis[i] !== "imprimir" ? "disabled" : ""}><small>base</small></label></div></div>
      <select data-r="${ri}" data-papel="${i}">${[["imprimir", "Imprimir"], ["traco", "Traço"], ["camiseta", "Camiseta"], ["ignorar", "Ignorar"]].map(o => `<option value="${o[0]}" ${r.papeis[i] === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}</select>
    </div>`).join("") || `<div class="hint">Sem cores nesta região.</div>`}`).join("");
}
$("#paleta").addEventListener("change", e => {
  const d = e.target.dataset, r = st.regioes[+d.r];
  if (d.rmax != null) { st.regioes[+d.rmax].maxCores = Math.max(1, +e.target.value || 1); return calcPaleta(+d.rmax); }
  if (d.rnome != null) { const rg = st.regioes[+d.rnome]; rg.nome = e.target.value.trim() || rg.nome; return calcPaleta(+d.rnome); }
  if (d.papel != null) {
    r.papeis[+d.papel] = e.target.value;
    if (e.target.value === "camiseta") { r.papeis = r.papeis.map((v, i) => i === +d.papel ? v : v === "camiseta" ? "imprimir" : v); $("#camiseta").value = r.pal.cores[+d.papel].hex; }
    desenharPaleta();
  }
  if (d.base != null) r.base[+d.base] = e.target.checked;
  separar();
});
$("#paleta").addEventListener("input", e => { const d = e.target.dataset; if (d.nome != null) { st.regioes[+d.r].nomes[+d.nome] = e.target.value; separar(); } });
$("#paleta").addEventListener("click", e => {
  const d = e.target.dataset;
  if (d.rdel != null) { st.regioes.splice(+d.rdel, 1); st.raws = null; calcPaleta(); }
});

/* ---------- 3/4. separação e prévia ---------- */
// opções do pipeline para uma imagem com `dpi` efetivos (sem as máscaras: dependem da resolução)
// flat = as cores de todas as regiões, na ordem em que o pipeline devolve os canais
function opcoes(dpi) {
  const mm = v => v / 25.4 * dpi, regioes = [], flat = [];
  st.regioes.forEach((r, ri) => {
    const idx = r.pal.cores.map((_, i) => i).filter(i => r.papeis[i] !== "camiseta");
    // a base acompanha as cores, inclusive no degradê (ali ela também sai reticulada)
    regioes.push({ cores: idx.map(i => r.pal.cores[i]), papeis: idx.map(i => r.papeis[i]), base: idx.map(i => r.base[i]) });
    idx.forEach(i => flat.push({ chave: ri + ":" + i, cor: r.pal.cores[i], papel: r.papeis[i], nome: r.nomes[i] }));
  });
  return {
    regioes, flat,
    camiseta: M.rgb2lab.apply(null, M.hex2rgb($("#camiseta").value)), bordas: $("#bordas").value,
    tracoCamiseta: $("#tracoOn").checked, alcancePx: mm(+$("#alcance").value), trapPx: mm(+$("#trapMm").value),
    baseOn: $("#baseOn").checked, chokePx: mm(+$("#choke").value),
  };
}
const comMascaras = (o, masks) => Object.assign({}, o, { regioes: o.regioes.map((r, k) => Object.assign({}, r, { mascara: masks[k] })) });
let timer;
function separar() { clearTimeout(timer); timer = setTimeout(separarAgora, 120); }
function separarAgora() {
  if (st.fonte === "canais") return finalizarPlano(st.planoCanais, 0, "canais:" + st.planoCanais.map(t => t.raw).join("|"), $("#camisetaCanais").value);
  if (!st.regioes.length || !st.regioes[0].pal) return;
  const p = st.prev, dpiPrev = st.dpi * p.k, camHex = $("#camiseta").value, masks = st.regioes.map(r => r.mPrev);
  const o = opcoes(dpiPrev), baseFlags = [].concat.apply([], o.regioes.map(r => r.base));
  const sep = M.pipeline(p.px, p.w, p.h, comMascaras(o, masks));
  const kTraco = o.flat.findIndex(f => f.papel === "traco");
  let plano = sep.canais.map((c, k) => ({ tipo: "cor", k, nome: o.flat[k].nome, hex: o.flat[k].cor.hex, lab: o.flat[k].cor.lab, tom: M.tipoTom(c), canal: c }))
    .filter(t => o.flat[t.k].papel === "imprimir" && M.cobertura(t.canal) > 0.00005);
  if (sep.traco && M.cobertura(sep.traco) > 0.0005)
    plano.push({ tipo: "traco", nome: "Traço preto", hex: kTraco >= 0 ? o.flat[kTraco].cor.hex : camHex, lab: kTraco >= 0 ? o.flat[kTraco].cor.lab : o.camiseta, tom: M.tipoTom(sep.traco), canal: sep.traco, traco: true });
  plano = M.ordenar(plano).map(i => plano[i]);
  if (sep.base) plano.unshift({ tipo: "base", nome: "Base branca", hex: "#ffffff", lab: [100, 0, 0], tom: "chapado", canal: sep.base, base: true });
  plano.forEach((t, n) => { t.num = "#" + String(n + 1).padStart(2, "0"); t.chaveModo = t.tipo === "cor" ? o.flat[t.k].chave : t.tipo; });
  st.sep = sep;
  finalizarPlano(plano, sep.foraDaPaleta,
    JSON.stringify([st.regioes.map(r => r.raw), o.flat.map(f => [f.chave, f.cor.hex, f.papel]), baseFlags, o.bordas, o.tracoCamiseta, $("#alcance").value, $("#trapMm").value, o.baseOn, $("#choke").value, $("#camiseta").value]),
    camHex);
}
// comum às duas origens (separação automática ou canais do documento): prévia dos fotolitos, fotolitos
// que podem dividir a folha, prova e lista de telas
function finalizarPlano(plano, fora, assin, camHex) {
  const p = st.prev, dpiPrev = st.dpi * p.k, canais = st.fonte === "canais";
  // prévia = cada fotolito visto de longe (chapado no limiar, degradê no tom com ponto mín./máx.)
  // modo de cada tela (Auto / Chapado / Retícula) escolhido por quem separa
  const rf = retFilme(dpiPrev);
  plano.forEach(t => {
    if (canais) t.chaveModo = "canal:" + t.original;
    // canal feito por você: vai como está — chapado no limiar ou retícula nativa do Photoshop, pelo tipo do canal
    t.modo = st.modos[t.chaveModo] || (canais ? (t.tom === "degrade" ? "reticula" : "chapado") : "auto");
    t.filmePrev = M.simularFilme(t.canal, p.w, p.h, Object.assign({ modo: t.modo }, rf));
    t.ret = M.fracaoDegrade(t.canal, p.w, p.h, rf.raio, t.modo);
  });
  const fixos = plano.map((t, i) => t.base || t.traco || t.tipo === "base" || t.tipo === "traco" || (canais && t.modo === "reticula") ? i : -1).filter(i => i >= 0);
  st.grupos = $("#juntar").checked ? M.agrupar(plano.map(t => t.canal), p.w, p.h, { margem: +$("#folga").value / 2.54 * dpiPrev, fixos }) : plano.map((_, i) => [i]);
  st.grupos.sort((a, b) => a[0] - b[0]);
  st.plano = plano; st.assin = assin;
  // canais do documento já estão em resolução cheia: os .raw lidos do PSD são as telas
  if (canais) st.raws = { assin, arqs: plano.map(t => t.raw) };

  // marcas copiadas do gabarito não vão para a camiseta: saem da prova (os fotolitos continuam com elas)
  const mk = marcasNaProva() && st.gabMaskPrev;
  const semMarcas = t => {
    if (!mk) return t.filmePrev;
    const rem = M.marcasDoGabarito(t.canal, p.w, p.h, mk), o = t.filmePrev.slice();
    for (let i = 0; i < o.length; i++) if (rem[i]) o[i] = 0;
    return o;
  };
  const prova = M.simular(plano.map(t => ({ canal: semMarcas(t), hex: t.hex })), p.w, p.h, camHex);
  const cv = $("#cvProva"); cv.width = p.w; cv.height = p.h; cv.getContext("2d").putImageData(new ImageData(prova, p.w, p.h), 0, 0);
  status("#stPrev", `${plano.length} telas em ${st.grupos.length} fotolitos` + (fora > 0.01 ? ` · ${fmt(fora * 100)}% fora da paleta: aumente o máximo de cores` : ""), fora > 0.01 ? "erro" : "ok");
  $("#telas").innerHTML = plano.map(t => `<div class="tela"><i style="background:${t.hex}"></i><b>${t.num}</b> ${esc(t.nome)}
    ${t.base ? '<span class="tag base">base</span>' : t.traco ? '<span class="tag traco">traço</span>' : ""}
    ${t.ret >= 0.02 ? `<span class="tag degrade">${t.ret > 0.9 ? "retícula" : "misto " + Math.round(t.ret * 100) + "% ret."}</span>` : '<span class="tag">chapado</span>'}
    <span class="hint">${fmt(M.cobertura(t.canal) * 100)}%</span>
    <select class="modo" data-modo="${t.chaveModo}" title="Auto: chapa o sólido e reticula o degradê">${(canais ? [["chapado", "Chapado"], ["reticula", "Retícula"]] : [["auto", "Auto"], ["chapado", "Chapado"], ["reticula", "Retícula"]]).map(x => `<option value="${x[0]}" ${t.modo === x[0] ? "selected" : ""}>${x[1]}</option>`).join("")}</select></div>`).join("");
  ["#btnCanais", "#btnFotos", "#btnFicha", "#btnProva"].forEach(id => { $(id).disabled = !plano.length || (id !== "#btnFicha" && !CEP) || (id === "#btnCanais" && canais); });
  salvarPreferencias();
}

$("#telas").addEventListener("change", e => { const k = e.target.dataset.modo; if (k != null) { st.modos[k] = e.target.value; separar(); } });

/* ---------- 5. resolução cheia ---------- */
// separa a imagem inteira em faixas e grava um .raw por tela (8 bits, preto = tinta)
async function processarCheio() {
  if (st.raws && st.raws.assin === st.assin) return st.raws;
  const W = st.W, H = st.H, o = opcoes(st.dpi), s = M.sobra(o), plano = st.plano;
  const g = st.full.getContext("2d");
  const arqs = plano.map(t => path.join(TMP, "tela" + t.num.slice(1) + ".raw"));
  const fds = arqs.map(a => fs.openSync(a, "w"));
  const regs = st.regioes.slice(0, -1), rfds = regs.map(r => fs.openSync(r.raw, "r"));
  try {
    for (let y0 = 0; y0 < H; y0 += FAIXA) {
      const a = Math.max(0, y0 - s), b = Math.min(H, y0 + FAIXA + s), N = (b - a) * W;
      // máscaras das regiões só nestas linhas; o resto é o que nenhuma cobre
      const masks = rfds.map(fd => { const m = Buf.alloc(N); fs.readSync(fd, m, 0, N, a * W); return new Uint8Array(m.buffer, m.byteOffset, N); });
      masks.push(mascaraResto(masks, N));
      const r = M.pipeline(g.getImageData(0, a, W, b - a).data, W, b - a, comMascaras(o, masks));
      const de = (y0 - a) * W, n = Math.min(FAIXA, H - y0) * W;
      plano.forEach((t, i) => {
        const c = t.tipo === "base" ? r.base : t.tipo === "traco" ? r.traco : r.canais[t.k];
        const out = Buf.alloc(n, 255);
        if (c) for (let q = 0; q < n; q++) out[q] = 255 - c[de + q];
        fs.writeSync(fds[i], out);
      });
      barra((y0 + FAIXA) / H);
      status("#stSaida", `Separando em resolução cheia… ${Math.min(100, Math.round((y0 + FAIXA) / H * 100))}%`);
      await espera();
    }
  } finally { fds.concat(rfds).forEach(fd => fs.closeSync(fd)); }
  st.raws = { assin: st.assin, arqs };
  return st.raws;
}
function rawCamiseta() {
  const a = path.join(TMP, "camiseta.raw");
  fs.writeFileSync(a, Buf.alloc(st.W * st.H, 0)); // tinta cheia
  return a;
}
const nomeBase = () => st.doc.nome.replace(/\.[^.]+$/, "");

$("#btnCanais").onclick = () => tarefa("#btnCanais", async () => {
  const raws = await processarCheio();
  status("#stSaida", "Criando os canais no Photoshop…");
  const canais = st.plano.map((t, i) => ({ nome: t.num + " " + t.nome, raw: raws.arqs[i], lab: t.lab, solidez: 100 }));
  if ($("#camPrev").checked) canais.unshift({ nome: "Camiseta (previa)", raw: rawCamiseta(), lab: M.rgb2lab.apply(null, M.hex2rgb($("#camiseta").value)), solidez: 100 });
  const r = await host("criarCanais", { w: st.W, h: st.H, dpi: st.dpi, substituir: $("#substituir").checked, canais });
  status("#stSaida", `${r.canais.length} canais criados. Confira no painel Canais.`, "ok");
});

/* ---------- fotolito misto (chapado + retícula), feito aqui, na resolução de saída ---------- */
// parâmetros da retícula para uma imagem com `dpi` efetivos
function retFilme(dpi) { return { raio: +$("#raioDeg").value / 25.4 * dpi, pontoMin: +$("#pontoMin").value / 100, pontoMax: +$("#pontoMax").value / 100 }; }
// escala inteira até o dpi pedido (ex.: 300 → 900 = 3×)
function saidaFilme() { const s = Math.max(1, Math.round(+$("#dpiRet").value / st.dpi)); return { s, dpi: st.dpi * s }; }
// percorre as telas `idxs` em faixas e entrega o fotolito 1 bit de cada uma, faixa a faixa (255 = tinta)
async function porFaixasFilme(arqs, idxs, fn) {
  const W = st.W, H = st.H, rf = retFilme(st.dpi), sd = saidaFilme(), m = 2 * Math.max(1, Math.round(rf.raio)) + 2;
  const op = Object.assign({ s: sd.s, lpi: +$("#lpi").value, angulo: +$("#ang").value, dpiSaida: sd.dpi }, rf);
  const fds = idxs.map(i => fs.openSync(arqs[i], "r"));
  try {
    for (let y0 = 0; y0 < H; y0 += FAIXA) {
      const a = Math.max(0, y0 - m), b = Math.min(H, y0 + FAIXA + m), n = (b - a) * W;
      const filmes = fds.map((fd, j) => {
        const buf = Buf.alloc(n); fs.readSync(fd, buf, 0, n, a * W);
        const c = new Uint8Array(n); for (let q = 0; q < n; q++) c[q] = 255 - buf[q];
        return M.filme(c, W, b - a, Object.assign({ yIni: y0 - a, yFim: Math.min(y0 + FAIXA, H) - a, yGlobal: a, modo: st.plano[idxs[j]].modo }, op));
      });
      fn(filmes, y0, Math.min(FAIXA, H - y0));
      await espera();
    }
  } finally { fds.forEach(fd => fs.closeSync(fd)); }
}

// canais do documento: cada canal vai como está e o Photoshop converte (limiar ou retícula nativa),
// como na exportação manual; cores que não se encostam podem dividir a folha (só as chapadas)
async function fotolitosDosCanais() {
  const raws = await processarCheio(), dpiOut = +$("#dpiRet").value, N = st.grupos.length, arquivos = [];
  const saida = path.join(st.doc.pasta, "Fotolitos - " + nomeBase());
  for (let k = 0; k < N; k++) {
    const g = st.grupos[k], ts = g.map(i => st.plano[i]), nums = ts.map(t => t.num).join(" "), nomes = ts.map(t => t.nome).join(" + ");
    const ret = ts.length === 1 && ts[0].modo === "reticula";
    let raw = raws.arqs[g[0]];
    if (g.length > 1) { // várias cores na mesma folha: o mais escuro (mais tinta) vence
      const u = fs.readFileSync(raws.arqs[g[0]]);
      for (const i of g.slice(1)) { const b = fs.readFileSync(raws.arqs[i]); for (let q = 0; q < u.length; q++) if (b[q] < u[q]) u[q] = b[q]; }
      raw = path.join(TMP, "fotolito.raw"); fs.writeFileSync(raw, u);
    }
    barra(k / N); status("#stSaida", `Fotolito ${k + 1} de ${N} (${nums}): gravando o PDF no Photoshop…`);
    const r = await host("gerarFotolitos", { saida, margemCm: +$("#margemCm").value, espelhar: $("#espelhar").checked, marcas: $("#marcasExt").checked, fotolitos: [{
      arquivo: (nums + " " + nomes).replace(/[\\/:*?"<>|]/g, "-") + ".pdf", raw, w: st.W, h: st.H, dpi: st.dpi, saidaDpi: dpiOut,
      reticula: ret ? { lpi: +$("#lpi").value, angulo: +$("#ang").value } : null,
      titulo: nums + "  " + nomes + "   |   " + nomeBase() + "   |   " + (ret ? "retícula " + $("#lpi").value + " lpi " + $("#ang").value + "°" : "chapado") + " · " + dpiOut + " dpi" +
        (ts.length > 1 ? "   |   " + ts.length + " telas: grave cada cor na sua tela, bloqueando as outras áreas" : ""),
    }] });
    arquivos.push.apply(arquivos, r.arquivos);
  }
  status("#stSaida", `${arquivos.length} fotolitos em ${saida}`, "ok");
  host("abrirPasta", { pasta: saida }).catch(() => {});
}

$("#btnFotos").onclick = () => tarefa("#btnFotos", async () => {
  if (st.fonte === "canais") return fotolitosDosCanais();
  const raws = await processarCheio(), sd = saidaFilme(), W2 = st.W * sd.s, H2 = st.H * sd.s;
  const saida = path.join(st.doc.pasta, "Fotolitos - " + nomeBase()), arquivos = [], N = st.grupos.length;
  for (let k = 0; k < N; k++) {
    const g = st.grupos[k], ts = g.map(i => st.plano[i]), nums = ts.map(t => t.num).join(" "), nomes = ts.map(t => t.nome).join(" + ");
    const raw = path.join(TMP, "fotolito.raw"), fd = fs.openSync(raw, "w");
    try {
      await porFaixasFilme(raws.arqs, g, (filmes, y0) => {
        const out = Buf.alloc(filmes[0].length, 255); // várias cores na mesma folha: soma as áreas
        for (const f of filmes) for (let q = 0; q < f.length; q++) if (f[q]) out[q] = 0;
        fs.writeSync(fd, out);
        barra((k + (y0 + FAIXA) / st.H) / N);
        status("#stSaida", `Fotolito ${k + 1} de ${N} (${nums})… ${Math.min(100, Math.round((y0 + FAIXA) / st.H * 100))}%`);
      });
    } finally { fs.closeSync(fd); }
    const ret = ts.some(t => t.ret >= 0.02);
    status("#stSaida", `Fotolito ${k + 1} de ${N}: gravando o PDF no Photoshop…`);
    const r = await host("gerarFotolitos", { saida, margemCm: +$("#margemCm").value, espelhar: $("#espelhar").checked, marcas: $("#marcasExt").checked, fotolitos: [{
      arquivo: (nums + " " + nomes).replace(/[\\/:*?"<>|]/g, "-") + ".pdf", raw, w: W2, h: H2, dpi: sd.dpi,
      titulo: nums + "  " + nomes + "   |   " + nomeBase() + "   |   " + (ret ? "chapado + retícula " + $("#lpi").value + " lpi " + $("#ang").value + "°" : "chapado") + " · " + sd.dpi + " dpi" +
        (ts.length > 1 ? "   |   " + ts.length + " telas: grave cada cor na sua tela, bloqueando as outras áreas" : ""),
    }] });
    arquivos.push.apply(arquivos, r.arquivos);
  }
  try { fs.unlinkSync(path.join(TMP, "fotolito.raw")); } catch (e) { /* já removido */ }
  status("#stSaida", `${arquivos.length} fotolitos em ${saida}`, "ok");
  host("abrirPasta", { pasta: saida }).catch(() => {});
});

$("#btnFicha").onclick = () => tarefa("#btnFicha", async () => {
  const p = st.prev, pxPorCm = p.w / (st.W / st.dpi * 2.54);
  const cv = document.createElement("canvas"); cv.width = p.w; cv.height = p.h;
  const g = cv.getContext("2d");
  const canais = st.plano.map(t => {
    const img = new ImageData(p.w, p.h);
    for (let q = 0; q < p.w * p.h; q++) { const v = 255 - t.canal[q]; img.data[q * 4] = img.data[q * 4 + 1] = img.data[q * 4 + 2] = v; img.data[q * 4 + 3] = 255; }
    g.putImageData(img, 0, 0);
    return { nome: t.base ? "Base Branca" : t.nome, tipo: "spot", hex: t.hex, lab: t.lab, png: cv.toDataURL("image/png") };
  });
  const dados = JSON.stringify({ formato: "ficha-photoshop", versao: 1, documento: st.doc.nome, larguraCm: st.W / st.dpi * 2.54, alturaCm: st.H / st.dpi * 2.54, pxPorCm, canais });
  if (fs && st.doc.pasta) {
    const arq = path.join(st.doc.pasta, nomeBase() + ".ficha.json");
    fs.writeFileSync(arq, dados);
    status("#stSaida", "Salvo: " + arq + " — na ficha: Estampas > + Do Photoshop", "ok");
  } else {
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([dados], { type: "application/json" }));
    a.download = nomeBase() + ".ficha.json"; a.click();
    status("#stSaida", "Arquivo .ficha.json baixado.", "ok");
  }
});

// PNG RGB 8 bits a partir das linhas já com o byte de filtro
let TAB_CRC = null;
function png(linhas, w, h) {
  const zlib = nreq("zlib");
  if (!TAB_CRC) { TAB_CRC = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; TAB_CRC[n] = c >>> 0; } }
  const crc = b => { let x = 0xffffffff; for (let i = 0; i < b.length; i++) x = TAB_CRC[(x ^ b[i]) & 255] ^ (x >>> 8); return (x ^ 0xffffffff) >>> 0; };
  const bloco = (tipo, dados) => {
    const l = Buf.alloc(4); l.writeUInt32BE(dados.length, 0);
    const td = Buf.concat([Buf.from(tipo), dados]), c = Buf.alloc(4); c.writeUInt32BE(crc(td), 0);
    return Buf.concat([l, td, c]);
  };
  const ih = Buf.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buf.concat([Buf.from([137, 80, 78, 71, 13, 10, 26, 10]), bloco("IHDR", ih), bloco("IDAT", zlib.deflateSync(linhas, { level: 3 })), bloco("IEND", Buf.alloc(0))]);
}

// prova estampada em tamanho real: os fotolitos prontos (chapado + pontos de retícula), tela a tela na
// ordem de impressão, cada um com a cor da sua tinta, sobre a camiseta; aberta como aba no Photoshop
$("#btnProva").onclick = () => tarefa("#btnProva", async () => {
  const raws = await processarCheio(), s = saidaFilme().s;
  const W = st.W, H = st.H, L = W * 3 + 1, cam = M.hex2rgb($(st.fonte === "canais" ? "#camisetaCanais" : "#camiseta").value), N = st.plano.length;
  const arq = path.join(TMP, "Prova estampada - " + nomeBase().replace(/[\\/:*?"<>|]/g, "-") + ".png");
  const rgb = Buf.alloc(H * L); // cada linha do PNG começa com o byte de filtro (0)
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const o = y * L + 1 + x * 3; rgb[o] = cam[0]; rgb[o + 1] = cam[1]; rgb[o + 2] = cam[2]; }
  for (let i = 0; i < N; i++) {
    const c = M.hex2rgb(st.plano[i].hex), W2 = W * s;
    // marcas copiadas do gabarito nesta tela: não vão para a camiseta (o fotolito continua com elas)
    let mk = null;
    if (marcasNaProva() && st.gabMask) {
      status("#stSaida", `Prova estampada: tela ${i + 1} de ${N}, achando as marcas do gabarito…`); await espera();
      const buf = fs.readFileSync(raws.arqs[i]), tinta = new Uint8Array(buf.length);
      for (let q = 0; q < buf.length; q++) tinta[q] = 255 - buf[q];
      mk = M.marcasDoGabarito(tinta, W, H, st.gabMask);
    }
    await porFaixasFilme(raws.arqs, [i], (filmes, y0, nl) => {
      const f = filmes[0];
      // fotolito na resolução de saída → fração de tinta em cada pixel da arte (os pontos aparecem)
      for (let y = 0; y < nl; y++) for (let x = 0; x < W; x++) {
        if (mk && mk[(y0 + y) * W + x]) continue;
        let n = 0;
        for (let dy = 0; dy < s; dy++) { const r = (y * s + dy) * W2 + x * s; for (let dx = 0; dx < s; dx++) if (f[r + dx]) n++; }
        if (!n) continue;
        const a = n / (s * s), o = (y0 + y) * L + 1 + x * 3;
        rgb[o] += (c[0] - rgb[o]) * a; rgb[o + 1] += (c[1] - rgb[o + 1]) * a; rgb[o + 2] += (c[2] - rgb[o + 2]) * a;
      }
      barra((i + (y0 + FAIXA) / H) / N);
      status("#stSaida", `Prova estampada: tela ${i + 1} de ${N}…`);
    });
  }
  fs.writeFileSync(arq, png(rgb, W, H));
  await host("abrirProva", { arquivo: arq, dpi: st.dpi });
  status("#stSaida", "Prova estampada aberta numa aba nova, no mesmo tamanho da arte (Janela > Organizar para ver lado a lado).", "ok");
});
// clique na prévia: amplia na largura do painel (e volta)
$("#prev").addEventListener("click", () => $("#prev").classList.toggle("grande"));

async function tarefa(id, fn) {
  const b = $(id); b.disabled = true; barra(0);
  try { await fn(); } catch (e) { status("#stSaida", e.message, "erro"); }
  finally { b.disabled = false; barra(0); }
}

/* ---------- controles e preferências ---------- */
const SAIDAS = [["maxCores", "oMax", v => v, true], ["mesclar", "oMes", v => v, true], ["alcance", "oAlc", v => fmt(+v) + " mm"], ["trapMm", "oTrap", v => fmt(+v) + " mm"], ["choke", "oChoke", v => fmt(+v) + " mm"], ["raioDeg", "oRaio", v => fmt(+v) + " mm"]];
SAIDAS.forEach(x => {
  const el = $("#" + x[0]); $("#" + x[1]).textContent = x[2](el.value);
  el.addEventListener("input", () => { $("#" + x[1]).textContent = x[2](el.value); x[3] ? calcPaleta() : separar(); });
});
["camiseta", "camisetaCanais", "bordas", "tracoOn", "baseOn", "juntar", "folga", "pontoMin", "pontoMax"].forEach(id => $("#" + id).addEventListener("input", separar));
// v2: retícula mista e "passagem entre cores" com degradê por padrão (a v1 guardava "auto")
const CHAVE_PREF = "estamparia-separacao-v2";
const PREF = ["maxCores", "mesclar", "bordas", "tracoOn", "alcance", "trapMm", "baseOn", "choke", "raioDeg", "pontoMin", "pontoMax", "camPrev", "substituir", "lpi", "ang", "dpiRet", "margemCm", "folga", "juntar", "espelhar", "gabarito", "escondeMarcas"];
function salvarPreferencias() {
  try { localStorage.setItem(CHAVE_PREF, JSON.stringify(PREF.reduce((o, id) => { const el = $("#" + id); o[id] = el.type === "checkbox" ? el.checked : el.value; return o; }, {}))); } catch (e) { /* sem armazenamento */ }
}
(function carregarPreferencias() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem(CHAVE_PREF)); } catch (e) { /* sem armazenamento */ }
  if (p) PREF.forEach(id => { const el = $("#" + id); if (p[id] === undefined) return; if (el.type === "checkbox") el.checked = p[id]; else el.value = p[id]; });
  SAIDAS.forEach(x => { $("#" + x[1]).textContent = x[2]($("#" + x[0]).value); });
  if (!CEP) status("#stArte", "Fora do Photoshop: modo de teste. Clique acima para escolher uma imagem.");
})();
["lpi", "ang", "dpiRet", "margemCm", "espelhar", "camPrev", "substituir"].forEach(id => $("#" + id).addEventListener("change", salvarPreferencias));
