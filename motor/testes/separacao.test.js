// Testes do motor de separação: node --test motor/testes
const test = require("node:test");
const assert = require("node:assert/strict");
const M = require("../separacao.js");

const PRETO = [17, 17, 17], VERMELHO = [210, 30, 40], AMARELO = [245, 200, 20];

// arte sintética com bordas suavizadas (supersampling 4×4):
// fundo preto, círculo vermelho (centro 100,100, raio 60), retângulo amarelo (180–260 × 50–150)
function arte(w = 300, h = 200, { transparente = false } = {}) {
  const px = new Uint8ClampedArray(w * h * 4);
  const cor = (x, y) => (x - 100) ** 2 + (y - 100) ** 2 <= 60 * 60 ? VERMELHO : x >= 180 && x < 260 && y >= 50 && y < 150 ? AMARELO : null;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) {
      const c = cor(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
      else if (!transparente) { r += PRETO[0]; g += PRETO[1]; b += PRETO[2]; a++; }
    }
    const i = (y * w + x) * 4;
    if (transparente) { // cor "pura" e alfa = cobertura
      if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
      px[i + 3] = Math.round(a / 16 * 255);
    } else { px[i] = r / 16; px[i + 1] = g / 16; px[i + 2] = b / 16; px[i + 3] = 255; }
  }
  return { px, w, h };
}
const perto = (rgb, hex, tol = 10) => M.dE(M.rgb2lab(...rgb), M.rgb2lab(...M.hex2rgb(hex))) < tol;
const areaCirculo = Math.PI * 60 * 60, areaRet = 80 * 100;

test("paleta encontra as 3 cores e sugere o preto como camiseta", () => {
  const { px, w, h } = arte();
  const { cores, camiseta } = M.paleta(px, w, h);
  assert.equal(cores.length, 3, "cores: " + cores.map(c => c.hex).join(", "));
  assert.ok(perto(PRETO, cores[camiseta].hex), "camiseta = preto");
  assert.ok(cores.some(c => perto(VERMELHO, c.hex)) && cores.some(c => perto(AMARELO, c.hex)));
});

test("detalhe pequeno e bem diferente (0,1% da arte) não some da paleta", () => {
  const { px, w, h } = arte();
  // quadrado azul 9×9 px = 0,135% da arte
  for (let y = 10; y < 19; y++) for (let x = 280; x < 289; x++) { const i = (y * w + x) * 4; px[i] = 40; px[i + 1] = 110; px[i + 2] = 220; }
  const { cores } = M.paleta(px, w, h);
  assert.ok(cores.some(c => perto([40, 110, 220], c.hex)), "azul presente: " + cores.map(c => c.hex).join(", "));
});

test("arte transparente: sem sugestão de camiseta, 2 cores", () => {
  const { px, w, h } = arte(300, 200, { transparente: true });
  const { cores, camiseta } = M.paleta(px, w, h);
  assert.equal(camiseta, -1);
  assert.equal(cores.length, 2);
});

test("separar: área de cada canal bate com a geometria e o preto vaza", () => {
  const { px, w, h } = arte();
  const { cores, camiseta } = M.paleta(px, w, h);
  const imprimir = cores.filter((_, i) => i !== camiseta);
  const { canais, foraDaPaleta } = M.separar(px, w, h, { cores: imprimir, camiseta: cores[camiseta].lab });
  assert.equal(canais.length, 2);
  const area = c => M.cobertura(c) * w * h;
  const iv = imprimir.findIndex(c => perto(VERMELHO, c.hex)), ia = 1 - iv;
  assert.ok(Math.abs(area(canais[iv]) - areaCirculo) / areaCirculo < 0.02, `vermelho ${area(canais[iv])} ≈ ${areaCirculo}`);
  assert.ok(Math.abs(area(canais[ia]) - areaRet) / areaRet < 0.02, `amarelo ${area(canais[ia])} ≈ ${areaRet}`);
  assert.equal(canais[iv][0], 0, "canto (camiseta) sem tinta");
  assert.equal(canais[iv][100 * w + 100], 255, "centro do círculo com tinta cheia");
  assert.ok(foraDaPaleta < 0.001);
  // borda suavizada: existem pixels de meia-tinta
  assert.ok(canais[iv].some(v => v > 30 && v < 225));
});

test("bordas automáticas: corte seco entre tintas, meia-tinta só contra a camiseta", () => {
  // degradê vermelho → amarelo (entre tintas) e vermelho → preto (contra a camiseta)
  const w = 200, h = 2, px = new Uint8ClampedArray(w * h * 4);
  for (let x = 0; x < w; x++) {
    const t = x / (w - 1), de = y => y === 0 ? AMARELO : PRETO;
    for (let y = 0; y < h; y++) { const c = de(y), i = (y * w + x) * 4; for (let k = 0; k < 3; k++) px[i + k] = VERMELHO[k] * (1 - t) + c[k] * t; px[i + 3] = 255; }
  }
  const cores = [{ lab: M.rgb2lab(...VERMELHO) }, { lab: M.rgb2lab(...AMARELO) }];
  const { canais } = M.separar(px, w, h, { cores, camiseta: M.rgb2lab(...PRETO) });
  const linha = (c, y) => [...c.subarray(y * w, y * w + w)];
  assert.ok(linha(canais[0], 0).every(v => v === 0 || v === 255), "vermelho × amarelo: sem meio-tom");
  assert.ok(linha(canais[0], 1).some(v => v > 40 && v < 215), "vermelho × camiseta: com meio-tom (glow)");
});

test("bordas duras: só 0 ou 255", () => {
  const { px, w, h } = arte();
  const { cores, camiseta } = M.paleta(px, w, h);
  const { canais } = M.separar(px, w, h, { cores: cores.filter((_, i) => i !== camiseta), camiseta: cores[camiseta].lab, bordas: "duras" });
  assert.ok(canais.every(c => c.every(v => v === 0 || v === 255)));
});

test("base branca: união das cores e retração (choke)", () => {
  const { px, w, h } = arte();
  const { cores, camiseta } = M.paleta(px, w, h);
  const { canais } = M.separar(px, w, h, { cores: cores.filter((_, i) => i !== camiseta), camiseta: cores[camiseta].lab });
  const sem = M.baseBranca(canais, w, h), com = M.baseBranca(canais, w, h, { choke: 2 });
  const A = c => M.cobertura(c) * w * h;
  assert.ok(Math.abs(A(sem) - (areaCirculo + areaRet)) / (areaCirculo + areaRet) < 0.02);
  assert.ok(A(com) < A(sem) * 0.97, "choke reduz a base");
  // na borda esquerda do círculo (x≈41) não há base com choke de 2 px
  assert.equal(com[100 * w + 41], 0);
  // só o amarelo leva base
  const iv = canais.findIndex(c => c[100 * w + 100] === 255);
  const soAmarelo = M.baseBranca(canais, w, h, { usar: canais.map((_, i) => i !== iv) });
  assert.equal(soAmarelo[100 * w + 100], 0);
});

test("retícula: a fração de pontos acompanha o tom", () => {
  const w = 300, h = 300;
  for (const tom of [0.1, 0.5, 0.8]) {
    const c = new Uint8Array(w * h).fill(Math.round(tom * 255));
    const r = M.reticular(c, w, h, { dpi: 300, lpi: 45, angulo: 22.5 });
    assert.ok(r.every(v => v === 0 || v === 255));
    assert.ok(Math.abs(M.cobertura(r) - tom) < 0.06, `tom ${tom}: ${M.cobertura(r).toFixed(3)}`);
  }
});

// arte com traço: círculo vermelho com contorno preto de 4 px, sobre fundo preto + gota amarela longe
function arteComTraco(w = 300, h = 200) {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const d = Math.hypot(x - 80, y - 100), i = (y * w + x) * 4;
    let c = PRETO;
    if (d < 50) c = VERMELHO; else if (d < 54) c = PRETO; // contorno (igual ao fundo!)
    if (Math.hypot(x - 250, y - 60) < 15) c = AMARELO;
    // risco preto atravessando o círculo (hachura dentro da arte)
    if (d < 50 && Math.abs(x - 80) < 2) c = PRETO;
    px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; px[i + 3] = 255;
  }
  return { px, w, h };
}

test("traço preto: preto dentro da arte imprime, fundo continua vazando", () => {
  const { px, w, h } = arteComTraco();
  const cores = [{ lab: M.rgb2lab(...VERMELHO) }, { lab: M.rgb2lab(...AMARELO) }];
  const sep = M.separar(px, w, h, { cores, camiseta: M.rgb2lab(...PRETO), bordas: "duras" });
  const traco = M.tracoPreto(sep.camiseta, sep.canais, w, h, { alcance: 6 });
  assert.equal(traco[100 * w + 80], 255, "risco dentro do círculo é traço");
  assert.equal(traco[100 * w + 28], 255, "contorno (x=28) é traço");
  assert.equal(traco[10 * w + 10], 0, "canto da camiseta vaza");
  assert.equal(traco[100 * w + 150], 0, "fundo longe da arte vaza");
});

test("trap: a cor avança por baixo do traço, mas não sobre o fundo", () => {
  const { px, w, h } = arteComTraco();
  const cores = [{ lab: M.rgb2lab(...VERMELHO) }, { lab: M.rgb2lab(...AMARELO) }];
  const sep = M.separar(px, w, h, { cores, camiseta: M.rgb2lab(...PRETO), bordas: "duras" });
  const traco = M.tracoPreto(sep.camiseta, sep.canais, w, h, { alcance: 6 });
  const [verm] = M.trap(sep.canais, traco, w, h, 2);
  assert.equal(sep.canais[0][100 * w + 80], 0, "sem trap, o risco abre buraco no vermelho");
  assert.equal(verm[100 * w + 80], 255, "com trap, o vermelho passa por baixo do risco");
  assert.equal(verm[100 * w + 28], 0, "contorno de 4 px: trap de 2 px não chega ao meio dele (x=28)");
  assert.equal(verm[100 * w + 150], 0, "não invade o fundo");
});

test("tipoTom, ordenar e agrupar", () => {
  const w = 100, h = 100, N = w * h;
  const chapado = new Uint8Array(N), degrade = new Uint8Array(N);
  for (let i = 0; i < N; i++) { const x = i % w; if (x < 30) chapado[i] = 255; degrade[i] = Math.round(x / w * 255); }
  assert.equal(M.tipoTom(chapado), "chapado");
  assert.equal(M.tipoTom(degrade), "degrade");
  const ord = M.ordenar([{ lab: [30, 0, 0], tom: "chapado" }, { lab: [90, 0, 0], tom: "chapado" }, { lab: [10, 0, 0], tom: "chapado", traco: true }, { lab: [60, 0, 0], tom: "degrade" }]);
  assert.deepEqual(ord, [1, 0, 3, 2], "claro → escuro → degradê → traço");
  // duas manchas separadas dividem tela; a faixa que passa por cima de uma delas não
  const a = new Uint8Array(N), b = new Uint8Array(N), c = new Uint8Array(N);
  for (let y = 0; y < 10; y++) for (let x = 0; x < 10; x++) { a[(y + 20) * w + x + 20] = 255; b[(y + 70) * w + x + 70] = 255; }
  for (let y = 22; y < 28; y++) for (let x = 0; x < w; x++) c[y * w + x] = 255;
  const g = M.agrupar([a, b, c], w, h, { margem: 5 });
  assert.deepEqual(g.map(x => x.join()).sort(), ["0,1", "2"]);
});

test("pipeline em faixas dá o mesmo resultado que a imagem inteira", () => {
  const { px, w, h } = arteComTraco();
  const o = { cores: [{ lab: M.rgb2lab(...VERMELHO) }, { lab: M.rgb2lab(...AMARELO) }], papeis: ["imprimir", "imprimir"], camiseta: M.rgb2lab(...PRETO),
    tracoCamiseta: true, alcancePx: 5, trapPx: 2, baseOn: true, base: [true, true], chokePx: 1 };
  const inteiro = M.pipeline(px, w, h, o);
  const s = M.sobra(o), faixa = 37;
  const junta = { canais: o.cores.map(() => new Uint8Array(w * h)), traco: new Uint8Array(w * h), base: new Uint8Array(w * h) };
  for (let y0 = 0; y0 < h; y0 += faixa) {
    const a = Math.max(0, y0 - s), b = Math.min(h, y0 + faixa + s), fh = b - a;
    const r = M.pipeline(px.subarray(a * w * 4, b * w * 4), w, fh, o);
    const de = (y0 - a) * w, ate = de + Math.min(faixa, h - y0) * w;
    r.canais.forEach((c, k) => junta.canais[k].set(c.subarray(de, ate), y0 * w));
    junta.traco.set(r.traco.subarray(de, ate), y0 * w); junta.base.set(r.base.subarray(de, ate), y0 * w);
  }
  assert.deepEqual(junta.canais, inteiro.canais);
  assert.deepEqual(junta.traco, inteiro.traco);
  assert.deepEqual(junta.base, inteiro.base);
});

test("limpar: some a meia-tinta fraca, fica a borda forte", () => {
  const c = new Uint8Array([0, 20, 60, 128, 255]);
  assert.deepEqual([...M.limpar(c, 0.3)], [0, 0, 0, 128, 255]);
  assert.deepEqual([...M.limpar(c, 0)], [...c]);
});

test("simular: base branca sob o vermelho sobre camiseta preta", () => {
  const w = 2, h = 1, cheio = new Uint8Array([255, 0]);
  const out = M.simular([{ canal: cheio, hex: "#ffffff" }, { canal: cheio, hex: "#d21e28" }], w, h, "#111111");
  assert.deepEqual([...out.slice(0, 4)], [210, 30, 40, 255]);
  assert.deepEqual([...out.slice(4, 8)], [17, 17, 17, 255]);
});
