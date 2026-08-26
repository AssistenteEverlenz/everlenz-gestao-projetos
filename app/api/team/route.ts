import { NextResponse } from "next/server";
import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://lpfoxpqezcfdvdecfdos.supabase.co";
const supabasePublicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_G_KSK1Ud0DPkXTR9iJIRhg_By7aDsa7";
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const allowedRoles = ["admin", "manager", "engineer"] as const;
type ProjectRole = (typeof allowedRoles)[number];

class ApiError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
function password() { return `${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}Aa!`; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase(); }
function clients() {
  if (!serviceRoleKey) throw new ApiError("A chave de administração do Supabase não está configurada.", 500);
  return {
    auth: createClient(supabaseUrl, supabasePublicKey, { auth: { persistSession: false, autoRefreshToken: false } }),
    admin: createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  };
}
async function authorize(request: Request, projectId: string) {
  const { auth, admin } = clients();
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new ApiError("Sessão inválida. Entre novamente.", 401);
  const { data: { user }, error } = await auth.auth.getUser(token);
  if (error || !user) throw new ApiError("Não foi possível validar o usuário logado.", 401);
  const { data: membership, error: membershipError } = await admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", user.id).maybeSingle();
  if (membershipError) throw new ApiError(`Erro ao validar as permissões: ${membershipError.message}`, 500);
  if (membership?.role !== "admin" && membership?.role !== "manager") throw new ApiError("Você não pode gerenciar esta equipe.", 403);
  const { data: project, error: projectError } = await admin.from("projects").select("organization_id,created_by").eq("id", projectId).single();
  if (projectError || !project) throw new ApiError("Projeto não encontrado.", 404);
  return { admin, requester: user, requesterRole: membership.role as "admin" | "manager", project };
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
async function targetRole(admin: SupabaseClient, projectId: string, userId: string) {
  const { data, error } = await admin.from("project_members").select("role").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  if (error) throw new ApiError(`Erro ao consultar o colaborador: ${error.message}`, 500);
  if (!data) throw new ApiError("Colaborador não encontrado.", 404);
  return data.role as string;
}
async function ensureCanManageTarget(admin: SupabaseClient, requesterRole: "admin" | "manager", projectId: string, userId: string, newRole?: ProjectRole) {
  const currentRole = await targetRole(admin, projectId, userId);
  if (requesterRole === "manager" && (currentRole !== "engineer" || (newRole && newRole !== "engineer"))) throw new ApiError("Gestores podem administrar apenas usuários do perfil Usuário.", 403);
}
function responseError(cause: unknown, fallback: string) {
  return NextResponse.json({ error: cause instanceof Error ? cause.message : fallback }, { status: cause instanceof ApiError ? cause.status : 400 });
}

export async function POST(request: Request) {
  let createdId: string | null = null;
  try {
    const body = await request.json() as { projectId?: string; name?: string; email?: string; role?: string };
    const projectId = String(body.projectId ?? "").trim();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "engineer") as ProjectRole;
    if (!projectId || !name || !email) throw new ApiError("Preencha nome, e-mail e perfil.");
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new ApiError("Informe um e-mail válido.");
    if (!allowedRoles.includes(role)) throw new ApiError("Perfil de acesso inválido.");
    const context = await authorize(request, projectId);
    if (context.requesterRole === "manager" && role !== "engineer") throw new ApiError("Gestores podem criar apenas usuários do perfil Usuário.", 403);
    let authUser = await findUser(context.admin, email);
    let temporaryPassword: string | null = null;
    if (!authUser) {
      temporaryPassword = password();
      const { data, error } = await context.admin.auth.admin.createUser({ email, password: temporaryPassword, email_confirm: true, user_metadata: { full_name: name, must_change_password: true } });
      if (error) throw new ApiError(`Erro ao criar o login: ${error.message}`);
      authUser = data.user; createdId = authUser.id;
    }
    const { data: existingProfile, error: lookupError } = await context.admin.from("profiles").select("organization_id").eq("id", authUser.id).maybeSingle();
    if (lookupError) throw new ApiError(`Erro ao consultar o perfil: ${lookupError.message}`, 500);
    if (existingProfile?.organization_id && existingProfile.organization_id !== context.project.organization_id) throw new ApiError("Este e-mail já pertence a uma organização diferente.", 409);
    const { error: profileError } = await context.admin.from("profiles").upsert({ id: authUser.id, organization_id: context.project.organization_id, full_name: name, email });
    if (profileError) throw new ApiError(`Erro ao preparar o perfil: ${profileError.message}`);
    const { data: projects, error: projectsError } = await context.admin.from("projects").select("id").eq("organization_id", context.project.organization_id);
    if (projectsError) throw new ApiError(`Erro ao consultar os projetos: ${projectsError.message}`, 500);
    const { data: duplicate } = await context.admin.from("project_members").select("user_id").eq("project_id", projectId).eq("user_id", authUser.id).maybeSingle();
    if (duplicate) throw new ApiError("Este usuário já faz parte da conta.", 409);
    const { error: membershipError } = await context.admin.from("project_members").upsert((projects ?? []).map((project) => ({ project_id: project.id, user_id: authUser!.id, role, accepted_at: new Date().toISOString() })), { onConflict: "project_id,user_id" });
    if (membershipError) throw new ApiError(`Erro ao liberar os projetos: ${membershipError.message}`, 500);
    createdId = null;
    return NextResponse.json({ member: { id: authUser.id, name, email, role, initials: initials(name), color: "#54756a", online: false }, senha_provisoria: temporaryPassword, projetos_liberados: projects?.length ?? 0 });
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
    const body = await request.json() as { action?: string; projectId?: string; userId?: string; name?: string; role?: string };
    const projectId = String(body.projectId ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    if (!projectId || !userId) throw new ApiError("Projeto e usuário são obrigatórios.");
    const context = await authorize(request, projectId);
    const action = body.action === "reset_password" ? "reset_password" : "update";
    const role = String(body.role ?? "engineer") as ProjectRole;
    if (action === "update" && !allowedRoles.includes(role)) throw new ApiError("Perfil de acesso inválido.");
    await ensureCanManageTarget(context.admin, context.requesterRole, projectId, userId, action === "update" ? role : undefined);
    if (context.project.created_by === userId && action === "update" && role !== "admin") throw new ApiError("O proprietário da conta deve permanecer Administrador.", 409);
    const { data: { user: target }, error: targetError } = await context.admin.auth.admin.getUserById(userId);
    if (targetError || !target) throw new ApiError("Login do colaborador não encontrado.", 404);
    if (action === "reset_password") {
      if (userId === context.requester.id) throw new ApiError("Use Configurações para alterar a sua própria senha.", 409);
      const temporaryPassword = password();
      const { error } = await context.admin.auth.admin.updateUserById(userId, { password: temporaryPassword, user_metadata: { ...target.user_metadata, must_change_password: true } });
      if (error) throw new ApiError(`Erro ao redefinir a senha: ${error.message}`, 500);
      return NextResponse.json({ senha_provisoria: temporaryPassword, email: target.email ?? "" });
    }
    const name = String(body.name ?? "").trim();
    if (!name) throw new ApiError("Informe o nome do usuário.");
    const { error: authError } = await context.admin.auth.admin.updateUserById(userId, { user_metadata: { ...target.user_metadata, full_name: name } });
    if (authError) throw new ApiError(`Erro ao atualizar o login: ${authError.message}`, 500);
    const { error: profileError } = await context.admin.from("profiles").update({ full_name: name }).eq("id", userId);
    if (profileError) throw new ApiError(`Erro ao atualizar o perfil: ${profileError.message}`, 500);
    const { data: projects } = await context.admin.from("projects").select("id").eq("organization_id", context.project.organization_id);
    const ids = (projects ?? []).map((project) => project.id);
    if (ids.length) {
      const { error: roleError } = await context.admin.from("project_members").update({ role }).eq("user_id", userId).in("project_id", ids);
      if (roleError) throw new ApiError(`Erro ao atualizar as permissões: ${roleError.message}`, 500);
    }
    return NextResponse.json({ member: { id: userId, name, email: target.email ?? "", role, initials: initials(name), color: "#54756a", online: false } });
  } catch (cause) { return responseError(cause, "Não foi possível atualizar o usuário."); }
}

export async function DELETE(request: Request) {
  try {
    const body = await request.json() as { projectId?: string; userId?: string };
    const projectId = String(body.projectId ?? "").trim();
    const userId = String(body.userId ?? "").trim();
    if (!projectId || !userId) throw new ApiError("Projeto e usuário são obrigatórios.");
    const context = await authorize(request, projectId);
    if (userId === context.requester.id) throw new ApiError("Você não pode excluir o próprio acesso.", 409);
    await ensureCanManageTarget(context.admin, context.requesterRole, projectId, userId);
    const { data: owned } = await context.admin.from("projects").select("id").eq("organization_id", context.project.organization_id).eq("created_by", userId).limit(1);
    if (owned?.length) throw new ApiError("O proprietário da conta não pode ser excluído.", 409);
    const { error } = await context.admin.auth.admin.deleteUser(userId);
    if (error) throw new ApiError(`Erro ao excluir o usuário: ${error.message}`, 500);
    return NextResponse.json({ deleted: true });
  } catch (cause) { return responseError(cause, "Não foi possível excluir o usuário."); }
}
