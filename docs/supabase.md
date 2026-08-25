# Supabase do Em Dia

## Situação do projeto antigo

O projeto exibido na captura foi pausado em 20/06/2025 e ultrapassou a janela de
restauração pelo painel. Ele não pode ser simplesmente reativado no plano Free.

Como esta aplicação ainda começa sem dados reais, o caminho recomendado é criar
um projeto Supabase novo. Só use “Restore the backup to a new Supabase project”
se houver dados antigos que realmente precisem ser preservados.

## Criar e preparar o projeto novo

1. No Dashboard do Supabase, abra a organização “Gustavo Adriano”.
2. Clique em “New project”.
3. Use o nome “Em Dia - Gestão de Obras”.
4. Gere e guarde a senha do banco em um gerenciador de senhas.
5. Escolha a região mais próxima dos usuários no Brasil.
6. Quando o projeto estiver ativo, abra “SQL Editor” e execute, em ordem, os
   arquivos da pasta supabase/queries.
7. Em “Authentication > URL Configuration”, defina:
   - Site URL: https://emdia.everlenz.com.br
   - Redirect URL: https://emdia.everlenz.com.br/**
8. Em “Project Settings > API” ou no botão “Connect”, copie apenas:
   - Project URL
   - Publishable key (ou anon key em projetos legados)

Não compartilhe a service_role, a secret key nem a senha do banco. Elas não são
necessárias para conectar o navegador e ignoram as políticas RLS.

## Variáveis do Coolify

Cadastre como variáveis de ambiente da aplicação:

NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICAVEL
NEXT_PUBLIC_APP_URL=https://emdia.everlenz.com.br

Depois salve e faça “Redeploy”. Variáveis NEXT_PUBLIC são incorporadas durante o
build, portanto reiniciar sem reconstruir a imagem não é suficiente.

## Armazenamento

As migrations criam dois buckets privados:

- worksite-photos: fotos do Diário de Obra, até 15 MB por arquivo;
- project-files: plantas, memoriais, contratos e demais documentos, até 50 MB.

O acesso é controlado por organização, projeto e função da pessoa. URLs de
download devem ser temporárias (signed URLs); nenhum bucket da obra é público.
