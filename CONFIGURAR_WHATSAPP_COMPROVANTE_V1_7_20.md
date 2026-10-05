# Comprovante de avaria pelo WhatsApp da empresa — v1.7.20

O botão **Enviar comprovante** chama a Edge Function `send-damage-receipt`. Ela usa a
WhatsApp Business Platform Cloud API para enviar um modelo de mensagem a partir
do número corporativo **(84) 99801-6062**. O token da Meta fica apenas nos
Secrets do Supabase. O botão separado **Abrir envio manual pelo meu WhatsApp**
mantém o procedimento anterior enquanto a integração é ativada.

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
4. Planeje o atendimento das respostas: o Disb Gestão v1.7.20 **apenas envia**
   comprovantes. Ele ainda não mostra mensagens que os clientes responderem.

**Não retire o número do aplicativo nesta etapa.** Conclua a preparação da Meta,
o modelo e o backend abaixo; faça a troca do número somente na etapa 5.

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

1. Instale a versão 1.7.20 ou atualize o app web.
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
