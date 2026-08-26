# Em Dia — by Everlenz

Plataforma técnica para planejamento, acompanhamento fotográfico e comunicação de obras. O protótipo conecta o avanço do Gantt aos registros do diário e transforma esses dados em status reports claros para o cliente.

Domínio da versão de teste: `emdia.everlenz.com.br`.

## O que já funciona

- criação de projetos a partir de um ambiente vazio;
- painel responsivo com mini indicadores expansíveis no mobile;
- Gantt com EAP, itens pai, quatro tipos de dependência, espera, datas, linha de
  base, responsáveis, pesos, cores, marcos e caminho crítico;
- diário mobile-first com múltiplas fotos, vínculo obrigatório à atividade,
  assistente em cinco etapas, ditado, equipes de campo, clima e medição do percentual executado no dia;
- atualização rastreável da atividade e dos itens pai ao salvar o diário;
- galeria por EAP, acesso ao diário e relatório fotográfico em lote;
- estoque com reservas por EAP, consumo e alertas de reposição;
- status report com aprovação auditável, resumo executivo, Curva S, fotos e Gantt completo;
- central de atenção para atrasos, suprimentos, relatórios e ocorrências;
- equipes operacionais por empresa e especialidade;
- equipe com papéis e convite simulado;
- temas claro e escuro com visual liquid glass;
- menu lateral que recolhe após 400 ms e expande ao receber o cursor;
- migrations Supabase com transação de medição, RLS multiusuário e Storage privado.

Sem as variáveis do Supabase, a versão de teste usa persistência local no
navegador. Depois da configuração, a mesma interface será alimentada pelo banco.
As migrations estão em `supabase/queries`.

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
4. Configure o domínio `https://emdia.everlenz.com.br`.
5. Cadastre as variáveis do `.env.example` como secrets.
6. Faça o deploy.

O `Dockerfile` usa a saída standalone do Next.js e executa como usuário sem privilégios.

## Documentação

- [Pesquisa de mercado](docs/market-research.md)
- [Publicação no Coolify](docs/coolify.md)
- [Configuração do Supabase](docs/supabase.md)
- [Migrations e funções do banco](supabase/queries/README.md)
