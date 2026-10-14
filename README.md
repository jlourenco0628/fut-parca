# Fut Parça

Sua turma. Sua pelada.

Versão 0.3: aplicativo web responsivo, com contas, turmas e funções reais. A demonstração inicial tem 15 atletas, três equipes e jogos fictícios. Ao criar uma conta e uma turma, você começa com seu próprio perfil e dados separados da demonstração.

## Abrir o app

Execute `Iniciar-Fut-Parca.cmd` nesta pasta e abra **http://127.0.0.1:4173/**. O app também está aberto no navegador do Codex durante esta sessão. O servidor precisa continuar em execução para abrir a interface e gerar PDFs.

Alternativamente, com Node.js disponível: `npm start`. Não é necessário instalar pacotes Node. A geração do PDF usa Python com `reportlab` e `pypdf`; o runtime desta máquina já inclui essas bibliotecas. Em outro computador, configure `FUT_PARCA_PYTHON` com o caminho de seu Python e instale essas duas bibliotecas.

## Funções desta versão

- Contas com entrada por e-mail e senha, criação de turmas e código de convite. O organizador gerencia a pelada; cada membro edita seu próprio perfil e suas escalações abertas. A exclusão da conta exige a senha, remove as sessões e os dados pessoais e preserva históricos somente com um atleta anonimizado.
- Cards dourados com nota geral, posição, bandeira, símbolo Fut Parça, retrato e seis atributos. Nome e foto têm espaços separados; os números ficam maiores e contidos dentro do escudo. Layout em SVG/CSS inspirado na composição de itens dourados do EA SPORTS FC, com giro de entrada, inclinação 3D e brilho no mouse ou toque. O movimento é reduzido conforme a preferência de acessibilidade do dispositivo. Referência visual: [tipos de item oficiais do EA SPORTS FC](https://help.ea.com/en/articles/ea-sports-fc/fc-25/items/).
- Logo enviada pelo criador (`logo-fut-parca.jpeg`) aplicada na navegação, no card e no ícone do app. Na interface, o fundo escuro da imagem é neutralizado, a cor se alinha ao verde do app e o símbolo no card usa a versão escura, sem alterar o arquivo original. Tipografia nativa de interfaces móveis e alternância entre tema claro e escuro. A escolha do tema fica salva neste navegador.
- Instalação como PWA em navegadores compatíveis, com ícones próprios para Android e iPhone e cache da interface. O servidor continua necessário para contas, sincronização e PDFs; o cache não substitui a conexão durante uma pelada.
- Perfil com nome, apelido, contato, foto enviada ou capturada na câmera e preferências de posição por futebol, futsal e society. Os retratos de exemplo são ilustrações próprias.
- Cadastro de peladas, nomes de equipe editáveis, sorteio aleatório ou equilibrado pelo overall dos cards e criação dos confrontos entre todas as equipes. Os capitães são sorteados entre os atletas de cada time, e o card do capitão passa a ser a logo da equipe.
- Súmula por jogo, com gols, assistências, interceptações, desarmes, defesas, defesas de pênalti e erros. Gols contra entram no placar do adversário. Um gol registrado aciona uma celebração animada com o artilheiro e o placar atualizado.
- Fantasy com escalação aberta antes do início; exatamente um goleiro e 5 atletas no futsal, 7 no society ou 11 no futebol. O início trava as escalações.
- Rankings da rodada e da temporada por modalidade, com empates compartilhando a posição.
- Fechamento exige todos os jogos finalizados ou cancelados. As skills evoluem até 1 ponto por atributo na pelada encerrada, em uma escala de 1 a 99. A ausência de uma ação não reduz a skill.
- PDF dinâmico com resultados dos jogos, artilheiros, assistentes, goleiros com mais defesas, rankings individuais, fantasy e temporada. Todos os líderes empatados aparecem nos destaques.
- Correção da súmula reabre a rodada, preserva as escalações e recalcula o resultado ao fechar novamente. A revisão aumenta sem duplicar evolução ou pontos.
- Exportação de backup em JSON pelo botão de download no topo.

## Experimentar o fluxo

1. Explore **Atletas** para ver os cards da demonstração ou clique em **Entrar na turma** e **Criar minha conta** para começar com seus dados.
2. Em **Peladas**, escolha a rodada em andamento e registre um lance. O placar e os pontos são recalculados imediatamente.
3. Finalize o terceiro jogo pelo seletor de estado. Clique em **Fechar pelada e gerar PDF**.
4. Confira a temporada em **Ranking** e as escalações em **Liga dos Parças**.
5. Em sua conta, crie uma turma e use o código de convite para reunir os atletas. O organizador também pode adicionar perfis. Crie uma nova pelada, escolha **Sortear times** e o modo aleatório ou equilibrado, depois use **Sortear capitães**. Confira equipes e goleiros, monte o fantasy e clique em **Começar pelada**.

## Regras de pontuação

| Lance | Pontos |
|---|---:|
| Gol | +6 |
| Assistência | +4 |
| Interceptação com posse | +1 |
| Desarme com posse | +1 |
| Defesa | +1,5 |
| Defesa de pênalti | +6 |
| Chance clara perdida | -1 |
| Pênalti perdido | -3 |
| Passe errado | -1 |
| Falha que causou gol | -3 |
| Gol contra | -3 |
| Cartão amarelo | -1 |
| Cartão vermelho | -3 |

Cada ação deve ser registrada uma vez. Uma recuperação é interceptação ou desarme; uma defesa de pênalti substitui a defesa comum. O fechamento valida que as assistências de cada equipe não ultrapassam seus gols próprios no jogo. O organizador revisa a correspondência dos lances na súmula.

As posições exercidas ficam registradas por rodada, de modo que uma alteração posterior de preferência no perfil não modifica os resultados históricos. As skills usam apenas os jogos finalizados. Ritmo, controle e físico permanecem na avaliação inicial nesta versão; não são inferidos de gols.

## Armazenamento e próxima etapa

A demonstração fica no `localStorage` deste navegador. Os dados das contas e turmas ficam no servidor local, em `../../work/fut-parca.sqlite`, usando SQLite no runtime desta máquina. O armazenamento possui alternativa em JSON atômico quando SQLite não está disponível. `FUT_PARCA_DATA_PATH` permite configurar outro caminho. A sessão usa um cookie; senhas são armazenadas como hashes, com salt individual.

As turmas ficam separadas e os dados são atualizados periodicamente entre sessões conectadas ao mesmo servidor. Alterações concorrentes são detectadas para evitar sobrescrever o trabalho de outro parça. O PDF de uma conta usa o fechamento salvo no servidor.

Por padrão, o servidor escuta apenas neste computador. A configuração de hospedagem está preparada em `Dockerfile` e `render.yaml`; veja [PUBLICACAO.md](PUBLICACAO.md) para colocar o app online e entender a etapa seguinte das lojas. Nenhum e-mail ou mensagem é enviado. Recuperação de senha por e-mail e notificações ainda não fazem parte desta versão. A câmera exige autorização do navegador e um contexto permitido; se indisponível, a foto pode ser enviada.

## Estrutura

`app.js`: telas e interações. `domain.mjs`: regras, skills, fantasy e rankings. `seed.mjs`: dados fictícios. `card.mjs` e `card.css`: card. `account_client.mjs`: sessões e atualização de dados. `accounts.mjs`: contas, turmas, persistência e permissões. `server.mjs`: servidor local e APIs. `pdf_report.py`: geração de PDF com paginação. A pasta `tests/` contém os testes, executados com `npm test`.
