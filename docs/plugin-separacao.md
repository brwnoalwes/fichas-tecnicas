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

- **Plugin UXP** (formato atual da Adobe; CEP está sendo descontinuado). Photoshop 2026 (27.x).
  Manifest v5, painel em HTML/JS, operações do Photoshop via `batchPlay` e `imaging` API.
- **Motor de separação em JavaScript puro** (`motor/`), separado do Photoshop: recebe pixels RGBA e
  devolve os canais (0–255 de tinta) por cor. É a diferença principal em relação ao BBOXSTAMP, que
  encadeia comandos gravados do Photoshop:
  - parâmetros ajustáveis e salvos como **receitas** da loja;
  - testável fora do Photoshop (Node, imagens de teste, testes automatizados);
  - o mesmo motor pode rodar na ficha para pré-visualizar a separação no mockup.
- **Plugin = casca fina**: lê os pixels do documento, chama o motor, grava os canais de cor especial
  com a cor/fórmula certa, gera fotolitos e envia para a ficha (formato `ficha-photoshop` já existente).

## Perfil da loja (respostas de 28/10/2026)

- Artes: **mistura** de chapadas e ilustrações coloridas de anime.
- Camisetas: **escuras** na maioria → base branca em quase toda estampa; preto da arte pode ser vazado.
- Fotolitos: **jato de tinta + filme** → preto máximo, opção de espelhar, marcas de registro.
- Retícula: **em quase todas** as artes → entra já na Fase 1.

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
- Plugin: instalar pelo **UXP Developer Tool** (Creative Cloud → Apps → UXP Developer Tools)
  carregando a pasta do plugin; depois empacotar `.ccx` para instalar com duplo clique.
- Qualidade da separação: provas impressas na bancada; ajustes viram receitas salvas.

## Em aberto

- Modelo da impressora jato de tinta, tamanho máximo do filme e dpi de saída.
- Retícula usada hoje: LPI, ângulo e forma do ponto; malhas das telas.
