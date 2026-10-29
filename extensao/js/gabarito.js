// Gabarito de registro da loja: PDF do tamanho da arte com a grade de símbolos + cruzes (imagem) e as
// cantoneiras/barra (linhas). Este leitor entende esse tipo de PDF simples — uma página com imagens JPEG
// e linhas retas — ou uma imagem (PNG/JPG) da página inteira. Serve para saber onde ficam as marcas e
// escondê-las na prova (elas não vão para a camiseta). Node 8 / ES2017.
"use strict";
(function (raiz) {
  const mult = (a, b) => [a[0] * b[0] + a[1] * b[2], a[0] * b[1] + a[1] * b[3], a[2] * b[0] + a[3] * b[2], a[2] * b[1] + a[3] * b[3],
    a[4] * b[0] + a[5] * b[2] + b[4], a[4] * b[1] + a[5] * b[3] + b[5]];
  const ponto = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

  /**
   * Lê o PDF: tamanho da página (pt), imagens JPEG com a posição em que são desenhadas e linhas retas.
   * Grava cada JPEG em `pastaTmp`. @returns {paginaW, paginaH, imagens:[{arquivo, x, y, w, h}], linhas:[{x1,y1,x2,y2,larg}]}
   */
  function lerPDF(fs, path, zlib, arquivo, pastaTmp) {
    const b = fs.readFileSync(arquivo), s = b.toString("latin1");
    const obj = n => {
      const i = s.search(new RegExp("(^|[^0-9])" + n + " 0 obj")); if (i < 0) return null;
      const fim = s.indexOf("endobj", i), st = s.indexOf("stream", i), dict = s.slice(i, st > 0 && st < fim ? st : fim);
      let dados = null;
      if (st > 0 && st < fim) {
        let ini = st + 6; if (b[ini] === 13) ini++; if (b[ini] === 10) ini++;
        const L = /\/Length (\d+)/.exec(dict); dados = b.subarray(ini, ini + (L ? +L[1] : s.indexOf("endstream", ini) - ini));
      }
      return { dict, dados };
    };
    const pag = /\/Type\s*\/Page[^s]/.exec(s); if (!pag) throw new Error("PDF sem página");
    const ini = s.lastIndexOf("obj", pag.index), dictPag = s.slice(ini, s.indexOf("endobj", pag.index));
    const mb = /\/MediaBox\s*\[\s*([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)/.exec(dictPag);
    const paginaW = +mb[3] - +mb[1], paginaH = +mb[4] - +mb[2];
    // imagens por nome (/Im14 14 0 R)
    const xobj = {};
    const rx = /\/(\w+)\s+(\d+)\s+0\s+R/g, blocoX = /\/XObject\s*<<([^>]*)>>/.exec(s);
    if (blocoX) { let m; while ((m = rx.exec(blocoX[1]))) xobj[m[1]] = +m[2]; }
    // conteúdo da página (um objeto ou uma lista)
    const cont = /\/Contents\s*(\[[^\]]*\]|\d+\s+0\s+R)/.exec(dictPag);
    const refs = (cont[1].match(/\d+\s+0\s+R/g) || []).map(r => +r.split(/\s+/)[0]);
    let texto = "";
    for (const r of refs) { const o = obj(r); texto += " " + (/FlateDecode/.test(o.dict) ? zlib.inflateSync(o.dados).toString("latin1") : o.dados.toString("latin1")); }
    // interpreta só o necessário: q/Q, cm, w, m, l, S, Do
    const toks = texto.match(/\/?[^\s\[\]<>()\/]+|\[|\]/g) || [];
    let ctm = [1, 0, 0, 1, 0, 0], larg = 1, pilha = [], ops = [], atual = null;
    const imagens = [], linhas = [];
    for (const t of toks) {
      if (/^-?[\d.]+$/.test(t)) { ops.push(+t); continue; }
      if (t[0] === "/") { ops.push(t.slice(1)); continue; }
      switch (t) {
        case "q": pilha.push([ctm, larg]); break;
        case "Q": if (pilha.length) { const p = pilha.pop(); ctm = p[0]; larg = p[1]; } break;
        case "cm": ctm = mult(ops.slice(-6), ctm); break;
        case "w": larg = ops[ops.length - 1]; break;
        case "m": atual = ponto(ctm, ops[ops.length - 2], ops[ops.length - 1]); break;
        case "l": { const p = ponto(ctm, ops[ops.length - 2], ops[ops.length - 1]); if (atual) linhas.push({ x1: atual[0], y1: atual[1], x2: p[0], y2: p[1], larg: larg * Math.hypot(ctm[0], ctm[1]) }); atual = p; break; }
        case "Do": {
          const nome = ops[ops.length - 1], o = xobj[nome] && obj(xobj[nome]);
          if (o && /\/Subtype\s*\/Image/.test(o.dict) && /DCTDecode/.test(o.dict)) {
            const arq = path.join(pastaTmp, "gabarito-" + nome + ".jpg");
            fs.writeFileSync(arq, o.dados);
            const p0 = ponto(ctm, 0, 0), p1 = ponto(ctm, 1, 1);
            imagens.push({ arquivo: arq, x: Math.min(p0[0], p1[0]), y: Math.min(p0[1], p1[1]), w: Math.abs(p1[0] - p0[0]), h: Math.abs(p1[1] - p0[1]) });
          }
          break;
        }
      }
      if (/^[a-zA-Z*'"]+$/.test(t)) ops = [];
    }
    if (!imagens.length && !linhas.length) throw new Error("Não achei a grade de marcas neste PDF (esperava imagem JPEG + linhas).");
    return { paginaW, paginaH, imagens, linhas };
  }

  /**
   * Máscara das marcas do gabarito no tamanho W × H da arte (a página do gabarito = a arte inteira).
   * 1 = marca (com folga de `folgaPx` para cobrir o antisserrilhado). Usa canvas do navegador.
   */
  async function mascara(g, W, H, folgaPx, M, carregar) {
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d"), sx = W / g.paginaW, sy = H / g.paginaH;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
    for (const im of g.imagens) {
      const img = await carregar(im.arquivo);
      ctx.drawImage(img, im.x * sx, (g.paginaH - im.y - im.h) * sy, im.w * sx, im.h * sy);
    }
    ctx.strokeStyle = "#000"; ctx.lineCap = "butt";
    for (const l of g.linhas) { ctx.lineWidth = l.larg * sx; ctx.beginPath(); ctx.moveTo(l.x1 * sx, (g.paginaH - l.y1) * sy); ctx.lineTo(l.x2 * sx, (g.paginaH - l.y2) * sy); ctx.stroke(); }
    const px = ctx.getImageData(0, 0, W, H).data, m = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) m[i] = px[i * 4] < 160 ? 255 : 0;
    return folgaPx > 0 ? M.dilatar(m, W, H, Math.round(folgaPx)) : m;
  }

  raiz.Gabarito = { lerPDF, mascara };
})(typeof window !== "undefined" ? window : this);
