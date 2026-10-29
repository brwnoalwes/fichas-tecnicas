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
const st = { doc: null, full: null, W: 0, H: 0, dpi: 300, prev: null, regioes: [], plano: null, grupos: null, sep: null, assin: "", raws: null, degradeIdx: new Set() };

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
$("#btnLer").onclick = async () => {
  try {
    if (CEP) {
      status("#stArte", "Exportando a arte do Photoshop…");
      if (!fs.existsSync(TMP)) fs.mkdirSync(TMP);
      const r = await host("exportarArte", { pasta: TMP });
      st.doc = { nome: r.nome, pasta: r.pasta };
      st.dpi = r.dpi;
      await carregarImagem("file:///" + encodeURI(r.png.replace(/\\/g, "/")).replace(/#/g, "%23") + "?t=" + Date.now());
    } else {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
      inp.onchange = async () => { const f = inp.files[0]; if (!f) return; st.doc = { nome: f.name, pasta: null }; st.dpi = 300; await carregarImagem(URL.createObjectURL(f)); };
      inp.click();
    }
  } catch (e) { status("#stArte", e.message, "erro"); }
};
function carregarImagem(src) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => {
      const W = im.naturalWidth, H = im.naturalHeight;
      const full = document.createElement("canvas"); full.width = W; full.height = H;
      full.getContext("2d").drawImage(im, 0, 0);
      const k = Math.min(1, PREV_MAX / Math.max(W, H)), w = Math.max(1, Math.round(W * k)), h = Math.max(1, Math.round(H * k));
      const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
      const g = cv.getContext("2d"); g.drawImage(im, 0, 0, w, h);
      Object.assign(st, { full, W, H, prev: { w, h, k, cv, px: g.getImageData(0, 0, w, h).data }, raws: null, regioes: [novaRegiao("Resto da arte", null, null)] });
      const cm = v => fmt(v / st.dpi * 2.54);
      status("#stArte", `${st.doc.nome} · ${W} × ${H} px · ${cm(W)} × ${cm(H)} cm a ${Math.round(st.dpi)} dpi`, "ok");
      $("#cvOrig").width = w; $("#cvOrig").height = h; $("#cvOrig").getContext("2d").drawImage(cv, 0, 0);
      calcPaleta(); res();
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
    // cor em degradê (glow) não leva base: a base é chapada e o degradê viraria cinza no fotolito
    regioes.push({ cores: idx.map(i => r.pal.cores[i]), papeis: idx.map(i => r.papeis[i]), base: idx.map(i => r.base[i] && !st.degradeIdx.has(ri + ":" + i)) });
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
  if (!st.regioes.length || !st.regioes[0].pal) return;
  const p = st.prev, dpiPrev = st.dpi * p.k, camHex = $("#camiseta").value, masks = st.regioes.map(r => r.mPrev);
  // 1º separa sem base para saber quais cores são degradê; depois monta a base só com as chapadas
  st.degradeIdx = new Set();
  const o = opcoes(dpiPrev);
  const sep = M.pipeline(p.px, p.w, p.h, Object.assign(comMascaras(o, masks), { baseOn: false }));
  sep.canais.forEach((c, k) => { if (o.flat[k].papel === "imprimir" && M.tipoTom(c) === "degrade") st.degradeIdx.add(o.flat[k].chave); });
  const baseFlags = [].concat.apply([], opcoes(dpiPrev).regioes.map(r => r.base));
  if (o.baseOn) {
    const usar = o.flat.map((_, k) => k).filter(k => o.flat[k].papel === "imprimir" && baseFlags[k]);
    if (usar.length) sep.base = M.baseBranca(usar.map(k => sep.canais[k]), p.w, p.h, { choke: o.chokePx });
  }
  const kTraco = o.flat.findIndex(f => f.papel === "traco");
  let plano = sep.canais.map((c, k) => ({ tipo: "cor", k, nome: o.flat[k].nome, hex: o.flat[k].cor.hex, lab: o.flat[k].cor.lab, tom: M.tipoTom(c), canal: c }))
    .filter(t => o.flat[t.k].papel === "imprimir" && M.cobertura(t.canal) > 0.00005);
  if (sep.traco && M.cobertura(sep.traco) > 0.0005)
    plano.push({ tipo: "traco", nome: "Traço preto", hex: kTraco >= 0 ? o.flat[kTraco].cor.hex : camHex, lab: kTraco >= 0 ? o.flat[kTraco].cor.lab : o.camiseta, tom: M.tipoTom(sep.traco), canal: sep.traco, traco: true });
  plano = M.ordenar(plano).map(i => plano[i]);
  if (sep.base) plano.unshift({ tipo: "base", nome: "Base branca", hex: "#ffffff", lab: [100, 0, 0], tom: "chapado", canal: sep.base, base: true });
  plano.forEach((t, n) => { t.num = "#" + String(n + 1).padStart(2, "0"); });
  const lim = limiteLimpeza();
  plano.forEach(t => { if (t.tom !== "degrade") t.canal = M.limpar(t.canal, lim); });
  const fixos = plano.map((t, i) => t.tipo !== "cor" || t.tom === "degrade" ? i : -1).filter(i => i >= 0);
  st.grupos = $("#juntar").checked ? M.agrupar(plano.map(t => t.canal), p.w, p.h, { margem: +$("#folga").value / 2.54 * dpiPrev, fixos }) : plano.map((_, i) => [i]);
  st.grupos.sort((a, b) => a[0] - b[0]);
  st.plano = plano; st.sep = sep;
  st.assin = JSON.stringify([st.regioes.map(r => r.raw), o.flat.map(f => [f.chave, f.cor.hex, f.papel]), baseFlags, o.bordas, o.tracoCamiseta, $("#alcance").value, $("#trapMm").value, o.baseOn, $("#choke").value, $("#camiseta").value, lim]);

  const prova = M.simular(plano.map(t => ({ canal: t.canal, hex: t.hex })), p.w, p.h, camHex);
  const cv = $("#cvProva"); cv.width = p.w; cv.height = p.h; cv.getContext("2d").putImageData(new ImageData(prova, p.w, p.h), 0, 0);
  status("#stPrev", `${plano.length} telas em ${st.grupos.length} fotolitos` + (sep.foraDaPaleta > 0.01 ? ` · ${fmt(sep.foraDaPaleta * 100)}% fora da paleta: aumente o máximo de cores` : ""), sep.foraDaPaleta > 0.01 ? "erro" : "ok");
  $("#telas").innerHTML = plano.map(t => `<div class="tela"><i style="background:${t.hex}"></i><b>${t.num}</b> ${esc(t.nome)}
    ${t.base ? '<span class="tag base">base</span>' : t.traco ? '<span class="tag traco">traço</span>' : `<span class="tag ${t.tom}">${t.tom === "degrade" ? "degradê" : "chapado"}</span>`}
    <span class="hint">${fmt(M.cobertura(t.canal) * 100)}%</span></div>`).join("");
  ["#btnCanais", "#btnFotos", "#btnFicha"].forEach(id => { $(id).disabled = !plano.length || (id !== "#btnFicha" && !CEP); });
  salvarPreferencias();
}

/* ---------- 5. resolução cheia ---------- */
// separa a imagem inteira em faixas e grava um .raw por tela (8 bits, preto = tinta)
async function processarCheio() {
  if (st.raws && st.raws.assin === st.assin) return st.raws;
  const W = st.W, H = st.H, o = opcoes(st.dpi), s = M.sobra(o), plano = st.plano, lim = limiteLimpeza();
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
        const corte = t.tom !== "degrade" ? Math.round(lim * 255) : 0;
        const out = Buf.alloc(n, 255);
        if (c) for (let q = 0; q < n; q++) { const v = c[de + q]; out[q] = v < corte ? 255 : 255 - v; }
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

$("#btnFotos").onclick = () => tarefa("#btnFotos", async () => {
  const raws = await processarCheio();
  status("#stSaida", "Montando os fotolitos…");
  const fotolitos = st.grupos.map((g, k) => {
    let raw = raws.arqs[g[0]];
    if (g.length > 1) { // une as telas do grupo: o mais escuro (mais tinta) vence
      const u = fs.readFileSync(raws.arqs[g[0]]);
      for (const i of g.slice(1)) { const b = fs.readFileSync(raws.arqs[i]); for (let q = 0; q < u.length; q++) if (b[q] < u[q]) u[q] = b[q]; }
      raw = path.join(TMP, "fotolito" + k + ".raw"); fs.writeFileSync(raw, u);
    }
    const ts = g.map(i => st.plano[i]), nums = ts.map(t => t.num).join(" "), nomes = ts.map(t => t.nome).join(" + ");
    const degrade = ts.length === 1 && ts[0].tom === "degrade";
    return {
      arquivo: (nums + " " + nomes).replace(/[\\/:*?"<>|]/g, "-") + ".pdf",
      titulo: nums + "  " + nomes + "   |   " + nomeBase() + "   |   " + (degrade ? "retícula " + $("#lpi").value + " lpi " + $("#ang").value + "°" : "chapado") + " · " + $("#dpiRet").value + " dpi" +
        (ts.length > 1 ? "   |   " + ts.length + " telas: grave cada cor na sua tela, bloqueando as outras áreas" : ""),
      raw, dpi: +$("#dpiRet").value, reticula: degrade ? { lpi: +$("#lpi").value, angulo: +$("#ang").value } : null,
    };
  });
  const saida = path.join(st.doc.pasta, "Fotolitos - " + nomeBase());
  status("#stSaida", `Gerando ${fotolitos.length} PDFs no Photoshop (pode demorar)…`);
  const r = await host("gerarFotolitos", { w: st.W, h: st.H, dpi: st.dpi, saida, margemCm: +$("#margemCm").value, espelhar: $("#espelhar").checked, fotolitos });
  status("#stSaida", `${r.arquivos.length} fotolitos em ${r.pasta}`, "ok");
  host("abrirPasta", { pasta: r.pasta }).catch(() => {});
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

const limiteLimpeza = () => +$("#limpeza").value / 100;

async function tarefa(id, fn) {
  const b = $(id); b.disabled = true; barra(0);
  try { await fn(); } catch (e) { status("#stSaida", e.message, "erro"); }
  finally { b.disabled = false; barra(0); }
}

/* ---------- controles e preferências ---------- */
const SAIDAS = [["maxCores", "oMax", v => v, true], ["mesclar", "oMes", v => v, true], ["alcance", "oAlc", v => fmt(+v) + " mm"], ["trapMm", "oTrap", v => fmt(+v) + " mm"], ["choke", "oChoke", v => fmt(+v) + " mm"], ["limpeza", "oLimp", v => v + "%"]];
SAIDAS.forEach(x => {
  const el = $("#" + x[0]); $("#" + x[1]).textContent = x[2](el.value);
  el.addEventListener("input", () => { $("#" + x[1]).textContent = x[2](el.value); x[3] ? calcPaleta() : separar(); });
});
["camiseta", "bordas", "tracoOn", "baseOn", "juntar", "folga"].forEach(id => $("#" + id).addEventListener("input", separar));
const PREF = ["maxCores", "mesclar", "bordas", "tracoOn", "alcance", "trapMm", "baseOn", "choke", "limpeza", "camPrev", "substituir", "lpi", "ang", "dpiRet", "margemCm", "folga", "juntar", "espelhar"];
function salvarPreferencias() {
  try { localStorage.setItem("estamparia-separacao", JSON.stringify(PREF.reduce((o, id) => { const el = $("#" + id); o[id] = el.type === "checkbox" ? el.checked : el.value; return o; }, {}))); } catch (e) { /* sem armazenamento */ }
}
(function carregarPreferencias() {
  let p = null;
  try { p = JSON.parse(localStorage.getItem("estamparia-separacao")); } catch (e) { /* sem armazenamento */ }
  if (p) PREF.forEach(id => { const el = $("#" + id); if (p[id] === undefined) return; if (el.type === "checkbox") el.checked = p[id]; else el.value = p[id]; });
  SAIDAS.forEach(x => { $("#" + x[1]).textContent = x[2]($("#" + x[0]).value); });
  if (!CEP) status("#stArte", "Fora do Photoshop: modo de teste. Clique acima para escolher uma imagem.");
})();
["lpi", "ang", "dpiRet", "margemCm", "espelhar", "camPrev", "substituir"].forEach(id => $("#" + id).addEventListener("change", salvarPreferencias));
