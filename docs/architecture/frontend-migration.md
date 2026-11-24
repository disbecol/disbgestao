# Migração gradual do frontend

O destino do Disb Gestão é um frontend React com TypeScript, mantendo o Supabase e a embalagem Android/Capacitor. A migração acontece por módulos publicados, com os dados e contratos existentes preservados durante a transição.

## Etapa 1 — base compartilhada e interface do Formulários

`modules/gestao` contém a nova compilação Vite e a base de componentes React. O resultado distribuído é `src/gestao-app/forms-react.js`. As cinco rotas do Formulários usam essa entrada: criação, preenchimento, relatórios, agendamentos e minhas avaliações. A antiga entrada que montava HTML em `src/forms/forms-ui.js` foi removida.

Os componentes nativos de entrada, seleção, texto longo, campos com rótulo, ações, indicadores de estado e cabeçalho estão em TypeScript. A interface é JSX real: não há conversão de HTML em tempo de execução nem `dangerouslySetInnerHTML` para renderizar os registros. A troca de unidade e a abertura/fechamento dos modais liberam os elementos do React antes de o controlador antigo substituir os contêineres.

O adaptador recebe a sessão, o cliente Supabase, o perfil, as unidades e as permissões do aplicativo principal. Não cria outro login, outro cliente ou outra cópia de token. Os RPCs, as regras de acesso, os relatórios exportados e as chaves dos rascunhos continuam os mesmos. O processo web/Android recompila a entrada React e inclui o resultado no cache offline.

### Limite desta etapa

A migração de todo o sistema ainda não está concluída. A navegação principal e os demais módulos permanecem nos controladores atuais. Na própria área de Formulários, o controlador de estado, eventos e chamadas ao banco foi preservado em `modules/gestao/src/forms/controller.jsx`; o núcleo de cálculos permanece em `src/forms/forms.js`. Eles ainda são JavaScript. Os novos componentes e o contrato de integração são TypeScript com verificação estrita; `allowJs` temporariamente permite a convivência com o controlador. Não confundir essa etapa com tipagem integral do módulo.

O limite de integração usa uma atualização síncrona ao pintar uma tela porque o controlador existente consulta os campos imediatamente em seguida. Os componentes não chamam `flushSync`. Uma pintura substitui o conteúdo da tela, como ocorria no renderizador anterior. A próxima extração do estado para hooks deve remover gradualmente essa necessidade e permitir atualizações locais sem remontar a página inteira.

## Sequência de migração

1. **Entregue nesta etapa:** infraestrutura React, componentes e contrato em TypeScript, cinco interfaces do Formulários, build e integração offline/Android.
2. **Próxima etapa:** tipar os modelos, serviços e estado do Formulários; extrair as telas em componentes por domínio e substituir a delegação de eventos por callbacks e hooks tipados.
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

A versão inicial passou em 588 testes do projeto principal e 9 testes dos componentes novos. Os 895 arquivos web do APK foram comparados com a compilação final; a entrada React está presente e a entrada antiga de HTML foi retirada. A assinatura Android é a mesma das versões anteriores.
