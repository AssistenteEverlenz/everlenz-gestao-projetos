"use client";

import { useState } from "react";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { Icon } from "../icons";

export function Settings({ dark, setDark, setToast }: { dark: boolean; setDark: (value: boolean) => void; setToast: (value: string) => void }) {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  async function changePassword(event: React.FormEvent) {
    event.preventDefault();
    if (password.length < 8) return setToast("A senha precisa ter pelo menos 8 caracteres.");
    if (password !== confirmation) return setToast("As senhas não coincidem.");
    setSavingPassword(true);
    const { error } = await getSupabaseBrowserClient().auth.updateUser({ password });
    setSavingPassword(false);
    if (error) return setToast(error.message);
    setPassword(""); setConfirmation(""); setToast("Senha alterada com segurança.");
  }

  return <div className="view-stack settings-view">
    <section className="settings-grid">
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="sun"/></span><div><span className="overline">APARÊNCIA</span><h3>Tema da interface</h3><p>Escolha o modo mais confortável para escritório ou canteiro.</p></div><div className="theme-options"><button className={!dark ? "active" : ""} onClick={() => setDark(false)}><span className="theme-preview light-preview"/><Icon name="sun"/> Claro</button><button className={dark ? "active" : ""} onClick={() => setDark(true)}><span className="theme-preview dark-preview"/><Icon name="moon"/> Escuro</button></div></div>
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="report"/></span><div><span className="overline">RELATÓRIOS</span><h3>Padrão do status report</h3><p>Defina os dados que aparecem em todos os documentos.</p></div><label><span>Nome da empresa</span><input defaultValue="Everlenz Engenharia"/></label><label><span>Mensagem de rodapé</span><input defaultValue="Informação técnica com evidência de campo"/></label></div>
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="bell"/></span><div><span className="overline">NOTIFICAÇÕES</span><h3>Alertas do projeto</h3><p>Receba avisos importantes sem excesso de ruído.</p></div><label className="setting-toggle"><span><strong>Atividade crítica atrasada</strong><small>Aviso imediato para gestores</small></span><input type="checkbox" defaultChecked/><i/></label><label className="setting-toggle"><span><strong>Relatório pronto para revisar</strong><small>Um resumo ao fim de cada dia</small></span><input type="checkbox" defaultChecked/><i/></label></div>
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="calendar"/></span><div><span className="overline">PLANEJAMENTO</span><h3>Calendário da obra</h3><p>Configuração usada no cálculo de durações e dependências.</p></div><label><span>Jornada padrão</span><select defaultValue="seg-sab"><option value="seg-sab">Segunda a sábado</option><option value="seg-sex">Segunda a sexta</option></select></label><label><span>Horas por dia</span><input type="number" defaultValue="8"/></label></div>
      {isSupabaseConfigured() && <form className="panel glass settings-card" onSubmit={changePassword}><span className="settings-icon"><Icon name="lock"/></span><div><span className="overline">SEGURANÇA</span><h3>Alterar minha senha</h3><p>Crie uma nova senha para o seu próprio acesso.</p></div><label><span>Nova senha</span><input type="password" minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)}/></label><label><span>Confirmar senha</span><input type="password" minLength={8} required value={confirmation} onChange={(event) => setConfirmation(event.target.value)}/></label><button className="secondary-btn" disabled={savingPassword}>{savingPassword && <span className="button-spinner"/>}{savingPassword ? "Alterando..." : "Alterar senha"}</button></form>}
      <div className="panel glass settings-card" data-tour="instrucoes"><span className="settings-icon"><Icon name="info"/></span><div><span className="overline">AJUDA</span><h3>Apresentação da plataforma</h3><p>Reveja o guia com as funções principais do Em Dia.</p></div><button className="secondary-btn" onClick={() => window.dispatchEvent(new CustomEvent("emdia:start-tour"))}>Rever apresentação</button></div>
    </section>
    <div className="settings-actions"><button className="primary-btn" onClick={() => setToast("Preferências salvas.")}><Icon name="check"/> Salvar preferências</button></div>
  </div>;
}
