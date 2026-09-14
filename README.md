 # BONITAS — Loja virtual com WhatsApp e painel administrativo

Sistema completo em Node.js, Express e SQLite. Inclui vitrine responsiva, busca e filtros, favoritos, carrinho, checkout, pedido salvo no banco antes de abrir o WhatsApp, painel administrativo protegido, produtos, fotos, estoque por tamanho/cor, pedidos, cupons e configurações.

O cliente pode usar **Acompanhar pedido** na loja e consultar com o número `BON-000001` e o mesmo WhatsApp informado na compra. A página mostra o status e o histórico atualizado pelo painel administrativo sem expor endereço, e-mail ou pedidos de outras pessoas.

## 1. Instalar o Node.js

Instale o **Node.js 22 LTS ou mais recente** em <https://nodejs.org/>. No Windows, mantenha marcada a opção de adicionar o Node ao PATH. Depois, abra um novo PowerShell e confirme:

```bash
node --version
npm --version
```

## 2. Instalar o projeto

Abra o terminal dentro da pasta `bonitas-store` e execute:

```bash
npm install
```

Copie `.env.example` para `.env`. No Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Edite o `.env` e substitua `SESSION_SECRET` por uma frase aleatória longa, com pelo menos 32 caracteres. Em produção, use HTTPS e defina `NODE_ENV=production`.

## 3. Criar o primeiro administrador

```bash
npm run create-admin
```

Digite nome, e-mail e uma senha com no mínimo 10 caracteres. A senha é transformada em hash bcrypt e nunca é salva em texto puro.

Se o painel informar e-mail ou senha incorretos, pare o servidor e redefina o acesso:

```bash
npm run reset-admin
```

Esse comando cria o administrador caso ele ainda não exista ou troca com segurança a senha do e-mail informado.

## 4. Iniciar

```bash
npm start
```

- Loja: <http://localhost:3000>
- Painel: <http://localhost:3000/admin>

Entre no painel com o e-mail e a senha criados no passo anterior.

## Como administrar

- **Cadastrar roupa:** Painel → Produtos → Novo produto. Preencha preços, cores, estoque por tamanho e envie até seis imagens JPG, PNG ou WebP de no máximo 5 MB cada.
- **Limpar produtos antigos:** pare o servidor e execute `npm run clear-products`. Digite `APAGAR` para confirmar. Pedidos antigos preservam o nome e o preço dos itens comprados.
- **Trocar WhatsApp, Instagram, endereço e entrega:** Painel → Configurações. O WhatsApp deve conter DDI e DDD, somente números; exemplo: `5583999999999`.
- **Atualizar estoque:** edite o produto. O estoque é separado por tamanho e cor.
- **Confirmar pedido:** Painel → Pedidos → Ver pedido → status `Confirmado`. Nesse momento o estoque é baixado em uma transação e nunca pode ficar negativo.
- **Criar cupom:** Painel → Cupons → Novo cupom. Cupons de porcentagem ou valor fixo são validados no servidor.
- **Trocar fotos, preços ou descrições:** edite o produto no painel; não é necessário alterar código.

O banco é a fonte oficial para preço, estoque, cupom e número do pedido. O carrinho fica no `localStorage` apenas como conveniência no aparelho do cliente.

Uma instalação nova começa sem produtos demonstrativos. Cadastre somente as roupas reais pelo painel.

## Hospedagem com SQLite

Em uma hospedagem com disco persistente, defina `DATA_DIR=/data`. O banco e as imagens enviadas ficarão dentro desse diretório. Sem disco persistente, o banco e as fotos podem desaparecer quando o serviço reiniciar.

Para o primeiro acesso na hospedagem, defina `ADMIN_EMAIL` e `ADMIN_PASSWORD_INITIAL` nas variáveis privadas do serviço. Se ainda não existir administrador, ele será criado automaticamente. Depois do primeiro login, remova `ADMIN_PASSWORD_INITIAL` das variáveis.

## Backup e restauração

Pare o servidor antes do backup. Copie estes arquivos da pasta `database`:

```text
bonitas.db
bonitas.db-wal (se existir)
bonitas.db-shm (se existir)
```

Guarde também `public/uploads`, pois contém as fotos enviadas pelo painel. Para restaurar, pare o servidor, substitua o banco e a pasta de uploads pelos arquivos do backup e inicie novamente.

## Segurança e produção

O projeto usa Helmet/CSP, limite de tentativas de login, sessão em cookie `httpOnly`/`sameSite`, token CSRF nas alterações administrativas, bcrypt, consultas preparadas, validação no servidor e limite de upload/requisição. Preços enviados pelo navegador nunca são aceitos; o pedido é recalculado no servidor.

Para colocar a loja publicamente na internet, use HTTPS, uma `SESSION_SECRET` forte, backups automáticos, proxy reverso e armazenamento persistente. O armazenamento padrão de sessões do Express é adequado para instalação simples, mas deve ser trocado por um armazenamento persistente (por exemplo Redis ou SQLite) antes de operar em várias instâncias.

## Estrutura principal

```text
bonitas-store/
├── database/database.js
├── middleware/auth.js
├── public/
│   ├── admin/
│   ├── css/style.css
│   ├── js/app.js
│   ├── uploads/
│   └── index.html
├── scripts/create-admin.js
├── .env.example
├── package.json
└── server.js
```
