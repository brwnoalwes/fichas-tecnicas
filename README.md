# Fichas Técnicas — estamparia

Página única (HTML, sem dependências) para a loja de camisetas de anime e serigrafia:

- **Mockup calibrado em cm**: foto da camiseta lisa + 3 pontos de calibração (axilas e gola). A estampa é posicionada em cm e mantém o tamanho real em todos os tamanhos (P a GG).
- **Ficha técnica**: cores e tintas na ordem de impressão, base branca, telas, malha, cura, etiquetas e embalagem.
- **Custo e preço**: camiseta lisa + tinta + telas ÷ tiragem + insumos + mão de obra → preço sugerido, lucro e margem.
- **Impressão A4** da ficha para a produção (com ou sem custos), com fotolitos de cada tela e o preparo de tintas em gramas.
- **Tintas e fórmulas** (aba Tintas): importa o JSON exportado pelo BBOXCOLOR (tintas base + calibrações). Cada cor da estampa pode ser ligada a uma fórmula; a ficha calcula quantos gramas de cada base pesar para a tiragem e o custo da tinta pela fórmula.
- **Do Photoshop**: o script `photoshop/Enviar para a ficha.jsx` lê os canais da arte já separada (ex.: pelo BBOXSTAMP) e gera um `.ficha.json`. Em Produtos → Estampas → “+ Do Photoshop” a ficha cria a estampa com o tamanho real em cm, uma cor por canal (ligada à fórmula mais próxima, ΔE < 6), base branca e as miniaturas dos fotolitos.

## Script do Photoshop

1. Copie `photoshop/Enviar para a ficha.jsx` para a pasta `Presets\Scripts` do Photoshop (ex.: `C:\Program Files\Adobe\Adobe Photoshop 2025\Presets\Scripts`) e reinicie — ou use **Arquivo → Scripts → Procurar…**.
2. Com a arte separada aberta, rode **Arquivo → Scripts → Enviar para a ficha** e salve o `.ficha.json`.
3. Na ficha: **Produtos → Estampas → + Do Photoshop**.

Convenções: canal de cor especial = preto é tinta; canal alfa = branco é tinta. Canais com “base” e “branca” no nome viram a base branca; canais com “camiseta” no nome são ignorados.

## Como usar

Abra o `index.html` no Chrome ou no Edge (ou pelo link do GitHub Pages).
Os dados ficam no navegador; em **Arquivo → Salvar em um arquivo…** escolha um `.json` (por exemplo, no Google Drive) e a página passa a salvar nele automaticamente. Use **Baixar backup** de vez em quando.

## Estrutura

| Arquivo | O que é |
|---|---|
| `index.html` | A página pronta (gerada — não edite à mão) |
| `src/fichas.template.html` | Código-fonte da página |
| `src/costas.jpg`, `src/frente.jpg` | Fotos do mockup de exemplo, embutidas no `index.html` |
| `src/build.mjs` | Gera o `index.html`: `node src/build.mjs` |
| `photoshop/Enviar para a ficha.jsx` | Script do Photoshop que exporta os canais separados para a ficha |

Depois de editar `src/fichas.template.html`, rode `node src/build.mjs` e faça commit dos dois arquivos.

## Próximas ideias

- Comparação lado a lado de todos os tamanhos e impressão 1:1 da estampa
- Mockup realista exportado em PNG para loja e Instagram
- Sincronizar o catálogo na nuvem para abrir no celular
