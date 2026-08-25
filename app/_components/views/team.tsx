"use client";

import { useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { Modal } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; inviteMember: (member: Member) => Promise<void>; setToast: (value: string) => void };

export function Team({ members, inviteMember, setToast }: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Member["role"]>("Engenheiro");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const initials = name.split(" ").map((part) => part[0]).slice(0, 2).join("").toUpperCase();
    setSaving(true); setError("");
    try {
      await inviteMember({ id: crypto.randomUUID(), name, email, role, initials, color: "#54756a", online: false });
      setOpen(false); setName(""); setEmail(""); setToast("Convite adicionado à equipe.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Não foi possível criar o convite.");
      setSaving(false);
    }
  }
  return <div className="view-stack team-view">
    <section className="team-summary glass"><div><div className="avatar-stack">{members.slice(0, 4).map((member) => <span className="avatar" style={{ background: member.color }} key={member.id}>{member.initials}</span>)}<span className="avatar rest">+{Math.max(0, members.length - 4)}</span></div><div><span className="overline">EQUIPE ATIVA</span><h2>{members.length} pessoas colaborando</h2><p>Todos os registros ficam identificados por autor, data e horário.</p></div></div><button className="primary-btn" onClick={() => setOpen(true)}><Icon name="plus"/> Convidar pessoa</button></section>
    <section className="panel glass members-panel"><header className="panel-header"><div><span className="overline">ACESSOS DO PROJETO</span><h3>Membros e permissões</h3></div><div className="search-box"><Icon name="search"/><input placeholder="Buscar por nome ou e-mail..."/></div></header><div className="member-table">
      <div className="member-row member-head"><span>PESSOA</span><span>FUNÇÃO</span><span>ACESSO</span><span>STATUS</span><span/></div>
      {members.map((member) => <div className="member-row" key={member.id}><span><span className="avatar" style={{ background: member.color }}>{member.initials}</span><span><strong>{member.name}</strong><small>{member.email}</small></span></span><span><strong>{member.role}</strong></span><span>{member.role === "Cliente" ? "Somente leitura" : member.role === "Encarregado" ? "Diário de obra" : "Projeto completo"}</span><span className={member.online ? "online" : "offline"}><i/>{member.pending ? "Convite pendente" : member.online ? "Online agora" : "Acesso recente"}</span><button className="icon-btn tiny"><Icon name="more"/></button></div>)}
    </div></section>
    <section className="permission-note"><Icon name="check"/><div><strong>Permissões pensadas para o canteiro</strong><p>Encarregados registram o campo, engenheiros atualizam o planejamento e clientes acompanham relatórios aprovados.</p></div></section>
    {open && <Modal title="Convidar para a equipe" subtitle="A pessoa deverá acessar o Em Dia usando exatamente este e-mail." onClose={() => setOpen(false)}><form className="invite-form" onSubmit={submit}><label><span>Nome completo</span><input value={name} required onChange={(event) => setName(event.target.value)} placeholder="Nome da pessoa"/></label><label><span>E-mail</span><input type="email" value={email} required onChange={(event) => setEmail(event.target.value)} placeholder="nome@empresa.com.br"/></label><label><span>Função no projeto</span><select value={role} onChange={(event) => setRole(event.target.value as Member["role"])}><option>Gestor</option><option>Engenheiro</option><option>Encarregado</option><option>Cliente</option><option>Administrador</option></select></label>{error && <div className="access-message"><Icon name="alert"/>{error}</div>}<div className="modal-actions"><button type="button" className="secondary-btn" onClick={() => setOpen(false)}>Cancelar</button><button className="primary-btn" disabled={saving}>{saving ? "Salvando..." : "Criar convite"}</button></div></form></Modal>}
  </div>;
}
