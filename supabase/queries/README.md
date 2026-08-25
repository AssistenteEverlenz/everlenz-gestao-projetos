# Queries do Supabase

Execute os arquivos no SQL Editor de um projeto Supabase novo, nesta ordem:

1. 001_schema.sql
2. 002_functions.sql
3. 003_rls.sql
4. 004_storage.sql
5. 005_report_views.sql

O fluxo crítico usa a função record_daily_progress. Ela bloqueia a atividade,
calcula o percentual final e grava diário, medição e metadados das fotos na mesma
transação. Os binários devem ser enviados antes ao bucket privado
worksite-photos, no caminho:

organization_id/project_id/YYYY-MM-DD/update_uuid/arquivo

Nunca coloque a service_role no navegador ou em variável NEXT_PUBLIC.
O cliente web usa somente a chave publicável/anon e as políticas RLS.
