# Comprovante de avaria pelo WhatsApp da empresa — v1.7.21

O botão **Enviar comprovante** chama a Edge Function `send-damage-receipt`. Ela usa a
WhatsApp Business Platform Cloud API para enviar um modelo de mensagem a partir
do número corporativo **(84) 99801-6062**. O token da Meta fica apenas nos
Secrets do Supabase. Após registrar o aceite do destinatário, o botão separado
**Abrir envio manual pelo meu WhatsApp** mantém o procedimento anterior. Em
04/11/2026, o número foi conectado à Cloud API e o identificador foi salvo no
Supabase. Após a correção de permissões da migração 83, o usuário confirmou a
entrega do primeiro comprovante em 04/11/2026.

### Atualização verificada em 04/11/2026

- A conta de mensagens **Disbecol** (`940672352023940`) está **Aprovada**,
  com cobrança em BRL e cartão final **0218** cadastrado.
- O modelo **`comprovante_avaria_entrega`**, `pt_BR`, categoria **Utilidade**,
  ID `994493586331706`, está **Ativo — Qualidade pendente**. A qualidade depende
  do uso; esse status não indica análise de aprovação pendente.
- O usuário confirmou a exclusão da conta do aplicativo WhatsApp Business do
  celular para liberar **+55 (84) 99801-6062** para uso exclusivo na Cloud API.
- A inclusão do número na conta de mensagens Disbecol foi aceita. O identificador
  novo mostrado pela Meta é **`1357177764156790`**. O painel exibe o telefone sem
  o nono dígito (`+55 84 9801-6062`), embora o cadastro tenha sido enviado como
  `+55 84 99801-6062`. O ID antigo da conta do aplicativo não deve ser usado.
- A linha **TIM estava cancelada por falta de recarga**, impedindo o recebimento
  dos códigos. O usuário recuperou a linha e concluiu pessoalmente a autenticação
  na Meta; nenhum código foi recebido ou digitado pelo agente.
- Após a autenticação, o número aparecia **Pendente** no WhatsApp Manager e
  **Não registrado** no painel do app. Foi executada a ação **Registrar**, em
  **Etapa 2. Configuração da produção > Registre seu número de telefone do
  WhatsApp**, para esse número. O painel passou a mostrar **Inscrito**, e o
  WhatsApp Manager confirmou **Conectado**. Não houve solicitação de novo PIN.
- O Secret **`WHATSAPP_PHONE_NUMBER_ID`** foi criado no Supabase com
  **`1357177764156790`**, em 04/11/2026 às 20:06:52 UTC. A presença do registro
  salvo foi confirmada no painel. **`WHATSAPP_ACCESS_TOKEN`** permanece cadastrado;
  seu valor não foi consultado, alterado nem revelado.
- A configuração do número está concluída. A função de envio não foi invocada
  nesta ativação; a aceitação e a entrega de um comprovante real ainda não foram
  testadas. A configuração de recebimento e de webhooks permanece fora desta etapa.
- A tabela oficial em BRL, vigente desde 01/10/2026, foi consultada: mensagens de
  utilidade entregues a destinatários brasileiros custam **R$ 0,035 (3,5 centavos)**
  na tarifa inicial. A orientação fiscal da Meta não informa alíquota para o Brasil;
  não há fatura nessa conta para confirmar um eventual acréscimo de tributos.
- **Não enviar teste nem comprovantes a clientes nesta configuração.** O usuário
  pediu expressamente para concluir o cadastro sem realizar envio de teste.

### Primeiro teste pelo usuário em 04/11/2026 — permissão corrigida

- O aceite do contato foi registrado pelo usuário. Ao enviar, o aplicativo
  exibiu **Não foi possível registrar o envio. Tente novamente.**
- O log da função confirmou `SEND_LOG_FAILED`, código SQL `42501`:
  `permission denied for table damage_receipt_sends`. O erro ocorreu na criação
  do registro de tentativa, antes da chamada à Meta.
- A migração **`83_whatsapp_receipt_service_role_grants.sql`** foi aplicada:
  permite `SELECT` e `INSERT` ao servidor (`service_role`) e `UPDATE` somente
  nas quatro colunas de resultado do envio. Mantém a RLS e não concede escrita
  direta a usuários autenticados ou anônimos. Não envia mensagens.
- **9 testes passaram**, incluindo reprodução do erro de permissão em PostgreSQL,
  gravação após a correção, restrições de edição, RLS e bloqueio de duplicidade.
- **Aplicada no Supabase Disb Gestão após autorização específica do usuário.**
  A consulta final, somente leitura, confirmou **10 verificações e todas aprovadas**:
  leitura, inserção e atualização de resultados pelo servidor, escrita direta
  bloqueada para usuários, consulta anônima bloqueada e RLS preservada. Uma falha
  transitória de conexão do painel na conferência foi resolvida ao repetir apenas
  a consulta de leitura. Não é necessário atualizar o APK para esta correção.
- O agente não repetiu o envio nem invocou a função para testar um destinatário.

### Entrega confirmada e consulta de custo em 04/11/2026

- Após a migração 83, o usuário confirmou que enviou o comprovante pelo sistema
  e que a mensagem chegou ao destinatário. O envio foi feito pelo usuário.
- No WhatsApp Manager, em **Insights > Preços das mensagens**, a conta Disbecol
  mostrou **1 mensagem enviada, 1 entregue e 1 recebida**, no intervalo de
  29/10/2026 a 04/11/2026.
- Na mesma consulta, o detalhamento de mensagens pagas e gratuitas ainda estava
  zerado e a cobrança total aproximada mostrava **US$ 0,00**. O próprio painel
  informa que seus dados são aproximados e podem divergir da fatura.
- Em **Cobrança e pagamentos > Disbecol**, o saldo em BRL era **R$ 0,00**, com a
  mensagem **Você não tem gastos recentes**. Nenhuma cobrança efetiva do primeiro
  comprovante estava lançada na consulta. Não tratar esse saldo como confirmação
  de gratuidade; o valor final e eventuais tributos dependem do lançamento.

### Reconsulta do custo em 05/11/2026

- **Insights > Preços das mensagens** passou a mostrar **1 mensagem paga de
  utilidade entregue**, nenhuma mensagem gratuita e cobrança total aproximada de
  **R$ 0,04 BRL**, no intervalo de 30/10/2026 a 05/11/2026.
- Após atualizar **Cobrança e pagamentos > Disbecol**, o saldo atual também
  passou a ser **R$ 0,04**, com a opção **Pagar agora**. A atividade de pagamento
  ainda informa que não há gastos recentes; não foi identificado pagamento
  registrado no cartão. O agente não acionou pagamento nem alterou a cobrança.
- Esse é o valor exibido pelo painel com duas casas decimais. Não atribuir a
  diferença em relação à referência de R$ 0,035 a tributos sem detalhamento de
  fatura; o arredondamento é uma explicação possível.

### Situação anterior verificada em 30/10/2026

- Portfólio **Disbecol**: `28506563622370992`.
- App **Disb Gestão Comprovantes**: `2199190057617572`.
- Conta de mensagens **Disbecol**: `940672352023940`, ainda sem número da API.
- Em 30/10/2026, o resumo da conta mostra **Aprovada**, moeda BRL e o cartão
  Visa final **0218** como forma de pagamento. O cadastro do cartão está concluído;
  a pendência de análise abaixo se refere ao modelo de mensagem.
- O número do celular foi vinculado ao portfólio como **Logística Disbecol**
  (conta `2500295133798666`, telefone `1237287429478979`). O painel identifica
  **Aplicativo WhatsApp Business**. Esse vínculo, sozinho, não ativa a Cloud API.
- Modelo `comprovante_avaria_entrega`, `pt_BR`, categoria Utilidade, enviado
  para análise na conta de mensagens Disbecol. ID: `994493586331706`.
  O status continuava **Em análise** na consulta de 30/10/2026.
- O site oficial HTTPS consta no portfólio: <https://www.disbecol.com.br/>.
- Função `send-damage-receipt` republicada no Supabase em 29/10/2026 com a
  correção para listas de vários produtos. Os oito testes de envio passaram.
- Usuário de serviço **Disb Gestão - Comprovantes** criado como Employee:
  `61596185244197`. Tem acesso ao app de comprovantes e acesso total somente à
  conta de mensagens Disbecol (`940672352023940`).
- Token gerado somente com `whatsapp_business_messaging` e salvo como
  `WHATSAPP_ACCESS_TOKEN` nos Secrets do Supabase. Validade selecionada: 60 dias
  a partir de 29/10/2026; renovar antes de 28/12/2026. O token não está neste
  repositório. `whatsapp_business_management` não foi concedida.
- A permissão **Tudo** da conta de mensagens foi concedida após autorização
  específica do administrador em 29/10/2026. Essa opção inclui envio, configurações,
  atribuição de usuários e informações de pagamento. O token permanece restrito
  ao escopo de envio `whatsapp_business_messaging`.
- Ainda faltam cadastrar o número definitivamente na API
  e obter a aprovação do modelo. `WHATSAPP_PHONE_NUMBER_ID` permanece
  ausente, portanto a função ainda retorna `WHATSAPP_NOT_CONFIGURED`. Nenhum
  envio real a cliente foi realizado.

O novo modelo de contas da Meta separa a conta que possui o número da conta
de mensagens. A mensagem de erro de migração não deve ser tratada como motivo
para excluir ou desconectar contas. Antes de executar a etapa 5, confirmar o
procedimento aplicável ao número, a aprovação do modelo e a preparação do envio.
Veja as [alterações de integração da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/account-model-evolution/onboarding/).

Como os comprovantes podem citar cerveja e chope, a
[Política de Mensagens do WhatsApp Business](https://whatsappbusiness.com/pt-br/policy/)
exige consentimento do destinatário, proteção de idade e país e licenças aplicáveis.
O Brasil consta entre os países permitidos para mensagens sobre álcool pela
**Plataforma** do WhatsApp Business, mas a Meta ainda precisa aceitar o cadastro,
o número e o modelo. O cadastro atual dos clientes comprova apenas a maioridade
do titular; ele não comprova o consentimento nem a idade de quem usa cada número.

## 1. Preparar o cadastro direto na Cloud API

A empresa optou por usar o **(84) 99801-6062 somente na Cloud API**. O número
deixará de funcionar no aplicativo WhatsApp Business do celular. Não é necessário
o fluxo especial de Coexistência nem contratar um parceiro apenas para isso.

Antes de retirar o número do aplicativo:

1. A empresa informou que pode perder as conversas e mídias antigas. Ainda
   assim, confira se há algum documento importante a exportar: a exclusão da
   conta no WhatsApp é irreversível e apaga o histórico e o backup da conta,
   conforme a [Central de Ajuda do WhatsApp](https://faq.whatsapp.com/2138577903196467/).
2. Confirme que a empresa controla o chip/linha e consegue receber SMS ou ligação
   de verificação nesse número.
3. Entre em [Meus Apps da Meta](https://developers.facebook.com/apps/) com o
   **perfil pessoal de uma pessoa responsável**. O perfil usa o nome dessa
   pessoa; o nome público da empresa fica no portfólio empresarial. Crie um
   app, escolha o caso de uso de comunicação pelo **WhatsApp** e vincule ou
   crie o portfólio empresarial. No formulário do portfólio, preencha os
   campos **Nome** e **Sobrenome** com os dados reais do administrador.
   Abra a configuração da API do WhatsApp; a Meta fornece uma conta de teste
   e um número de teste para validar o acesso inicial. Faça isso antes de
   mexer na linha real. Os nomes dos botões podem variar.
4. Planeje o atendimento das respostas: o Disb Gestão v1.7.21 **apenas envia**
   comprovantes. Ele ainda não mostra mensagens que os clientes responderem.

**Não retire o número do aplicativo nesta etapa.** Conclua a preparação da Meta,
o modelo e o backend abaixo; faça a troca do número somente na etapa 5.

No portfólio empresarial, preencha os dados oficiais da Disbecol. O campo
**Telefone comercial** é um dado cadastral e pode ser diferente do número que
enviará as mensagens. O **(84) 99801-6062** será cadastrado separadamente como
número da API. Se a Meta continuar mostrando um aviso de bloqueio para a categoria
real da empresa após preencher os dados, interrompa o cadastro e procure o
suporte da Meta; não selecione uma categoria incorreta.

## 2. Criar e aprovar o modelo

Crie no WhatsApp Manager um modelo de categoria **Utilidade**, idioma
**Português (Brasil)**, nome `comprovante_avaria_entrega`, com o corpo exato:

```text
COMPROVANTE DE AVARIA

Cliente: {{1}}
PDV: {{2}}
Mapa: {{3}}
Data: {{4}}

Produto(s) avariado(s):
{{5}}

O produto avariado será enviado junto ao próximo pedido realizado pelo cliente.

Precisa de mais informações? Entre em contato com nossa Central de Atendimento: (84) 9 9609-9264.
```

O aplicativo preenche as cinco variáveis com dados da avaria gravada no Supabase.
O texto dos produtos é limitado a 700 caracteres para evitar mensagens extensas.
Os produtos são separados por ponto e vírgula: variáveis de modelos aprovados
não aceitam quebras de linha, conforme as [regras de variáveis do WhatsApp](https://www.twilio.com/docs/content/using-variables-with-content-api#whatsapp-variable-rules).
A Meta precisa aprovar o modelo antes de usá-lo com clientes.

## 3. Criar histórico no Supabase

Execute uma vez, no SQL Editor do projeto, o arquivo:

`supabase/51_v1_7_20_whatsapp_comprovante_avaria.sql`

Esse SQL e a primeira publicação da Edge Function já foram feitos no Supabase.
Para a atualização **1.7.21**, execute também:

`supabase/52_whatsapp_comprovante_elegibilidade.sql`

Depois, republique `supabase/functions/send-damage-receipt/index.ts` com a versão
deste repositório. A função atualizada bloqueia o envio para um contato não
autorizado. **Não configure o token real da Meta antes de republicá-la.**

Os contatos existentes começam sem autorização. **Não é necessário abordar os
2.600 clientes de uma vez.** Quando ocorrer uma avaria, o motorista pede o aceite
à pessoa que usa o número, confirma que ela tem 18 anos ou mais e está no Brasil,
e toca **Registrar aceite na entrega**. O sistema registra o nome informado, como
a maioridade foi confirmada, o motorista e a data. Só então libera **Enviar
comprovante** para aquele número. Se a pessoa não aceitar, o envio automático
permanece bloqueado. O administrador pode revisar ou revogar a autorização em
**Admin → Contatos de clientes**. Não registre CPF ou data de nascimento.

Para novos cadastros, também é possível obter esse aceite previamente com a
frase: “Aceito receber da Disbecol, pelo WhatsApp informado, comprovantes de
avaria. Posso cancelar esse recebimento a qualquer momento.” Guarde a resposta
e confirme a maioridade de quem usa o número.

A tabela `damage_receipt_sends` registra tentativas, aceite da API e ID da
mensagem. A trava impede que toques repetidos enviem o mesmo comprovante ao
mesmo contato. Uma resposta de rede incerta bloqueia novo envio até conferência
manual, para evitar duplicidade.

## 4. Publicar a função e preparar Secrets

Publique a função antes da troca do número. Ela responderá que o WhatsApp ainda
não está configurado até que os Secrets reais sejam adicionados:

```powershell
npx supabase@latest functions deploy send-damage-receipt --project-ref jrsjbcdahqpcgcvzdtfb
```

Depois que obtiver o Phone Number ID e o token na etapa 5, configure no Supabase
os Secrets:

- `WHATSAPP_ACCESS_TOKEN`: token da Meta; nunca colocar no GitHub ou no app.
- `WHATSAPP_PHONE_NUMBER_ID`: ID do número **+55 84 99801-6062**.
- `WHATSAPP_TEMPLATE_NAME`: `comprovante_avaria_entrega` (opcional, esse é o padrão).
- `WHATSAPP_TEMPLATE_LANGUAGE`: `pt_BR` (opcional, esse é o padrão).
- `WHATSAPP_GRAPH_VERSION`: versão habilitada pela Meta, por exemplo `v26.0` (opcional).

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos
pelo projeto Supabase à função. Os Secrets novos entram em vigor sem republicar.

Mantenha a verificação JWT habilitada. A função só aceita uma avaria criada pelo
usuário conectado e um contato cadastrado para o mesmo cliente. O navegador não
fornece nem o número de destino nem o texto usado no envio.

## 5. Trocar o número e ativar

Somente depois das etapas 1–4, escolha uma janela planejada para interromper o
uso do número no celular. No WhatsApp Business do celular, a ação necessária é
**excluir a conta WhatsApp desse número**, não apenas desinstalar o aplicativo.
Essa ação é irreversível e apaga o histórico. Em seguida, cadastre
**+55 84 99801-6062** na WABA pela configuração da Cloud API,
validando a posse por SMS ou ligação. A Meta exige que um número vinculado a
uma conta WhatsApp seja removido antes do registro comum na
[Plataforma do WhatsApp Business](https://whatsappbusiness.com/wp-content/uploads/2026/04/Onboarding-to-the-WhatsApp-Business-Platform.pdf).

Ao concluir, obtenha o **Phone Number ID** e um token de usuário do sistema com
permissão `whatsapp_business_messaging`. Confira no WhatsApp Manager que o ID
corresponde a **+55 84 99801-6062**. Um token temporário de teste não serve para
uso contínuo. Não coloque o token no app, no GitHub ou em mensagens de chat.
Cadastre os dois Secrets obrigatórios listados na etapa 4.

## 6. Teste de ativação

1. Instale a versão 1.7.21 ou atualize o app web.
2. Crie uma avaria de teste com um contato autorizado da empresa.
3. Toque **Enviar comprovante** e confira que a conversa recebeu a mensagem do
   número **(84) 99801-6062**, sem abrir o WhatsApp do motorista.
4. Confira em `damage_receipt_sends` o status `ACCEPTED` e o `provider_message_id`.
5. Toque novamente: deve informar que o envio já foi aceito, sem duplicar.
6. Confirme que o número da empresa está registrado apenas na Cloud API e que
   o plano de atendimento às respostas dos clientes está definido.

`ACCEPTED` significa que a API da Meta aceitou a solicitação, não que o celular
do cliente recebeu a mensagem. Para acompanhar entrega e leitura, será preciso
adicionar um webhook de status da Meta em uma etapa posterior.
