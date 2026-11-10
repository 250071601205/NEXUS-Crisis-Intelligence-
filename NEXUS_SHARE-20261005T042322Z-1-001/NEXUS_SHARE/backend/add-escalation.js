const fs = require("fs");

const file = "server.js";
let source = fs.readFileSync(file, "utf8");

if (
  source.includes(
    "function createEscalationNotifications"
  )
) {
  console.log(
    "Escalation system is already installed."
  );
  process.exit(0);
}

/*
  Find the first Express root route instead of relying
  on a specific section-heading format.
*/
const marker = 'app.get("/",';

const insertAt = source.indexOf(marker);

if (insertAt === -1) {
  console.error(
    'Could not find the root app.get("/") route.'
  );
  process.exit(1);
}

const escalationCode = `
/* =========================================================
   NEXUS AUTOMATIC ESCALATION
========================================================= */

async function createEscalationNotifications({
  incidentId,
  title,
  location,
  severity,
  reason
}) {
  const level =
    String(severity || "LOW").toUpperCase();

  if (
    level !== "CRITICAL" &&
    level !== "HIGH"
  ) {
    return;
  }

  const escalationType =
    level === "CRITICAL"
      ? "CRITICAL_ESCALATION"
      : "HIGH_PRIORITY";

  const escalationMessage =
    level === "CRITICAL"
      ? \`CRITICAL escalation: "\${title}" at \${location}. Immediate authority attention is required. Reason: \${reason || "Critical severity"}.\`
      : \`HIGH priority alert: "\${title}" at \${location}. Authority attention is recommended. Reason: \${reason || "High severity"}.\`;

  try {
    const result =
      await query(
        \`
        SELECT id
        FROM users
        WHERE role = 'AUTHORITY'
          AND is_active = 1
        \`
      );

    for (
      const user of rowsOf(result)
    ) {
      await createNotification({
        userId: user.id,
        incidentId,
        title:
          level === "CRITICAL"
            ? "CRITICAL INCIDENT ESCALATION"
            : "HIGH PRIORITY INCIDENT",
        message:
          escalationMessage,
        type:
          escalationType,
        severity:
          level
      });
    }

    await addIncidentHistory({
      incidentId,
      actorId: null,
      action:
        level === "CRITICAL"
          ? "CRITICAL_ESCALATION_TRIGGERED"
          : "HIGH_PRIORITY_ALERT_TRIGGERED",
      fromStatus: null,
      toStatus: null,
      details: {
        escalation_level:
          level,
        reason:
          reason ||
          "Severity threshold triggered"
      }
    });

    console.log(
      \`NEXUS escalation triggered: Incident #\${incidentId} → \${level}\`
    );
  } catch (error) {
    console.error(
      "Escalation notification error:",
      error.message
    );
  }
}

`;

source =
  source.slice(0, insertAt) +
  escalationCode +
  source.slice(insertAt);

/*
  Add the escalation call specifically to the normal
  citizen incident creation flow.
*/
const hookMarker =
  'await notifyAuthorityUsers({';

const hookIndex = source.indexOf(
  hookMarker,
  insertAt + escalationCode.length
);

if (hookIndex === -1) {
  console.error(
    "Escalation function was added, but the incident notification hook could not be found."
  );
  process.exit(1);
}

/*
  Find the closing }); for notifyAuthorityUsers.
*/
const hookEnd =
  source.indexOf(
    "});",
    hookIndex
  );

if (hookEnd === -1) {
  console.error(
    "Could not find the end of the incident notification call."
  );
  process.exit(1);
}

const afterNotification =
  hookEnd + 3;

const escalationCall = `

      await createEscalationNotifications({
        incidentId,
        title,
        location,
        severity,
        reason:
          severity === "CRITICAL"
            ? "Critical citizen incident"
            : "High-severity citizen incident"
      });`;

source =
  source.slice(0, afterNotification) +
  escalationCall +
  source.slice(afterNotification);

fs.writeFileSync(
  file,
  source,
  "utf8"
);

console.log(
  "NEXUS automatic escalation installed successfully."
);