"use client";

import { Icon } from "../icons";

export function Settings({ dark, setDark, setToast }: { dark: boolean; setDark: (value: boolean) => void; setToast: (value: string) => void }) {
  return <div className="view-stack settings-view">
    <section className="settings-grid">
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="sun"/></span><div><span className="overline">APARÊNCIA</span><h3>Tema da interface</h3><p>Escolha o modo mais confortável para escritório ou canteiro.</p></div><div className="theme-options"><button className={!dark ? "active" : ""} onClick={() => setDark(false)}><span className="theme-preview light-preview"/><Icon name="sun"/> Claro</button><button className={dark ? "active" : ""} onClick={() => setDark(true)}><span className="theme-preview dark-preview"/><Icon name="moon"/> Escuro</button></div></div>
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="report"/></span><div><span className="overline">RELATÓRIOS</span><h3>Padrão do status report</h3><p>Defina os dados que aparecem em todos os documentos.</p></div><label><span>Nome da empresa</span><input defaultValue="Everlenz Engenharia"/></label><label><span>Mensagem de rodapé</span><input defaultValue="Informação técnica com evidência de campo"/></label></div>
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="bell"/></span><div><span className="overline">NOTIFICAÇÕES</span><h3>Alertas do projeto</h3><p>Receba avisos importantes sem excesso de ruído.</p></div><label className="setting-toggle"><span><strong>Atividade crítica atrasada</strong><small>Aviso imediato para gestores</small></span><input type="checkbox" defaultChecked/><i/></label><label className="setting-toggle"><span><strong>Relatório pronto para revisar</strong><small>Um resumo ao fim de cada dia</small></span><input type="checkbox" defaultChecked/><i/></label></div>
      <div className="panel glass settings-card"><span className="settings-icon"><Icon name="calendar"/></span><div><span className="overline">PLANEJAMENTO</span><h3>Calendário da obra</h3><p>Configuração usada no cálculo de durações e dependências.</p></div><label><span>Jornada padrão</span><select defaultValue="seg-sab"><option value="seg-sab">Segunda a sábado</option><option value="seg-sex">Segunda a sexta</option></select></label><label><span>Horas por dia</span><input type="number" defaultValue="8"/></label></div>
    </section>
    <div className="settings-actions"><button className="primary-btn" onClick={() => setToast("Preferências salvas.")}><Icon name="check"/> Salvar preferências</button></div>
  </div>;
}
