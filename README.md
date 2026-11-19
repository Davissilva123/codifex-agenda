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
   Para adicionar opções personalizadas e permitir renomear as opções padrão do campo “O que você vai fazer?” em um banco já configurado, execute [`supabase/migration-tipos-agendamento.sql`](./supabase/migration-tipos-agendamento.sql) no **SQL Editor**. Se executou uma versão anterior dessa migração, execute-a novamente para adicionar a configuração dos nomes padrão. Em instalações novas, o `schema.sql` já inclui essa estrutura.
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

O service worker e as notificações precisam de HTTPS fora de `localhost`. Entre com uma conta criada ou convidada no Supabase. Depois da migração multiempresa, o cadastro público fica desativado: um super admin deve convidar e vincular cada usuário a uma empresa.

Se a verificação de sessão não responder em 12 segundos, a tela informa o problema e oferece **Tentar conectar novamente**, em vez de permanecer carregando indefinidamente. Confirme as variáveis públicas do Supabase e a conexão antes de tentar novamente.

## 4. Publicar na Vercel

1. Envie este projeto para um repositório Git e importe-o no painel da Vercel, ou use a Vercel CLI.
2. Configure as mesmas três variáveis públicas usadas em `.env.local` em **Project → Settings → Environment Variables**. Para o painel multiempresa, configure também `SUPABASE_SERVICE_ROLE_KEY` e `CRON_SECRET` como variáveis privadas da Vercel (sem o prefixo `NEXT_PUBLIC_`). A chave `service_role` só é lida por rotas de servidor; nunca a coloque no cliente ou no aplicativo desktop. A chave privada VAPID permanece exclusivamente nos secrets da Edge Function.
3. Publique. O projeto usa os comandos padrão `npm run build` e `npm run start`.
4. No Supabase Auth, adicione o domínio final em **URL Configuration → Site URL / Redirect URLs**.
5. Em um domínio próprio, atualize `project_url` no Vault somente se a URL do projeto Supabase tiver mudado (não é a URL Vercel).

## 5. Migrar para multiempresa e configurar o painel Admin

Faça a migração antes de publicar a nova versão do app. Ela não apaga registros: cria a empresa Avisnet, vincula os dados existentes a ela e substitui políticas RLS por políticas de empresa. Faça, ainda assim, um backup completo do projeto no Supabase antes de alterar o banco. O backup por empresa do painel **não substitui** o backup completo do banco.

1. Confirme em **Authentication → Users** que existem exatamente os dois usuários mencionados e que `davi@avisnet.com.br` está cadastrado. Para uma instalação nova, crie esses dois usuários no painel Supabase antes de continuar. A migração falha e reverte a transação inteira se essa pré-condição não for atendida.
2. Confirme que as tabelas base foram criadas executando `supabase/schema.sql` conforme a seção 1. Se a tabela `notas` ainda não existir, execute também `supabase/add-notas.sql`. Execute antes as migrações já usadas pelo projeto, incluindo `migration-alertas-categorias.sql` e `migration-tipos-agendamento.sql`.
3. Abra **SQL Editor → New query**, cole o arquivo completo [`supabase/migration-multitenant-admin.sql`](./supabase/migration-multitenant-admin.sql) e selecione **Run**. O script é transacional e idempotente. Na primeira execução, associa os dois usuários à empresa “Avisnet System Informática LTDA”, dá a Davi o papel `admin_empresa` e inclui seu usuário em `super_admins`. Novos usuários não são vinculados automaticamente.
4. Confira no SQL Editor:

   ```sql
   select id, nome, status, plano, vencimento
   from public.empresas
   order by nome;

   select u.email, m.papel, m.status, e.nome
   from public.membros m
   join auth.users u on u.id = m.user_id
   join public.empresas e on e.id = m.empresa_id
   order by e.nome, u.email;

   select u.email
   from public.super_admins s
   join auth.users u on u.id = s.user_id;

   select 'agendamentos' as tabela, count(*) filter (where empresa_id is null) as sem_empresa from public.agendamentos
   union all select 'contatos', count(*) filter (where empresa_id is null) from public.contatos
   union all select 'telefones', count(*) filter (where empresa_id is null) from public.telefones
   union all select 'observacoes', count(*) filter (where empresa_id is null) from public.observacoes
   union all select 'notas', count(*) filter (where empresa_id is null) from public.notas;
   ```

   O último resultado deve ter `sem_empresa = 0` em todas as linhas.
5. Em **Vercel → Project → Settings → Environment Variables**, adicione:

   ```dotenv
   SUPABASE_SERVICE_ROLE_KEY=<chave service_role privada do Supabase>
   CRON_SECRET=<segredo aleatório forte>
   ```

   Gere um segredo forte e não o reutilize como senha. Adicione ambas as variáveis aos ambientes Vercel em que o app será executado. Nunca use o prefixo `NEXT_PUBLIC_` nelas. A chave de serviço é usada somente em `app/api/admin/*` e no cron do servidor.
6. Publique a aplicação. O item **Admin** aparece no menu do avatar de super admins. Cada rota de `/api/admin/*` verifica a sessão e o registro em `super_admins`; `middleware.ts` também protege `/admin` e essas APIs. Usuários comuns recebem **403 — Acesso não autorizado**.
7. Em **Vercel → Settings → Cron Jobs**, confirme `/api/cron/company-backups` (`0 6 * * *`, 03:00 no horário de São Paulo). O cron usa `CRON_SECRET`, cria ZIPs diários das empresas ativas e remove backups com mais de 30 dias. O bucket `empresa-backups` é privado e limita cada ZIP a 50 MB. Se a geração ultrapassar o tempo de execução do plano Vercel, será necessário ajustar o plano ou dividir o trabalho em lotes menores.

### Testes do painel e do isolamento

1. Execute a migração e confira as consultas acima.
2. Entre como `davi@avisnet.com.br`; abra o menu do avatar e confirme **Admin**. Crie uma empresa de teste e convide um usuário.
3. Entre com um usuário comum e acesse `/admin` e `/api/admin/companies`; ambos devem responder **403**.
4. Crie registros na empresa de teste. Confirme que o usuário de outra empresa não os recebe. Para uma conta com vários vínculos, troque a empresa ativa no menu do avatar e confirme que os dados e o cache offline permanecem separados.
5. No detalhe da empresa de teste, gere um backup manual, baixe o ZIP e confirme que contém metadados e JSON por tabela. Crie/alterе um registro de teste, depois escolha **Restaurar** e digite exatamente o nome da empresa. A restauração substitui somente os dados daquela empresa; antes dela é criado um backup `pre_restauracao`, e a substituição ocorre em uma única transação. Não use dados de produção para o primeiro teste.
6. Suspenda a empresa de teste e confirme que consultas continuam disponíveis, mas gravações são rejeitadas pelo RLS. Reative-a ao terminar.

### MFA para super admins

Recomendamos exigir MFA/TOTP para a conta `davi@avisnet.com.br` e para qualquer futuro super admin em **Supabase → Authentication → Multi-Factor Authentication**. Guarde os códigos de recuperação fora do repositório e valide o fluxo de recuperação antes de tornar a política obrigatória. O painel ainda valida o papel no servidor; MFA acrescenta proteção à sessão autenticada.

Os ZIPs são backups de dados por empresa e não contêm esquema, configuração do projeto, usuários do Auth ou outros dados globais do Supabase. Mantenha e teste também os backups completos do banco e do Storage.

## 6. Criar aplicativo portátil para Windows

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

- Navegação entre visões diária, semanal (sete dias), mensal e anual, além de tarefas, contatos e notas. A agenda abre no dia selecionado (hoje ao iniciar).
- Tarefas possuem prioridade, prazo, categoria/área e cliente/projeto associado, com filtros por cliente, categoria e prioridade e contagens dinâmicas de abertas, concluídas e atrasadas.
- Links de videoconferência conhecidos são identificados e exibidos como ação para entrar na reunião. O formulário avisa sobre conflito de horário para o mesmo responsável.
- Importação e exportação de agenda no formato iCalendar (`.ics`), além de backup JSON completo.
- Calendário anual de 12 meses e calendário mensal com navegação; destaque de hoje, feriados calculados, eventos, aniversários e anotações.
- CRUD de compromissos e tarefas, responsável em texto livre, conclusão automática após o horário final, indicação de tarefas atrasadas, categorias/cores, recorrências diária/semanal/mensal/anual e lembretes. O horário de término é opcional; quando informado, os blocos semanais ficam proporcionais à duração.
- Formulários exibem datas como `dd/mm/aaaa` e horários no padrão brasileiro de 24 horas (`HH:mm`); tarefas podem ser excluídas pela própria lista.
- Anotações diárias com gravação automática após uma breve pausa na digitação.
- Agenda de contatos com visualização em cards ou lista compacta, filtro A–Z com contagem, favoritos, importação/exportação CSV, telefone brasileiro validado e formatado, detecção/mesclagem de duplicados e lixeira com restauração e exclusão em massa.
- Busca global por compromissos, tarefas, contatos e observações; aceita datas brasileiras e não diferencia acentos. Tema claro/escuro, atalhos (`N`, `T`, setas, `D`/`S`/`M`/`A`, `Ctrl+F` e `?`) e instalação como PWA.
- Múltiplos lembretes por compromisso, com soneca, conclusão e estado persistidos. No Electron, os avisos autorizados também aparecem como notificações do sistema; atrasos ficam sinalizados na agenda.
- Categorias pessoais com cores, filtros por categoria/status e estados vazios com ações para criar itens.
- Notificações push por Edge Function e fallback local enquanto o app está aberto e autorizado. A ação **Adiar 5 min** abre a agenda e agenda novamente o lembrete.
- Uso offline após o primeiro acesso autenticado neste dispositivo: os dados ficam em cache local, novas edições são guardadas na fila de sincronização e enviadas ao Supabase quando a conexão voltar.
- Navegação por datas e anos arquivados sem exibir anos futuros não gerados. O botão **Gerar ano** fica disponível na visão anual e libera o próximo ano, um por vez, neste dispositivo; anos futuros só aparecem após serem gerados.

O CSV exportado usa cabeçalhos `nome,telefones,email,empresa,endereco,aniversario,observacoes`. Datas de aniversário importadas devem estar em `AAAA-MM-DD`; telefones aceitam itens separados por ` | ` no formato `celular:+5511999999999`.

A classificação, responsável e lixeira foram adicionados ao esquema de `agendamentos` e `contatos`. Para atualizar um projeto Supabase já existente, execute [`supabase/migration-responsavel-lixeira-contatos.sql`](./supabase/migration-responsavel-lixeira-contatos.sql) e depois [`supabase/migration-alertas-categorias.sql`](./supabase/migration-alertas-categorias.sql) no SQL Editor. A segunda migração cria `categorias`, preserva/backfilla categorias existentes e adiciona o estado dos lembretes. Instalações novas podem executar [`supabase/schema.sql`](./supabase/schema.sql) e também a migração de alertas/categorias para popular as categorias padrão.

Para trabalhar sem conexão, faça o primeiro login e abra a agenda conectado para carregar os dados no dispositivo. Depois disso, a agenda instalada pode abrir, consultar e editar a cópia local sem internet. O login inicial, push, sincronização com outros dispositivos e envio/recebimento de dados do Supabase dependem de internet.

## Segurança e operação

- Todas as tabelas de dados têm RLS habilitado; as policies limitam acesso ao `auth.uid()` correspondente. `telefones` e inscrições push também carregam `user_id`.
- O cliente usa somente a chave pública do Supabase; o segredo de serviço é restrito à Edge Function.
- O service worker mantém recursos do app em cache. Agenda, tarefas, contatos e observações podem ser consultados/editados offline no mesmo navegador; a primeira autenticação e a sincronização entre dispositivos precisam de internet.
- Os dados offline usam o armazenamento local do navegador e são separados pela conta autenticada. Não limpe os dados do navegador antes de sincronizar as alterações pendentes. Se o mesmo registro for alterado em dois dispositivos desconectados, a sincronização reaplica as alterações deste dispositivo na ordem da fila.
- Se alterar o esquema de alertas, atualize a migração/SQL e publique novamente a Edge Function. Verifique a execução em **Edge Functions → send-push → Invocations** e **Database → Cron Jobs**.
