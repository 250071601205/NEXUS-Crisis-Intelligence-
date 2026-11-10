const fs = require("fs");

const file = "server.js";
let source = fs.readFileSync(file, "utf8");

/*
  Remove the old OpenRouter configuration block.
*/
source = source.replace(
  /const OPENROUTER_API_KEY\s*=\s*[\s\S]*?const OPENROUTER_URL\s*=\s*[\s\S]*?;\s*/m,
  ""
);

/*
  Replace any remaining OpenRouter configuration checks
  with Ollama configuration checks.
*/
source = source
  .replaceAll("OPENROUTER_API_KEY", "OLLAMA_URL")
  .replaceAll("OPENROUTER_MODEL", "OLLAMA_MODEL")
  .replaceAll("OPENROUTER_URL", "OLLAMA_URL")
  .replaceAll("OpenRouter configured", "Ollama configured")
  .replaceAll("OpenRouter NOT configured", "Ollama NOT configured")
  .replaceAll("openrouter/free", "llama3.2");

/*
  Remove accidental duplicate OpenRouter comments/text.
*/
source = source.replace(
  /NEXUS AI — OPENROUTER/gi,
  "NEXUS AI — OLLAMA LOCAL MODEL"
);

/*
  Make sure the Ollama configuration exists.
  The actual AI implementation already exists
  lower in server.js from our previous step.
*/
const ollamaExists =
  source.includes("const OLLAMA_URL") &&
  source.includes("const OLLAMA_MODEL");

if (!ollamaExists) {
  console.error(
    "Ollama configuration was not found in server.js."
  );
  process.exit(1);
}

fs.writeFileSync(file, source, "utf8");

console.log(
  "OpenRouter references removed. NEXUS backend now uses Ollama."
);