# Plugin de separação de cores — plano

Uso interno da loja. Objetivo: substituir o fluxo BBOXSTAMP + BBOXCOLOR por uma ferramenta nossa,
integrada à ficha técnica: **arte → separação → telas/fotolitos → fórmulas → ficha → custo**.

## Regra de ouro

Feito do zero. Não copiar código, receitas (valores de ajustes), imagens nem a tabela de tintas das
extensões da Black Box Stamp — a licença permite usar, não reproduzir. Técnicas de pré-impressão
(Intervalo de cores, canais de cor especial, base branca, retícula, processo simulado) são de domínio
comum e podem ser implementadas por nós. O `.json` de tintas extraído do BBOXCOLOR fica só no PC
(o `.gitignore` bloqueia `*.json`).

## Arquitetura

Alvo: **Photoshop 2020 (v21.0)**, o que a loja usa. Plugins UXP só existem a partir do Photoshop 2021
(v22), então o plugin é uma **extensão CEP** (painel HTML/JS, CSXS 9) + **ExtendScript** (`.jsx`),
o mesmo formato do BBOXSTAMP. Deve funcionar também nas versões mais novas (manifest com faixa
`[21.0,99.9]`). O `PlayerDebugMode` já está ligado no PC (CSXS 8–12), então a extensão sem
assinatura carrega direto da pasta `%APPDATA%\Adobe\CEP\extensions`.

- **Painel CEP**: interface, receitas e o motor rodam no navegador embutido (Chromium do CEP, com
  Node.js habilitado para ler/gravar arquivos temporários).
- **ExtendScript**: só o que exige o Photoshop — exportar os pixels da arte para um PNG temporário,
  criar canais de cor especial a partir das máscaras que o motor devolve, converter canais em
  retícula com o meio-tom nativo do Photoshop (Bitmap → Halftone Screen), gerar e salvar fotolitos.
  Fluxo de pixels: Photoshop → PNG temporário → motor (canvas) → PNGs de máscara → Photoshop.
- **Motor de separação em JavaScript puro** (`motor/`), separado do Photoshop: recebe pixels RGBA e
  devolve os canais (0–255 de tinta) por cor. É a diferença principal em relação ao BBOXSTAMP, que
  encadeia comandos gravados do Photoshop:
  - parâmetros ajustáveis e salvos como **receitas** da loja;
  - testável fora do Photoshop (Node, imagens de teste, testes automatizados);
  - o mesmo motor pode rodar na ficha para pré-visualizar a separação no mockup.
- **Extensão = casca fina**: lê os pixels do documento, chama o motor, grava os canais de cor especial
  com a cor/fórmula certa, gera fotolitos e envia para a ficha (formato `ficha-photoshop` já existente).

## Perfil da loja (respostas de 28/10/2026)

- Artes: **mistura** de chapadas e ilustrações coloridas de anime.
- Camisetas: **escuras** na maioria → base branca em quase toda estampa; preto da arte pode ser vazado.
- Fotolitos: **jato de tinta + filme** → preto máximo, opção de espelhar, marcas de registro.
- Retícula: **em quase todas** as artes → entra já na Fase 1.

## Método de referência: separação do Sukuna (Forja Limitada, 06/2026)

Análise do PSD separado à mão no Photoshop 2020 (3898 × 5512 px, 300 dpi, 33 × 46,7 cm, RGB):

- **18 canais de cor especial, uma tinta por região e tom**: cabelo rosa 1–2, amarelo, pele 1–2,
  roxo 1–2, branco (realce), **sombra 1–6**, vermelho, preto, glow, ouro + supercristal; mais um canal
  "Camiseta" (preto) só para a prova na tela. Sombras e meios-tons são **tintas próprias**, não
  retícula — é daí que vem a fidelidade.
- **Canais chapados**: 99% dos pixels são 0 ou 255, com borda suavizada. Só o **#17 Glow** é
  degradê (88%) e só ele foi reticulado (fotolito exportado a 900 dpi; os outros a 300 dpi).
- **#16 Preto 1 é traço impresso por cima** (contorno + hachura, 20,7% da área), não vazado.
- **Fotolito compartilhado (economia de filme)**: cores que não se tocam saem na mesma folha
  ("#01 #02 #04 #05", "#09 #18"). **Uma tela, uma cor, sempre**: a folha é gravada uma vez em cada
  tela, bloqueando as outras áreas. Duas cores na mesma tela é inviável (limpar e trocar a tinta a
  cada passada).
- **Marcas de registro e número da tela** em todos os canais; ordem de impressão = numeração.
- Nesta versão não há canal de base branca (a versão anterior, de 8 telas, tinha "01_BASE BRANCA").

Levado para o motor (`motor/separacao.js`) e para `separacao.html`: paleta de até 24 tintas,
bordas "automáticas" (corte seco entre tintas, degradê só contra a camiseta), traço preto por cima
com trap, retícula só nas telas em degradê, ordem claro → escuro → degradê → traço, e sugestão de
cores que dividem a folha de fotolito. Separação por **região** (seleção no Photoshop, uma paleta
por região — "Pele" × "Amarelo dos crânios" com tons parecidos viram tintas diferentes) é feita na
extensão.

## Gabarito de registro da loja

`Serigrafia\Gabarito 33x46,67.pdf`: página do tamanho da arte (33 × 46,67 cm) com uma grade de 23
símbolos únicos (♠ ♥ ♦ ♣ ♪ ♫ ☼ θ ☺ ◊ □ ▲ ╬ † # Δ ₳ @ $ % & [] =), cada um ao lado de uma cruz, em 5
colunas (2 à esquerda, cruzes no centro, 2 à direita) + cantoneiras e barra de centro (linhas). No
PDF: uma imagem JPEG em x 41,08 pt, y 4,19 pt, 853,5 × 1314,9 pt, e 12 linhas.

Uso: o gabarito é o fundo de todos os canais; em cada canal o separador copia os pares símbolo+cruz
próximos da arte. O gabarito impresso fica fixo no berço: o fotolito encaixa nos símbolos na gravação
e no registro das cores — por isso várias cores podem dividir a mesma folha de fotolito.

Na extensão: fotolito **1:1** com a arte (sem margem, cruzes ou título da extensão no modo canais) e
**marcas automáticas**: `lerMarcasGabarito` acha os 92 pares símbolo+cruz (23 linhas × 4) e as 23
cruzes do meio; `escolherMarcas` dá a cada cor o par mais perto da arte em cada canto (4, ou 2 em
cantos opostos), sem encostar em tinta da folha e sem repetir símbolo entre cores da mesma folha; os
pixels do gabarito desses pares são gravados no fotolito. A lista de telas mostra os símbolos de cada
cor. Marcas que o separador já colocou nos canais ficam como estão (a escolha desvia delas).
- Corte de ponto mínimo/máximo na retícula e tira de teste de retícula.

## Fases

### Fase 1 — separação chapada + base + retícula + fotolitos (MVP)
1. **Preparar arquivo**: área A4/A3/A3+ na resolução de fotolito, posicionar a arte, tamanho em cm
   vindo da ficha (opcional).
2. **Paleta automática**: detecta as cores sólidas da arte (k-means em amostra reduzida), você
   confirma/junta/remove cores e escolhe a cor da camiseta.
3. **Canais**: um canal de cor especial por cor, com tolerância e suavização de borda ajustáveis;
   cor da camiseta vira "não imprime" (vazado).
4. **Base branca automática**: união das cores sobre camiseta escura, com retração (choke) em px
   ajustável para não aparecer nas bordas.
5. **Retícula** por canal: LPI, ângulo e forma do ponto (redondo/elíptico), com tira de teste.
6. **Fotolitos para jato de tinta + filme**: cada tela em preto máximo (bitmap da retícula),
   marcas de registro, nome da cor e do produto, opção de espelhar; exporta TIFF/PDF.
7. **Enviar para a ficha**: mesmo `.ficha.json` do script atual (compatível com "+ Do Photoshop").

### Fase 2 — processo simulado (ilustrações coloridas)
- Canais por faixa de cor + cinzas + realce branco (highlight white) + base, para personagens com
  degradê e sombras, com receitas calibradas por provas impressas.

### Fase 3 — integração viva com a ficha
- Plugin lê o catálogo da ficha (fórmulas e tintas base) e sugere a fórmula de cada canal (ΔE).
- Ficha mostra a prova de cor simulada no mockup e calcula tintas/custo automaticamente.

## Como testar

- Motor: `node` com imagens de teste em `motor/testes/` (sem Photoshop).
- Extensão: copiar a pasta para `%APPDATA%\Adobe\CEP\extensions\` e reiniciar o Photoshop 2020;
  aparece em **Janela → Extensões**. Erros do painel: depuração remota do CEP via arquivo `.debug`.
- Qualidade da separação: provas impressas na bancada; ajustes viram receitas salvas.

## Em aberto

- Modelo da impressora jato de tinta, tamanho máximo do filme e dpi de saída.
- Retícula usada hoje: LPI, ângulo e forma do ponto; malhas das telas.
