# Migração gradual do frontend

O destino do Disb Gestão é um frontend React com TypeScript, mantendo o Supabase e a embalagem Android/Capacitor. A migração acontece por módulos publicados, com os dados e contratos existentes preservados durante a transição.

## Etapa 1 — base compartilhada e interface do Formulários

`modules/gestao` contém a nova compilação Vite e a base de componentes React. O resultado distribuído é `src/gestao-app/forms-react.js`. As cinco rotas do Formulários usam essa entrada: criação, preenchimento, relatórios, agendamentos e minhas avaliações. A antiga entrada que montava HTML em `src/forms/forms-ui.js` foi removida.

Os componentes nativos de entrada, seleção, texto longo, campos com rótulo, ações, indicadores de estado e cabeçalho estão em TypeScript. A interface é JSX real: não há conversão de HTML em tempo de execução nem `dangerouslySetInnerHTML` para renderizar os registros. A troca de unidade e a abertura/fechamento dos modais liberam os elementos do React antes de o controlador antigo substituir os contêineres.

O adaptador recebe a sessão, o cliente Supabase, o perfil, as unidades e as permissões do aplicativo principal. Não cria outro login, outro cliente ou outra cópia de token. Os RPCs, as regras de acesso, os relatórios exportados e as chaves dos rascunhos continuam os mesmos. O processo web/Android recompila a entrada React e inclui o resultado no cache offline.

### Limite desta etapa

A migração de todo o sistema ainda não está concluída. A navegação principal e os demais módulos permanecem nos controladores atuais. Na versão inicial 1.7.113, o controlador de Formulários ainda era JSX/JavaScript; a etapa 2 abaixo converte esse controlador para TypeScript. O núcleo de cálculos permanece em `src/forms/forms.js`, com contrato tipado na integração.

O limite de integração usa uma atualização síncrona ao pintar uma tela porque o controlador existente consulta os campos imediatamente em seguida. Os componentes não chamam `flushSync`. Uma pintura substitui o conteúdo da tela, como ocorria no renderizador anterior. A próxima extração do estado para hooks deve remover gradualmente essa necessidade e permitir atualizações locais sem remontar a página inteira.

## Etapa 2 — controlador, modelos e serviços de Formulários

A versão 1.7.114 converte o controlador para `modules/gestao/src/forms/controller.tsx`. O estado, os eventos, os modelos de perguntas, aplicações, avaliações individuais, agendamentos e planos têm tipos explícitos. A compilação não usa mais `allowJs`; os arquivos da nova aplicação passam pela verificação estrita, sem `any`, `ts-ignore` ou `ts-nocheck` no código de implementação.

Os contratos existentes das tabelas e funções das migrações 79–81 estão descritos em `database.ts`, e as consultas paginadas e RPCs foram extraídos para `service.ts`. O serviço recebe o mesmo cliente e sessão do aplicativo principal. Requer autenticação, mantém os filtros por unidade, propaga erros e preserva o controle de revisão nas gravações. A consulta das próprias avaliações continua sem parâmetro para selecionar outro usuário. Esta etapa não executa migrações nem altera dados de produção.

Os rascunhos locais mantêm as chaves e o formato existentes. A leitura valida a estrutura, aceita modelos ainda incompletos e informa quando uma cópia não pode ser lida, preservando o conteúdo armazenado. Edições feitas durante a gravação de um modelo continuam disponíveis com a nova versão do servidor; uma resposta antiga não apaga o rascunho de outro usuário ou unidade.

O núcleo de cálculo JavaScript, a delegação de eventos e a atualização síncrona da integração ainda permanecem. A extração de telas para componentes independentes e a passagem gradual do estado para hooks são o próximo trabalho desta área; tipar o controlador não conclui essa refatoração.

## Sequência de migração

1. **Entregue na etapa 1:** infraestrutura React, componentes e contrato em TypeScript, cinco interfaces do Formulários, build e integração offline/Android.
2. **Entregue na etapa 2:** controlador, modelos, serviços e estado de Formulários em TypeScript estrito. **Próximo:** extrair as telas em componentes por domínio, substituir a delegação de eventos por callbacks e hooks tipados e migrar o núcleo de cálculos.
3. Migrar Devoluções, mantendo importação, agrupamento de ocorrências, auditoria, penalidades, filtros e associação com o raio.
4. Migrar Avarias de Entrega e Vendas, incluindo fotos, localização, assinaturas, decisões, comprovantes e filas offline.
5. Migrar Pedidos e Apontamentos Fora do Raio.
6. Migrar NRI, Conferência, FEFO, Ativo de Giro, Materiais, Refugo e consultas de estoque/preços.
7. Migrar Início, Configurações e a navegação principal; consolidar a base compartilhada com a Puxada e retirar os adaptadores de compatibilidade que não forem mais necessários.

A Puxada já possui aplicação React/TypeScript em `modules/puxada`. Continua compilada e integrada pelo mecanismo existente durante esta etapa.

## Desenvolvimento e verificação

Em uma instalação nova, instale as dependências dos três projetos:

```powershell
npm ci
npm --prefix modules/puxada ci
npm --prefix modules/gestao ci
npm run typecheck:frontend
npm run build:frontend
npm run test:frontend
node --test --test-concurrency=2 tests/*.test.mjs
npm run android:sync
```

O bundle compilado é versionado porque o site publicado serve arquivos estáticos. Mudanças de código devem passar pela compilação antes da validação no navegador e da publicação. Cada nova entrada precisa constar no service worker e no APK; os testes verificam a ordem de carregamento e a inclusão no cache.

Os cenários de regressão usam dados fictícios e o cliente substituído. Cobrem criação, revisão conflitante, tipos de resposta, gravação, finalização, retomada offline, isolamento por unidade, resposta assíncrona antiga, avaliação individual, calendário, exportação e coexistência dos modais. Nenhum registro de teste é criado em produção.

Os testes dos serviços verificam paginação, limite explícito de exportação, filtros, lotes de IDs, erros de permissão e a consulta pessoal sem outra identidade. Os testes de tipos rejeitam chamadas sem revisão e status inválidos antes da compilação. Os testes de rascunho incluem estruturas incompletas, respostas individuais, notas, fotos, zero e arquivos locais malformados.

A versão inicial passou em 588 testes do projeto principal e 9 testes dos componentes novos. Os 895 arquivos web do APK foram comparados com a compilação final; a entrada React está presente e a entrada antiga de HTML foi retirada. A assinatura Android é a mesma das versões anteriores.

A etapa 2 passou em 592 testes do projeto principal e 31 testes da aplicação TypeScript. A versão Android 271 mantém a mesma assinatura, e os 895 arquivos web do APK correspondem à compilação final. A ferramenta de navegador não iniciou nessa sessão; a conferência manual da prévia e a instalação em aparelho físico ficaram pendentes.
