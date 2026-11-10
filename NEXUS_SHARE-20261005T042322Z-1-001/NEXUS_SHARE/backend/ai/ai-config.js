const GROQ_API_URL =
  String(
    process.env.GROQ_API_URL ||
      "https://api.groq.com/openai/v1/chat/completions"
  ).trim();

const GROQ_API_KEY =
  String(process.env.GROQ_API_KEY || "").trim();

const GROQ_MODEL =
  String(
    process.env.GROQ_MODEL ||
      "openai/gpt-oss-20b"
  ).trim();

const GROQ_TIMEOUT_MS =
  Number(process.env.GROQ_TIMEOUT_MS || 30000);

module.exports = {
  GROQ_API_URL,
  GROQ_API_KEY,
  GROQ_MODEL,
  GROQ_TIMEOUT_MS
};
