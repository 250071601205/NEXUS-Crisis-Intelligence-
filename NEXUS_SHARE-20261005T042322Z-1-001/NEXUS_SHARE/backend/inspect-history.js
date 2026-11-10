const db = require("./db");

async function run() {
  try {
    const [rows] = await db.query(
      "DESCRIBE incident_history"
    );

    console.table(rows);
  } catch (error) {
    console.error(
      "Could not inspect incident_history:",
      error.message
    );
  } finally {
    await db.end();
  }
}

run();