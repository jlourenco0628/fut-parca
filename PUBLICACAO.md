# Publicar o Fut Parça

O app ainda está aberto somente neste computador. A primeira publicação recomendada é a versão web: ela permite testar o mesmo cadastro, as peladas e os PDFs em celulares Android e iPhone antes de enviar pacotes às lojas.

## 1. Colocar a versão web online

1. Crie uma conta no [GitHub](https://github.com/) e coloque **o conteúdo desta pasta** em um repositório privado. Não inclua o banco SQLite, backups ou dados reais de atletas. O arquivo `render.yaml` precisa ficar na raiz desse repositório.
2. Crie uma conta na [Render](https://dashboard.render.com/) e conecte esse repositório em **New > Blueprint**. Confira os valores mostrados antes de aceitar: `render.yaml` solicita um serviço **pago** e disco persistente de 1 GB. Um servidor gratuito sem disco perderia contas e peladas quando reiniciasse. O endereço `https://...onrender.com` e HTTPS são oferecidos pela hospedagem; não é preciso comprar domínio para testar.
3. Após a publicação, abra `/api/health` no endereço recebido e confirme `{"ok":true}`. Abra o app, crie uma conta de teste, entre novamente em outro aparelho e gere um PDF de uma pelada fechada. Faça um backup de teste.
   Em Android/Chrome, o botão **Instalar** aparece quando o navegador libera a instalação. No iPhone/Safari, use **Compartilhar > Adicionar à Tela de Início**.
4. Guarde o acesso à hospedagem e faça cópias periódicas dos dados. O banco é gravado em `/var/data/fut-parca.sqlite`; somente essa pasta está no disco persistente. A primeira versão usa uma única instância, adequada a um piloto pequeno.

O servidor lê automaticamente a URL HTTPS da Render, aceita as requisições dessa origem, usa cookie `Secure` e lê a porta fornecida pela hospedagem. Se escolher outro provedor, configure `FUT_PARCA_PUBLIC_ORIGIN` com a URL HTTPS exata e `FUT_PARCA_DATA_PATH` com um caminho absoluto em armazenamento persistente. Para tráfego atrás de um proxy confiável, configure `FUT_PARCA_TRUST_PROXY=1`.

## 2. Preparar as lojas

- **Google Play:** abra uma conta no [Play Console](https://play.google.com/console/about/) e conclua a verificação. A taxa de cadastro informada pelo Google é de **US$ 25, uma vez**. Contas pessoais novas precisam cumprir o teste fechado exigido pelo Google antes do lançamento público; atualmente são **12 testadores por 14 dias consecutivos**.
- **App Store:** entre no [Apple Developer Program](https://developer.apple.com/programs/enroll/) e conclua a verificação. A associação custa **US$ 99 por ano** (ou valor local). A publicação passa pelo App Store Connect e pelo TestFlight.
- A exclusão autenticada da conta já está disponível dentro do app, e `excluir-conta.html` é a página pública que explica o processo. Antes da submissão, ainda precisamos publicar uma política de privacidade com um contato real, preencher os formulários de dados das lojas e oferecer recuperação de senha por e-mail.
- Para o aplicativo instalável, usaremos uma camada móvel como [Capacitor](https://capacitorjs.com/docs) ligada ao servidor online. O Android será enviado como pacote **AAB** assinado. O iPhone precisará de compilação iOS (Mac/Xcode ou serviço de compilação macOS), teste no TestFlight e envio à análise da Apple. Ícone, telas da loja, descrição e contato de suporte também entram nessa etapa.

A Apple avalia se o app oferece utilidade e experiência próprias além de simplesmente exibir um site. Vamos testar câmera, navegação, sessão e downloads nos aparelhos antes do envio. A aprovação nas lojas depende da análise delas.

## Situação atual

O código agora contém Dockerfile, configuração de hospedagem e armazenamento persistente para um piloto web. A publicação **não foi executada**: ainda faltam sua conta no GitHub/Render, a aprovação do custo de hospedagem e os testes no endereço público. A etapa de lojas depende do piloto web e dos itens de conta e privacidade acima.

Fontes: [Render Web Services](https://render.com/docs/web-services), [Render Persistent Disks](https://render.com/docs/disks), [Google Play Console](https://support.google.com/googleplay/android-developer/answer/6112435), [teste de contas pessoais do Google Play](https://support.google.com/googleplay/android-developer/answer/14151465), [exclusão de contas no Google Play](https://support.google.com/googleplay/android-developer/answer/13327111), [Apple Developer Program](https://developer.apple.com/programs/enroll/), [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/).
