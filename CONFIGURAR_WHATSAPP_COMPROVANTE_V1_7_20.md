# Comprovante de avaria pelo WhatsApp da empresa — v1.7.20

O botão **Enviar comprovante** chama a Edge Function `send-damage-receipt`. Ela usa a
WhatsApp Business Platform Cloud API para enviar um modelo de mensagem a partir
do número corporativo **(84) 99801-6062**. O token da Meta fica apenas nos
Secrets do Supabase. O botão separado **Abrir envio manual pelo meu WhatsApp**
mantém o procedimento anterior enquanto a integração é ativada.

## 1. Preservar o WhatsApp Business no celular

O número (84) 99801-6062 precisa continuar ativo no aplicativo WhatsApp Business.
A página de [Coexistência da Meta](https://developers.facebook.com/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users)
é documentação **para Parceiros de Soluções e Provedores de Tecnologia**; ela
não oferece um cadastro direto para a empresa. Para usar o mesmo número no app
e na Cloud API, contrate ou utilize um parceiro que ofereça explicitamente o
fluxo **WhatsApp Business App Coexistence**. A Meta exige que esse parceiro
configure o Cadastro Incorporado com a opção de conectar a conta existente,
webhooks e registro de sessão.

Antes de contratar, confirme com o parceiro:

1. O número continuará funcionando no aplicativo WhatsApp Business do celular?
2. O fluxo exibirá a opção de conectar a conta existente do app?
3. O parceiro fornecerá acesso à **Cloud API da Meta**, incluindo Phone Number ID
   e possibilidade de gerar um token para o sistema Disb Gestão? Se ele oferecer
   apenas uma API própria, esta integração precisará ser adaptada.
4. Quem cuidará dos webhooks exigidos para a coexistência e da sincronização
   inicial? Quais são as taxas do parceiro e da Meta?

Use [Encontrar um parceiro, no site oficial do WhatsApp Business](https://business.facebook.com/messaging/partner-showcase/)
para iniciar a busca. Antes de confirmar a conexão, verifique que a tela diz
que o mesmo número permanecerá no aplicativo e na Cloud API. Não faça uma
migração comum do número para a API.

Ao concluir, obtenha o **Phone Number ID** desse número e um token com permissão
`whatsapp_business_messaging`. Confira no WhatsApp Manager que o número vinculado
ao Phone Number ID é **+55 84 99801-6062**. Um token temporário de teste não é
adequado para uso contínuo.

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
A Meta precisa aprovar o modelo antes de usá-lo com clientes.

## 3. Criar histórico no Supabase

Execute uma vez, no SQL Editor do projeto, o arquivo:

`supabase/51_v1_7_20_whatsapp_comprovante_avaria.sql`

A tabela `damage_receipt_sends` registra tentativas, aceite da API e ID da
mensagem. A trava impede que toques repetidos enviem o mesmo comprovante ao
mesmo contato. Uma resposta de rede incerta bloqueia novo envio até conferência
manual, para evitar duplicidade.

## 4. Configurar Secrets e publicar a função

No Supabase, configure os Secrets:

- `WHATSAPP_ACCESS_TOKEN`: token da Meta; nunca colocar no GitHub ou no app.
- `WHATSAPP_PHONE_NUMBER_ID`: ID do número **+55 84 99801-6062**.
- `WHATSAPP_TEMPLATE_NAME`: `comprovante_avaria_entrega` (opcional, esse é o padrão).
- `WHATSAPP_TEMPLATE_LANGUAGE`: `pt_BR` (opcional, esse é o padrão).
- `WHATSAPP_GRAPH_VERSION`: versão habilitada pela Meta, por exemplo `v26.0` (opcional).

`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY` são fornecidos
pelo projeto Supabase à função. Depois publique:

```powershell
npx supabase@latest functions deploy send-damage-receipt --project-ref jrsjbcdahqpcgcvzdtfb
```

Mantenha a verificação JWT habilitada. A função só aceita uma avaria criada pelo
usuário conectado e um contato cadastrado para o mesmo cliente. O navegador não
fornece nem o número de destino nem o texto usado no envio.

## 5. Teste de ativação

1. Instale a versão 1.7.20 ou atualize o app web.
2. Crie uma avaria de teste com um contato autorizado da empresa.
3. Toque **Enviar comprovante** e confira que a conversa recebeu a mensagem do
   número **(84) 99801-6062**, sem abrir o WhatsApp do motorista.
4. Confira em `damage_receipt_sends` o status `ACCEPTED` e o `provider_message_id`.
5. Toque novamente: deve informar que o envio já foi aceito, sem duplicar.
6. Confirme que o aplicativo WhatsApp Business da empresa segue funcionando.

`ACCEPTED` significa que a API da Meta aceitou a solicitação, não que o celular
do cliente recebeu a mensagem. Para acompanhar entrega e leitura, será preciso
adicionar um webhook de status da Meta em uma etapa posterior.
