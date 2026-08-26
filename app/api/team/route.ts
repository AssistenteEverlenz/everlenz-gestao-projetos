import { NextResponse } from "next/server";
import {
  createClient,
  type SupabaseClient,
  type User,
} from "@supabase/supabase-js";

const defaultSupabaseUrl = "https://lpfoxpqezcfdvdecfdos.supabase.co";
const defaultSupabasePublishableKey =
  "sb_publishable_G_KSK1Ud0DPkXTR9iJIRhg_By7aDsa7";
const supabaseUrl =
  process.env.NEXT_PUBLIC_SUPABASE_URL ?? defaultSupabaseUrl;
const supabasePublicKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  defaultSupabasePublishableKey;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

const allowedRoles = [
  "admin",
  "manager",
  "engineer",
  "foreman",
  "client",
] as const;
type ProjectRole = (typeof allowedRoles)[number];

class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function temporaryPassword() {
  return `${crypto.randomUUID().replaceAll("-", "").slice(0, 9)}Aa!`;
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string,
): Promise<User | null> {
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error)
      throw new ApiError(`Erro ao consultar os acessos: ${error.message}`, 500);
    const found = data.users.find(
      (user) => user.email?.toLowerCase() === email,
    );
    if (found) return found;
    if (data.users.length < 100) return null;
  }
  return null;
}

export async function POST(request: Request) {
  let createdAuthUserId: string | null = null;
  try {
    if (!supabaseUrl || !supabasePublicKey)
      throw new ApiError("Configuração pública do Supabase ausente.", 500);
    if (!supabaseServiceRoleKey)
      throw new ApiError(
        "SUPABASE_SERVICE_ROLE_KEY ausente no servidor. Configure a chave para criar acessos da equipe.",
        500,
      );

    const authorization = request.headers.get("authorization") ?? "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "").trim();
    if (!accessToken)
      throw new ApiError("Sessão inválida. Entre novamente.", 401);

    const auth = createClient(supabaseUrl, supabasePublicKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user: requester },
      error: requesterError,
    } = await auth.auth.getUser(accessToken);
    if (requesterError || !requester)
      throw new ApiError("Não foi possível validar o usuário logado.", 401);

    const body = (await request.json()) as {
      projectId?: string;
      name?: string;
      email?: string;
      role?: string;
    };
    const projectId = String(body.projectId ?? "").trim();
    const name = String(body.name ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const role = String(body.role ?? "engineer") as ProjectRole;
    if (!projectId || !name || !email)
      throw new ApiError("Preencha nome, e-mail e função.");
    if (!/^\S+@\S+\.\S+$/.test(email))
      throw new ApiError("Informe um e-mail válido.");
    if (!allowedRoles.includes(role))
      throw new ApiError("Função de projeto inválida.");

    const { data: requesterMembership, error: membershipError } = await admin
      .from("project_members")
      .select("role")
      .eq("project_id", projectId)
      .eq("user_id", requester.id)
      .maybeSingle();
    if (membershipError)
      throw new ApiError(
        `Erro ao validar as permissões: ${membershipError.message}`,
        500,
      );
    if (
      requesterMembership?.role !== "admin" &&
      requesterMembership?.role !== "manager"
    )
      throw new ApiError("Você não pode gerenciar esta equipe.", 403);
    if (role === "admin" && requesterMembership.role !== "admin")
      throw new ApiError(
        "Somente administradores podem criar outro administrador.",
        403,
      );

    const { data: project, error: projectError } = await admin
      .from("projects")
      .select("organization_id")
      .eq("id", projectId)
      .single();
    if (projectError || !project)
      throw new ApiError("Projeto não encontrado.", 404);

    let authUser = await findAuthUserByEmail(admin, email);
    let password: string | null = null;
    if (!authUser) {
      password = temporaryPassword();
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: name },
      });
      if (error)
        throw new ApiError(`Erro ao criar o login: ${error.message}`);
      authUser = data.user;
      createdAuthUserId = authUser.id;
    }

    const { data: profile, error: profileLookupError } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("id", authUser.id)
      .maybeSingle();
    if (profileLookupError)
      throw new ApiError(
        `Erro ao consultar o perfil: ${profileLookupError.message}`,
        500,
      );
    if (profile?.organization_id && profile.organization_id !== project.organization_id)
      throw new ApiError(
        "Este e-mail já pertence a uma organização diferente.",
        409,
      );

    const { error: profileError } = await admin.from("profiles").upsert({
      id: authUser.id,
      organization_id: project.organization_id,
      full_name: name,
    });
    if (profileError)
      throw new ApiError(`Erro ao preparar o perfil: ${profileError.message}`);

    const { data: existingMembership, error: existingMembershipError } =
      await admin
        .from("project_members")
        .select("user_id")
        .eq("project_id", projectId)
        .eq("user_id", authUser.id)
        .maybeSingle();
    if (existingMembershipError)
      throw new ApiError(
        `Erro ao consultar a equipe: ${existingMembershipError.message}`,
        500,
      );
    if (existingMembership)
      throw new ApiError("Este usuário já faz parte do projeto.", 409);

    const { error: addError } = await admin.from("project_members").insert({
      project_id: projectId,
      user_id: authUser.id,
      role,
      accepted_at: new Date().toISOString(),
    });
    if (addError)
      throw new ApiError(`Erro ao adicionar à equipe: ${addError.message}`);

    // A equipe representa a conta/organização, não apenas a obra aberta.
    // Assim, gestores e colaboradores entram na mesma conta e enxergam todos
    // os projetos existentes da organização com o papel escolhido.
    const { data: organizationProjects, error: organizationProjectsError } =
      await admin
        .from("projects")
        .select("id")
        .eq("organization_id", project.organization_id)
        .neq("id", projectId);
    if (organizationProjectsError)
      throw new ApiError(
        `Erro ao consultar os projetos da conta: ${organizationProjectsError.message}`,
        500,
      );
    if (organizationProjects?.length) {
      const { error: organizationMembershipError } = await admin
        .from("project_members")
        .upsert(
          organizationProjects.map((organizationProject) => ({
            project_id: organizationProject.id,
            user_id: authUser.id,
            role,
            accepted_at: new Date().toISOString(),
          })),
          { onConflict: "project_id,user_id" },
        );
      if (organizationMembershipError)
        throw new ApiError(
          `Erro ao liberar os projetos da conta: ${organizationMembershipError.message}`,
          500,
        );
    }

    await admin
      .from("project_invitations")
      .delete()
      .eq("project_id", projectId)
      .eq("email", email);

    createdAuthUserId = null;
    return NextResponse.json({
      member: {
        id: authUser.id,
        name,
        email,
        role,
        initials: initials(name),
        color: "#54756a",
        online: false,
        pending: false,
      },
      senha_provisoria: password,
      projetos_liberados: (organizationProjects?.length ?? 0) + 1,
    });
  } catch (cause) {
    if (createdAuthUserId && supabaseUrl && supabaseServiceRoleKey) {
      const admin = createClient(supabaseUrl, supabaseServiceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      await admin.auth.admin.deleteUser(createdAuthUserId).catch(() => undefined);
    }
    const status = cause instanceof ApiError ? cause.status : 400;
    const message =
      cause instanceof Error ? cause.message : "Não foi possível criar o usuário.";
    return NextResponse.json({ error: message }, { status });
  }
}
