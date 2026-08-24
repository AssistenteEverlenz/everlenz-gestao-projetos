# Pesquisa de referências do produto

Pesquisa realizada em 24 de agosto de 2026, usando documentação e páginas oficiais dos fornecedores.

## Padrões consolidados

- **Microsoft Project:** hierarquia EAP, tarefas-resumo e subtarefas, dependências FS/SS/FF/SF, calendários, caminho crítico, folgas e comparação entre linha de base e realizado. Referências: [visão Gantt](https://support.microsoft.com/en-us/project/work-with-the-gantt-chart-view), [como o Project agenda tarefas](https://support.microsoft.com/en-US/project/how-project-schedules-tasks-behind-the-scenes) e [visões de acompanhamento](https://support.microsoft.com/en-us/project/overview-of-project-views).
- **Procore:** diário como registro auditável do dia, incluindo fotos, comentários, acidentes, quantidades, produtividade, atrasos e histórico de alterações. Referência: [Daily Log Overview](https://support.procore.com/products/online/user-guide/project-level/daily-log/tutorials/daily-log-overview).
- **Autodesk Construction Cloud / Forma Build:** captura de campo via web e mobile, fotos e ocorrências vinculadas ao trabalho, dados atualizados e compartilhamento rápido com a equipe. Referência: [Forma Build](https://www.autodesk.com/products/forma-build/overview).
- **Mobuss Construção:** RDO configurável com clima, efetivo, máquinas, ocorrências, fotos, vídeos, aprovação e assinatura digital. Referência: [Diário de Obras](https://www.mobussconstrucao.com.br/modulo/diario-de-obras/).
- **Sienge:** avanço físico comparando linha base, medido e reprojetado; diário integrado a tarefas, equipes, equipamentos, clima, ocorrências e anexos. Referências: [cronograma de obra](https://ajuda.sienge.com.br/support/solutions/articles/153000258958-como-cadastrar-um-cronograma-de-obra-) e [equipes e equipamentos no diário](https://ajuda.sienge.com.br/support/solutions/articles/153000199095-como-adicionar-equipes-e-equipamentos-em-di%C3%A1rio-de-obra-).

## Direção adotada

O MVP do Em Dia não tenta reproduzir um ERP completo. O fluxo central é:

`Atividade do Gantt → registro diário → evidência fotográfica → avanço auditável → status report`

Isso preserva a profundidade técnica do MS Project no cronograma, mas transforma a atualização diária em uma experiência rápida de canteiro. O cliente recebe uma visão narrativa e visual, sem precisar interpretar a complexidade do Gantt.

## Escopo do MVP

1. Portfólio e visão geral por obra.
2. Gantt com EAP, linha de base, dependências e caminho crítico.
3. Diário com fotos, descrição, clima, efetivo e atualização percentual.
4. Status report diário gerado a partir dos registros aprovados.
5. Equipe com papéis de administrador, gestor, engenheiro, encarregado e cliente.
6. Tema claro/escuro e UX responsiva.

## Próximas camadas

- cálculo automático de datas e caminho crítico;
- calendário de dias úteis, feriados e jornadas;
- aprovação/assinatura do RDO;
- notificações e envio por e-mail/WhatsApp;
- modo offline para o canteiro;
- custos e curva físico-financeira;
- importação de arquivos do Microsoft Project;
- trilha de auditoria e geolocalização opcional das fotos.
