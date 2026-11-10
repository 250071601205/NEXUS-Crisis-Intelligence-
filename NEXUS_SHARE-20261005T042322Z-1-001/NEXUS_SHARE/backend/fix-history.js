const fs = require("fs");

const file = "server.js";
let source = fs.readFileSync(file, "utf8");

const startMarker =
  "async function addIncidentHistory";

const start = source.indexOf(startMarker);

if (start === -1) {
  console.error(
    "Could not find addIncidentHistory in server.js."
  );
  process.exit(1);
}

/*
  Find the next function after addIncidentHistory.
*/
const end = source.indexOf(
  "async function createNotification",
  start
);

if (end === -1) {
  console.error(
    "Could not find the end of addIncidentHistory."
  );
  process.exit(1);
}

const replacement = `async function addIncidentHistory({
  incidentId,
  actorId,
  action,
  fromStatus = null,
  toStatus = null,
  details = null
}) {
  try {
    if (
      !(await tableExists("incident_history"))
    ) {
      return;
    }

    /*
      Actual NEXUS table schema:

      incident_id
      status
      changed_by
      notes
      created_at
    */

    const historyStatus =
      toStatus ||
      fromStatus ||
      "RECORDED";

    let notes = action || "";

    if (details) {
      const detailText =
        typeof details === "string"
          ? details
          : JSON.stringify(details);

      notes =
        notes +
        (detailText
          ? " — " + detailText
          : "");
    }

    notes = String(notes).slice(
      0,
      255
    );

    await query(
      \`
      INSERT INTO incident_history
        (
          incident_id,
          status,
          changed_by,
          notes
        )
      VALUES
        (?, ?, ?, ?)
      \`,
      [
        incidentId,
        historyStatus,
        actorId || null,
        notes
      ]
    );
  } catch (error) {
    console.warn(
      "History logging skipped:",
      error.message
    );
  }
}

`;

source =
  source.slice(0, start) +
  replacement +
  source.slice(end);

fs.writeFileSync(
  file,
  source,
  "utf8"
);

console.log(
  "Incident history writer fixed successfully."
);