# Fichas Técnicas — estamparia

Página única (HTML, sem dependências) para a loja de camisetas de anime e serigrafia:

- **Mockup calibrado em cm**: foto da camiseta lisa + 3 pontos de calibração (axilas e gola). A estampa é posicionada em cm e mantém o tamanho real em todos os tamanhos (P a GG).
- **Ficha técnica**: cores e tintas na ordem de impressão, base branca, telas, malha, cura, etiquetas e embalagem.
- **Custo e preço**: camiseta lisa + tinta + telas ÷ tiragem + insumos + mão de obra → preço sugerido, lucro e margem.
- **Impressão A4** da ficha para a produção (com ou sem custos).

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

Depois de editar `src/fichas.template.html`, rode `node src/build.mjs` e faça commit dos dois arquivos.

## Próximas ideias

- Separação de cores (integração com o fluxo do Photoshop) para gerar fotolitos das telas
- Comparação lado a lado de todos os tamanhos e impressão 1:1 da estampa
- Mockup realista exportado em PNG para loja e Instagram
- Sincronizar o catálogo na nuvem para abrir no celular
