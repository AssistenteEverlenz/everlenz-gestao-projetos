"use client";
/* eslint-disable @next/next/no-img-element -- a prévia do relatório aceita evidências e URLs blob */

import { useState } from "react";
import { Icon } from "../icons";
import type { JournalEntry, Member, Project, Task, ViewId } from "../types";
import { Modal, StatusBadge } from "../ui";

type Props = { project: Project; tasks: Task[]; entries: JournalEntry[]; members: Member[]; navigate: (view: ViewId) => void; metrics: { overall: number; active: number }; setToast: (value: string) => void };

export function Reports({ project, tasks, entries, metrics, setToast }: Props) {
  const [preview, setPreview] = useState(false);
  const reports = [
    { date: "24 ago 2026", code: "SR-0104", title: "Status diário · Segunda-feira", status: "Em revisão", photos: 5, updates: 2 },
    { date: "23 ago 2026", code: "SR-0103", title: "Status diário · Domingo", status: "Enviado", photos: 3, updates: 1 },
    { date: "22 ago 2026", code: "SR-0102", title: "Status diário · Sábado", status: "Enviado", photos: 8, updates: 3 },
  ];
  return <div className="view-stack reports-view">
    <section className="report-builder glass"><div className="builder-icon"><Icon name="spark"/></div><div><span className="overline">RELATÓRIO AUTOMÁTICO</span><h2>O status report de hoje está pronto para revisar.</h2><p>Combinamos as atualizações do diário, as fotos e o avanço físico em uma narrativa objetiva para o cliente.</p><div className="builder-chips"><span><Icon name="trend"/> {metrics.overall}% de avanço geral</span><span><Icon name="journal"/> 2 atividades atualizadas</span><span><Icon name="camera"/> 5 evidências</span></div></div><button className="primary-btn" onClick={() => setPreview(true)}>Revisar relatório <Icon name="arrow"/></button></section>

    <section className="panel glass reports-panel"><header className="panel-header"><div><span className="overline">HISTÓRICO</span><h3>Relatórios da obra</h3></div><div className="search-box"><Icon name="search"/><input placeholder="Buscar relatório..."/></div></header><div className="report-table">
      <div className="report-row report-head"><span>RELATÓRIO</span><span>CONTEÚDO</span><span>STATUS</span><span/></div>
      {reports.map((report) => <button className="report-row" key={report.code} onClick={() => setPreview(true)}><span><i className="pdf-icon"><Icon name="report"/></i><span><strong>{report.title}</strong><small>{report.code} · {report.date}</small></span></span><span><small>{report.updates} atualizações</small><small>{report.photos} fotos</small></span><span><StatusBadge value={report.status}/></span><span><Icon name="more"/></span></button>)}
    </div></section>

    {preview && <Modal title="Prévia do status report" subtitle="SR-0104 · 24 de agosto de 2026" onClose={() => setPreview(false)} wide>
      <div className="report-preview">
        <div className="report-paper">
          <header><div className="report-logo"><img src="/emdia.svg" alt=""/><strong>em dia <span>BY EVERLENZ</span></strong></div><small>STATUS REPORT · SR-0104</small></header>
          <div className="report-cover"><span>ACOMPANHAMENTO DIÁRIO</span><h2>{project.name}</h2><p>{project.client} · {project.location}</p><strong>24 de agosto de 2026</strong></div>
          <div className="report-kpis"><div><span>AVANÇO GERAL</span><strong>{metrics.overall}%</strong></div><div><span>PLANEJADO</span><strong>41%</strong></div><div><span>DESVIO</span><strong className="danger">−3 p.p.</strong></div><div><span>STATUS</span><strong>No prazo</strong></div></div>
          <section><h3>Resumo executivo</h3><p>As frentes de estrutura e vedação avançaram conforme a programação do dia. A armação positiva da laje atingiu {tasks.find((task) => task.id === 7)?.progress}% e a alvenaria do setor norte recebeu quatro novas fiadas. O desvio acumulado permanece controlado e não altera, neste momento, a previsão contratual.</p></section>
          <section><h3>Evolução registrada hoje</h3><div className="preview-photos">{entries.slice(0, 2).map((entry) => <article key={entry.id}>{entry.image && <img src={entry.image} alt=""/>}<div><strong>{entry.title}</strong><p>{entry.description}</p><span>+{entry.progressAdded}% no cronograma</span></div></article>)}</div></section>
          <footer>Gerado por Em Dia · by Everlenz · Informação técnica com evidência de campo</footer>
        </div>
        <div className="preview-actions"><button className="secondary-btn" onClick={() => window.print()}><Icon name="download"/> Exportar PDF</button><button className="primary-btn" onClick={() => { setPreview(false); setToast("Relatório marcado como enviado ao cliente."); }}><Icon name="share"/> Aprovar e compartilhar</button></div>
      </div>
    </Modal>}
  </div>;
}
