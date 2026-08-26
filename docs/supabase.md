# Supabase do Em Dia

## Ambiente atual

- Project ref: lpfoxpqezcfdvdecfdos
- URL: https://lpfoxpqezcfdvdecfdos.supabase.co
- Migrations aplicadas em 25/08/2026
- Site URL do Auth: https://emdia.everlenz.com.br
- Buckets privados: worksite-photos e project-files

A aplicação usa a publishable key no navegador e exige uma sessão autenticada.
O token da Management API serve somente para provisionamento e deve ser revogado
depois da configuração.

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

Não compartilhe a service_role, a secret key nem a senha do banco. A
`service_role` ignora as políticas RLS e, neste projeto, deve existir somente no
ambiente protegido do servidor para a criação administrativa de usuários.

## Variáveis do Coolify

Cadastre como variáveis de ambiente da aplicação:

NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=SUA_CHAVE_PUBLICAVEL
SUPABASE_SERVICE_ROLE_KEY=SUA_CHAVE_SERVICE_ROLE_SECRETA
NEXT_PUBLIC_APP_URL=https://emdia.everlenz.com.br

Depois salve e faça “Redeploy”. Variáveis NEXT_PUBLIC são incorporadas durante o
build, portanto reiniciar sem reconstruir a imagem não é suficiente.

A `SUPABASE_SERVICE_ROLE_KEY` é usada exclusivamente pela rota de servidor
`/api/team`. Ela permite criar o login da nova pessoa com e-mail já confirmado e
uma senha provisória aleatória. A rota valida a sessão e o papel do administrador
ou gestor antes da operação. Nunca use o prefixo `NEXT_PUBLIC` nessa chave.

## Armazenamento

As migrations criam dois buckets privados:

- worksite-photos: fotos do Diário de Obra, até 15 MB por arquivo;
- project-files: plantas, memoriais, contratos e demais documentos, até 50 MB.

O acesso é controlado por organização, projeto e função da pessoa. URLs de
download devem ser temporárias (signed URLs); nenhum bucket da obra é público.
