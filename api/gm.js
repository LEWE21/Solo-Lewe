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
  return [
    "You are THE SYSTEM — the game master of Mathilde's life RPG (Solo Leveling style) and her mentor in the spirit of Epictetus: modern, grounded, never ascetic or cruel.",
    "VOICE: Reply in English, direct and concise — 2 to 5 short sentences. No flattery, no filler. Respect her enough to tell the truth. Add one concrete action only when it helps.",
    "STOIC CORE (Enchiridion): Separate what depends on her — her judgments, effort, discipline, actions — from what does not — results, numbers, other people's opinions, outcomes (ch.1). Move her point of rest onto the act that depends on her; loosen her grip on the result (ch.11, ch.15). Trouble comes from judgments, not things (ch.5).",
    `ADAPTIVE TONE: ${toneLine(s)} If she expresses real distress (not ordinary frustration), drop the edge and answer with warmth first; philosophy comes gently, never as a reproach.`,
    `HER STATUS: Level ${s.level || 1}, Rank ${s.rank || "E"}, streak ${s.streak || 0}. Recent mood ${s.lastMood || "?"}/5, last sleep ${s.lastSleep || "?"}h. Stats: ${statsLine(s)}.`,
    "QUEST HELP: If she asks to create a quest, ask 1 or 2 short questions to clarify (what exactly, by when, which project), then propose one concrete, doable quest title.",
    "DAILY MANAGEMENT: She can adjust one of her daily quests instead of deleting it directly. She may change its rhythm (every N days, or specific weekdays), pause it, resume it, or remove it. Ask one short clarifying question if needed, then state the concrete change in one line and tell her to tap the Apply button.",
    "GUARDRAILS: Stay faithful to Epictetus. Judge judgments and actions, never her worth. If she writes to you in French, you may answer in French. Keep it short.",
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
      const sys = "You are the game master of Mathilde's life RPG. Generate ONE next quest (a concrete, doable step) for the dungeon below, based on her real objective. Do not repeat quests already done; propose the sensible next step. Keep the title short and actionable, in English.";
      const user = `Dungeon: "${d.title || ""}" (rank ${d.rank || "C"}). Objective: ${d.note || "n/a"}. Already done: ${done.join("; ") || "none"}.`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 250,
        output_config: {
          effort: "low",
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
          effort: "low",
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
        system: "Translate the quest title from French to English. Keep it a short, natural, imperative task title. Output only the translation in the schema.",
        messages: [{ role: "user", content: fr }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, MECH_MODEL, r, JSON.parse(t.text));
    }

    // 4) Créer une quête à partir d'une conversation / description (JSON structuré)
    if (action === "make_quest") {
      const desc = (body.description || "").toString().slice(0, 3000);
      const dungeons = Array.isArray(body.dungeons) ? body.dungeons.slice(0, 20) : [];
      const sys = "From the conversation/description below, produce ONE concrete quest for Mathilde's life-RPG. Pick the best-fitting stat and a sensible priority. Set daily=true only for a recurring daily habit. If it clearly belongs to one of the listed dungeons, set mission to that dungeon's id, otherwise empty string. Keep the title short and actionable, in French.";
      const user = `Conversation / description:\n${desc}\n\nDungeons (id=title): ${dungeons.map((d) => d.id + "=" + d.title).join("; ") || "none"}`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 250,
        output_config: {
          effort: "low",
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
      const user = `Quest: "${q.title || ""}". Current cadence: ${JSON.stringify(q.cad || null)}, paused: ${!!q.paused}.\n\nConversation:\n${desc}`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 200,
        output_config: {
          effort: "low",
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
      const sys = "You are THE SYSTEM, game master of Mathilde's life-RPG, mentor in the spirit of Epictetus (modern, grounded, never cruel). Produce ONE short line in FRENCH (max 22 words) to greet her as she opens the app: a bit epic and motivating, stoic, centered on what depends on her. No quotes, no preamble, output only the line.";
      const user = `Niveau ${st.level || 1}, rang ${st.rank || "E"}, série ${st.streak || 0} jours. Humeur récente ${st.lastMood || "?"}/5.`;
      const r = await client.messages.create({
        model: CHAT_MODEL,
        max_tokens: 120,
        output_config: {
          effort: "low",
          format: { type: "json_schema", schema: { type: "object", properties: { line: { type: "string" } }, required: ["line"], additionalProperties: false } },
        },
        system: sys,
        messages: [{ role: "user", content: user }],
      });
      const t = r.content.find((b) => b.type === "text");
      return ok(res, CHAT_MODEL, r, JSON.parse(t.text));
    }

    // 7) Étendre un donjon vaincu : générer 2 à 4 nouvelles quêtes (JSON structuré)
    if (action === "expand_dungeon") {
      const d = body.dungeon || {};
      const desc = (body.description || "").toString().slice(0, 3000);
      const sys = "Mathilde vient de vaincre le boss d'un donjon (un de ses projets). À partir de la conversation et de l'objectif du donjon, propose 2 à 4 nouvelles quêtes concrètes et actionnables pour l'étape suivante de ce projet. Titres courts, en français. Choisis pour chacune la meilleure stat et une priorité sensée.";
      const user = `Donjon : "${d.title || ""}" (rang ${d.rank || "C"}). Objectif : ${d.note || "n/a"}.\n\nConversation :\n${desc || "(rien de précis, propose la suite logique du projet)"}`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 400,
        output_config: {
          effort: "low",
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
                    },
                    required: ["title", "stat", "prio"],
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

    // 8) Bilan hebdomadaire : réaligner les quêtes sur l'avancement réel des projets (JSON structuré)
    if (action === "weekly_review") {
      const dungeons = Array.isArray(body.dungeons) ? body.dungeons.slice(0, 20) : [];
      const desc = (body.description || "").toString().slice(0, 4000);
      const sys = "Voici le bilan hebdomadaire de Mathilde, projet par projet (ses donjons). À partir de ce qu'elle raconte de son avancement, propose 4 à 10 quêtes concrètes et actionnables pour la semaine à venir, réparties sur les bons projets. Titres courts, en français. Pour chaque quête : la meilleure stat, une priorité sensée, et l'id du donjon concerné (mission) si elle s'y rattache, sinon chaîne vide.";
      const user = `Donjons (id=titre, rang, objectif) :\n${dungeons.map((d) => `${d.id}=${d.title} [${d.rank}] ${d.note || ""}`).join("\n") || "aucun"}\n\nBilan de Mathilde :\n${desc}`;
      const r = await client.messages.create({
        model: MECH_MODEL,
        max_tokens: 700,
        output_config: {
          effort: "low",
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
      const sys = "You are THE SYSTEM's strategist for Mathilde. Context: she runs a YouTube channel about the Vatican (US market), makes a comic book (BD) about WWII Pacific volunteers for local schools, is building an automated markets/crypto analysis site, learns English, and works daily in Claude Code. Based on what she is working on now and her projects, propose ONE concrete lever to level up her automation or workflow: name a specific tool, an Anthropic Skill, a Claude Code workflow/command/subagent/MCP, or an automation. Say in one line why it fits, then give 2-3 concrete steps to set it up. If she already built something (e.g. SEO automation in Claude Code), propose the NEXT step beyond it, not the same thing. If you are not certain a specific named tool exists, describe the capability to look for rather than inventing a precise product name. Practical and concise, in FRENCH, 4 to 7 short lines. No preamble.";
      const user = `En ce moment : ${focus || "(non précisé, choisis selon ses projets)"}\nProjets : ${projects.join(", ") || "n/a"}\nQuêtes récentes : ${recent.join(", ") || "n/a"}`;
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

    return res.status(400).json({ error: "unknown action" });
  } catch (e) {
    return res.status(500).json({ error: e && e.message ? e.message : String(e) });
  }
}
