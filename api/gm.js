import Anthropic from "@anthropic-ai/sdk";

// Le modèle par défaut. Pour réduire les coûts, mets SYSTEME_MODEL=claude-sonnet-5
// (ou claude-haiku-4-5) dans les variables d'environnement Vercel.
const MODEL = process.env.SYSTEME_MODEL || "claude-opus-4-8";
// Split de modèles : le mentor (chat) reste sur un modèle haut de gamme,
// les tâches mécaniques (traduction, création/édition de quête) tournent sur Haiku (moins cher).
const CHAT_MODEL = process.env.SYSTEME_CHAT_MODEL || MODEL;
const MECH_MODEL = process.env.SYSTEME_MECH_MODEL || "claude-haiku-4-5";
const STATS = ["physique", "mental", "creativite", "business", "social", "discipline"];

// Prix en $ par million de tokens [entrée, sortie], pour l'estimation de coût renvoyée au client.
const PRICES = {
  "claude-opus-4-8": [5, 25], "claude-opus-4-7": [5, 25], "claude-opus-4-6": [5, 25],
  "claude-sonnet-5": [3, 15], "claude-sonnet-4-6": [3, 15], "claude-haiku-4-5": [1, 5], "claude-fable-5": [10, 50],
};
function costUsd(model, usage) {
  const p = PRICES[model] || [5, 25];
  const i = (usage && usage.input_tokens) || 0, o = (usage && usage.output_tokens) || 0;
  return (i * p[0] + o * p[1]) / 1e6;
}
function ok(res, model, r, payload) {
  return res.status(200).json(Object.assign({}, payload, { _usd: costUsd(model, r && r.usage) }));
}

function toneLine(s) {
  const mood = Number(s.lastMood);
  const sleep = Number(s.lastSleep);
  if ((mood && mood <= 2) || (sleep && sleep < 6)) {
    return "She seems low right now (poor mood or little sleep) — be gentle and encouraging, and lighten the challenge.";
  }
  if ((mood && mood >= 4) || (Number(s.streak) >= 3)) {
    return "She is strong right now — challenge her and raise the bar.";
  }
  return "Read her state and calibrate: firm but kind.";
}

function statsLine(s) {
  const st = s.stats || {};
  return STATS.map((k) => `${k} ${(st[k] && st[k].level) || 1}`).join(", ");
}

function mentorSystem(s) {
  s = s || {};
  const coach = s.coachStyle || "robi";
  if (coach === "epictete") {
    return [
      "You are ROBI, speaking in the spirit of Epictetus — a modern, grounded stoic mentor for Mathilde, never ascetic or cruel.",
      "VOICE: Reply in FRENCH, direct and concise — 2 to 5 short sentences. No flattery, no filler. Respect her enough to tell the truth. Add one concrete action only when it helps.",
      "STOIC CORE (Enchiridion): Separate what depends on her — her judgments, effort, discipline, actions — from what does not — results, numbers, other people's opinions, outcomes (ch.1). Move her point of rest onto the act that depends on her; loosen her grip on the result (ch.11, ch.15). Trouble comes from judgments, not things (ch.5).",
      `ADAPTIVE TONE: ${toneLine(s)} If she expresses real distress (not ordinary frustration), drop the edge and answer with warmth first; philosophy comes gently, never as a reproach.`,
      `HER STATUS: Level ${s.level || 1}, Rank ${s.rank || "E"}, streak ${s.streak || 0}. Recent mood ${s.lastMood || "?"}/5. Stats: ${statsLine(s)}.`,
      "TASK HELP: If she asks to create a task, ask 1 or 2 short questions to clarify, then propose one concrete, doable task title.",
      "DAILY MANAGEMENT: She can adjust a daily task instead of deleting it (change its rhythm, pause, resume, remove). Ask one short question if needed, state the concrete change in one line, tell her to tap Apply.",
      "GUARDRAILS: Stay faithful to Epictetus. Judge judgments and actions, never her worth. Keep it short, in French.",
    ].join("\n\n");
  }
  // ROBI : assistant IA modelé sur JARVIS des films Iron Man (courtois, calme, spirituel, vouvoie), pour toute la famille.
  return [
    "You are ROBI, a personal AI assistant modeled on JARVIS from the Iron Man films: a calm, courteous, quietly witty butler-style AI. You serve Mathilde and her family, and you are their interface to what their personal assistant has set up for them.",
    "VOICE: Reply in FRENCH. Always use the formal 'vous', with the calm courteous wit of JARVIS. Address the person by their first name (see PERSON below), NOT by a gendered honorific. Never call them 'Monsieur': the main user, Mathilde, is a woman; if an honorific is truly needed, use 'Madame'. Be polished, concise and anticipatory — 2 to 4 short sentences, never servile nor cold. You may report and anticipate: 'Je me permets de vous signaler…', 'Si vous le souhaitez, je peux…'. Keep it simple enough for the whole family.",
    `PERSON: prénom ${s.name || "Mathilde"}. Mathilde est une femme : ne l'appelez jamais « Monsieur ».`,
    `STATUS: Niveau ${s.level || 1}, série de ${s.streak || 0} jour(s). Humeur récente ${s.lastMood || "?"}/5. Adaptez le ton : ${toneLine(s)}`,
    "TASK HELP: If they wish to create a task, ask one short question if needed, then propose one concrete, doable task.",
    "DAILY MANAGEMENT: They can adjust a daily task instead of deleting it (change its rhythm, pause, resume, remove). Ask one short question if needed, confirm the change in one line, and invite them to tap Apply.",
    "GUARDRAILS: Courteous and honest, never harsh. Keep it short and clear, in French, always using 'vous'. If someone is in real distress, set the wit aside and answer with warmth first.",
  ].join("\n\n");
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Use POST" });
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "Server missing ANTHROPIC_API_KEY" });
  }

  const client = new Anthropic();
  let body = req.body;
  if (typeof body === "string") {
    try { body = JSON.parse(body); } catch { body = {}; }
  }
  body = body || {};
  const action = body.action;

  try {
    // 1) Chat avec le maître du jeu / mentor stoïcien adaptatif
    if (action === "chat") {
      const history = Array.isArray(body.history) ? body.history.slice(-20) : [];
      const msg = (body.message || "").toString().slice(0, 4000);
      if (!msg) return res.status(400).json({ error: "message required" });
      const r = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 700,
        output_config: { effort: "medium" },
        system: mentorSystem(body.state),
        messages: [...history, { role: "user", content: msg }],
      });
      const reply = r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      return ok(res, CHAT_MODEL, r, { reply });
    }

    // 2) Générer la prochaine quête d'un donjon (sortie JSON structurée)
    if (action === "next_quest") {
      const d = body.dungeon || {};
      const done = Array.isArray(body.doneTitles) ? body.doneTitles.slice(0, 20) : [];
      const sys = "You are ROBI, helping Mathilde. Generate ONE next task (a concrete, doable step) for the objective below, based on her real goal. Do not repeat tasks already done; propose the sensible next step. Keep the title short and actionable, in French.";
      const user = `Objective: "${d.title || ""}" (level ${d.rank || "C"}). Goal: ${d.note || "n/a"}. Already done: ${done.join("; ") || "none"}.`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 250,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                stat: { type: "string", enum: STATS },
                prio: { type: "string", enum: ["high", "med", "low"] },
              },
              required: ["title", "stat", "prio"],
              additionalProperties: false,
            },
          },
        },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, MECH_MODEL, r, JSON.parse(t.text));
    }

    // 3) Traduire un titre de quête FR -> EN (sortie JSON structurée)
    if (action === "translate") {
      const fr = (body.text || "").toString().slice(0, 500);
      if (!fr) return res.status(400).json({ error: "text required" });
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 120,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: { en: { type: "string" } },
              required: ["en"],
              additionalProperties: false,
            },
          },
        },
        system: "Translate the task title from French to English. Keep it a short, natural, imperative task title. Output only the translation in the schema.",
        messages: [{ role: "user", content: fr }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, MECH_MODEL, r, JSON.parse(t.text));
    }

    // 4) Créer une quête à partir d'une conversation / description (JSON structuré)
    if (action === "make_quest") {
      const desc = (body.description || "").toString().slice(0, 3000);
      const dungeons = Array.isArray(body.dungeons) ? body.dungeons.slice(0, 20) : [];
      const sys = "From the conversation/description below, produce ONE concrete task for Mathilde's personal dashboard. Pick the best-fitting area and a sensible priority. Set daily=true only for a recurring daily habit. If it clearly belongs to one of the listed objectives, set mission to that objective's id, otherwise empty string. Keep the title short and actionable, in French.";
      const user = `Conversation / description:\n${desc}\n\nObjectives (id=title): ${dungeons.map((d) => d.id + "=" + d.title).join("; ") || "none"}`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 250,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                stat: { type: "string", enum: STATS },
                prio: { type: "string", enum: ["high", "med", "low"] },
                daily: { type: "boolean" },
                mission: { type: "string" },
              },
              required: ["title", "stat", "prio", "daily", "mission"],
              additionalProperties: false,
            },
          },
        },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, MECH_MODEL, r, JSON.parse(t.text));
    }

    // 5) Modifier une quête journalière à partir de la conversation (JSON structuré)
    if (action === "edit_daily") {
      const desc = (body.description || "").toString().slice(0, 3000);
      const q = body.quest || {};
      const sys = "Decide how Mathilde wants to change her recurring daily quest, based on the conversation. Options for op: cadence_everyN (recurs every N days; everyN=1 means every day), cadence_weekdays (recurs on specific weekdays; fill weekdays with integers where 0=Sunday, 1=Monday, ... 6=Saturday), pause (stop it without deleting), resume (reactivate), delete (remove it), none (intent not clear yet). Fill everyN only for cadence_everyN, otherwise 1. Fill weekdays only for cadence_weekdays, otherwise an empty array.";
      const user = `Task: "${q.title || ""}". Current cadence: ${JSON.stringify(q.cad || null)}, paused: ${!!q.paused}.\n\nConversation:\n${desc}`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 200,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                op: { type: "string", enum: ["cadence_everyN", "cadence_weekdays", "pause", "resume", "delete", "none"] },
                everyN: { type: "integer" },
                weekdays: { type: "array", items: { type: "integer" } },
              },
              required: ["op", "everyN", "weekdays"],
              additionalProperties: false,
            },
          },
        },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, MECH_MODEL, r, JSON.parse(t.text));
    }

    // 6) Message d'accueil du maître à l'ouverture de l'app (JSON structuré)
    if (action === "greeting") {
      const st = body.state || {};
      const todo = Number(body.todo) || 0;
      const sys = "You are ROBI, a personal AI assistant with the calm, courteous, quietly witty tone of JARVIS from Iron Man. Produce ONE short line in FRENCH (max 24 words) greeting the person warmly as they open the app, ready to assist. Use the formal 'vous'. Address them by their first name (given below), never by a gendered honorific. The main user, Mathilde, is a woman: NEVER 'Monsieur'. Do NOT mention any task count or to-do reminder. No quotes, no preamble, output only the line.";
      const user = `Prénom : ${st.name || "Mathilde"}. Série : ${st.streak || 0} jour(s). Humeur récente : ${st.lastMood || "?"}/5.`;
      const r = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 120,
        output_config: {
          format: { type: "json_schema", schema: { type: "object", properties: { line: { type: "string" } }, required: ["line"], additionalProperties: false } },
        },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, CHAT_MODEL, r, JSON.parse(t.text));
    }

    // 6bis) Citation tranchante et productive du jour, en lien avec ses projets (JSON structuré)
    if (action === "citation") {
      const st = body.state || {};
      const objs = Array.isArray(body.objectives) ? body.objectives.slice(0, 12) : [];
      const sys = "Tu forges UNE citation tranchante et productive, en FRANÇAIS, pour Mathilde. Style : incisif et stoïcien à la manière d'Épictète, mais moderne et motivant, jamais mièvre ni ascétique. Une phrase qui claque, lui parle et la pousse à agir aujourd'hui, en lien direct avec ce qu'elle construit en ce moment (ses projets ci-dessous). Elle distingue ce qui dépend d'elle (son effort, sa constance) de ce qui n'en dépend pas (les résultats, les chiffres). Contraintes : max 22 mots, tutoiement, PAS de tiret long, pas de guillemets, pas d'auteur ni d'attribution, pas de préambule. Sortie : la phrase seule.";
      const goals = "Ses grands buts : chaîne YouTube sur le Vatican (marché US) à monétiser, BD sur les volontaires du Pacifique pour les écoles, site d'analyse fondamentale des marchés et cryptos. Elle vise la liberté financière et géographique, et plus de discipline au quotidien.";
      const cur = objs.length ? `Ce qu'elle construit en ce moment (ses objectifs) : ${objs.map((o) => o.title + (o.note ? " (" + o.note + ")" : "")).join(" ; ")}.` : "";
      const user = `${cur}\n${goals}\nSérie en cours : ${st.streak || 0} jour(s).`;
      const r = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 120,
        output_config: {
          format: { type: "json_schema", schema: { type: "object", properties: { line: { type: "string" } }, required: ["line"], additionalProperties: false } },
        },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, CHAT_MODEL, r, JSON.parse(t.text));
    }

    // 8) Bilan hebdomadaire : réaligner les tâches sur l'avancement réel des projets (JSON structuré)
    if (action === "weekly_review") {
      const dungeons = Array.isArray(body.dungeons) ? body.dungeons.slice(0, 20) : [];
      const desc = (body.description || "").toString().slice(0, 4000);
      const sys = "Voici le bilan hebdomadaire de Mathilde, projet par projet (ses objectifs). À partir de ce qu'elle raconte de son avancement, propose 4 à 10 tâches concrètes et actionnables pour la semaine à venir, réparties sur les bons projets. Titres courts, en français. Pour chaque tâche : la meilleure stat, une priorité sensée, et l'id de l'objectif concerné (mission) si elle s'y rattache, sinon chaîne vide.";
      const user = `Objectifs (id=titre, palier, but) :\n${dungeons.map((d) => `${d.id}=${d.title} [${d.rank}] ${d.note || ""}`).join("\n") || "aucun"}\n\nBilan de Mathilde :\n${desc}`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 700,
        output_config: {
          format: {
            type: "json_schema",
            schema: {
              type: "object",
              properties: {
                quests: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      title: { type: "string" },
                      stat: { type: "string", enum: STATS },
                      prio: { type: "string", enum: ["high", "med", "low"] },
                      mission: { type: "string" },
                    },
                    required: ["title", "stat", "prio", "mission"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["quests"],
              additionalProperties: false,
            },
          },
        },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, MECH_MODEL, r, JSON.parse(t.text));
    }

    // 9) Suggestion d'outil / skill / automatisation selon l'avancement (texte)
    if (action === "suggest") {
      const focus = (body.focus || "").toString().slice(0, 600);
      const projects = Array.isArray(body.projects) ? body.projects.slice(0, 12) : [];
      const recent = Array.isArray(body.recent) ? body.recent.slice(0, 12) : [];
      const sys = "You are ROBI, Mathilde's strategist assistant. Context: she runs a YouTube channel about the Vatican (US market), makes a comic book (BD) about WWII Pacific volunteers for local schools, is building an automated markets/crypto analysis site, learns English, and works daily in Claude Code. Based on what she is working on now and her projects, propose ONE concrete lever to level up her automation or workflow: name a specific tool, an Anthropic Skill, a Claude Code workflow/command/subagent/MCP, or an automation. Say in one line why it fits, then give 2-3 concrete steps to set it up. If she already built something (e.g. SEO automation in Claude Code), propose the NEXT step beyond it, not the same thing. If you are not certain a specific named tool exists, describe the capability to look for rather than inventing a precise product name. Practical and concise, in FRENCH, 4 to 7 short lines. No preamble.";
      const user = `En ce moment : ${focus || "(non précisé, choisis selon ses projets)"}\nProjets : ${projects.join(", ") || "n/a"}\nTâches récentes : ${recent.join(", ") || "n/a"}`;
      const r = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 500,
        output_config: { effort: "medium" },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const reply = r.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      return ok(res, CHAT_MODEL, r, { reply });
    }

    // 10) coach_prompt : une épreuve/question du jour selon le type (epictete | defi | journal)
    if (action === "coach_prompt") {
      const kind = ["epictete", "defi", "journal"].includes(body.kind) ? body.kind : "defi";
      const s = body.state || {};
      const name = s.name || "Mathilde";
      const persona = {
        epictete: `You are Epictetus, a modern grounded stoic mentor for ${name} (a woman), never ascetic nor cruel. Give ONE short, concrete stoic challenge to live TODAY, inspired by the Enchiridion: actionable, modern, not radical. 2 to 3 sentences, in FRENCH, address her with 'tu'. No preamble.`,
        defi: `You are an expert life coach for ${name} (a woman). Her world: a YouTube channel about the Vatican (US market), a comic book about WWII Pacific volunteers for schools, an automated markets/crypto analysis site, learning English, daily discipline. Ask ONE sharp, meaningful coaching question of the day that makes her reflect and act on her goals. One question only, in FRENCH, warm but incisive, address her with 'tu'. No preamble.`,
        journal: `You are an expert life coach helping ${name} (a woman) look back on her day. Ask 1 or 2 short, warm questions to understand how her day went and what she learned from it. In FRENCH, curious and caring, concise, address her with 'tu'. No preamble.`,
      }[kind];
      const r = await client.messages.create({
        model: CHAT_MODEL, max_tokens: 240,
        output_config: { effort: "low", format: { type: "json_schema", schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"], additionalProperties: false } } },
        system: persona,
        messages: [{ role: "user", content: `Niveau ${s.level || 1}, série ${s.streak || 0}. Donne ${kind === "journal" ? "tes questions" : ("ton " + (kind === "epictete" ? "épreuve" : "défi"))} du jour.` }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, CHAT_MODEL, r, JSON.parse(t.text));
    }

    // 11) coach_judge : juge si la réponse mérite la récompense, et explique si non
    if (action === "coach_judge") {
      const kind = ["epictete", "defi", "journal"].includes(body.kind) ? body.kind : "defi";
      const prompt = (body.prompt || "").toString().slice(0, 1500);
      const answer = (body.answer || "").toString().slice(0, 3000);
      const name = (body.state && body.state.name) || "Mathilde";
      const who = { epictete: "Epictetus, the stoic mentor", defi: "an expert life coach", journal: "an expert life coach" }[kind];
      const sys = `You are ${who} for ${name} (a woman). Judge whether her answer below is a genuine, sincere, specific engagement with the challenge/question, NOT random, empty, one-word, evasive or off-topic. Be fair but never reward a non-answer. If genuine: set ok=true and write a short warm validation in FRENCH (1 to 2 sentences, address her with 'tu'). If not genuine: set ok=false and clearly explain in FRENCH (1 to 2 sentences) why it is not enough and what a real answer would look like. Never be cruel.`;
      const r = await client.messages.create({
        model: CHAT_MODEL, max_tokens: 280,
        output_config: { effort: "medium", format: { type: "json_schema", schema: { type: "object", properties: { ok: { type: "boolean" }, message: { type: "string" } }, required: ["ok", "message"], additionalProperties: false } } },
        system: sys,
        messages: [{ role: "user", content: `Défi/question du jour :\n"${prompt}"\n\nRéponse de ${name} :\n"${answer}"` }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, CHAT_MODEL, r, JSON.parse(t.text));
    }

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
}
