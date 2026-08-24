# Everlenz Obras

Plataforma técnica para planejamento, acompanhamento fotográfico e comunicação de obras. O protótipo conecta o avanço do Gantt aos registros do diário e transforma esses dados em status reports claros para o cliente.

Domínio sugerido: `obras.everlenz.com.br`.

## O que já funciona

- painel responsivo com mini indicadores expansíveis no mobile;
- Gantt com EAP, linha de base, caminho crítico e edição do avanço;
- diário de obra com vínculo à atividade, descrição, efetivo e upload de foto;
- atualização da porcentagem da atividade ao salvar o registro;
- prévia diagramada do status report e impressão em PDF pelo navegador;
- equipe com papéis e convite simulado;
- temas claro e escuro com visual liquid glass;
- estrutura inicial de banco Supabase com RLS multiusuário.

Os dados exibidos nesta primeira entrega são demonstrativos e ficam em memória durante a sessão. O esquema pronto para a integração está em `supabase/schema.sql`.

## Desenvolvimento

```bash
npm install
npm run dev
```

Acesse `http://localhost:3000`.

## Validação

```bash
npm run lint
npm run build
```

## Coolify

1. Crie uma aplicação usando o repositório GitHub.
2. Selecione o build por `Dockerfile` e a raiz `/`.
3. Exponha a porta `3000`.
4. Configure o domínio `https://obras.everlenz.com.br`.
5. Cadastre as variáveis do `.env.example` como secrets.
6. Faça o deploy.

O `Dockerfile` usa a saída standalone do Next.js e executa como usuário sem privilégios.

## Documentação

- [Pesquisa de mercado](docs/market-research.md)
- [Modelo inicial do Supabase](supabase/schema.sql)
