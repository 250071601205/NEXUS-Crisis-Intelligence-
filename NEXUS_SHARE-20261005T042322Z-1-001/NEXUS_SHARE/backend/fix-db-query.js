const fs = require("fs");

const file = "server.js";
let source = fs.readFileSync(file, "utf8");

const start = source.indexOf(
  "async function query(sql, params = []) {"
);

const end = source.indexOf(
  "function rowsOf",
  start
);

if (start === -1 || end === -1) {
  console.error(
    "Could not find the database query helper."
  );
  process.exit(1);
}

const replacement = `async function query(sql, params = []) {
  let result;

  if (typeof db.query === "function") {
    result = await db.query(sql, params);
  } else if (
    db.pool &&
    typeof db.pool.query === "function"
  ) {
    result = await db.pool.query(sql, params);
  } else {
    throw new Error(
      "Database query method not found in db.js"
    );
  }

  /*
    mysql2/promise returns:
    [rows, fields] for SELECT
    [resultHeader, fields] for INSERT/UPDATE/DELETE

    NEXUS uses only the first item.
  */
  if (Array.isArray(result)) {
    return result[0];
  }

  return result;
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
  "Database query helper fixed successfully."
);