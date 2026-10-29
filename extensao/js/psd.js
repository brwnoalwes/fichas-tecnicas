// Leitor de PSD/PSB (8 bits, RGB) para o painel: lê os canais extras (cor especial/alfa) direto do
// arquivo salvo, sem copiar canal por canal no Photoshop (≈20 s cada). Também devolve a imagem
// composta (para a prévia). Node 8 / ES2017. Valores dos canais como no arquivo: 0 = tinta.
"use strict";
(function (raiz) {
  // cor do canal no recurso 1077 (DisplayInfo): espaço 0 RGB, 1 HSB, 2 CMYK, 7 Lab, 8 cinza
  function corParaRGB(esp, v) {
    const c = x => Math.max(0, Math.min(255, Math.round(x)));
    if (esp === 0) return [v[0] / 257, v[1] / 257, v[2] / 257].map(c);
    if (esp === 1) {
      const H = v[0] / 65535 * 360, S = v[1] / 65535, V = v[2] / 65535;
      const f = n => { const k = (n + H / 60) % 6; return V - V * S * Math.max(0, Math.min(k, 4 - k, 1)); };
      return [f(5), f(3), f(1)].map(x => c(x * 255));
    }
    if (esp === 2) { const [C, Mg, Y, K] = v.map(x => 1 - x / 65535); return [255 * (1 - C) * (1 - K), 255 * (1 - Mg) * (1 - K), 255 * (1 - Y) * (1 - K)].map(c); }
    if (esp === 7) {
      const s = x => x > 32767 ? x - 65536 : x, L = v[0] / 100, a = s(v[1]) / 100, b = s(v[2]) / 100;
      return raiz.MotorSeparacao.lab2rgb(L, a, b);
    }
    if (esp === 8) { const g = c(255 - v[0] / 10000 * 255); return [g, g, g]; }
    return [128, 128, 128];
  }
  const hex = rgb => "#" + rgb.map(x => x.toString(16).padStart(2, "0")).join("");

  /**
   * @param fs, Buf   módulos do Node (fs, Buffer)
   * @param salvarRaw (indice, nome) => caminho do .raw a gravar para o canal extra
   * @param progresso (texto) => Promise (para a interface respirar)
   * @returns {W, H, dpi, rgba (Uint8ClampedArray do composto), canais:[{nome, tipo, hex, lab, raw, solidez}]}
   */
  async function lerPSD(fs, Buf, arquivo, salvarRaw, progresso) {
    const fd = fs.openSync(arquivo, "r");
    try {
      let pos = 0;
      const ler = n => { const b = Buf.alloc(n); fs.readSync(fd, b, 0, n, pos); pos += n; return b; };
      const u8 = () => ler(1)[0], u16 = () => ler(2).readUInt16BE(0), u32 = () => ler(4).readUInt32BE(0);
      if (ler(4).toString("latin1") !== "8BPS") throw new Error("não é um arquivo PSD");
      const versao = u16(); ler(6);
      const nC = u16(), H = u32(), W = u32(), prof = u16(), modo = u16();
      if (prof !== 8) throw new Error("o PSD precisa estar em 8 bits por canal");
      if (modo !== 3) throw new Error("o PSD precisa estar em RGB");
      const lenModo = u32(); pos += lenModo; // dados de modo de cor (ler o tamanho ANTES de somar)
      const fimRes = (() => { const n = u32(); return pos + n; })();
      let dpi = 300; const nomes = [], nomesU = [], info = [];
      while (pos < fimRes) {
        if (ler(4).toString("latin1") !== "8BIM") break;
        const id = u16(), nl = u8(); ler(nl); if ((nl + 1) % 2) ler(1);
        const sz = u32(), ini = pos;
        if (id === 1005) dpi = Math.round(u32() / 65536);
        if (id === 1006) while (pos < ini + sz) { const l = u8(); nomes.push(ler(l).toString("latin1")); }
        if (id === 1045) while (pos < ini + sz) { const l = u32(), b = ler(l * 2); let s = ""; for (let i = 0; i < l; i++) s += String.fromCharCode(b.readUInt16BE(i * 2)); nomesU.push(s.replace(/\0+$/, "")); }
        if (id === 1077) { u32(); while (pos + 13 <= ini + sz) { const esp = u16(), v = [u16(), u16(), u16(), u16()], sol = u16(), tipo = u8(); info.push({ esp, v, sol, tipo }); } }
        pos = ini + sz + (sz % 2);
      }
      pos = fimRes;
      const lenCM = versao === 2 ? u32() * 4294967296 + u32() : u32(); pos += lenCM; // camadas e máscaras
      const comp = u16();
      if (comp !== 0 && comp !== 1) throw new Error("compressão do PSD não suportada (salve sem compressão ZIP)");
      const extras = Math.max(nomesU.length, nomes.length), base = nC - extras;
      // tamanho de cada linha de cada canal
      let contagens = null;
      if (comp === 1) {
        const bc = versao === 2 ? 4 : 2, b = ler(nC * H * bc);
        contagens = new Uint32Array(nC * H);
        for (let i = 0; i < nC * H; i++) contagens[i] = bc === 2 ? b.readUInt16BE(i * 2) : b.readUInt32BE(i * 4);
      }
      const inicioDados = pos, inicioCanal = [];
      let p = inicioDados;
      for (let c = 0; c < nC; c++) {
        inicioCanal.push(p);
        if (comp === 1) { let s = 0; for (let y = 0; y < H; y++) s += contagens[c * H + y]; p += s; } else p += W * H;
      }
      // decodifica um canal inteiro (PackBits por linha)
      function canal(c) {
        const out = Buf.alloc(W * H);
        if (comp === 0) { fs.readSync(fd, out, 0, W * H, inicioCanal[c]); return out; }
        let tam = 0; for (let y = 0; y < H; y++) tam += contagens[c * H + y];
        const src = Buf.alloc(tam); fs.readSync(fd, src, 0, tam, inicioCanal[c]);
        let i = 0;
        for (let y = 0; y < H; y++) {
          const fim = i + contagens[c * H + y]; let o = y * W; const lim = o + W;
          while (i < fim && o < lim) {
            let k = src[i++]; if (k > 127) k -= 256;
            if (k >= 0) { src.copy(out, o, i, i + k + 1); i += k + 1; o += k + 1; }
            else if (k > -128) { out.fill(src[i++], o, o + 1 - k); o += 1 - k; }
          }
          i = fim;
        }
        return out;
      }
      const lista = [];
      for (let e = 0; e < extras; e++) {
        const c = base + e, nome = nomesU[e] || nomes[e] || "Canal " + (e + 1), di = info[e];
        const tipo = di ? (di.tipo === 2 ? "spot" : di.tipo === 1 ? "mascara" : "selecao") : "selecao";
        let rgb = di ? corParaRGB(di.esp, di.v) : [128, 128, 128];
        const item = { nome, tipo, hex: hex(rgb), lab: raiz.MotorSeparacao.rgb2lab(rgb[0], rgb[1], rgb[2]), solidez: di ? di.sol : 100 };
        const destino = salvarRaw(e, nome, tipo);
        if (destino) {
          await progresso(`Lendo canal ${e + 1} de ${extras}: ${nome}`);
          fs.writeFileSync(destino, canal(c));
          item.raw = destino;
        }
        lista.push(item);
      }
      // composto RGB (para a prévia e a prova)
      await progresso("Lendo a imagem composta…");
      const rgba = new Uint8ClampedArray(W * H * 4);
      for (let k = 0; k < 3; k++) { const ch = canal(k); for (let i = 0; i < W * H; i++) rgba[i * 4 + k] = ch[i]; }
      for (let i = 0; i < W * H; i++) rgba[i * 4 + 3] = 255;
      return { W, H, dpi, rgba, canais: lista };
    } finally { fs.closeSync(fd); }
  }
  raiz.lerPSD = lerPSD;
})(typeof window !== "undefined" ? window : this);
