# Fichas Técnicas — estamparia

Página única (HTML, sem dependências) para a loja de camisetas de anime e serigrafia:

- **Mockup calibrado em cm**: foto da camiseta lisa + 3 pontos de calibração (axilas e gola). A estampa é posicionada em cm e mantém o tamanho real em todos os tamanhos (P a GG).
- **Ficha técnica**: cores e tintas na ordem de impressão, base branca, telas, malha, cura, etiquetas e embalagem.
- **Custo e preço**: camiseta lisa + tinta + telas ÷ tiragem + insumos + mão de obra → preço sugerido, lucro e margem.
- **Impressão A4** da ficha para a produção (com ou sem custos), com fotolitos de cada tela e o preparo de tintas em gramas.
- **Tintas e fórmulas** (aba Tintas): importa o JSON exportado pelo BBOXCOLOR (tintas base + calibrações). Cada cor da estampa pode ser ligada a uma fórmula; a ficha calcula quantos gramas de cada base pesar para a tiragem e o custo da tinta pela fórmula.
- **Calcular mistura** (aba Tintas, ou “Calcular mistura” em cada cor da estampa): a partir da cor alvo em Lab, testa combinações de até 2–4 tintas base com um modelo de mistura subtrativa (Kubelka-Munk simplificado por canal RGB linear), mostra as 3 melhores com ΔE e gramas, e salva como fórmula — já ligada à cor, quando aberto a partir dela. Previsão: sempre confirmar com prova impressa.
- **Do Photoshop**: o script `photoshop/Enviar para a ficha.jsx` lê os canais da arte já separada (ex.: pelo BBOXSTAMP) e gera um `.ficha.json`. Em Produtos → Estampas → “+ Do Photoshop” a ficha cria a estampa com o tamanho real em cm, uma cor por canal (ligada à fórmula mais próxima, ΔE < 6), base branca e as miniaturas dos fotolitos.

## Script do Photoshop

1. Copie `photoshop/Enviar para a ficha.jsx` para a pasta `Presets\Scripts` do Photoshop (ex.: `C:\Program Files\Adobe\Adobe Photoshop 2020\Presets\Scripts`) e reinicie — ou use **Arquivo → Scripts → Procurar…**.
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
| `motor/separacao.js` | Motor de separação de cores (paleta, canais, base branca, retícula, prova) — JS puro |
| `motor/testes/` | Testes do motor: `npm test` |
| `separacao.html` | Página de teste do motor: carregue uma arte e veja paleta, telas e prova de cor |
| `docs/plugin-separacao.md` | Plano da extensão própria de separação para o Photoshop 2020 |
| `extensao/` | Extensão “Separacao Estamparia” (CEP, Photoshop 2020+): painel + `jsx/host.jsx` |

## Extensão de separação (Photoshop 2020)

1. Instalar/atualizar: `powershell -ExecutionPolicy Bypass -File extensao\instalar.ps1` (copia para
   `%APPDATA%\Adobe\CEP\extensions\com.estamparia.separacao`, junto com o motor).
2. Abrir o Photoshop → **Janela → Extensões → Separacao Estamparia**.
3. Com a arte aberta: **Ler a arte** → (opcional) selecionar áreas no Photoshop e **+ Região da
   seleção** — cada região (Pele, Cabelo, Crânios…) ganha tintas próprias → ajustar
   paleta/nomes/papéis → **Criar canais no PSD** (um canal de cor especial por tela, na ordem de
   impressão, + “Camiseta (previa)”) → **Gerar fotolitos (PDF)** (pasta “Fotolitos - …” ao lado do
   PSD; sempre 1 bit e **misto**: dentro da mesma tela, o sólido sai chapado e glow/esfumado/passagens
   entre cores saem reticulados — retícula feita pela extensão na resolução de saída, com ponto
   mínimo/máximo e modo por tela Auto/Chapado/Retícula; marcas de registro e título;
   cores que não se encostam podem dividir a folha — uma tela por cor, sempre) → **Enviar para a ficha**.
   A prévia simula a estampa (fotolitos nas cores das tintas sobre a camiseta); **Ver prova estampada**
   abre essa simulação em tamanho real, com os pontos de retícula, numa aba do Photoshop.
4. Erros do painel: depuração remota em `http://localhost:8099` com o Photoshop aberto.

Fora do Photoshop, `extensao/index.html` abre em modo de teste (copie `motor/separacao.js` para
`extensao/js/motor.js`).

Depois de editar `src/fichas.template.html`, rode `node src/build.mjs` e faça commit dos dois arquivos.

## Próximas ideias

- Comparação lado a lado de todos os tamanhos e impressão 1:1 da estampa
- Mockup realista exportado em PNG para loja e Instagram
- Sincronizar o catálogo na nuvem para abrir no celular
