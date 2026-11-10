const {
  GROQ_API_URL,
  GROQ_API_KEY,
  GROQ_MODEL,
  GROQ_TIMEOUT_MS
} = require("./ai-config");

const isGroqConfigured =
  Boolean(GROQ_API_KEY);

async function callGroq({ messages }) {
  if (!isGroqConfigured) {
    throw new Error(
      "GROQ_API_KEY is not configured."
    );
  }

  if (!Array.isArray(messages) || !messages.length) {
    throw new Error(
      "Groq messages are required."
    );
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () => controller.abort(),
      GROQ_TIMEOUT_MS
    );

  const startedAt = Date.now();

  try {
    const response =
      await fetch(
        GROQ_API_URL,
        {
          method: "POST",

          headers: {
            "Content-Type": "application/json",
            Authorization:
              `Bearer ${GROQ_API_KEY}`
          },

          body: JSON.stringify({
            model: GROQ_MODEL,
            messages,
            temperature: 0.2,
            reasoning_effort: "low",
            max_completion_tokens: 256
          }),

          signal: controller.signal
        }
      );

    const raw =
      await response.text();

    let data;

    try {
      data = JSON.parse(raw);
    } catch {
      throw new Error(
        `Groq returned invalid JSON (HTTP ${response.status}).`
      );
    }

    if (!response.ok) {
      throw new Error(
        data?.error?.message ||
        data?.error ||
        `Groq request failed with HTTP ${response.status}.`
      );
    }

    const reply =
      data?.choices?.[0]?.message?.content;

    if (!reply) {
      throw new Error(
        "Groq returned no AI response."
      );
    }

    console.log(
      `[NEXUS AI] Groq completed in ${Date.now() - startedAt} ms.`
    );

    return {
      reply: String(reply).trim(),

      model:
        data?.model ||
        GROQ_MODEL,

      provider: "Groq"
    };

  } catch (error) {

    if (error?.name === "AbortError") {
      throw new Error(
        `Groq AI request timed out after ${GROQ_TIMEOUT_MS / 1000} seconds.`
      );
    }

    throw error;

  } finally {
    clearTimeout(timeout);
  }
}

async function testGroq() {
  return callGroq({
    messages: [
      {
        role: "user",
        content:
          "Reply with exactly: NEXUS AI online."
      }
    ]
  });
}

module.exports = {
  callGroq,
  testGroq,
  isGroqConfigured
};