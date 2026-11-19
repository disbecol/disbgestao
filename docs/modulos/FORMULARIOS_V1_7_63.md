# Formulários — v1.7.63

Novo módulo interno do Disb Gestão, baseado nas referências fornecidas em 30/10/2026.

## Acesso e navegação

- **Criar formulários**: administradores e usuários com `FORMS_MANAGE`.
- **Formulários disponíveis**: modelos publicados autorizados ao usuário e à unidade atual.
- Cada modelo criado aparece automaticamente no menu, pelo próprio nome.
- **Agendamentos**: aplicações únicas, diárias, por dias da semana ou mensais.
- **Acompanhamento**: resumo, aplicações/detalhado, controle de execução, farol,
  gráficos, mapa de conformidades e inconsistências com planos de ação.
- Quem preenche pode consultar suas próprias aplicações. A leitura das aplicações
  de outras pessoas exige autorização de acompanhamento no modelo.
- Matriz Caicó e Filial Pau dos Ferros seguem os vínculos de unidade já existentes.
  Uma pessoa não recebe acesso a outra unidade ao ser selecionada no formulário.

## Criação e aplicação

- Nome, descrição, área, tipo e unidades de aplicação.
- Permissões por cargo, pessoa específica ou todos os usuários autorizados das unidades.
- Seções e perguntas editáveis, reordenáveis e duplicáveis.
- Respostas: Sim/Não/N/A, texto curto/longo, número, data e uma/várias opções.
- Obrigatoriedade, resposta conforme e observação exigida em não conformidade.
- Observações por pergunta e seção, plano inicial por resposta não conforme.
- Progresso por seção, duração, salvamento de rascunho e retomada.
- Rascunhos abertos também são guardados no aparelho; iniciar e finalizar exigem conexão.
- N/A não entra no denominador da conformidade. Campos sem avaliação não recebem nota.
- Autor, datas e resultado são calculados pelo servidor; o cliente não pode alterá-los.
- A versão e as perguntas de aplicações iniciadas são preservadas após editar o modelo.
- Arquivar um modelo mantém os relatórios e impede novas aplicações.
- Agendamentos e finalização são transacionais e protegidos contra duplicidade.
- Planos têm responsável, prazo, situação e descrição de conclusão, com auditoria.
- CSV e Excel incluem respostas, observações e planos. PDF individual apresenta o registro.

As referências de acesso público e notificações externas foram excluídas do escopo
por decisão do usuário: apenas usuários conectados; e-mail/WhatsApp ficam para depois.

## Banco e publicação

Aplicar **somente após a autorização do administrador**:

`supabase/79_forms_module.sql`

A migração cria cinco tabelas novas, rotinas e políticas RLS. Não remove dados dos
módulos anteriores. Não libera acesso anônimo. Escritas operacionais são feitas por
RPCs com validação de usuário ativo, unidade, permissões, versão e campos obrigatórios.

Depois de aplicar a migração, publicar os arquivos web da v1.7.63 ou instalar o APK
atualizado. Um APK anterior não contém a interface do novo módulo.

## Verificação

`npm run test:forms`: validação de respostas, cálculo, exportações e teste da migração
em PostgreSQL local isolado (PGlite), incluindo RLS, permissões, versões, agendas,
idempotência e planos de ação. Não usa o Supabase de produção.

`node --test tests/*.test.mjs`: regressão dos módulos existentes.

A revisão visual usa dados fictícios em banco isolado, sem criar formulários ou
aplicações de teste no banco de produção.

Validação concluída em 30/10/2026: 126 testes aprovados, incluindo 30 do novo módulo.
A aplicação foi exercitada no navegador em tela de computador e de celular, com
retomada de rascunho, finalização, plano de ação e agendamento. O PDF foi gerado e
conferido visualmente; o Excel foi reaberto para validar o arquivo exportado.

APK local: `releases/DisbGestao-1.7.63.apk`, versionCode 230. Assinatura compatível
com a v1.7.62 e arquivos web do pacote comparados com o código final.

A migração 79 foi autorizada e aplicada ao Supabase Disb Gestão em 30/10/2026.
A consulta posterior confirmou cinco tabelas com RLS, cinco políticas, as três
permissões ativas, módulo habilitado, escrita direta bloqueada e ausência de acesso
anônimo. Não foram criados modelos ou respostas fictícias em produção.
