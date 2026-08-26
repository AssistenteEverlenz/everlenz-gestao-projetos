import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://lpfoxpqezcfdvdecfdos.supabase.co";
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "sb_publishable_G_KSK1Ud0DPkXTR9iJIRhg_By7aDsa7";

type Input = {
  projectId?: string;
  project?: string;
  date?: string;
  overall?: number;
  entries?: Array<{ eap: string; activity: string; title: string; description: string; progress: number }>;
  alerts?: Array<{ title: string; description: string; priority: string }>;
};

function localSummary(body: Input) {
  const entries = body.entries ?? [];
  const progress = entries.reduce((sum, entry) => sum + entry.progress, 0);
  const activities = [...new Set(entries.map((entry) => `${entry.eap} · ${entry.activity}`))];
  const attention = (body.alerts ?? []).filter((item) => item.priority === "high" || item.priority === "critical");
  const execution = activities.length ? `No período, houve avanço em ${activities.length} atividade${activities.length > 1 ? "s" : ""}, com ${progress} ponto${progress !== 1 ? "s" : ""} percentual${progress !== 1 ? "is" : ""} medido${progress !== 1 ? "s" : ""}.` : "Não houve medição física registrada no período.";
  const detail = entries.slice(0, 3).map((entry) => entry.title).join("; ");
  const risk = attention.length ? ` Permanecem ${attention.length} ponto${attention.length > 1 ? "s" : ""} crítico${attention.length > 1 ? "s" : ""} sob acompanhamento.` : " Não foram registrados pontos críticos em aberto.";
  return `${body.project ?? "A obra"} apresenta avanço físico geral de ${body.overall ?? 0}%. ${execution}${detail ? ` Principais frentes: ${detail}.` : ""}${risk}`;
}

export async function POST(request: Request) {
  try {
    const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const body = await request.json() as Input;
    if (!body.projectId) return NextResponse.json({ error: "Projeto não informado." }, { status: 400 });
    const supabase = createClient(supabaseUrl, supabaseKey, { auth: { persistSession: false } });
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);
    if (userError || !user) return NextResponse.json({ error: "Sessão inválida." }, { status: 401 });
    const { data: membership } = await supabase.from("project_members").select("user_id").eq("project_id", body.projectId).eq("user_id", user.id).maybeSingle();
    if (!membership) return NextResponse.json({ error: "Acesso ao projeto não autorizado." }, { status: 403 });

    const fallback = localSummary(body);
    if (!process.env.OPENAI_API_KEY) return NextResponse.json({ summary: fallback, source: "local" });
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: process.env.OPENAI_SUMMARY_MODEL ?? "gpt-5.4-mini",
        text: { verbosity: "low" },
        input: `Você é um engenheiro de planejamento. Escreva um resumo executivo em português brasileiro, objetivo, factual e com no máximo 100 palavras. Não invente dados.\n\nDADOS:\n${JSON.stringify(body)}`,
      }),
    });
    if (!response.ok) return NextResponse.json({ summary: fallback, source: "local" });
    const result = await response.json() as { output?: Array<{ content?: Array<{ type?: string; text?: string }> }> };
    const summary = result.output?.flatMap((item) => item.content ?? []).find((item) => item.type === "output_text")?.text?.trim();
    return NextResponse.json({ summary: summary || fallback, source: summary ? "openai" : "local" });
  } catch {
    return NextResponse.json({ error: "Não foi possível gerar o resumo." }, { status: 500 });
  }
}
