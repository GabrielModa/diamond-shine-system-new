# Diamond Shine System (Quick Start)

Guia rápido para subir o projeto e testar login localmente.

## 1) Instalar dependências

```bash
npm install
```

> Se seu ambiente bloquear o registry npm, rode em uma máquina/rede com acesso ao `registry.npmjs.org`.

## 2) Configurar banco + seed (cria tabelas e usuários de teste)

```bash
npm run db:setup
```

Esse comando faz:
- `prisma generate`
- `prisma db push`
- seed de usuários (`scripts/seed-dev.js`)

## 3) Subir aplicação

```bash
npm run dev
```

Abra: `http://localhost:3000/login`

## 4) Login de teste

Use qualquer um abaixo com a mesma senha:

- `admin@ds.ie`
- `super@ds.ie`
- `employee@ds.ie`
- `viewer@ds.ie`

Senha para todos:

- `password123`

## 5) Testar endpoint de login via terminal (opcional)

```bash
curl -i -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@ds.ie","password":"password123"}'
```

Esperado: `200 OK` + cookies `ds-auth` e `ds-role`.

## 6) Se der erro 500 no login

Quase sempre é banco não inicializado.

1. Pare o servidor.
2. Rode de novo:

```bash
npm run db:setup
```

3. Suba novamente:

```bash
npm run dev
```

Se persistir, confira se o `DATABASE_URL` no `.env` está apontando para SQLite local (`file:./dev.db`) e se o arquivo `prisma/dev.db` foi criado.
