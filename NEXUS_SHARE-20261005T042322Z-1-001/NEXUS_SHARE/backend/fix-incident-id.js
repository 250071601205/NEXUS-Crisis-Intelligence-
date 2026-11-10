const fs = require("fs");

const file = "server.js";
let source = fs.readFileSync(file, "utf8");

const pattern =
  /const incidentId\s*=\s*result\.insertId;/;

if (!pattern.test(source)) {
  console.error(
    "Could not find the normal incident insertId line."
  );
  process.exit(1);
}

const replacement = `let incidentId =
        result?.insertId ?? null;

      /*
        Fallback for MySQL result-format differences.
        Read the newest incident created by this user.
      */
      if (!incidentId) {
        const latestIncident =
          await query(
            \`
            SELECT id
            FROM incidents
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            \`,
            [req.user.id]
          );

        incidentId =
          rowsOf(latestIncident)[0]?.id ?? null;
      }

      if (!incidentId) {
        throw new Error(
          "Incident was created but its ID could not be determined."
        );
      }`;

source = source.replace(
  pattern,
  replacement
);

fs.writeFileSync(
  file,
  source,
  "utf8"
);

console.log(
  "Normal incident ID handling fixed successfully."
);