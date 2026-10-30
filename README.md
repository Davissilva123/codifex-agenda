# Minha Agenda

PWA de agenda pessoal em Next.js App Router, TypeScript e Tailwind CSS, usando Supabase Auth/Postgres/Edge Functions e notificações Web Push. A interface e a exibição das datas usam pt-BR e o fuso `America/Sao_Paulo`.

## Requisitos

- Node.js 20 ou superior e npm.
- Projeto Supabase com Auth, Postgres, Vault, `pg_cron` e `pg_net` disponíveis.
- Conta Vercel para publicar a aplicação web.
- Supabase CLI para publicar a Edge Function e configurar secrets.

## 1. Criar e configurar o Supabase

1. Crie um projeto em [supabase.com/dashboard](https://supabase.com/dashboard) e guarde a URL, a chave pública `anon`/`publishable` e, para uso apenas no servidor, a chave `service_role`.
2. No painel, abra **Authentication → Providers → Email** e habilite o provedor. Ajuste a confirmação de e-mail e os endereços de redirecionamento para incluir o endereço local (`http://localhost:3000`) e o domínio Vercel que será usado.
3. Crie um segredo aleatório forte para o cron. Use o mesmo valor no Vault e nas secrets da função; não o publique nem o coloque em variáveis `NEXT_PUBLIC_*`.
4. No **SQL Editor**, primeiro guarde a URL do projeto e o segredo do cron no Vault. Substitua os exemplos:

   ```sql
   select vault.create_secret('https://SEU-PROJETO.supabase.co', 'project_url');
   select vault.create_secret('SUBSTITUA_POR_UM_SEGREDO_ALEATORIO_FORTE', 'cron_secret');
   ```

5. Execute o conteúdo completo de [`supabase/schema.sql`](./supabase/schema.sql). Ele cria as tabelas, índices, políticas RLS por usuário e o trabalho `pg_cron` que chama a Edge Function a cada minuto. O script requer que os dois segredos já estejam no Vault. No painel **Database → Extensions**, habilite `pg_cron` e `pg_net` se ainda não estiverem disponíveis no projeto/região.
   Se o aplicativo mostrar `Could not find the table 'public.observacoes' in the schema cache`, conecte-se ao projeto Supabase correto e execute [`supabase/fix-observacoes.sql`](./supabase/fix-observacoes.sql) no **SQL Editor**. O script cria a tabela com RLS, recarrega o cache do PostgREST e não altera as outras tabelas.
6. Configure secrets da Edge Function no Supabase (Dashboard → **Edge Functions → Secrets**) ou usando a CLI:

   ```powershell
   supabase secrets set --project-ref SEU_PROJECT_REF `
     SUPABASE_URL=https://SEU-PROJETO.supabase.co `
     SUPABASE_SERVICE_ROLE_KEY=SUA_SERVICE_ROLE_KEY `
     VAPID_PUBLIC_KEY=SUA_CHAVE_PUBLICA `
     VAPID_PRIVATE_KEY=SUA_CHAVE_PRIVADA `
     VAPID_SUBJECT=mailto:voce@exemplo.com `
     CRON_SECRET=O_MESMO_SEGREDO_SALVO_NO_VAULT
   ```

   O valor de `CRON_SECRET` precisa ser idêntico ao salvo no Vault na etapa 4. A chave `service_role` só vai para os secrets do Supabase — nunca para a Vercel ou para o navegador.
7. Publique a função sem a validação JWT automática do gateway, pois o agendador a autentica com o segredo próprio no header:

   ```powershell
   supabase functions deploy send-push --project-ref SEU_PROJECT_REF --no-verify-jwt
   ```

   A função valida `x-cron-secret`, envia push com VAPID, remove inscrições expiradas e registra a deduplicação dos lembretes e dos aniversários. O painel **Database → Cron Jobs** deve mostrar `minha-agenda-alertas` com execução `* * * * *`.

## 2. Gerar as chaves VAPID

Gere um par uma única vez e mantenha a chave privada em segredo:

```powershell
npx --yes web-push generate-vapid-keys
```

Use a chave pública em `NEXT_PUBLIC_VAPID_PUBLIC_KEY` na Vercel e em `VAPID_PUBLIC_KEY` nos secrets da função. Use a privada somente em `VAPID_PRIVATE_KEY` nos secrets da função. `VAPID_SUBJECT` deve ser um `mailto:` válido ou URL de contato.

Não deixe o texto de exemplo `SUA_CHAVE_VAPID_PUBLICA` no `.env.local`: essa chave não é válida para inscrição de notificações. A chave pública deve ser a chave completa gerada pelo comando acima, correspondente à chave privada configurada nos secrets da Edge Function.

## 3. Rodar localmente

```powershell
npm install
Copy-Item .env.example .env.local
```

Edite `.env.local` e preencha:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=SUA_CHAVE_PUBLICA_ANON_OU_PUBLISHABLE
NEXT_PUBLIC_VAPID_PUBLIC_KEY=SUA_CHAVE_VAPID_PUBLICA
```

Inicie e abra `http://localhost:3000`:

```powershell
npm run dev
```

O service worker e as notificações precisam de HTTPS fora de `localhost`. Cadastre-se na tela inicial ou entre com uma conta criada no Supabase.

Se a verificação de sessão não responder em 12 segundos, a tela informa o problema e oferece **Tentar conectar novamente**, em vez de permanecer carregando indefinidamente. Confirme as variáveis públicas do Supabase e a conexão antes de tentar novamente.

## 4. Publicar na Vercel

1. Envie este projeto para um repositório Git e importe-o no painel da Vercel, ou use a Vercel CLI.
2. Configure as mesmas três variáveis públicas usadas em `.env.local` em **Project → Settings → Environment Variables**. A chave `service_role`, `CRON_SECRET` e a chave privada VAPID não devem ser configuradas na Vercel.
3. Publique. O projeto usa os comandos padrão `npm run build` e `npm run start`.
4. No Supabase Auth, adicione o domínio final em **URL Configuration → Site URL / Redirect URLs**.
5. Em um domínio próprio, atualize `project_url` no Vault somente se a URL do projeto Supabase tiver mudado (não é a URL Vercel).

## 5. Criar aplicativo portátil para Windows

O pacote desktop é uma pasta portátil para Windows 64 bits. Não requer instalar Node.js no computador de destino: o executável inclui o runtime do Electron e inicia o Next.js localmente. Autenticação e sincronização continuam usando o Supabase; portanto, é necessária conexão com a internet para entrar e sincronizar os dados. Nenhuma chave `service_role` deve ser incluída no aplicativo.

No computador de desenvolvimento Windows:

1. Instale Node.js 22 LTS e Git.
2. Na pasta do projeto, instale as dependências e crie `.env.local` a partir do exemplo:

   ```powershell
   npm install
   Copy-Item .env.example .env.local
   ```

3. Em **Supabase → Project Settings → API**, copie a URL real do projeto e a chave pública `anon`/`publishable` para `.env.local`, substituindo os valores de exemplo. Para notificações, use a chave pública completa do par VAPID gerado na seção 2; a chave privada deve ficar somente nos secrets da Edge Function. Esses valores são incorporados ao cliente desktop durante o build, então gere novamente o pacote sempre que alterá-los. Mantenha RLS habilitado em todas as tabelas. Nunca use a chave `service_role`.
4. No Supabase, em **Authentication → URL Configuration → Redirect URLs**, permita `http://127.0.0.1:32147/**` para fluxos de confirmação/autenticação iniciados no aplicativo local.
5. Gere a pasta do aplicativo:

   ```powershell
   npm run desktop:package
   ```

6. Confirme que `release\desktop\win-unpacked\resources\web\desktop_modules\next` existe e copie a pasta `release\desktop\win-unpacked` inteira para o computador de destino, por exemplo `C:\MinhaAgenda`. Execute `Minha Agenda.exe` dentro dela. Não copie apenas o `.exe`: a pasta `resources` contém a aplicação.
7. Em cada computador, entre com a mesma conta para acessar os dados compartilhados no Supabase. Para publicar mudanças do código, gere e distribua novamente a pasta desktop.

O script `npm run desktop:dev` compila e abre a versão Electron no computador de desenvolvimento. O aplicativo desktop usa uma janela própria e não altera a publicação Next.js na Vercel. O service worker e o cache local permanecem disponíveis após autenticação inicial, mas login e sincronização com Supabase precisam de internet.

## 6. Instalar como PWA no Windows

1. Abra a URL HTTPS publicada em Microsoft Edge ou Google Chrome e entre na conta.
2. Escolha **Ativar notificações** e permita notificações no navegador e no Windows. A permissão precisa ser concedida em cada computador/navegador.
3. No Edge, use **... → Aplicativos → Instalar Minha Agenda**. No Chrome, use o ícone de instalação na barra de endereço ou **... → Transmitir, salvar e compartilhar → Instalar página como app**.
4. Para receber avisos com a aba fechada, mantenha as notificações do navegador permitidas nas configurações do Windows. Os lembretes são verificados pelo agendador Supabase a cada minuto.

## Funcionalidades

- Navegação principal simplificada em duas abas: **Agenda** e **Tarefas**. A Agenda abre no dia selecionado (hoje ao iniciar); a visão mensal, a visão anual e os contatos ficam dentro da própria aba Agenda.
- Tarefas possuem prioridade, prazo, categoria/área e cliente/projeto associado, com filtros e contagens dinâmicas de abertas, concluídas e todas; a lista vazia informa quando não há tarefas no ano selecionado.
- Calendário anual de 12 meses e calendário mensal com navegação; destaque de hoje, feriados calculados, eventos, aniversários e anotações.
- CRUD de compromissos e tarefas, conclusão, categorias/cores, validação de horário, recorrências diária/semanal/mensal/anual e lembretes.
- Formulários exibem datas como `dd/mm/aaaa` e horários no padrão brasileiro de 24 horas (`HH:mm`); tarefas podem ser excluídas pela própria lista.
- Anotações diárias com gravação automática após uma breve pausa na digitação.
- Agenda de contatos com telefones rotulados, busca, favoritos, filtro A–Z e importação/exportação CSV.
- Busca global por compromissos, tarefas, contatos e observações; aceita datas brasileiras e não diferencia acentos. Backup de exportação JSON (botão de seta para baixo no cabeçalho), tema claro/escuro, atalhos (`Ctrl+N`, `Ctrl+F` e setas) e instalação como PWA.
- Notificações push por Edge Function e fallback local enquanto o app está aberto e autorizado. A ação **Adiar 5 min** abre a agenda e agenda novamente o lembrete.
- Uso offline após o primeiro acesso autenticado neste dispositivo: os dados ficam em cache local, novas edições são guardadas na fila de sincronização e enviadas ao Supabase quando a conexão voltar.
- Navegação por datas e anos arquivados sem exibir anos futuros não gerados. O botão **Gerar ano** fica disponível na visão anual e libera o próximo ano, um por vez, neste dispositivo; anos futuros só aparecem após serem gerados.

O CSV exportado usa cabeçalhos `nome,telefones,email,empresa,endereco,aniversario,observacoes`. Datas de aniversário importadas devem estar em `AAAA-MM-DD`; telefones aceitam itens separados por ` | ` no formato `celular:+5511999999999`.

A classificação de tarefas foi adicionada ao esquema por meio de `tipo`, `prioridade` e `cliente` em `agendamentos`. O SQL pode ser executado novamente em um banco já configurado para incluir essas colunas sem remover os registros existentes.

Para trabalhar sem conexão, faça o primeiro login e abra a agenda conectado para carregar os dados no dispositivo. Depois disso, a agenda instalada pode abrir, consultar e editar a cópia local sem internet. O login inicial, push, sincronização com outros dispositivos e envio/recebimento de dados do Supabase dependem de internet.

## Segurança e operação

- Todas as tabelas de dados têm RLS habilitado; as policies limitam acesso ao `auth.uid()` correspondente. `telefones` e inscrições push também carregam `user_id`.
- O cliente usa somente a chave pública do Supabase; o segredo de serviço é restrito à Edge Function.
- O service worker mantém recursos do app em cache. Agenda, tarefas, contatos e observações podem ser consultados/editados offline no mesmo navegador; a primeira autenticação e a sincronização entre dispositivos precisam de internet.
- Os dados offline usam o armazenamento local do navegador e são separados pela conta autenticada. Não limpe os dados do navegador antes de sincronizar as alterações pendentes. Se o mesmo registro for alterado em dois dispositivos desconectados, a sincronização reaplica as alterações deste dispositivo na ordem da fila.
- Se alterar o esquema de alertas, atualize a migração/SQL e publique novamente a Edge Function. Verifique a execução em **Edge Functions → send-push → Invocations** e **Database → Cron Jobs**.
