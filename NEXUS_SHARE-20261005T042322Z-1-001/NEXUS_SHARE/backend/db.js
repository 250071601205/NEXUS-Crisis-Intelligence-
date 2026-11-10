const mysql = require("mysql2/promise");

require("dotenv").config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQLHOST || "localhost",
  user: process.env.DB_USER || process.env.MYSQLUSER || "root",
  password: process.env.DB_PASSWORD || process.env.MYSQLPASSWORD || "",
  database: process.env.DB_NAME || process.env.MYSQLDATABASE || "nexus",
  port: Number(process.env.DB_PORT || process.env.MYSQLPORT || 3306),

  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,

  enableKeepAlive: true
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();

    console.log("Connected to NEXUS MySQL database!");

    connection.release();
  } catch (error) {
    console.error(
      "NEXUS MySQL connection failed:",
      error.message
    );
  }
}

testConnection();

module.exports = pool;