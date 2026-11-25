"use client";
import { SearchableSelect } from "../searchable-select";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, ProjectTeam, ProjectTeamMember, Task, ViewId } from "../types";
import { Modal } from "../ui";

type Props = {
  project: Project;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
  /** Todos os usuários da conta, com as obras que cada um acessa. */
  accountUsers: Member[];
  /** Obras que o usuário logado acessa e, portanto, pode liberar para outras pessoas. */
  accountProjects: Project[];
  navigate: (view: ViewId) => void;
  metrics: { overall: number; active: number };
  currentUserId: string;
  currentUserRole: Member["role"];
  inviteMember: (member: Member) => Promise<{ temporaryPassword?: string }>;
  updateMember: (member: Member) => Promise<void>;
  resetMemberPassword: (member: Member) => Promise<{ temporaryPassword: string }>;
  /** Retorna uma mensagem quando a pessoa continua com acesso a outras obras. */
  deleteMember: (member: Member) => Promise<string | void>;
  projectTeams?: ProjectTeam[];
  saveProjectTeam: (team: ProjectTeam) => Promise<void>;
  deleteProjectTeam: (team: ProjectTeam) => Promise<void>;
  setToast: (value: string) => void;
};

const roles: Member["role"][] = ["Administrador", "Gestor", "Usuário"];

export function Team({
  project,
  accountUsers,
  accountProjects,
  currentUserId,
  currentUserRole,
  inviteMember,
  updateMember,
  resetMemberPassword,
  deleteMember,
  projectTeams = [],
  saveProjectTeam,
  deleteProjectTeam,
  setToast,
}: Props) {
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [deleting, setDeleting] = useState<Member | null>(null);
  const [menu, setMenu] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("Usuário");
  const [search, setSearch] = useState("");
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<{ email: string; password: string; reset?: boolean } | null>(null);
  const [operationalTeam, setOperationalTeam] = useState<ProjectTeam | null | undefined>(undefined);
  const [deletingTeam, setDeletingTeam] = useState<ProjectTeam | null>(null);
  const [teamName, setTeamName] = useState("");
  const [teamCompany, setTeamCompany] = useState("");
  const [teamSpecialty, setTeamSpecialty] = useState("");
  const [teamContact, setTeamContact] = useState("");
  const [teamMembers, setTeamMembers] = useState<ProjectTeamMember[]>([]);
  const [projectIds, setProjectIds] = useState<string[]>([]);
  const [projectSearch, setProjectSearch] = useState("");
  const isAdmin = currentUserRole === "Administrador";
  const canManage = isAdmin || currentUserRole === "Gestor";
  const availableRoles = isAdmin ? roles : (["Usuário"] as Member["role"][]);
  const projectNames = useMemo(() => new Map(accountProjects.map((item) => [item.id, item.name])), [accountProjects]);
  const sortedProjects = useMemo(() => [...accountProjects].sort((a, b) => Number(Boolean(a.archivedAt)) - Number(Boolean(b.archivedAt)) || a.name.localeCompare(b.name, "pt-BR")), [accountProjects]);
  const visibleProjects = useMemo(() => {
    const term = projectSearch.trim().toLocaleLowerCase("pt-BR");
    return term ? sortedProjects.filter((item) => `${item.name} ${item.client}`.toLocaleLowerCase("pt-BR").includes(term)) : sortedProjects;
  }, [sortedProjects, projectSearch]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return accountUsers;
    return accountUsers.filter((member) => `${member.name} ${member.email} ${member.role} ${(member.projectIds ?? []).map((id) => projectNames.get(id) ?? "").join(" ")}`.toLowerCase().includes(term));
  }, [accountUsers, search, projectNames]);

  // Dados e perfil: administrador edita todos; gestor, somente quem é Usuário.
  const canEditData = (member: Member) => canManage && (isAdmin || member.role === "Usuário");
  // Obras: administrador e gestor escolhem as obras de gestores e usuários (nunca as próprias).
  const canEditAccess = (member: Member) => canManage && member.id !== currentUserId && member.role !== "Administrador";
  const accessLabel = (member: Member) => {
    if (member.role === "Administrador") return { title: "Todas as obras", detail: "Acesso automático" };
    const names = (member.projectIds ?? []).map((id) => projectNames.get(id)).filter(Boolean) as string[];
    if (!names.length) return { title: "Nenhuma obra", detail: isAdmin ? "Sem acesso a obras" : "Nenhuma das suas obras" };
    return { title: `${names.length} ${names.length === 1 ? "obra" : "obras"}`, detail: names.join(" · ") };
  };

  function toggleProject(id: string, checked: boolean) {
    setProjectIds((current) => checked ? [...new Set([...current, id])] : current.filter((item) => item !== id));
  }
  function startCreate() {
    setName(""); setEmail(""); setRole("Usuário"); setProjectIds([project.id]); setProjectSearch(""); setError(""); setCreateOpen(true);
  }
  function startEdit(member: Member) {
    setMenu(null); setName(member.name); setRole(member.role); setProjectIds(member.projectIds ?? []); setProjectSearch(""); setError(""); setEditing(member);
  }
  async function submitCreate(event: React.FormEvent) {
    event.preventDefault();
    if (role !== "Administrador" && !projectIds.length) { setError("Selecione ao menos uma obra para este usuário."); return; }
    setProcessing(true); setError("");
    try {
      const result = await inviteMember({
        id: crypto.randomUUID(), name, email, role,
        initials: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
        color: "#54756a", online: false, projectIds,
      });
      setCreateOpen(false);
      if (result.temporaryPassword) setCredentials({ email, password: result.temporaryPassword });
      setToast("Usuário criado e acesso liberado.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível criar o usuário."); }
    finally { setProcessing(false); }
  }
  async function submitEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editing) return;
    setProcessing(true); setError("");
    try {
      await updateMember({ ...editing, name, role, initials: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(), projectIds: canEditAccess(editing) ? projectIds : undefined });
      setEditing(null); setToast("Dados e acesso às obras atualizados.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível atualizar o usuário."); }
    finally { setProcessing(false); }
  }
  async function resetPassword(member: Member) {
    setMenu(null); setProcessing(true);
    try {
      const result = await resetMemberPassword(member);
      setCredentials({ email: member.email, password: result.temporaryPassword, reset: true });
    } catch (cause) { setToast(cause instanceof Error ? cause.message : "Não foi possível redefinir a senha."); }
    finally { setProcessing(false); }
  }
  async function confirmDelete() {
    if (!deleting) return;
    setProcessing(true); setError("");
    try { const message = await deleteMember(deleting); setDeleting(null); setToast(message || "Acesso removido."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir o usuário."); }
    finally { setProcessing(false); }
  }

  function editOperationalTeam(team?: ProjectTeam) {
    setOperationalTeam(team ?? null);
    setTeamName(team?.name ?? "");
    setTeamCompany(team?.company ?? "");
    setTeamSpecialty(team?.specialty ?? "");
    setTeamContact(team?.contact ?? "");
    setTeamMembers(team?.members ?? []);
    setError("");
  }

  async function submitOperationalTeam(event: React.FormEvent) {
    event.preventDefault(); setProcessing(true); setError("");
    try {
      await saveProjectTeam({ id: operationalTeam?.id ?? "", name: teamName, company: teamCompany, specialty: teamSpecialty, contact: teamContact, active: operationalTeam?.active ?? true, members: teamMembers.filter((member) => member.name.trim()).map((member) => ({ ...member, name: member.name.trim() })) });
      setOperationalTeam(undefined);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível salvar a equipe operacional."); }
    finally { setProcessing(false); }
  }

  async function confirmDeleteTeam() {
    if (!deletingTeam) return;
    setProcessing(true); setError("");
    try { await deleteProjectTeam(deletingTeam); setDeletingTeam(null); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir a equipe operacional."); }
    finally { setProcessing(false); }
  }

  const projectPicker = <div className="project-access-box">
    <div className="project-access-head"><div><strong>Obras liberadas</strong><small>{isAdmin ? "A pessoa verá somente as obras selecionadas." : "Você pode liberar apenas as obras que acessa."}</small></div><div className="project-access-bulk"><button type="button" className="text-btn" onClick={() => setProjectIds((current) => [...new Set([...current, ...visibleProjects.map((item) => item.id)])])}>Marcar todas</button><button type="button" className="text-btn" onClick={() => { const hidden = new Set(visibleProjects.map((item) => item.id)); setProjectIds((current) => current.filter((id) => !hidden.has(id))); }}>Limpar</button></div></div>
    {accountProjects.length > 6 && <input type="search" value={projectSearch} onChange={(event) => setProjectSearch(event.target.value)} placeholder="Buscar obra ou cliente"/>}
    <small>{projectIds.filter((id) => projectNames.has(id)).length} de {accountProjects.length} obra(s) selecionada(s)</small>
    <div className="project-access-list">
      {visibleProjects.map((item) => <label key={item.id} className={projectIds.includes(item.id) ? "checked" : ""}><input type="checkbox" checked={projectIds.includes(item.id)} onChange={(event) => toggleProject(item.id, event.target.checked)}/><span><strong>{item.name}</strong><small>{item.client}{item.archivedAt ? " · Arquivada" : ""}</small></span></label>)}
      {!visibleProjects.length && <small className="project-access-empty">Nenhuma obra encontrada.</small>}
    </div>
  </div>;
  const adminAccessNote = <div className="modal-note"><Icon name="check"/><p><strong>Acesso a todas as obras</strong><br/>Administradores entram automaticamente em todas as obras da conta, inclusive nas que forem criadas depois.</p></div>;

  return <div className="view-stack team-view" data-tour="equipe-conteudo">
    <section className="team-summary glass">
      <div><div className="avatar-stack">{accountUsers.slice(0, 4).map((member) => <span className="avatar" style={{ background: member.color }} key={member.id}>{member.initials}</span>)}<span className="avatar rest">+{Math.max(0, accountUsers.length - 4)}</span></div><div><span className="overline">USUÁRIOS DA CONTA</span><h2>{accountUsers.length} {accountUsers.length === 1 ? "pessoa" : "pessoas"} na conta</h2><p>Administradores acessam todas as obras. Gestores e usuários veem apenas as obras liberadas para eles.</p></div></div>
      {canManage && <button className="primary-btn" onClick={startCreate}><Icon name="plus"/> Adicionar usuário</button>}
    </section>
    <section className="panel glass members-panel">
      <header className="panel-header"><div><span className="overline">ACESSOS DA CONTA</span><h3>Usuários e obras liberadas</h3></div><div className="search-box"><Icon name="search"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome, e-mail ou obra..."/></div></header>
      <div className="member-table">
        <div className="member-row member-head"><span>PESSOA</span><span>PERFIL</span><span>OBRAS</span><span>STATUS</span><span/></div>
        {filtered.map((member) => {
          const editData = canEditData(member);
          const editAccess = canEditAccess(member);
          const others = member.id !== currentUserId && editData;
          const access = accessLabel(member);
          return <div className="member-row" key={member.id}>
            <span><span className="avatar" style={{ background: member.color }}>{member.initials}</span><span><strong>{member.name}{member.id === currentUserId ? " (você)" : ""}</strong><small>{member.email || "E-mail protegido"}</small></span></span>
            <span><strong>{member.role}</strong></span>
            <span className="member-projects"><strong>{access.title}</strong><small title={access.detail}>{access.detail}</small></span>
            <span className={member.online ? "online" : "offline"}><i/>{member.online ? "Online agora" : "Acesso liberado"}</span>
            {(editData || editAccess) && <div className="member-actions"><button className="icon-btn tiny" aria-label={`Gerenciar ${member.name}`} onClick={() => setMenu(menu === member.id ? null : member.id)}><Icon name="more"/></button>{menu === member.id && <div className="member-menu glass"><button onClick={() => startEdit(member)}>{editData && editAccess ? "Editar dados e obras" : editData ? "Editar dados" : "Editar obras"}</button>{others && <button disabled={processing} onClick={() => resetPassword(member)}>Redefinir senha</button>}{others && <button className="danger" onClick={() => { setMenu(null); setError(""); setDeleting(member); }}>Excluir usuário</button>}</div>}</div>}
          </div>;
        })}
        {!filtered.length && <div className="empty-inline"><Icon name="users"/><div><strong>Nenhum usuário encontrado</strong><p>Busque por outro nome, e-mail ou obra.</p></div></div>}
      </div>
    </section>
    <section className="panel glass operational-teams-panel">
      <header className="panel-header"><div><span className="overline">EQUIPES DE CAMPO</span><h3>Empresas e especialidades da obra</h3><p>Use estas equipes no Diário de Obra e informe apenas quantas pessoas trabalharam.</p></div>{canManage && <button className="secondary-btn" onClick={() => editOperationalTeam()}><Icon name="plus"/> Nova equipe</button>}</header>
      <div className="operational-team-grid">
        {projectTeams.map((team) => <article key={team.id}><span className="team-company-avatar">{team.company.slice(0,2).toUpperCase()}</span><div><strong>{team.name}</strong><small>{team.company} · {team.specialty}</small><em>{team.members?.length ?? 0} colaborador(es){team.contact ? ` · ${team.contact}` : ""}</em></div>{canManage && <div className="operational-team-actions"><button className="icon-btn tiny" aria-label={`Editar ${team.name}`} onClick={() => editOperationalTeam(team)}><Icon name="settings"/></button><button className="icon-btn tiny danger" aria-label={`Excluir ${team.name}`} onClick={() => setDeletingTeam(team)}><Icon name="close"/></button></div>}</article>)}
        {!projectTeams.length && <div className="empty-inline"><Icon name="team"/><div><strong>Nenhuma equipe operacional cadastrada</strong><p>Cadastre, por exemplo, Empresa A · Elétrica ou Empresa B · Mecânica.</p></div></div>}
      </div>
    </section>
    <section className="permission-note"><Icon name="check"/><div><strong>Três perfis, regras objetivas</strong><p>Administrador tem controle total e vê todas as obras; Gestor coordena as obras que criou ou que foram liberadas para ele e escolhe quem mais as acessa; Usuário visualiza o Gantt e o Status Report e, no Diário de Obra, cria registros e edita ou exclui apenas os próprios.</p></div></section>

    {createOpen && <Modal title="Adicionar usuário" subtitle="Escolha o perfil e as obras que a pessoa poderá abrir." onClose={() => !processing && setCreateOpen(false)}><form className="invite-form" onSubmit={submitCreate}><label><span>Nome completo</span><input value={name} required onChange={(event) => setName(event.target.value)}/></label><label><span>E-mail de acesso</span><input type="email" value={email} required onChange={(event) => setEmail(event.target.value)}/></label><label><span>Perfil de acesso</span><SearchableSelect value={role} onChange={(event) => setRole(event.target.value as Member["role"])}>{availableRoles.map((item) => <option key={item}>{item}</option>)}</SearchableSelect></label>{role === "Administrador" ? adminAccessNote : projectPicker}<div className="modal-note"><Icon name="check"/><p><strong>Primeiro acesso protegido</strong><br/>O usuário receberá uma senha provisória e será obrigado a criar uma nova senha ao entrar.</p></div>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={processing} onClick={() => setCreateOpen(false)}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing && <span className="button-spinner"/>}{processing ? "Criando acesso..." : "Criar e liberar acesso"}</button></div></form></Modal>}
    {editing && <Modal title={canEditData(editing) ? "Editar usuário" : "Obras liberadas"} subtitle={canEditData(editing) ? "Perfil e obras valem para toda a conta." : `Escolha quais das suas obras ${editing.name} pode abrir.`} onClose={() => !processing && setEditing(null)}><form className="invite-form" onSubmit={submitEdit}><label><span>Nome completo</span><input value={name} required disabled={!canEditData(editing)} onChange={(event) => setName(event.target.value)}/></label><label><span>E-mail de acesso</span><input value={editing.email} disabled/></label><label><span>Perfil de acesso</span><SearchableSelect value={role} disabled={!canEditData(editing) || editing.id === currentUserId} onChange={(event) => setRole(event.target.value as Member["role"])}>{availableRoles.includes(role) ? availableRoles.map((item) => <option key={item}>{item}</option>) : <option>{role}</option>}</SearchableSelect></label>{role === "Administrador" ? adminAccessNote : canEditAccess(editing) ? projectPicker : <div className="modal-note"><Icon name="check"/><p><strong>Suas obras</strong><br/>Você não altera o próprio acesso. Peça a um administrador para incluir ou retirar obras.</p></div>}{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={processing} onClick={() => setEditing(null)}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing && <span className="button-spinner"/>}{processing ? "Salvando..." : "Salvar alterações"}</button></div></form></Modal>}
    {deleting && <Modal title="Excluir usuário" subtitle={isAdmin ? "Remove o login e o acesso a todas as obras." : "Retira o acesso às suas obras. Se a pessoa não tiver obras de outros gestores, o login também é excluído."} onClose={() => !processing && setDeleting(null)}><div className="invite-form"><div className="delete-warning"><Icon name="alert"/><p>Confirma a exclusão de <strong>{deleting.name}</strong>? Os registros feitos por essa pessoa permanecem na obra.</p></div>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button className="secondary-btn" disabled={processing} onClick={() => setDeleting(null)}>Cancelar</button><button className="danger-btn" disabled={processing} onClick={confirmDelete}>{processing && <span className="button-spinner"/>}{processing ? "Excluindo..." : "Excluir usuário"}</button></div></div></Modal>}
    {credentials && <Modal title={credentials.reset ? "Senha redefinida" : "Acesso criado"} subtitle="Repasse estes dados por um canal seguro." onClose={() => setCredentials(null)}><div className="invite-form"><div className="temporary-access"><span>E-MAIL</span><strong>{credentials.email}</strong><span>SENHA PROVISÓRIA</span><strong>{credentials.password}</strong></div><div className="modal-note"><Icon name="check"/><p>No próximo login, o usuário será obrigado a escolher uma nova senha.</p></div><div className="modal-actions"><button className="secondary-btn" onClick={() => navigator.clipboard.writeText(`Em Dia\nE-mail: ${credentials.email}\nSenha provisória: ${credentials.password}`)}>Copiar acesso</button><button className="primary-btn" onClick={() => setCredentials(null)}>Concluir</button></div></div></Modal>}
    {operationalTeam !== undefined && <Modal title={operationalTeam ? "Editar equipe operacional" : "Nova equipe operacional"} subtitle="Agrupe os profissionais por empresa e especialidade." onClose={() => !processing && setOperationalTeam(undefined)} wide><form className="invite-form operational-team-form" onSubmit={submitOperationalTeam}><div className="form-grid"><label><span>Nome da equipe</span><input required value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Equipe elétrica A"/></label><label><span>Empresa</span><input required value={teamCompany} onChange={(event) => setTeamCompany(event.target.value)} placeholder="Empresa A"/></label><label><span>Especialidade</span><input required value={teamSpecialty} onChange={(event) => setTeamSpecialty(event.target.value)} placeholder="Elétrica, mecânica, civil..."/></label><label><span>Contato geral (opcional)</span><input value={teamContact} onChange={(event) => setTeamContact(event.target.value)} placeholder="Responsável ou telefone"/></label></div><section className="field-worker-editor"><header><div><span>COLABORADORES DA EMPRESA</span><p>Estas pessoas poderão ser selecionadas como destinatárias nas retiradas do estoque.</p></div><button type="button" className="secondary-btn compact" onClick={() => setTeamMembers((current) => [...current, { id: crypto.randomUUID(), name: "", role: "", phone: "", active: true }])}><Icon name="plus"/> Adicionar</button></header>{teamMembers.map((member, index) => <div className="field-worker-row" key={member.id}><label><span>Nome completo</span><input required value={member.name} onChange={(event) => setTeamMembers((current) => current.map((entry, position) => position === index ? { ...entry, name: event.target.value } : entry))}/></label><label><span>Função</span><input value={member.role ?? ""} onChange={(event) => setTeamMembers((current) => current.map((entry, position) => position === index ? { ...entry, role: event.target.value } : entry))} placeholder="Eletricista, encarregado..."/></label><label><span>Telefone</span><input value={member.phone ?? ""} onChange={(event) => setTeamMembers((current) => current.map((entry, position) => position === index ? { ...entry, phone: event.target.value } : entry))}/></label><button type="button" className="icon-btn tiny danger" aria-label={`Remover ${member.name || "colaborador"}`} onClick={() => setTeamMembers((current) => current.filter((_, position) => position !== index))}><Icon name="close"/></button></div>)}{!teamMembers.length && <div className="empty-inline"><Icon name="users"/><div><strong>Nenhum colaborador cadastrado</strong><p>Você ainda poderá selecionar a equipe inteira como destinatária.</p></div></div>}</section>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setOperationalTeam(undefined)}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing && <span className="button-spinner"/>}{processing ? "Salvando..." : "Salvar equipe e colaboradores"}</button></div></form></Modal>}
    {deletingTeam && <Modal title="Excluir equipe operacional" subtitle="Registros anteriores do Diário permanecerão preservados." onClose={() => !processing && setDeletingTeam(null)}><div className="invite-form"><div className="delete-warning"><Icon name="alert"/><p>Confirma a exclusão de <strong>{deletingTeam.name}</strong>?</p></div>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button className="secondary-btn" disabled={processing} onClick={() => setDeletingTeam(null)}>Cancelar</button><button className="danger-btn" disabled={processing} onClick={() => void confirmDeleteTeam()}>{processing && <span className="button-spinner"/>}{processing ? "Excluindo..." : "Excluir equipe"}</button></div></div></Modal>}
  </div>;
}
