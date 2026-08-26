"use client";

import { useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { Modal } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; inviteMember: (member: Member) => Promise<{ temporaryPassword?: string }>; setToast: (value: string) => void };

export function Team({ members, inviteMember, setToast }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("Engenheiro");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [credentials, setCredentials] = useState<{ email: string; password: string } | null>(null);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    setSaving(true); setError("");
    try {
      const result = await inviteMember({ id: crypto.randomUUID(), name, email, role, initials, color: "#54756a", online: false });
      if (result.temporaryPassword) setCredentials({ email, password: result.temporaryPassword });
      setOpen(false); setName(""); setEmail(""); setSaving(false); setToast("Usuário criado e acesso liberado.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o usuário.");
      setSaving(false);
    }
  }
  return <div className="view-stack team-view">
    <section className="team-summary glass"><div><div className="avatar-stack">{members.slice(0, 4).map((member) => <span className="avatar" style={{ background: member.color }} key={member.id}>{member.initials}</span>)}<span className="avatar rest">+{Math.max(0, members.length - 4)}</span></div><div><span className="overline">EQUIPE DA CONTA</span><h2>{members.length} pessoas com acesso</h2><p>Novos usuários recebem login imediato e acesso aos projetos da conta.</p></div></div><button className="primary-btn" onClick={() => setOpen(true)}><Icon name="plus"/> Adicionar usuário</button></section>
    <section className="panel glass members-panel"><header className="panel-header"><div><span className="overline">ACESSOS DO PROJETO</span><h3>Membros e permissões</h3></div><div className="search-box"><Icon name="search"/><input placeholder="Buscar por nome ou e-mail..."/></div></header><div className="member-table">
      <div className="member-row member-head"><span>PESSOA</span><span>FUNÇÃO</span><span>ACESSO</span><span>STATUS</span><span/></div>
      {members.map((member) => <div className="member-row" key={member.id}><span><span className="avatar" style={{ background: member.color }}>{member.initials}</span><span><strong>{member.name}</strong><small>{member.email}</small></span></span><span><strong>{member.role}</strong></span><span>{member.role === "Cliente" ? "Somente leitura" : member.role === "Encarregado" ? "Diário de obra" : "Projeto completo"}</span><span className={member.online ? "online" : "offline"}><i/>{member.pending ? "Convite pendente" : member.online ? "Online agora" : "Acesso recente"}</span><button className="icon-btn tiny"><Icon name="more"/></button></div>)}
    </div></section>
    <section className="permission-note"><Icon name="check"/><div><strong>Permissões pensadas para o canteiro</strong><p>Encarregados registram o campo, engenheiros atualizam o planejamento e clientes acompanham relatórios aprovados.</p></div></section>
    {open && <Modal title="Adicionar usuário à conta" subtitle="O acesso será liberado imediatamente, sem confirmação por e-mail." onClose={() => setOpen(false)}><form className="invite-form" onSubmit={submit}><label><span>Nome completo</span><input value={name} required onChange={(event) => setName(event.target.value)} placeholder="Nome da pessoa"/></label><label><span>E-mail de acesso</span><input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com.br"/></label><label><span>Perfil de acesso</span><select value={role} onChange={(event) => setRole(event.target.value as Member["role"])}><option>Gestor</option><option>Engenheiro</option><option>Encarregado</option><option>Cliente</option><option>Administrador</option></select></label><div className="modal-note"><Icon name="check"/><p><strong>Acesso à mesma conta</strong><br/>O usuário será criado no Supabase, vinculado à organização e liberado nos projetos existentes.</p></div>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving && <span className="button-spinner"/>}{saving ? "Criando acesso..." : "Criar e liberar acesso"}</button></div></form></Modal>}
    {credentials && <Modal title="Acesso criado" subtitle="Repasse estes dados ao novo usuário por um canal seguro." onClose={() => setCredentials(null)}><div className="invite-form"><div className="temporary-access"><span>E-MAIL</span><strong>{credentials.email}</strong><span>SENHA PROVISÓRIA</span><strong>{credentials.password}</strong></div><div className="modal-note"><Icon name="check"/><p>O usuário já pode entrar no Em Dia. Esta senha é exibida somente agora.</p></div><div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => navigator.clipboard.writeText(`Em Dia\nE-mail: ${credentials.email}\nSenha provisória: ${credentials.password}`)}>Copiar acesso</button><button type="button" className="primary-btn" onClick={() => setCredentials(null)}>Concluir</button></div></div></Modal>}
  </div>;
}
