const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const departments = [
  {
    name: "Water & Drainage",
    email: "water@nexus.local",
    password: "Water@123",
    department_id: 1
  },
  {
    name: "Traffic & Transport",
    email: "traffic@nexus.local",
    password: "Traffic@123",
    department_id: 2
  },
  {
    name: "Fire & Rescue",
    email: "fire@nexus.local",
    password: "Fire@123",
    department_id: 3
  },
  {
    name: "Police",
    email: "police@nexus.local",
    password: "Police@123",
    department_id: 4
  },
  {
    name: "Electricity",
    email: "electricity@nexus.local",
    password: "Electricity@123",
    department_id: 5
  },
  {
    name: "Health & Medical",
    email: "health@nexus.local",
    password: "Health@123",
    department_id: 6
  },
  {
    name: "Chennai Corporation",
    email: "corporation@nexus.local",
    password: "Corporation@123",
    department_id: 7
  }
];

async function createDepartmentUsers() {
  let connection;

  try {
    connection = await mysql.createConnection({
      host: process.env.DB_HOST,
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME
    });

    console.log("Connected to NEXUS database.\n");

    for (const dept of departments) {
      const [existing] = await connection.execute(
        "SELECT id FROM users WHERE email = ?",
        [dept.email]
      );

      if (existing.length > 0) {
        await connection.execute(
          `UPDATE users
           SET name = ?, role = 'DEPARTMENT',
               department_id = ?, is_active = 1
           WHERE email = ?`,
          [dept.name + " Department", dept.department_id, dept.email]
        );

        console.log(`Updated: ${dept.name}`);
      } else {
        const hashedPassword = await bcrypt.hash(dept.password, 10);

        await connection.execute(
          `INSERT INTO users
           (name, email, password, role, is_active, department_id)
           VALUES (?, ?, ?, 'DEPARTMENT', 1, ?)`,
          [
            dept.name + " Department",
            dept.email,
            hashedPassword,
            dept.department_id
          ]
        );

        console.log(`Created: ${dept.name}`);
      }
    }

    console.log("\n====================================");
    console.log("DEPARTMENT ACCOUNTS READY");
    console.log("====================================\n");

    for (const dept of departments) {
      console.log(`${dept.name}`);
      console.log(`Email:    ${dept.email}`);
      console.log(`Password: ${dept.password}`);
      console.log(`Department ID: ${dept.department_id}`);
      console.log("------------------------------------");
    }

  } catch (error) {
    console.error("\nERROR:", error.message);
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

createDepartmentUsers();