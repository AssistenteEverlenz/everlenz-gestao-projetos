import { NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://vgtqnphmmdxsclfagjor.supabase.co";
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_AAtXENyy7qmM7PQCiD_HKg_4gP7T40u";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const allowedRoles = ["admin", "manager", "engineer"] as const;
type AccountRole = (typeof allowedRoles)[number];

class ApiError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function password() { return `${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}Aa!`; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function normalizeRole(role: string | null | undefined): AccountRole {
  return role === "admin" || role === "manager" ? role : "engineer";
}
function clients() {
  if (!serviceRoleKey) throw new ApiError("A chave de administração do Supabase não está configurada.", 500);
  return {
    auth: createClient(supabaseUrl, supabasePublicKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    admin: createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}

type Context = {
  admin: SupabaseClient;
  requester: User;
  requesterRole: "admin" | "manager";
  organizationId: string;
  /** Obras da organização, da mais antiga para a mais nova. */
  projects: { id: string; created_by: string }[];
  /** Obras cujo acesso o solicitante pode conceder ou retirar. */
  manageable: Set<string>;
};

async function authorize(request: Request): Promise<Context> {
  const { auth, admin } = clients();
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ApiError("Sessão inválida. Entre novamente.", 401);
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) throw new ApiError("Não foi possível validar o usuário logado.", 401);
  const { data: profile, error: profileError } = await admin.from("profiles").select("organization_id,account_role").eq("id", user.id).maybeSingle();
  if (profileError) throw new ApiError(`Erro ao validar as permissões: ${profileError.message}`, 500);
  if (!profile?.organization_id) throw new ApiError("Usuário sem organização.", 403);
  const role = normalizeRole(profile.account_role);
  if (role !== "admin" && role !== "manager") throw new ApiError("Você não pode gerenciar usuários.", 403);
  const { data: projects, error: projectsError } = await admin.from("projects").select("id,created_by").eq("organization_id", profile.organization_id).order("created_at");
  if (projectsError) throw new ApiError(`Erro ao consultar as obras: ${projectsError.message}`, 500);
  let manageable = new Set((projects ?? []).map((project) => project.id));
  if (role === "manager") {
    const { data: own, error: ownError } = await admin.from("project_members").select("project_id").eq("user_id", user.id).in("project_id", [...manageable]);
    if (ownError) throw new ApiError(`Erro ao consultar as suas obras: ${ownError.message}`, 500);
    manageable = new Set((own ?? []).map((row) => row.project_id));
  }
  return { admin, requester: user, requesterRole: role, organizationId: profile.organization_id, projects: projects ?? [], manageable };
}

async function findUser(admin: SupabaseClient, email: string): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 });
    if (error) throw new ApiError(`Erro ao consultar os acessos: ${error.message}`, 500);
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < 100) break;
  }
  return null;
}

async function loadTarget(context: Context, userId: string) {
  const { data, error } = await context.admin.from("profiles").select("organization_id,account_role,full_name").eq("id", userId).maybeSingle();
  if (error) throw new ApiError(`Erro ao consultar o colaborador: ${error.message}`, 500);
  if (!data || data.organization_id !== context.organizationId) throw new ApiError("Colaborador não encontrado.", 404);
  const { data: memberships, error: membershipError } = await context.admin.from("project_members").select("project_id").eq("user_id", userId).in("project_id", context.projects.map((project) => project.id));
  if (membershipError) throw new ApiError(`Erro ao consultar as obras do colaborador: ${membershipError.message}`, 500);
  return { role: normalizeRole(data.account_role), name: data.full_name as string, projectIds: new Set((memberships ?? []).map((row) => row.project_id)) };
}

function readProjectIds(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.map((id) => String(id)))] : null;
}

/**
 * Grava as obras do colaborador. Obras fora do alcance do solicitante não mudam;
 * administradores recebem todas; quem criou uma obra nunca perde o acesso a ela.
 */
async function applyAccess(context: Context, userId: string, role: AccountRole, current: Set<string>, requested: string[] | null) {
  const all = context.projects.map((project) => project.id);
  let next: Set<string>;
  if (role === "admin") next = new Set(all);
  else if (requested === null) next = new Set(current);
  else {
    next = new Set([...current].filter((id) => !context.manageable.has(id)));
    requested.filter((id) => context.manageable.has(id)).forEach((id) => next.add(id));
    context.projects.filter((project) => project.created_by === userId).forEach((project) => next.add(project.id));
  }
  const removed = [...current].filter((id) => !next.has(id));
  if (removed.length) {
    const { error } = await context.admin.from("project_members").delete().eq("user_id", userId).in("project_id", removed);
    if (error) throw new ApiError(`Erro ao retirar o acesso às obras: ${error.message}`, 500);
  }
  if (next.size) {
    const now = new Date().toISOString();
    const rows = [...next].map((projectId) => ({ project_id: projectId, user_id: userId, role, accepted_at: now }));
    const { error } = await context.admin.from("project_members").upsert(rows, { onConflict: "project_id,user_id" });
    if (error) throw new ApiError(`Erro ao liberar as obras: ${error.message}`, 500);
  }
  return [...next];
}

function responseError(cause: unknown, fallback: string) {
  return NextResponse.json({ error: cause instanceof Error ? cause.message : fallback }, { status: cause instanceof ApiError ? cause.status : 400 });
}

export async function POST(request: Request) {
  let createdId: string | null = null;
  try {
    const body = await request.json() as { name?: string; email?: string; role?: string; projectIds?: unknown };
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "engineer") as AccountRole;
    const projectIds = readProjectIds(body.projectIds) ?? [];
    if (!name || !email) throw new ApiError("Preencha nome, e-mail e perfil.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError("Informe um e-mail válido.");
    if (!allowedRoles.includes(role)) throw new ApiError("Perfil de acesso inválido.");
    const context = await authorize(request);
    if (context.requesterRole === "manager" && role !== "engineer") throw new ApiError("Gestores podem criar apenas usuários do perfil Usuário.", 403);
    if (role !== "admin" && !projectIds.some((id) => context.manageable.has(id))) throw new ApiError("Selecione ao menos uma obra para este usuário.");
    let authUser = await findUser(context.admin, email);
    let temporaryPassword: string | null = null;
    if (authUser) {
      const { data: existingProfile, error: lookupError } = await context.admin.from("profiles").select("organization_id").eq("id", authUser.id).maybeSingle();
      if (lookupError) throw new ApiError(`Erro ao consultar o perfil: ${lookupError.message}`, 500);
      if (existingProfile?.organization_id === context.organizationId) throw new ApiError("Este usuário já faz parte da conta. Edite as obras dele na lista.", 409);
      if (existingProfile?.organization_id) throw new ApiError("Este e-mail já pertence a uma organização diferente.", 409);
    } else {
      temporaryPassword = password();
      const { data, error } = await context.admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: name, must_change_password: true } });
      if (error) throw new ApiError(`Erro ao criar o login: ${error.message}`);
      authUser = data.user; createdId = authUser.id;
    }
    const { error: profileError } = await context.admin.from("profiles").upsert({ id: authUser.id, organization_id: context.organizationId, full_name: name, email, account_role: role });
    if (profileError) throw new ApiError(`Erro ao preparar o perfil: ${profileError.message}`);
    const granted = await applyAccess(context, authUser.id, role, new Set(), projectIds);
    createdId = null;
    return NextResponse.json({ member: { id: authUser.id, name, email, role, initials: initials(name), color: "#54756a", online: false, projectIds: granted }, senha_provisoria: temporaryPassword, projetos_liberados: granted.length });
  } catch (cause) {
    if (createdId && serviceRoleKey) {
      const admin = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
      await admin.auth.admin.deleteUser(createdId).catch(() => undefined);
    }
    return responseError(cause, "Não foi possível criar o usuário.");
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { action?: string; userId?: string; name?: string; role?: string; projectIds?: unknown };
    const userId = String(body.userId ?? "").trim();
    if (!userId) throw new ApiError("Usuário é obrigatório.");
    const context = await authorize(request);
    const target = await loadTarget(context, userId);
    const action = body.action === "reset_password" ? "reset_password" : "update";
    const managerRule = context.requesterRole === "manager";
    if (managerRule && target.role === "admin") throw new ApiError("Gestores não podem alterar administradores.", 403);
    const { data: { user: authTarget }, error: targetError } = await context.admin.auth.admin.getUserById(userId);
    if (targetError || !authTarget) throw new ApiError("Login do colaborador não encontrado.", 404);

    if (action === "reset_password") {
      if (userId === context.requester.id) throw new ApiError("Use Configurações para alterar a sua própria senha.", 409);
      if (managerRule && target.role !== "engineer") throw new ApiError("Gestores podem redefinir a senha apenas de usuários do perfil Usuário.", 403);
      const temporaryPassword = password();
      const { error } = await context.admin.auth.admin.updateUserById(userId, { password: temporaryPassword, user_metadata: { ...authTarget.user_metadata, must_change_password: true } });
      if (error) throw new ApiError(`Erro ao redefinir a senha: ${error.message}`, 500);
      return NextResponse.json({ senha_provisoria: temporaryPassword, email: authTarget.email ?? "" });
    }

    const name = String(body.name ?? target.name).trim();
    const role = body.role === undefined ? target.role : String(body.role) as AccountRole;
    if (!name) throw new ApiError("Informe o nome do usuário.");
    if (!allowedRoles.includes(role)) throw new ApiError("Perfil de acesso inválido.");
    if (managerRule && target.role !== "engineer" && (name !== target.name || role !== target.role)) throw new ApiError("Gestores podem alterar apenas as obras de outro gestor.", 403);
    if (managerRule && role !== target.role && role !== "engineer") throw new ApiError("Gestores podem atribuir apenas o perfil Usuário.", 403);
    if (context.projects[0]?.created_by === userId && role !== "admin") throw new ApiError("O proprietário da conta deve permanecer Administrador.", 409);
    if (userId === context.requester.id && role !== target.role) throw new ApiError("Você não pode alterar o próprio perfil de acesso.", 409);
    // Ninguém altera as próprias obras: o administrador já vê todas e o gestor não pode se retirar.
    const requested = userId === context.requester.id ? null : readProjectIds(body.projectIds);

    if (name !== target.name) {
      const { error: authError } = await context.admin.auth.admin.updateUserById(userId, { user_metadata: { ...authTarget.user_metadata, full_name: name } });
      if (authError) throw new ApiError(`Erro ao atualizar o login: ${authError.message}`, 500);
    }
    const { error: profileError } = await context.admin.from("profiles").update({ full_name: name, account_role: role }).eq("id", userId);
    if (profileError) throw new ApiError(`Erro ao atualizar o perfil: ${profileError.message}`, 500);
    const granted = await applyAccess(context, userId, role, target.projectIds, requested);
    return NextResponse.json({ member: { id: userId, name, email: authTarget.email ?? "", role, initials: initials(name), color: "#54756a", online: false, projectIds: granted } });
  } catch (cause) { return responseError(cause, "Não foi possível atualizar o usuário."); }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { userId?: string };
    const userId = String(body.userId ?? "").trim();
    if (!userId) throw new ApiError("Usuário é obrigatório.");
    const context = await authorize(request);
    if (userId === context.requester.id) throw new ApiError("Você não pode excluir o próprio acesso.", 409);
    const target = await loadTarget(context, userId);
    if (context.requesterRole === "manager") {
      if (target.role !== "engineer") throw new ApiError("Gestores podem excluir apenas usuários do perfil Usuário.", 403);
      // O gestor retira o acesso às obras dele; o login só some se não sobrar nenhuma obra.
      const remaining = await applyAccess(context, userId, target.role, target.projectIds, []);
      if (remaining.length) return NextResponse.json({ deleted: false, remainingProjects: remaining.length });
    }
    if (context.projects.some((project) => project.created_by === userId)) throw new ApiError("Quem criou uma obra não pode ser excluído. Altere o perfil ou retire as demais obras.", 409);
    const { error } = await context.admin.auth.admin.deleteUser(userId);
    if (error) throw new ApiError(`Erro ao excluir o usuário: ${error.message}`, 500);
    return NextResponse.json({ deleted: true });
  } catch (cause) { return responseError(cause, "Não foi possível excluir o usuário."); }
}
