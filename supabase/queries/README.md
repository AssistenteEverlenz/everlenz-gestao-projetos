# Queries do Supabase

Execute os arquivos no SQL Editor de um projeto Supabase novo, nesta ordem:

1. 001_schema.sql
2. 002_functions.sql
3. 003_rls.sql
4. 004_storage.sql
5. 005_report_views.sql
6. 006_team_invitations.sql
7. 007_project_deletion_cascade.sql
8. 008_editable_daily_progress.sql
9. 009_gantt_hierarchy.sql
10. 010_work_calendar.sql
11. 011_team_accounts.sql
12. 012_realtime.sql
13. 013_field_operations.sql
14. 014_inventory_control.sql
15. 015_stock_receivers.sql
16. 016_inventory_movement_management.sql
17. 017_project_portfolio_and_task_responsibles.sql
18. 018_brand_identity.sql
19. 019_project_brand_variants.sql
20. 020_task_duration_and_bulk_delete.sql

O fluxo crítico usa a função record_daily_progress. Ela bloqueia a atividade,
calcula o percentual final e grava diário, medição e metadados das fotos na mesma
transação. Essa função usa SECURITY DEFINER somente para permitir que encarregados
atualizem o percentual; antes de qualquer escrita ela valida a participação e o
papel do usuário no projeto. Os binários devem ser enviados antes ao bucket privado
worksite-photos, no caminho:

organization_id/project_id/YYYY-MM-DD/update_uuid/arquivo

Nunca coloque a service_role no navegador ou em variável NEXT_PUBLIC.
O cliente web usa somente a chave publicável/anon e as políticas RLS.

A migration 013 acrescenta equipes operacionais, estoque e reservas por EAP,
ocorrências, modelos de relatório, trilha de aprovação e canais Realtime. Ela já
foi aplicada ao ambiente de teste; em um projeto novo deve ser executada depois
das migrations anteriores.

A migration 014 completa o estoque com histórico rastreável, requisições por
usuário, aprovação e atendimento com baixa atômica, além da importação em lote.
O modelo público `modelo-importacao-estoque.csv` deve ser validado integralmente
no cliente antes da chamada da função `import_inventory_items`; a função mantém
todo o lote em uma única transação e não deixa registros parciais em caso de erro.

A migration 015 acrescenta os colaboradores das equipes de campo, destinatários
rastreáveis para retiradas e a numeração interna automática das movimentações.

A migration 016 permite que administradores e gestores editem ou excluam
movimentações com recálculo transacional de todo o histórico, saldos e consumos
por EAP. As versões anteriores ficam preservadas na trilha de auditoria.

A migration 018 cria a identidade visual configurável, com um PNG para a
organização e outro para cada projeto. Os arquivos ficam no bucket público
`brand-assets`; somente administradores e gestores podem alterá-los.

A migration 019 separa as identidades da empresa, do cliente e da obra e permite
configurar uma cor de fundo para cada marca.

A migration 020 armazena durações fracionadas e adiciona a exclusão transacional
de conjuntos do Gantt, incluindo a validação dos registros do Diário de Obra.
