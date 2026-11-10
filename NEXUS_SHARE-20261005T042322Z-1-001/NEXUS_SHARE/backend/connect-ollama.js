const fs = require("fs");

const file = "server.js";
const source = fs.readFileSync(file, "utf8");

const chatMarker = '"/api/ai/chat"';
const chatIndex = source.indexOf(chatMarker);

if (chatIndex === -1) {
  console.error('Could not find "/api/ai/chat" in server.js.');
  process.exit(1);
}

/*
  Find the section heading immediately before
  the AI chat route.
*/
const start = source.lastIndexOf(
  "/* =========================================================",
  chatIndex
);

/*
  Find the next section heading after
  the AI chat route. This should be the
  AI ANALYSIS section.
*/
const end = source.indexOf(
  "/* =========================================================",
  chatIndex + chatMarker.length
);

if (start === -1 || end === -1) {
  console.error(
    "Could not determine the AI section boundaries."
  );
  process.exit(1);
}

const ollamaBlock = `/* =========================================================
   NEXUS AI — OLLAMA LOCAL MODEL
========================================================= */

const OLLAMA_URL =
  process.env.OLLAMA_URL ||
  "http://localhost:11434/api/chat";

const OLLAMA_MODEL =
  process.env.OLLAMA_MODEL ||
  "llama3.2";

function buildAISystemPrompt({
  mode = "crisis",
  location = "Tamil Nadu",
  context = {}
}) {
  return \`
You are NEXUS AI, the intelligence assistant inside
NEXUS — Crisis Intelligence for Tamil Nadu.

Your job:
- Help citizens understand NEXUS information.
- Explain hazards, disruptions, reports and risk.
- Give calm, practical and safety-focused guidance.
- Never invent a live event, road closure, traffic condition,
  weather condition, authority action or emergency response.
- Clearly distinguish confirmed information from uncertainty.
- Use the supplied NEXUS context for current information.
- Never claim that you contacted police, fire, ambulance,
  government officers or another authority.
- Never claim live traffic unless live traffic data is supplied.
- Never fabricate coordinates or incident records.

Operating area:
\${location}

Current mode:
\${mode}

NEXUS context:
\${JSON.stringify(context, null, 2)}

Response rules:
- Be concise but useful.
- Use plain language.
- For emergencies, prioritize immediate safe actions.
- When information is unavailable, say so directly.
- Never present guesses as confirmed facts.
\`;
}

async function callOllama({ messages }) {
  const response = await fetch(
    OLLAMA_URL,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages,
        stream: false
      })
    }
  );

  const raw = await response.text();

  let data;

  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(
      "Ollama returned an invalid response."
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.error ||
      "Ollama request failed."
    );
  }

  const reply =
    data?.message?.content;

  if (!reply) {
    throw new Error(
      "Ollama returned no AI response."
    );
  }

  return {
    reply: String(reply),
    model:
      data?.model ||
      OLLAMA_MODEL,
    provider: "Ollama"
  };
}

app.post(
  "/api/ai/chat",
  async (req, res) => {
    try {
      const message =
        String(
          req.body?.message || ""
        ).trim();

      const mode =
        String(
          req.body?.mode ||
          "crisis"
        );

      const location =
        String(
          req.body?.location ||
          "Tamil Nadu"
        );

      const context =
        req.body?.context || {};

      if (!message) {
        return statusError(
          res,
          "AI message is required."
        );
      }

      const systemPrompt =
        buildAISystemPrompt({
          mode,
          location,
          context
        });

      const ai =
        await callOllama({
          messages: [
            {
              role: "system",
              content:
                systemPrompt
            },
            {
              role: "user",
              content:
                message
            }
          ]
        });

      res.json({
        success: true,
        available: true,
        reply: ai.reply,
        model: ai.model,
        provider: ai.provider
      });
    } catch (error) {
      console.error(
        "NEXUS AI error:",
        error.message
      );

      res.status(503).json({
        success: false,
        available: false,
        message:
          "NEXUS AI is temporarily unavailable.",
        error:
          process.env.NODE_ENV ===
          "development"
            ? error.message
            : undefined
      });
    }
  }
);

`;

const newSource =
  source.slice(0, start) +
  ollamaBlock +
  source.slice(end);

fs.writeFileSync(
  file,
  newSource,
  "utf8"
);

console.log(
  "NEXUS AI successfully connected to Ollama."
);