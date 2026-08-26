"use client";

import { useMemo, useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, ProjectTeam, Task, ViewId } from "../types";
import { Modal } from "../ui";

type Props = {
  project: Project;
  tasks: Task[];
  entries: JournalEntry[];
  members: Member[];
  navigate: (view: ViewId) => void;
  metrics: { overall: number; active: number };
  currentUserId: string;
  currentUserRole: Member["role"];
  inviteMember: (member: Member) => Promise<{ temporaryPassword?: string }>;
  updateMember: (member: Member) => Promise<void>;
  resetMemberPassword: (member: Member) => Promise<{ temporaryPassword: string }>;
  deleteMember: (member: Member) => Promise<void>;
  projectTeams?: ProjectTeam[];
  saveProjectTeam: (team: ProjectTeam) => Promise<void>;
  deleteProjectTeam: (team: ProjectTeam) => Promise<void>;
  setToast: (value: string) => void;
};

const roles: Member["role"][] = ["Administrador", "Gestor", "Usuário"];

export function Team({
  members,
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
  const canManage = currentUserRole === "Administrador" || currentUserRole === "Gestor";
  const availableRoles = currentUserRole === "Administrador" ? roles : (["Usuário"] as Member["role"][]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return term ? members.filter((member) => `${member.name} ${member.email} ${member.role}`.toLowerCase().includes(term)) : members;
  }, [members, search]);

  function startCreate() {
    setName(""); setEmail(""); setRole("Usuário"); setError(""); setCreateOpen(true);
  }
  function startEdit(member: Member) {
    setMenu(null); setName(member.name); setRole(member.role); setError(""); setEditing(member);
  }
  async function submitCreate(event: React.FormEvent) {
    event.preventDefault(); setProcessing(true); setError("");
    try {
      const result = await inviteMember({
        id: crypto.randomUUID(), name, email, role,
        initials: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase(),
        color: "#54756a", online: false,
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
      await updateMember({ ...editing, name, role, initials: name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase() });
      setEditing(null); setToast("Dados e permissões atualizados em todos os projetos.");
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
    try { await deleteMember(deleting); setDeleting(null); setToast("Usuário e acesso removidos da conta."); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Não foi possível excluir o usuário."); }
    finally { setProcessing(false); }
  }

  function editOperationalTeam(team?: ProjectTeam) {
    setOperationalTeam(team ?? null);
    setTeamName(team?.name ?? "");
    setTeamCompany(team?.company ?? "");
    setTeamSpecialty(team?.specialty ?? "");
    setTeamContact(team?.contact ?? "");
    setError("");
  }

  async function submitOperationalTeam(event: React.FormEvent) {
    event.preventDefault(); setProcessing(true); setError("");
    try {
      await saveProjectTeam({ id: operationalTeam?.id ?? "", name: teamName, company: teamCompany, specialty: teamSpecialty, contact: teamContact, active: operationalTeam?.active ?? true });
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

  return <div className="view-stack team-view" data-tour="equipe-conteudo">
    <section className="team-summary glass">
      <div><div className="avatar-stack">{members.slice(0, 4).map((member) => <span className="avatar" style={{ background: member.color }} key={member.id}>{member.initials}</span>)}<span className="avatar rest">+{Math.max(0, members.length - 4)}</span></div><div><span className="overline">EQUIPE DA CONTA</span><h2>{members.length} pessoas com acesso</h2><p>Os acessos valem para todos os projetos da mesma conta.</p></div></div>
      {canManage && <button className="primary-btn" onClick={startCreate}><Icon name="plus"/> Adicionar usuário</button>}
    </section>
    <section className="panel glass members-panel">
      <header className="panel-header"><div><span className="overline">ACESSOS DA CONTA</span><h3>Membros e permissões</h3></div><div className="search-box"><Icon name="search"/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por nome ou e-mail..."/></div></header>
      <div className="member-table">
        <div className="member-row member-head"><span>PESSOA</span><span>PERFIL</span><span>ACESSO</span><span>STATUS</span><span/></div>
        {filtered.map((member) => {
          const manageable = canManage && (currentUserRole === "Administrador" || member.role === "Usuário");
          return <div className="member-row" key={member.id}>
            <span><span className="avatar" style={{ background: member.color }}>{member.initials}</span><span><strong>{member.name}{member.id === currentUserId ? " (você)" : ""}</strong><small>{member.email || "E-mail protegido"}</small></span></span>
            <span><strong>{member.role}</strong></span>
            <span>{member.role === "Administrador" ? "Controle total" : member.role === "Gestor" ? "Gestão da operação" : "Uso da plataforma"}</span>
            <span className={member.online ? "online" : "offline"}><i/>{member.online ? "Online agora" : "Acesso liberado"}</span>
            {manageable && <div className="member-actions"><button className="icon-btn tiny" aria-label={`Gerenciar ${member.name}`} onClick={() => setMenu(menu === member.id ? null : member.id)}><Icon name="more"/></button>{menu === member.id && <div className="member-menu glass"><button onClick={() => startEdit(member)}>Editar dados</button>{member.id !== currentUserId && <button disabled={processing} onClick={() => resetPassword(member)}>Redefinir senha</button>}{member.id !== currentUserId && <button className="danger" onClick={() => { setMenu(null); setError(""); setDeleting(member); }}>Excluir usuário</button>}</div>}</div>}
          </div>;
        })}
      </div>
    </section>
    <section className="panel glass operational-teams-panel">
      <header className="panel-header"><div><span className="overline">EQUIPES DE CAMPO</span><h3>Empresas e especialidades da obra</h3><p>Use estas equipes no Diário de Obra e informe apenas quantas pessoas trabalharam.</p></div>{canManage && <button className="secondary-btn" onClick={() => editOperationalTeam()}><Icon name="plus"/> Nova equipe</button>}</header>
      <div className="operational-team-grid">
        {projectTeams.map((team) => <article key={team.id}><span className="team-company-avatar">{team.company.slice(0,2).toUpperCase()}</span><div><strong>{team.name}</strong><small>{team.company} · {team.specialty}</small>{team.contact && <em>{team.contact}</em>}</div>{canManage && <div className="operational-team-actions"><button className="icon-btn tiny" aria-label={`Editar ${team.name}`} onClick={() => editOperationalTeam(team)}><Icon name="settings"/></button><button className="icon-btn tiny danger" aria-label={`Excluir ${team.name}`} onClick={() => setDeletingTeam(team)}><Icon name="close"/></button></div>}</article>)}
        {!projectTeams.length && <div className="empty-inline"><Icon name="team"/><div><strong>Nenhuma equipe operacional cadastrada</strong><p>Cadastre, por exemplo, Empresa A · Elétrica ou Empresa B · Mecânica.</p></div></div>}
      </div>
    </section>
    <section className="permission-note"><Icon name="check"/><div><strong>Três perfis, regras objetivas</strong><p>Administrador tem controle total; Gestor coordena a operação; Usuário utiliza as funções liberadas. As permissões detalhadas serão configuradas na próxima etapa.</p></div></section>

    {createOpen && <Modal title="Adicionar usuário à conta" subtitle="O acesso será imediato, sem confirmação por e-mail." onClose={() => !processing && setCreateOpen(false)}><form className="invite-form" onSubmit={submitCreate}><label><span>Nome completo</span><input value={name} required onChange={(event) => setName(event.target.value)}/></label><label><span>E-mail de acesso</span><input type="email" value={email} required onChange={(event) => setEmail(event.target.value)}/></label><label><span>Perfil de acesso</span><select value={role} onChange={(event) => setRole(event.target.value as Member["role"])}>{availableRoles.map((item) => <option key={item}>{item}</option>)}</select></label><div className="modal-note"><Icon name="check"/><p><strong>Primeiro acesso protegido</strong><br/>O usuário receberá uma senha provisória e será obrigado a criar uma nova senha ao entrar.</p></div>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={processing} onClick={() => setCreateOpen(false)}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing && <span className="button-spinner"/>}{processing ? "Criando acesso..." : "Criar e liberar acesso"}</button></div></form></Modal>}
    {editing && <Modal title="Editar usuário" subtitle="As mudanças valem para todos os projetos da conta." onClose={() => !processing && setEditing(null)}><form className="invite-form" onSubmit={submitEdit}><label><span>Nome completo</span><input value={name} required onChange={(event) => setName(event.target.value)}/></label><label><span>E-mail de acesso</span><input value={editing.email} disabled/></label><label><span>Perfil de acesso</span><select value={role} disabled={editing.id === currentUserId && editing.role === "Administrador"} onChange={(event) => setRole(event.target.value as Member["role"])}>{availableRoles.includes(role) ? availableRoles.map((item) => <option key={item}>{item}</option>) : <option>{role}</option>}</select></label>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" disabled={processing} onClick={() => setEditing(null)}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing && <span className="button-spinner"/>}{processing ? "Salvando..." : "Salvar alterações"}</button></div></form></Modal>}
    {deleting && <Modal title="Excluir usuário" subtitle="Esta operação remove o login e o acesso a todos os projetos." onClose={() => !processing && setDeleting(null)}><div className="invite-form"><div className="delete-warning"><Icon name="alert"/><p>Confirma a exclusão de <strong>{deleting.name}</strong>? Os registros feitos por essa pessoa permanecem na obra.</p></div>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button className="secondary-btn" disabled={processing} onClick={() => setDeleting(null)}>Cancelar</button><button className="danger-btn" disabled={processing} onClick={confirmDelete}>{processing && <span className="button-spinner"/>}{processing ? "Excluindo..." : "Excluir usuário"}</button></div></div></Modal>}
    {credentials && <Modal title={credentials.reset ? "Senha redefinida" : "Acesso criado"} subtitle="Repasse estes dados por um canal seguro." onClose={() => setCredentials(null)}><div className="invite-form"><div className="temporary-access"><span>E-MAIL</span><strong>{credentials.email}</strong><span>SENHA PROVISÓRIA</span><strong>{credentials.password}</strong></div><div className="modal-note"><Icon name="check"/><p>No próximo login, o usuário será obrigado a escolher uma nova senha.</p></div><div className="modal-actions"><button className="secondary-btn" onClick={() => navigator.clipboard.writeText(`Em Dia\nE-mail: ${credentials.email}\nSenha provisória: ${credentials.password}`)}>Copiar acesso</button><button className="primary-btn" onClick={() => setCredentials(null)}>Concluir</button></div></div></Modal>}
    {operationalTeam !== undefined && <Modal title={operationalTeam ? "Editar equipe operacional" : "Nova equipe operacional"} subtitle="Agrupe os profissionais por empresa e especialidade." onClose={() => !processing && setOperationalTeam(undefined)}><form className="invite-form" onSubmit={submitOperationalTeam}><label><span>Nome da equipe</span><input required value={teamName} onChange={(event) => setTeamName(event.target.value)} placeholder="Equipe elétrica A"/></label><label><span>Empresa</span><input required value={teamCompany} onChange={(event) => setTeamCompany(event.target.value)} placeholder="Empresa A"/></label><label><span>Especialidade</span><input required value={teamSpecialty} onChange={(event) => setTeamSpecialty(event.target.value)} placeholder="Elétrica, mecânica, civil..."/></label><label><span>Contato (opcional)</span><input value={teamContact} onChange={(event) => setTeamContact(event.target.value)} placeholder="Responsável ou telefone"/></label>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setOperationalTeam(undefined)}>Cancelar</button><button className="primary-btn" disabled={processing}>{processing && <span className="button-spinner"/>}{processing ? "Salvando..." : "Salvar equipe"}</button></div></form></Modal>}
    {deletingTeam && <Modal title="Excluir equipe operacional" subtitle="Registros anteriores do Diário permanecerão preservados." onClose={() => !processing && setDeletingTeam(null)}><div className="invite-form"><div className="delete-warning"><Icon name="alert"/><p>Confirma a exclusão de <strong>{deletingTeam.name}</strong>?</p></div>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button className="secondary-btn" disabled={processing} onClick={() => setDeletingTeam(null)}>Cancelar</button><button className="danger-btn" disabled={processing} onClick={() => void confirmDeleteTeam()}>{processing && <span className="button-spinner"/>}{processing ? "Excluindo..." : "Excluir equipe"}</button></div></div></Modal>}
  </div>;
}
