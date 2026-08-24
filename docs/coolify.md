# Publicação do Em Dia no Coolify

Este projeto está preparado para publicação pelo `Dockerfile`, usando a porta interna `3000` e o domínio `https://emdia.everlenz.com.br`.

## Criação pelo painel

1. Abra o projeto e o ambiente desejado no Coolify.
2. Clique em **+ New** e escolha **Public Repository**.
3. Informe `https://github.com/AssistenteEverlenz/everlenz-gestao-projetos`.
4. Selecione a branch `main`.
5. Em **Build Pack**, escolha **Dockerfile**.
6. Use `/` como **Base Directory** e `/Dockerfile` como **Dockerfile Location**.
7. Configure `3000` em **Ports Exposes**.
8. Configure `https://emdia.everlenz.com.br` em **Domains**.
9. Mantenha **Force HTTPS** habilitado.
10. Use `/` como caminho do health check e código esperado `200`.
11. Clique em **Deploy** e confira no log se o commit publicado é o mais recente da branch `main`.

O protótipo atual não exige variáveis de ambiente para iniciar. As variáveis do Supabase serão adicionadas quando a persistência for conectada.

## Deploy automático a cada push

Para um repositório público, use o webhook manual do GitHub:

1. No recurso do Em Dia, abra **Configuration → Advanced → Deployment** e habilite **Auto Deploy**.
2. Abra **Configuration → Webhooks**.
3. Gere um segredo aleatório longo em **GitHub Webhook Secret** e salve.
4. Copie a URL exibida em **Manual Git Webhooks → GitHub**.
5. No GitHub, abra **Settings → Webhooks → Add webhook**.
6. Cole a URL do Coolify em **Payload URL**.
7. Selecione `application/json` em **Content type**.
8. Informe o mesmo segredo configurado no Coolify.
9. Mantenha a validação SSL habilitada, selecione apenas o evento **push** e deixe o webhook ativo.
10. Faça um commit de teste na branch `main` e confirme a nova execução em **Deployments** no Coolify.

## Criação pela API

Com a URL da instalação e um token temporário, o fluxo é:

1. `GET /api/v1/projects` para localizar o projeto.
2. `GET /api/v1/servers` para localizar o servidor de destino.
3. `POST /api/v1/applications/public` usando:

```json
{
  "project_uuid": "UUID_DO_PROJETO",
  "server_uuid": "UUID_DO_SERVIDOR",
  "environment_name": "production",
  "git_repository": "https://github.com/AssistenteEverlenz/everlenz-gestao-projetos",
  "git_branch": "main",
  "build_pack": "dockerfile",
  "dockerfile_location": "/Dockerfile",
  "ports_exposes": "3000",
  "domains": "https://emdia.everlenz.com.br",
  "name": "emdia-everlenz",
  "description": "Gestão de obras, diário de campo e status reports",
  "instant_deploy": true,
  "autogenerate_domain": false
}
```

4. `PATCH /api/v1/applications/{uuid}` para confirmar `is_force_https_enabled`, health check e opções de deploy.
5. Configurar o webhook de push do GitHub.

O token da API nunca deve ser incluído no repositório. Após a configuração, revogue o token temporário com acesso root e crie outro limitado a **deploy** para futuras automações.
