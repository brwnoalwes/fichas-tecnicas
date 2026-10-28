/* Motor de separação de cores para serigrafia.
 *
 * JavaScript puro, sem dependências: roda no navegador (página de teste, painel CEP do
 * Photoshop 2020) e no Node (testes). Trabalha com pixels RGBA (Uint8ClampedArray / Uint8Array)
 * e devolve canais de tinta: Uint8Array com 0 = sem tinta e 255 = tinta cheia.
 *
 * Etapas:
 *   paleta()      detecta as cores sólidas da arte (k-means em Lab + limpeza)
 *   separar()     um canal por cor; bordas suavizadas viram meia-tinta entre as duas cores vizinhas
 *   baseBranca()  união das cores que levam base, com retração (choke) em px
 *   reticular()   prévia de retícula AM (ponto redondo); a final é feita pelo Photoshop
 *   simular()     prova de cor: base + cores sobre a cor da camiseta
 */
(function (raiz, fabrica) {
  if (typeof module === "object" && module.exports) module.exports = fabrica();
  else raiz.MotorSeparacao = fabrica();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- cor ---------- */
  const lin = c => { c /= 255; return c > 0.04045 ? Math.pow((c + 0.055) / 1.055, 2.4) : c / 12.92; };
  const LIN = new Float64Array(256).map((_, i) => lin(i));
  const fLab = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;

  function rgb2lab(r, g, b) {
    const R = LIN[r], G = LIN[g], B = LIN[b];
    const X = fLab((R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047);
    const Y = fLab(R * 0.2126 + G * 0.7152 + B * 0.0722);
    const Z = fLab((R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883);
    return [116 * Y - 16, 500 * (X - Y), 200 * (Y - Z)];
  }
  function lab2rgb(L, a, b) {
    let y = (L + 16) / 116, x = a / 500 + y, z = y - b / 200;
    const f = t => { const t3 = t * t * t; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
    x = 0.95047 * f(x); y = f(y); z = 1.08883 * f(z);
    const c = v => { v = v > 0.0031308 ? 1.055 * Math.pow(v, 1 / 2.4) - 0.055 : 12.92 * v; return Math.max(0, Math.min(255, Math.round(v * 255))); };
    return [c(x * 3.2406 - y * 1.5372 - z * 0.4986), c(-x * 0.9689 + y * 1.8758 + z * 0.0415), c(x * 0.0557 - y * 0.2040 + z * 1.0570)];
  }
  const hex = ([r, g, b]) => "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
  const hex2rgb = h => { const n = parseInt(String(h).replace("#", ""), 16) || 0; return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  const dE = (p, q) => Math.sqrt(d2(p, q));

  // projeção de p no segmento a→b: t = 0 em a, 1 em b; devolve [t, distância ao segmento]
  function projetar(p, a, b) {
    const v = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], vv = v[0] * v[0] + v[1] * v[1] + v[2] * v[2];
    if (!vv) return [0, dE(p, a)];
    let t = ((p[0] - a[0]) * v[0] + (p[1] - a[1]) * v[1] + (p[2] - a[2]) * v[2]) / vv;
    t = Math.max(0, Math.min(1, t));
    return [t, dE(p, [a[0] + t * v[0], a[1] + t * v[1], a[2] + t * v[2]])];
  }

  // pseudoaleatório com semente: o mesmo arquivo dá sempre a mesma paleta
  function rng(seed) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

  /* ---------- paleta ---------- */
  /**
   * @param {Uint8ClampedArray} px RGBA
   * @param {object} o  maxCores (8), mesclarDE (12), coberturaMin (0.004), amostras (40000)
   * @returns {{cores: {lab:number[], hex:string, cobertura:number}[], camiseta: number}} camiseta = índice
   *          sugerido para a cor de fundo (cor dominante nas bordas), ou -1 se a arte tem transparência.
   */
  function paleta(px, w, h, o = {}) {
    const maxCores = o.maxCores || 8, mesclarDE = o.mesclarDE ?? 12, coberturaMin = o.coberturaMin ?? 0.004;
    const N = w * h, passo = Math.max(1, Math.floor(N / (o.amostras || 40000)));
    const pts = [];
    let transparentes = 0;
    for (let i = 0; i < N; i += passo) {
      if (px[i * 4 + 3] < 128) { transparentes++; continue; }
      pts.push(rgb2lab(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]));
    }
    if (!pts.length) return { cores: [], camiseta: -1 };

    // k-means++ (determinístico)
    const rnd = rng(pts.length * 31 + maxCores);
    const cent = [pts[Math.floor(rnd() * pts.length)].slice()];
    const dist = new Float64Array(pts.length).fill(Infinity);
    while (cent.length < Math.min(maxCores, pts.length)) {
      let soma = 0;
      const ult = cent[cent.length - 1];
      for (let i = 0; i < pts.length; i++) { dist[i] = Math.min(dist[i], d2(pts[i], ult)); soma += dist[i]; }
      if (!soma) break;
      let alvo = rnd() * soma, i = 0;
      for (; i < pts.length - 1 && (alvo -= dist[i]) > 0; i++);
      cent.push(pts[i].slice());
    }
    const rot = new Int32Array(pts.length);
    for (let it = 0; it < 15; it++) {
      const acc = cent.map(() => [0, 0, 0, 0]);
      for (let i = 0; i < pts.length; i++) {
        let m = 0, md = Infinity;
        for (let k = 0; k < cent.length; k++) { const d = d2(pts[i], cent[k]); if (d < md) { md = d; m = k; } }
        rot[i] = m; const a = acc[m]; a[0] += pts[i][0]; a[1] += pts[i][1]; a[2] += pts[i][2]; a[3]++;
      }
      let mudou = false;
      acc.forEach((a, k) => { if (a[3]) { const n = [a[0] / a[3], a[1] / a[3], a[2] / a[3]]; if (d2(n, cent[k]) > 0.01) mudou = true; cent[k] = n; } });
      if (!mudou) break;
    }
    let cl = cent.map((c, k) => ({ lab: c, n: 0 }));
    for (let i = 0; i < pts.length; i++) cl[rot[i]].n++;
    cl = cl.filter(c => c.n);

    // junta cores quase iguais
    for (;;) {
      let par = null, md = mesclarDE;
      for (let i = 0; i < cl.length; i++) for (let j = i + 1; j < cl.length; j++) { const d = dE(cl[i].lab, cl[j].lab); if (d < md) { md = d; par = [i, j]; } }
      if (!par) break;
      const [a, b] = par.map(i => cl[i]), n = a.n + b.n;
      a.lab = a.lab.map((v, k) => (v * a.n + b.lab[k] * b.n) / n); a.n = n;
      cl.splice(par[1], 1);
    }
    // descarta cores de borda (meio caminho entre duas outras, pouca área) e cores minúsculas.
    // Detalhe pequeno mas bem diferente das outras cores (olho, brilho) fica.
    const total = pts.length;
    cl = cl.filter((c, i) => {
      const cob = c.n / total;
      if (cob < 0.0005) return false;
      if (cob < coberturaMin && Math.min(...cl.map((o, j) => j === i ? Infinity : dE(c.lab, o.lab))) < 30) return false;
      if (cob > 0.03) return true;
      for (let a = 0; a < cl.length; a++) for (let b = a + 1; b < cl.length; b++) {
        if (a === i || b === i) continue;
        const [t, r] = projetar(c.lab, cl[a].lab, cl[b].lab);
        if (t > 0.1 && t < 0.9 && r < mesclarDE * 0.6) return false;
      }
      return true;
    });
    cl.sort((p, q) => q.n - p.n);
    const cores = cl.map(c => ({ lab: c.lab.map(v => Math.round(v * 10) / 10), hex: hex(lab2rgb(...c.lab)), cobertura: c.n / total }));

    // cor da camiseta sugerida: a mais comum nas bordas da imagem (se a arte não for transparente)
    let camiseta = -1;
    if (transparentes / (transparentes + pts.length) < 0.02 && cores.length > 1) {
      const conta = new Array(cores.length).fill(0);
      const borda = (x, y) => {
        const i = (y * w + x) * 4; if (px[i + 3] < 128) return;
        const p = rgb2lab(px[i], px[i + 1], px[i + 2]);
        let m = 0, md = Infinity; cores.forEach((c, k) => { const d = d2(p, c.lab); if (d < md) { md = d; m = k; } }); conta[m]++;
      };
      const pb = Math.max(1, Math.floor((w + h) / 400));
      for (let x = 0; x < w; x += pb) { borda(x, 0); borda(x, h - 1); }
      for (let y = 0; y < h; y += pb) { borda(0, y); borda(w - 1, y); }
      const m = conta.indexOf(Math.max(...conta));
      if (conta[m] > conta.reduce((s, v) => s + v, 0) * 0.6) camiseta = m;
    }
    return { cores, camiseta };
  }

  /* ---------- separação ---------- */
  /**
   * @param o.cores    [{lab}] cores que serão impressas
   * @param o.camiseta lab da camiseta (ou null): pixels dessa cor não imprimem (vazado)
   * @param o.bordas   "suaves" (padrão: borda vira meia-tinta entre as duas cores) | "duras"
   * @param o.tolMistura distância máxima (ΔE) ao segmento entre duas cores para tratar como borda
   * @returns {{canais: Uint8Array[], foraDaPaleta: number}} foraDaPaleta = fração de pixels longe de todas as cores
   */
  function separar(px, w, h, o) {
    const N = w * h, cores = o.cores.map(c => c.lab), K = cores.length;
    const ref = o.camiseta ? [...cores, o.camiseta] : cores; // último = camiseta (não imprime)
    const R = ref.length, tolMix = o.tolMistura ?? 14, tolFora = o.tolFora ?? 25, duras = o.bordas === "duras";
    const canais = cores.map(() => new Uint8Array(N));
    const cache = new Map();
    let fora = 0;
    const d = new Float64Array(R);
    for (let i = 0; i < N; i++) {
      const al = px[i * 4 + 3];
      if (!al) continue;
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2], chave = (r << 16) | (g << 8) | b;
      let res = cache.get(chave);
      if (!res) {
        const p = rgb2lab(r, g, b);
        let i1 = 0, i2 = -1;
        for (let k = 0; k < R; k++) { d[k] = d2(p, ref[k]); if (d[k] < d[i1]) i1 = k; }
        for (let k = 0; k < R; k++) if (k !== i1 && (i2 < 0 || d[k] < d[i2])) i2 = k;
        let t1 = 1, erro = Math.sqrt(d[i1]);
        if (i2 >= 0) {
          const [t, resid] = projetar(p, ref[i2], ref[i1]); // t = quanto da cor i1
          if (resid < tolMix && resid < erro) { t1 = t; erro = resid; }
        }
        if (duras) t1 = t1 >= 0.5 ? 1 : 0;
        res = [i1, i2, t1, erro > tolFora ? 1 : 0];
        cache.set(chave, res);
      }
      const [i1, i2, t1, longe] = res;
      fora += longe;
      if (i1 < K) canais[i1][i] = Math.round(255 * t1 * al / 255);
      if (i2 >= 0 && i2 < K && t1 < 1) canais[i2][i] = Math.round(255 * (1 - t1) * al / 255);
    }
    return { canais, foraDaPaleta: fora / N };
  }

  /* ---------- base branca ---------- */
  // erosão em tons de cinza (mínimo numa janela quadrada 2r+1), separável
  function erodir(c, w, h, r) {
    if (r <= 0) return c.slice();
    const tmp = new Uint8Array(c.length), out = new Uint8Array(c.length);
    for (let y = 0; y < h; y++) {
      const o = y * w;
      for (let x = 0; x < w; x++) {
        let m = 255;
        for (let k = Math.max(0, x - r), e = Math.min(w - 1, x + r); k <= e && m; k++) if (c[o + k] < m) m = c[o + k];
        tmp[o + x] = m;
      }
    }
    for (let x = 0; x < w; x++) for (let y = 0; y < h; y++) {
      let m = 255;
      for (let k = Math.max(0, y - r), e = Math.min(h - 1, y + r); k <= e && m; k++) if (tmp[k * w + x] < m) m = tmp[k * w + x];
      out[y * w + x] = m;
    }
    return out;
  }
  /**
   * @param canais    canais das cores
   * @param o.usar    [true/false por canal] quais cores levam base (padrão: todas)
   * @param o.choke   retração em px (a base fica menor que a arte para não aparecer na borda)
   */
  function baseBranca(canais, w, h, o = {}) {
    const N = w * h, base = new Uint8Array(N);
    canais.forEach((c, k) => { if (o.usar && !o.usar[k]) return; for (let i = 0; i < N; i++) if (c[i] > base[i]) base[i] = c[i]; });
    return erodir(base, w, h, Math.round(o.choke || 0));
  }

  /* ---------- retícula (prévia) ---------- */
  /**
   * Retícula AM de ponto redondo. célula = dpi / lpi px, girada pelo ângulo.
   * @returns Uint8Array binário (0 ou 255)
   */
  function reticular(c, w, h, o = {}) {
    const cel = (o.dpi || 300) / (o.lpi || 45), ang = (o.angulo ?? 22.5) * Math.PI / 180;
    const cs = Math.cos(ang) / cel, sn = Math.sin(ang) / cel, out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const v = c[y * w + x] / 255;
      if (v <= 0) continue;
      if (v >= 1) { out[y * w + x] = 255; continue; }
      const u = x * cs + y * sn, t = -x * sn + y * cs;
      const s = (Math.cos(2 * Math.PI * u) + Math.cos(2 * Math.PI * t)) / 4 + 0.5;
      if (s > 1 - v) out[y * w + x] = 255;
    }
    return out;
  }

  /* ---------- prova de cor ---------- */
  /**
   * @param camadas [{canal, hex}] na ordem de impressão (base primeiro)
   * @returns Uint8ClampedArray RGBA opaco
   */
  function simular(camadas, w, h, camisetaHex) {
    const N = w * h, out = new Uint8ClampedArray(N * 4), [cr, cg, cb] = hex2rgb(camisetaHex || "#111111");
    const r = new Float32Array(N).fill(cr), g = new Float32Array(N).fill(cg), b = new Float32Array(N).fill(cb);
    for (const { canal, hex: hx } of camadas) {
      const [R, G, B] = hex2rgb(hx);
      for (let i = 0; i < N; i++) { const a = canal[i] / 255; if (!a) continue; r[i] += (R - r[i]) * a; g[i] += (G - g[i]) * a; b[i] += (B - b[i]) * a; }
    }
    for (let i = 0; i < N; i++) { out[i * 4] = r[i]; out[i * 4 + 1] = g[i]; out[i * 4 + 2] = b[i]; out[i * 4 + 3] = 255; }
    return out;
  }

  const cobertura = c => { let s = 0; for (let i = 0; i < c.length; i++) s += c[i]; return s / 255 / c.length; };

  return { paleta, separar, baseBranca, erodir, reticular, simular, cobertura, rgb2lab, lab2rgb, hex, hex2rgb, dE };
});
