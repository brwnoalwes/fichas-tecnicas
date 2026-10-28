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

test("simular: base branca sob o vermelho sobre camiseta preta", () => {
  const w = 2, h = 1, cheio = new Uint8Array([255, 0]);
  const out = M.simular([{ canal: cheio, hex: "#ffffff" }, { canal: cheio, hex: "#d21e28" }], w, h, "#111111");
  assert.deepEqual([...out.slice(0, 4)], [210, 30, 40, 255]);
  assert.deepEqual([...out.slice(4, 8)], [17, 17, 17, 255]);
});
