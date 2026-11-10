require("dotenv").config();

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const db = require("./db");
const {
  collectExternalIntelligence,
  saveExternalSignals
} = require("./external-intelligence");
const app = express();
const path = require("path");

app.use(express.static(path.join(__dirname, "..", "frontend")));

const PORT = Number(process.env.PORT || 5000);
const JWT_SECRET =
  process.env.JWT_SECRET || "nexus-development-secret-change-me";

const {
  callGroq,
  isGroqConfigured
} = require("./ai/ai-service");

const {
  GROQ_MODEL
} = require("./ai/ai-config");

app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

/* =========================================================
   DATABASE
========================================================= */

async function query(sql, params = []) {
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

function rowsOf(result) {
  if (Array.isArray(result)) {
    return Array.isArray(result[0]) ? result[0] : result;
  }

  if (Array.isArray(result?.rows)) {
    return result.rows;
  }

  return [];
}

/* =========================================================
   TABLE HELPERS
========================================================= */

const tableColumnCache = new Map();

async function getTableColumns(tableName) {
  if (tableColumnCache.has(tableName)) {
    return tableColumnCache.get(tableName);
  }

  try {
    const result = await query(
      `SHOW COLUMNS FROM \`${tableName}\``
    );

    const columns = rowsOf(result)
      .map((row) => row.Field)
      .filter(Boolean);

    tableColumnCache.set(tableName, columns);

    return columns;
  } catch {
    tableColumnCache.set(tableName, []);
    return [];
  }
}

async function tableExists(tableName) {
  const columns = await getTableColumns(tableName);
  return columns.length > 0;
}

async function insertDynamic(tableName, values) {
  const columns = await getTableColumns(tableName);

  if (!columns.length) {
    return null;
  }

  const selected = Object.entries(values).filter(
    ([column, value]) =>
      columns.includes(column) &&
      value !== undefined
  );

  if (!selected.length) {
    return null;
  }

  const columnNames = selected
    .map(([column]) => `\`${column}\``)
    .join(", ");

  const placeholders = selected
    .map(() => "?")
    .join(", ");

  const params = selected.map(([, value]) => value);

  return query(
    `INSERT INTO \`${tableName}\`
      (${columnNames})
     VALUES
      (${placeholders})`,
    params
  );
}

/* =========================================================
   AUTH
========================================================= */

function signToken(user) {
  return jwt.sign(
    {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      department_id: user.department_id ?? null
    },
    JWT_SECRET,
    {
      expiresIn: "24h"
    }
  );
}

function authenticateToken(req, res, next) {
  const header = req.headers.authorization || "";

  if (!header.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      message: "Authentication required."
    });
  }

  const token = header.slice(7).trim();

  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Invalid or expired authentication token."
    });
  }
}

function requireRoles(...roles) {
  return (req, res, next) => {
    const role = String(
      req.user?.role || ""
    ).toUpperCase();

    if (!roles.includes(role)) {
      return res.status(403).json({
        success: false,
        message:
          "You are not authorized for this operation."
      });
    }

    next();
  };
}

const requireAuthority =
  requireRoles("AUTHORITY");

const requireDepartment =
  requireRoles("DEPARTMENT");

const requireCitizen =
  requireRoles("USER");

/* =========================================================
   HELPERS
========================================================= */

const VALID_SEVERITIES = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL"
];

function normalizeSeverity(value) {
  const severity = String(
    value || "LOW"
  ).toUpperCase();

  return VALID_SEVERITIES.includes(severity)
    ? severity
    : "LOW";
}

function normalizeEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: String(
      user.role || ""
    ).toUpperCase(),
    department_id:
      user.department_id ?? null,
    is_active:
      Number(user.is_active) === 1
  };
}

function statusError(res, message) {
  return res.status(400).json({
    success: false,
    message
  });
}

/* =========================================================
   HISTORY
========================================================= */

async function addIncidentHistory({
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
      `
      INSERT INTO incident_history
        (
          incident_id,
          status,
          changed_by,
          notes
        )
      VALUES
        (?, ?, ?, ?)
      `,
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

async function createNotification({
  userId = null,
  incidentId = null,
  title,
  message,
  type = "INFO",
  severity = "LOW"
}) {
  try {
    if (
      !(await tableExists("notifications"))
    ) {
      return;
    }

    await insertDynamic(
      "notifications",
      {
        user_id: userId,
        recipient_id: userId,
        incident_id: incidentId,
        title,
        message,
        body: message,
        type,
        category: type,
        severity,
        is_read: 0,
        read_status: "UNREAD",
        created_at: new Date()
      }
    );
  } catch (error) {
    console.warn(
      "Notification skipped:",
      error.message
    );
  }
}

async function notifyAuthorityUsers(
  notification
) {
  try {
    const result = await query(`
      SELECT id
      FROM users
      WHERE role = 'AUTHORITY'
        AND is_active = 1
    `);

    for (const user of rowsOf(result)) {
      await createNotification({
        ...notification,
        userId: user.id
      });
    }
  } catch (error) {
    console.warn(
      "Authority notification skipped:",
      error.message
    );
  }
}

/* =========================================================
   ROOT / HEALTH
========================================================= */


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
      ? `CRITICAL escalation: "${title}" at ${location}. Immediate authority attention is required. Reason: ${reason || "Critical severity"}.`
      : `HIGH priority alert: "${title}" at ${location}. Authority attention is recommended. Reason: ${reason || "High severity"}.`;

  try {
    const result =
      await query(
        `
        SELECT id
        FROM users
        WHERE role = 'AUTHORITY'
          AND is_active = 1
        `
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
      `NEXUS escalation triggered: Incident #${incidentId} → ${level}`
    );
  } catch (error) {
    console.error(
      "Escalation notification error:",
      error.message
    );
  }
}

app.get("/", (req, res) => {
  res.json({
    success: true,
    service:
      "NEXUS — Crisis Intelligence",
    status: "ONLINE",
    backend: "Express",
    database: "MySQL",
    ai:
      isGroqConfigured
        ? "CONFIGURED"
        : "NOT_CONFIGURED"
  });
});

app.get("/api/test", (req, res) => {
  res.json({
    success: true,
    message:
      "NEXUS API is working."
  });
});

app.get("/api/health", async (req, res) => {
  try {
    await query(
      "SELECT 1 AS ok"
    );

    res.json({
      success: true,
      api: "ONLINE",
      database: "CONNECTED",
      ai:
        isGroqConfigured
          ? "CONFIGURED"
          : "NOT_CONFIGURED"
    });
  } catch {
    res.status(503).json({
      success: false,
      api: "ONLINE",
      database: "UNAVAILABLE",
      ai:
        isGroqConfigured
          ? "CONFIGURED"
          : "NOT_CONFIGURED"
    });
  }
});

app.get(
  "/api/authority/health",
  requireAuthority,
  async (req, res) => {
    try {
      await query(
        "SELECT 1 AS ok"
      );

      res.json({
        success: true,
        authority: true,
        database: "CONNECTED",
        ai:
          isGroqConfigured
            ? "CONFIGURED"
            : "NOT_CONFIGURED",
        timestamp:
          new Date().toISOString()
      });
    } catch {
      res.status(503).json({
        success: false,
        authority: true,
        database: "UNAVAILABLE"
      });
    }
  }
);

app.get(
  "/api/database/status",
  requireAuthority,
  async (req, res) => {
    try {
      const result = await query(
        "SELECT DATABASE() AS database_name"
      );

      res.json({
        success: true,
        connected: true,
        database:
          rowsOf(result)[0]
            ?.database_name || null
      });
    } catch (error) {
      res.status(503).json({
        success: false,
        connected: false,
        message: error.message
      });
    }
  }
);

/* =========================================================
   REGISTER
========================================================= */

app.post(
  "/api/auth/register",
  async (req, res) => {
    try {
      const name = String(
        req.body?.name || ""
      ).trim();

      const email =
        normalizeEmail(
          req.body?.email
        );

      const password = String(
        req.body?.password || ""
      );

      const confirmPassword =
        String(
          req.body?.confirmPassword ??
          req.body?.confirm_password ??
          ""
        );

      if (
        !name ||
        !email ||
        !password ||
        !confirmPassword
      ) {
        return statusError(
          res,
          "Name, email, password and confirm password are required."
        );
      }

      if (name.length < 2) {
        return statusError(
          res,
          "Please enter a valid name."
        );
      }

      if (!isValidEmail(email)) {
        return statusError(
          res,
          "Please enter a valid email address."
        );
      }

      if (password.length < 8) {
        return statusError(
          res,
          "Password must contain at least 8 characters."
        );
      }

      if (
        password !== confirmPassword
      ) {
        return statusError(
          res,
          "Passwords do not match."
        );
      }

      const existingResult =
        await query(
          `
          SELECT id
          FROM users
          WHERE LOWER(email) = ?
          LIMIT 1
          `,
          [email]
        );

      if (
        rowsOf(existingResult).length
      ) {
        return res.status(409).json({
          success: false,
          message:
            "An account with this email already exists."
        });
      }

      const passwordHash =
        await bcrypt.hash(
          password,
          12
        );

      const result = await query(
        `
        INSERT INTO users
          (
            name,
            email,
            password,
            role,
            is_active,
            department_id
          )
        VALUES
          (
            ?,
            ?,
            ?,
            'USER',
            1,
            NULL
          )
        `,
        [
          name,
          email,
          passwordHash
        ]
      );

      res.status(201).json({
        success: true,
        message:
          "Registration successful. Please log in.",
        userId:
          result.insertId
      });
    } catch (error) {
      console.error(
        "Registration error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Registration failed."
      });
    }
  }
);

/* =========================================================
   LOGIN
========================================================= */

app.post(
  "/api/auth/login",
  async (req, res) => {
    try {
      const email =
        normalizeEmail(
          req.body?.email
        );

      const password = String(
        req.body?.password || ""
      );

      if (!email || !password) {
        return statusError(
          res,
          "Email and password are required."
        );
      }

      const result = await query(
        `
        SELECT
          id,
          name,
          email,
          password,
          role,
          is_active,
          department_id
        FROM users
        WHERE LOWER(email) = ?
        LIMIT 1
        `,
        [email]
      );

      const user =
        rowsOf(result)[0];

      if (!user) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid email or password."
        });
      }

      if (
        Number(user.is_active) !== 1
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This account is inactive."
        });
      }

      let passwordMatches = false;
      let shouldUpgradePassword =
        false;

      const storedPassword =
        String(
          user.password || ""
        );

      if (
        storedPassword.startsWith("$2a$") ||
        storedPassword.startsWith("$2b$") ||
        storedPassword.startsWith("$2y$")
      ) {
        passwordMatches =
          await bcrypt.compare(
            password,
            storedPassword
          );
      } else {
        passwordMatches =
          password ===
          storedPassword;

        shouldUpgradePassword =
          passwordMatches;
      }

      if (!passwordMatches) {
        return res.status(401).json({
          success: false,
          message:
            "Invalid email or password."
        });
      }

      if (
        shouldUpgradePassword
      ) {
        const newHash =
          await bcrypt.hash(
            password,
            12
          );

        await query(
          `
          UPDATE users
          SET password = ?
          WHERE id = ?
          `,
          [
            newHash,
            user.id
          ]
        );
      }

      const role = String(
        user.role || ""
      ).toUpperCase();

      if (
        ![
          "USER",
          "AUTHORITY",
          "DEPARTMENT"
        ].includes(role)
      ) {
        return res.status(403).json({
          success: false,
          message:
            "This account has an unsupported role."
        });
      }

      if (
        role === "DEPARTMENT" &&
        (
          user.department_id ===
            null ||
          user.department_id ===
            undefined
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Department account is missing department assignment."
        });
      }

      const cleanUser =
        publicUser({
          ...user,
          role
        });

      const token =
        signToken(
          cleanUser
        );

      res.json({
        success: true,
        message:
          "Login successful.",
        token,
        accessToken: token,
        user: cleanUser
      });
    } catch (error) {
      console.error(
        "Login error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Login failed."
      });
    }
  }
);

/* =========================================================
   ME
========================================================= */

app.get(
  "/api/auth/me",
  authenticateToken,
  async (req, res) => {
    try {
      const result =
        await query(
          `
          SELECT
            id,
            name,
            email,
            role,
            is_active,
            department_id
          FROM users
          WHERE id = ?
          LIMIT 1
          `,
          [req.user.id]
        );

      const user =
        rowsOf(result)[0];

      if (
        !user ||
        Number(user.is_active) !== 1
      ) {
        return res.status(401).json({
          success: false,
          message:
            "User account is unavailable."
        });
      }

      res.json({
        success: true,
        user:
          publicUser(user)
      });
    } catch (error) {
      console.error(
        "Auth/me error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load account information."
      });
    }
  }
);

/* =========================================================
   CREATE INCIDENT
========================================================= */

app.post(
  "/api/incidents",
  authenticateToken,
  requireCitizen,
  async (req, res) => {
    try {
      const title =
        String(
          req.body?.title || ""
        ).trim();

      const description =
        String(
          req.body?.description || ""
        ).trim();

      const location =
        String(
          req.body?.location || ""
        ).trim();

      const severity =
        normalizeSeverity(
          req.body?.severity
        );

      if (!title || !location) {
        return statusError(
          res,
          "Title and location are required."
        );
      }

      const result =
        await query(
          `
          INSERT INTO incidents
            (
              user_id,
              title,
              description,
              location,
              severity,
              status,
              department_id
            )
          VALUES
            (
              ?,
              ?,
              ?,
              ?,
              ?,
              'REPORTED',
              NULL
            )
          `,
          [
            req.user.id,
            title,
            description,
            location,
            severity
          ]
        );

      let incidentId =
        result?.insertId ?? null;

      /*
        Fallback for MySQL result-format differences.
        Read the newest incident created by this user.
      */
      if (!incidentId) {
        const latestIncident =
          await query(
            `
            SELECT id
            FROM incidents
            WHERE user_id = ?
            ORDER BY id DESC
            LIMIT 1
            `,
            [req.user.id]
          );

        incidentId =
          rowsOf(latestIncident)[0]?.id ?? null;
      }

      if (!incidentId) {
        throw new Error(
          "Incident was created but its ID could not be determined."
        );
      }

      await addIncidentHistory({
        incidentId,
        actorId:
          req.user.id,
        action:
          "INCIDENT_REPORTED",
        toStatus:
          "REPORTED",
        details: {
          source:
            "CITIZEN"
        }
      });

      await notifyAuthorityUsers({
        incidentId,
        title:
          `New ${severity} Incident`,
        message:
          `${title} reported at ${location}.`,
        type:
          severity === "CRITICAL"
            ? "CRITICAL"
            : "INCIDENT",
        severity
      });
await createEscalationNotifications({
  incidentId,
  title:
    `EMERGENCY: ${title}`,
  location,
  severity:
    severity === "LOW" ||
    severity === "MEDIUM"
      ? "CRITICAL"
      : severity,
  reason:
    "Emergency Mode report"
});
      await createEscalationNotifications({
        incidentId,
        title,
        location,
        severity,
        reason:
          severity === "CRITICAL"
            ? "Critical citizen incident"
            : "High-severity citizen incident"
      });

      res.status(201).json({
        success: true,
        message:
          "Incident submitted successfully.",
        incidentId,
        id: incidentId,
        incident: {
          id: incidentId,
          user_id:
            req.user.id,
          title,
          description,
          location,
          severity,
          status:
            "REPORTED",
          department_id:
            null
        }
      });
    } catch (error) {
      console.error(
        "Incident creation error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to submit incident."
      });
    }
  }
);

/* =========================================================
   USER INCIDENTS
========================================================= */

app.get(
  "/api/incidents/user/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const requestedUserId =
        Number(
          req.params.userId
        );

      const role =
        String(
          req.user.role || ""
        ).toUpperCase();

      if (
        !Number.isInteger(
          requestedUserId
        )
      ) {
        return statusError(
          res,
          "Invalid user ID."
        );
      }

      if (
        role !== "AUTHORITY" &&
        Number(req.user.id) !==
          requestedUserId
      ) {
        return res.status(403).json({
          success: false,
          message:
            "You cannot access these incidents."
        });
      }

      const result =
        await query(
          `
          SELECT *
          FROM incidents
          WHERE user_id = ?
          ORDER BY created_at DESC
          `,
          [requestedUserId]
        );

      res.json({
        success: true,
        incidents:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "User incidents error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load incidents."
      });
    }
  }
);

/* =========================================================
   AUTHORITY INCIDENTS
========================================================= */

app.get(
  "/api/incidents",
  authenticateToken,
  requireAuthority,
  async (req, res) => {
    try {
      const result =
        await query(
          `
          SELECT
            i.*,
            u.name AS reporter_name,
            u.email AS reporter_email,
            d.name AS department_name
          FROM incidents i
          LEFT JOIN users u
            ON u.id = i.user_id
          LEFT JOIN departments d
            ON d.id = i.department_id
          ORDER BY
            CASE i.severity
              WHEN 'CRITICAL' THEN 1
              WHEN 'HIGH' THEN 2
              WHEN 'MEDIUM' THEN 3
              ELSE 4
            END,
            i.created_at DESC
          `
        );

      res.json({
        success: true,
        incidents:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "Authority incident error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load incidents."
      });
    }
  }
);

/* =========================================================
   AUTHORITY VERIFY / REJECT
========================================================= */

app.patch(
  "/api/incidents/:id/status",
  authenticateToken,
  requireAuthority,
  async (req, res) => {
    try {
      const incidentId =
        Number(
          req.params.id
        );

      const nextStatus =
        String(
          req.body?.status || ""
        ).toUpperCase();

      if (
        !Number.isInteger(
          incidentId
        )
      ) {
        return statusError(
          res,
          "Invalid incident ID."
        );
      }

      if (
        ![
          "VERIFIED",
          "REJECTED"
        ].includes(nextStatus)
      ) {
        return statusError(
          res,
          "Authority can only set VERIFIED or REJECTED."
        );
      }

      const result =
        await query(
          `
          SELECT *
          FROM incidents
          WHERE id = ?
          LIMIT 1
          `,
          [incidentId]
        );

      const incident =
        rowsOf(result)[0];

      if (!incident) {
        return res.status(404).json({
          success: false,
          message:
            "Incident not found."
        });
      }

      if (
        incident.status !==
        "REPORTED"
      ) {
        return statusError(
          res,
          "Only REPORTED incidents can be verified or rejected."
        );
      }

      await query(
        `
        UPDATE incidents
        SET status = ?
        WHERE id = ?
        `,
        [
          nextStatus,
          incidentId
        ]
      );

      await addIncidentHistory({
        incidentId,
        actorId:
          req.user.id,
        action:
          nextStatus ===
          "VERIFIED"
            ? "INCIDENT_VERIFIED"
            : "INCIDENT_REJECTED",
        fromStatus:
          "REPORTED",
        toStatus:
          nextStatus
      });

      if (incident.user_id) {
        await createNotification({
          userId:
            incident.user_id,
          incidentId,
          title:
            nextStatus ===
            "VERIFIED"
              ? "Incident Verified"
              : "Incident Rejected",
          message:
            nextStatus ===
            "VERIFIED"
              ? `Your incident "${incident.title}" has been verified by NEXUS authority.`
              : `Your incident "${incident.title}" was rejected by NEXUS authority.`,
          type:
            nextStatus ===
            "VERIFIED"
              ? "VERIFIED"
              : "REJECTED",
          severity:
            incident.severity
        });
      }

      res.json({
        success: true,
        message:
          `Incident marked ${nextStatus}.`,
        status:
          nextStatus
      });
    } catch (error) {
      console.error(
        "Authority status error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to update incident status."
      });
    }
  }
);

/* =========================================================
   AUTHORITY ASSIGN
========================================================= */

app.patch(
  "/api/incidents/:id/department",
  authenticateToken,
  requireAuthority,
  async (req, res) => {
    try {
      const incidentId =
        Number(
          req.params.id
        );

      const departmentId =
        Number(
          req.body?.department_id ??
          req.body?.departmentId
        );

      if (
        !Number.isInteger(
          incidentId
        )
      ) {
        return statusError(
          res,
          "Invalid incident ID."
        );
      }

      if (
        !Number.isInteger(
          departmentId
        )
      ) {
        return statusError(
          res,
          "Invalid department ID."
        );
      }

      const departmentResult =
        await query(
          `
          SELECT id, name
          FROM departments
          WHERE id = ?
          LIMIT 1
          `,
          [departmentId]
        );

      const department =
        rowsOf(
          departmentResult
        )[0];

      if (!department) {
        return res.status(404).json({
          success: false,
          message:
            "Department not found."
        });
      }

      const incidentResult =
        await query(
          `
          SELECT *
          FROM incidents
          WHERE id = ?
          LIMIT 1
          `,
          [incidentId]
        );

      const incident =
        rowsOf(
          incidentResult
        )[0];

      if (!incident) {
        return res.status(404).json({
          success: false,
          message:
            "Incident not found."
        });
      }

      if (
        incident.status !==
        "VERIFIED"
      ) {
        return statusError(
          res,
          "Only VERIFIED incidents can be assigned."
        );
      }

      await query(
        `
        UPDATE incidents
        SET
          department_id = ?,
          status = 'ASSIGNED'
        WHERE id = ?
        `,
        [
          departmentId,
          incidentId
        ]
      );

      await addIncidentHistory({
        incidentId,
        actorId:
          req.user.id,
        action:
          "DEPARTMENT_ASSIGNED",
        fromStatus:
          "VERIFIED",
        toStatus:
          "ASSIGNED",
        details: {
          department_id:
            departmentId,
          department_name:
            department.name
        }
      });

      if (incident.user_id) {
        await createNotification({
          userId:
            incident.user_id,
          incidentId,
          title:
            "Department Assigned",
          message:
            `Your incident "${incident.title}" has been assigned to ${department.name}.`,
          type:
            "ASSIGNED",
          severity:
            incident.severity
        });
      }

      try {
        const usersResult =
          await query(
            `
            SELECT id
            FROM users
            WHERE role = 'DEPARTMENT'
              AND department_id = ?
              AND is_active = 1
            `,
            [departmentId]
          );

        for (
          const user
          of rowsOf(usersResult)
        ) {
          await createNotification({
            userId:
              user.id,
            incidentId,
            title:
              "New Incident Assigned",
            message:
              `"${incident.title}" has been assigned to ${department.name}.`,
            type:
              "ASSIGNED",
            severity:
              incident.severity
          });
        }
      } catch (error) {
        console.warn(
          "Department notification skipped:",
          error.message
        );
      }

      res.json({
        success: true,
        message:
          `Incident assigned to ${department.name}.`,
        status:
          "ASSIGNED",
        department: {
          id:
            department.id,
          name:
            department.name
        }
      });
    } catch (error) {
      console.error(
        "Department assignment error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to assign department."
      });
    }
  }
);

/* =========================================================
   DEPARTMENT INCIDENTS
========================================================= */

app.get(
  "/api/department/incidents",
  authenticateToken,
  requireDepartment,
  async (req, res) => {
    try {
      const departmentId =
        Number(
          req.user.department_id
        );

      if (
        !Number.isInteger(
          departmentId
        )
      ) {
        return res.status(403).json({
          success: false,
          message:
            "Department assignment is missing."
        });
      }

      const result =
        await query(
          `
          SELECT
            i.*,
            u.name AS reporter_name,
            u.email AS reporter_email,
            d.name AS department_name
          FROM incidents i
          LEFT JOIN users u
            ON u.id = i.user_id
          LEFT JOIN departments d
            ON d.id = i.department_id
          WHERE i.department_id = ?
          ORDER BY
            CASE i.severity
              WHEN 'CRITICAL' THEN 1
              WHEN 'HIGH' THEN 2
              WHEN 'MEDIUM' THEN 3
              ELSE 4
            END,
            i.created_at DESC
          `,
          [departmentId]
        );

      res.json({
        success: true,
        department_id:
          departmentId,
        incidents:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "Department incidents error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load department incidents."
      });
    }
  }
);

/* =========================================================
   DEPARTMENT WORKFLOW
========================================================= */

const DEPARTMENT_TRANSITIONS =
  {
    ASSIGNED: "ACCEPTED",
    ACCEPTED: "IN_PROGRESS",
    IN_PROGRESS: "COMPLETED",
    COMPLETED: "RESOLVED"
  };

app.patch(
  "/api/department/incidents/:id/status",
  authenticateToken,
  requireDepartment,
  async (req, res) => {
    try {
      const incidentId =
        Number(
          req.params.id
        );

      const requestedStatus =
        String(
          req.body?.status || ""
        ).toUpperCase();

      const departmentId =
        Number(
          req.user.department_id
        );

      if (
        !Number.isInteger(
          incidentId
        )
      ) {
        return statusError(
          res,
          "Invalid incident ID."
        );
      }

      if (
        ![
          "ACCEPTED",
          "IN_PROGRESS",
          "COMPLETED",
          "RESOLVED"
        ].includes(
          requestedStatus
        )
      ) {
        return statusError(
          res,
          "Invalid department status."
        );
      }

      const result =
        await query(
          `
          SELECT *
          FROM incidents
          WHERE id = ?
            AND department_id = ?
          LIMIT 1
          `,
          [
            incidentId,
            departmentId
          ]
        );

      const incident =
        rowsOf(result)[0];

      if (!incident) {
        return res.status(404).json({
          success: false,
          message:
            "Incident not found in your department."
        });
      }

      const expectedNext =
        DEPARTMENT_TRANSITIONS[
          incident.status
        ];

      if (
        expectedNext !==
        requestedStatus
      ) {
        return statusError(
          res,
          `Invalid transition. Current status is ${incident.status}; next allowed status is ${expectedNext || "none"}.`
        );
      }

      await query(
        `
        UPDATE incidents
        SET status = ?
        WHERE id = ?
          AND department_id = ?
        `,
        [
          requestedStatus,
          incidentId,
          departmentId
        ]
      );

      await addIncidentHistory({
        incidentId,
        actorId:
          req.user.id,
        action:
          "DEPARTMENT_STATUS_UPDATED",
        fromStatus:
          incident.status,
        toStatus:
          requestedStatus,
        details: {
          department_id:
            departmentId
        }
      });

      if (incident.user_id) {
        await createNotification({
          userId:
            incident.user_id,
          incidentId,
          title:
            `Incident ${requestedStatus.replace("_", " ")}`,
          message:
            `Your incident "${incident.title}" is now ${requestedStatus.replace("_", " ").toLowerCase()}.`,
          type:
            "STATUS_UPDATE",
          severity:
            incident.severity
        });
      }

      res.json({
        success: true,
        message:
          `Incident status updated to ${requestedStatus}.`,
        status:
          requestedStatus
      });
    } catch (error) {
      console.error(
        "Department status error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to update department status."
      });
    }
  }
);

/* =========================================================
   HISTORY
========================================================= */

app.get(
  "/api/incidents/:id/history",
  authenticateToken,
  async (req, res) => {
    try {
      const incidentId =
        Number(
          req.params.id
        );

      const role =
        String(
          req.user.role || ""
        ).toUpperCase();

      if (
        !Number.isInteger(
          incidentId
        )
      ) {
        return statusError(
          res,
          "Invalid incident ID."
        );
      }

      const incidentResult =
        await query(
          `
          SELECT
            id,
            user_id,
            department_id
          FROM incidents
          WHERE id = ?
          LIMIT 1
          `,
          [incidentId]
        );

      const incident =
        rowsOf(
          incidentResult
        )[0];

      if (!incident) {
        return res.status(404).json({
          success: false,
          message:
            "Incident not found."
        });
      }

      const authorized =
        role === "AUTHORITY" ||
        (
          role === "USER" &&
          Number(req.user.id) ===
            Number(incident.user_id)
        ) ||
        (
          role === "DEPARTMENT" &&
          Number(
            req.user.department_id
          ) ===
            Number(
              incident.department_id
            )
        );

      if (!authorized) {
        return res.status(403).json({
          success: false,
          message:
            "You are not authorized to view this incident history."
        });
      }

      if (
        !(await tableExists(
          "incident_history"
        ))
      ) {
        return res.json({
          success: true,
          history: []
        });
      }

      const columns =
        await getTableColumns(
          "incident_history"
        );

      const actorColumn =
        [
          "actor_user_id",
          "actor_id",
          "user_id"
        ].find(
          (column) =>
            columns.includes(
              column
            )
        );

      let sql = `
        SELECT *
        FROM incident_history
        WHERE incident_id = ?
        ORDER BY created_at ASC
      `;

      if (actorColumn) {
        sql = `
          SELECT
            h.*,
            u.name AS actor_name,
            u.email AS actor_email,
            u.role AS actor_role
          FROM incident_history h
          LEFT JOIN users u
            ON u.id = h.${actorColumn}
          WHERE h.incident_id = ?
          ORDER BY h.created_at ASC
        `;
      }

      const result =
        await query(
          sql,
          [incidentId]
        );

      res.json({
        success: true,
        history:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "History error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load incident history."
      });
    }
  }
);

/* =========================================================
   EVIDENCE
========================================================= */

app.get(
  "/api/incidents/:id/evidence",
  authenticateToken,
  async (req, res) => {
    try {
      const incidentId =
        Number(
          req.params.id
        );

      const role =
        String(
          req.user.role || ""
        ).toUpperCase();

      const incidentResult =
        await query(
          `
          SELECT
            user_id,
            department_id
          FROM incidents
          WHERE id = ?
          LIMIT 1
          `,
          [incidentId]
        );

      const incident =
        rowsOf(
          incidentResult
        )[0];

      if (!incident) {
        return res.status(404).json({
          success: false,
          message:
            "Incident not found."
        });
      }

      const authorized =
        role === "AUTHORITY" ||
        (
          role === "USER" &&
          Number(req.user.id) ===
            Number(incident.user_id)
        ) ||
        (
          role === "DEPARTMENT" &&
          Number(
            req.user.department_id
          ) ===
            Number(
              incident.department_id
            )
        );

      if (!authorized) {
        return res.status(403).json({
          success: false,
          message:
            "Evidence access denied."
        });
      }

      if (
        !(await tableExists(
          "incident_evidence"
        ))
      ) {
        return res.json({
          success: true,
          evidence: []
        });
      }

      const result =
        await query(
          `
          SELECT *
          FROM incident_evidence
          WHERE incident_id = ?
          ORDER BY created_at ASC
          `,
          [incidentId]
        );

      res.json({
        success: true,
        evidence:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "Evidence error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load incident evidence."
      });
    }
  }
);

/* =========================================================
   NOTIFICATIONS
========================================================= */

app.get(
  "/api/notifications",
  authenticateToken,
  async (req, res) => {
    try {
      if (
        !(await tableExists(
          "notifications"
        ))
      ) {
        return res.json({
          success: true,
          notifications: []
        });
      }

      const columns =
        await getTableColumns(
          "notifications"
        );

      const recipientColumn =
        [
          "user_id",
          "recipient_id"
        ].find(
          (column) =>
            columns.includes(
              column
            )
        );

      if (!recipientColumn) {
        return res.json({
          success: true,
          notifications: []
        });
      }

      const result =
        await query(
          `
          SELECT *
          FROM notifications
          WHERE ${recipientColumn} = ?
          ORDER BY created_at DESC
          LIMIT 100
          `,
          [req.user.id]
        );

      res.json({
        success: true,
        notifications:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "Notifications error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load notifications."
      });
    }
  }
);

app.patch(
  "/api/notifications/:id/read",
  authenticateToken,
  async (req, res) => {
    try {
      const notificationId =
        Number(
          req.params.id
        );

      if (
        !(await tableExists(
          "notifications"
        ))
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Notifications table is unavailable."
        });
      }

      const columns =
        await getTableColumns(
          "notifications"
        );

      const recipientColumn =
        [
          "user_id",
          "recipient_id"
        ].find(
          (column) =>
            columns.includes(
              column
            )
        );

      const readColumn =
        [
          "is_read",
          "read_status"
        ].find(
          (column) =>
            columns.includes(
              column
            )
        );

      if (
        !recipientColumn ||
        !readColumn
      ) {
        return res.status(404).json({
          success: false,
          message:
            "Notification fields are unavailable."
        });
      }

      if (
        readColumn ===
        "is_read"
      ) {
        await query(
          `
          UPDATE notifications
          SET is_read = 1
          WHERE id = ?
            AND ${recipientColumn} = ?
          `,
          [
            notificationId,
            req.user.id
          ]
        );
      } else {
        await query(
          `
          UPDATE notifications
          SET read_status = 'READ'
          WHERE id = ?
            AND ${recipientColumn} = ?
          `,
          [
            notificationId,
            req.user.id
          ]
        );
      }

      res.json({
        success: true,
        message:
          "Notification marked as read."
      });
    } catch (error) {
      console.error(
        "Notification read error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to update notification."
      });
    }
  }
);

/* =========================================================
   HAZARDS
========================================================= */


/* =========================================================
   NEXUS LIVE WEATHER — OPEN-METEO
========================================================= */

app.get(
  "/api/weather",
  async (req, res) => {
    try {
      const latitude = Number(
        req.query.latitude ?? 13.0827
      );

      const longitude = Number(
        req.query.longitude ?? 80.2707
      );

      if (
        !Number.isFinite(latitude) ||
        !Number.isFinite(longitude)
      ) {
        return res.status(400).json({
          success: false,
          message:
            "Valid latitude and longitude are required."
        });
      }

      /*
        NEXUS is currently restricted to
        Tamil Nadu geographic bounds.
      */
      if (
        latitude < 8.0 ||
        latitude > 13.6 ||
        longitude < 76.0 ||
        longitude > 80.5
      ) {
        return res.status(400).json({
          success: false,
          message:
            "NEXUS weather service currently supports Tamil Nadu locations only."
        });
      }

      const url =
        "https://api.open-meteo.com/v1/forecast" +
        "?latitude=" +
        encodeURIComponent(latitude) +
        "&longitude=" +
        encodeURIComponent(longitude) +
        "&current=" +
        encodeURIComponent(
          "temperature_2m,relative_humidity_2m,precipitation,rain,wind_speed_10m,weather_code"
        ) +
        "&timezone=Asia%2FKolkata";

      const response =
        await fetch(url);

      const raw =
        await response.text();

      let data;

      try {
        data =
          JSON.parse(raw);
      } catch {
        throw new Error(
          "Open-Meteo returned invalid JSON."
        );
      }

      if (!response.ok) {
        throw new Error(
          data?.reason ||
          "Open-Meteo request failed."
        );
      }

      res.json({
        success: true,
        available: true,
        source: "Open-Meteo",
        location: {
          latitude,
          longitude
        },
        current:
          data.current || null,
        units:
          data.current_units || null,
        fetched_at:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        "Weather API error:",
        error.message
      );

      res.status(503).json({
        success: false,
        available: false,
        source: "Open-Meteo",
        message:
          "Live weather data is temporarily unavailable."
      });
    }
  }
);

app.get(
  "/api/hazards",
  async (req, res) => {
    try {
      if (
        !(await tableExists(
          "hazard_events"
        ))
      ) {
        return res.json({
          success: true,
          connected: true,
          source:
            "NEXUS database",
          hazards: []
        });
      }

      const result =
        await query(
          `
          SELECT *
          FROM hazard_events
          ORDER BY
            CASE
              WHEN UPPER(
                COALESCE(
                  severity,
                  'LOW'
                )
              ) = 'CRITICAL'
                THEN 1
              WHEN UPPER(
                COALESCE(
                  severity,
                  'LOW'
                )
              ) = 'HIGH'
                THEN 2
              WHEN UPPER(
                COALESCE(
                  severity,
                  'LOW'
                )
              ) = 'MEDIUM'
                THEN 3
              ELSE 4
            END
          LIMIT 500
          `
        );

      res.json({
        success: true,
        connected: true,
        source:
          "NEXUS database",
        hazards:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "Hazards error:",
        error
      );

      res.status(500).json({
        success: false,
        hazards: []
      });
    }
  }
);

/* =========================================================
   TRAFFIC
========================================================= */

app.get(
  "/api/traffic",
  async (req, res) => {
    try {
      if (
        !(await tableExists(
          "traffic_events"
        ))
      ) {
        return res.json({
          success: true,
          connected: true,
          source:
            "NEXUS database",
          traffic: []
        });
      }

      const result =
        await query(
          `
          SELECT *
          FROM traffic_events
          ORDER BY observed_at DESC
          LIMIT 500
          `
        );

      res.json({
        success: true,
        connected: true,
        source:
          "NEXUS database",
        traffic:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "Traffic error:",
        error
      );

      res.status(500).json({
        success: false,
        traffic: []
      });
    }
  }
);

/* =========================================================
   COMMUNITY SIGNALS
========================================================= */

async function getCommunitySignals(
  req,
  res
) {
  try {
    if (
      !(await tableExists(
        "community_signals"
      ))
    ) {
      return res.json({
        success: true,
        connected: true,
        source:
          "NEXUS database",
        signals: []
      });
    }

    const result =
      await query(
        `
        SELECT *
        FROM community_signals
        ORDER BY created_at DESC
        LIMIT 500
        `
      );

    res.json({
      success: true,
      connected: true,
      source:
        "NEXUS database",
      signals:
        rowsOf(result)
    });
  } catch (error) {
    console.error(
      "Community signals error:",
      error
    );

    res.status(500).json({
      success: false,
      signals: []
    });
  }
}

app.get(
  "/api/community/signals",
  getCommunitySignals
);

app.get(
  "/api/signals",
  getCommunitySignals
);
/* =========================================================
   EXTERNAL INTELLIGENCE
========================================================= */

let externalCollectionRunning = false;

async function runExternalIntelligenceCollection() {
  if (externalCollectionRunning) {
    console.log(
      "[NEXUS Intelligence] Collection already running. Skipping."
    );

    return {
      success: false,
      skipped: true,
      reason: "Collection already running."
    };
  }

  externalCollectionRunning = true;

  try {
    console.log("");
    console.log(
      "----------------------------------------------"
    );
    console.log(
      "[NEXUS Intelligence] External collection started"
    );
    console.log(
      "----------------------------------------------"
    );

    const signals =
      await collectExternalIntelligence();

    const result =
      await saveExternalSignals(
        db,
        signals
      );

    console.log(
      `[NEXUS Intelligence] Collected: ${signals.length}`
    );

    console.log(
      `[NEXUS Intelligence] Inserted: ${result.inserted}`
    );

    console.log(
      `[NEXUS Intelligence] Skipped: ${result.skipped}`
    );

    console.log(
      "[NEXUS Intelligence] External signals remain UNVERIFIED."
    );

    console.log(
      "----------------------------------------------"
    );

    return {
      success: true,
      collected: signals.length,
      inserted: result.inserted,
      skipped: result.skipped,
      timestamp:
        new Date().toISOString()
    };
  } catch (error) {
    console.error(
      "[NEXUS Intelligence] Collection failed:",
      error.message
    );

    return {
      success: false,
      collected: 0,
      inserted: 0,
      skipped: 0,
      error: error.message,
      timestamp:
        new Date().toISOString()
    };
  } finally {
    externalCollectionRunning = false;
  }
}


/*
   Manual collection endpoint.

   Only AUTHORITY accounts can manually
   trigger external intelligence collection.
*/
app.post(
  "/api/intelligence/collect",
  authenticateToken,
  requireAuthority,
  async (req, res) => {
    try {
      const result =
        await runExternalIntelligenceCollection();

      if (!result.success) {
        return res.status(503).json({
          success: false,
          message:
            result.reason ||
            result.error ||
            "External intelligence collection failed.",
          ...result
        });
      }

      res.json({
        success: true,
        message:
          "External intelligence collection completed.",
        collected:
          result.collected,
        inserted:
          result.inserted,
        skipped:
          result.skipped,
        verification:
          "UNVERIFIED — authority review required",
        timestamp:
          result.timestamp
      });
    } catch (error) {
      console.error(
        "External intelligence endpoint error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to collect external intelligence."
      });
    }
  }
);


/*
   Intelligence status endpoint.

   Useful for the Authority Console and
   backend monitoring.
*/
app.get(
  "/api/intelligence/status",
  authenticateToken,
  requireAuthority,
  async (req, res) => {
    try {
      const exists =
        await tableExists(
          "community_signals"
        );

      let count = 0;

      if (exists) {
        const result =
          await query(
            `
            SELECT COUNT(*) AS total
            FROM community_signals
            `
          );

        count =
          Number(
            rowsOf(result)[0]?.total || 0
          );
      }

      res.json({
        success: true,
        collector:
          externalCollectionRunning
            ? "RUNNING"
            : "IDLE",
        database:
          exists
            ? "AVAILABLE"
            : "UNAVAILABLE",
        total_signals:
          count,
        verification:
          "External signals are UNVERIFIED until authority review.",
        timestamp:
          new Date().toISOString()
      });
    } catch (error) {
      console.error(
        "Intelligence status error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to load intelligence status."
      });
    }
  }
);


/*
   Automatic collection.

   First run: shortly after server startup.
   Repeats every 15 minutes.

   External information is never automatically
   converted into a verified incident.
*/
setTimeout(
  async () => {
    await runExternalIntelligenceCollection();
  },
  15000
);

setInterval(
  async () => {
    await runExternalIntelligenceCollection();
  },
  15 * 60 * 1000
);
/* =========================================================
   DISRUPTIONS
========================================================= */

app.get(
  "/api/disruptions",
  async (req, res) => {
    try {
      if (
        !(await tableExists(
          "route_disruptions"
        ))
      ) {
        return res.json({
          success: true,
          connected: true,
          source:
            "NEXUS database",
          disruptions: []
        });
      }

      const result =
        await query(
          `
          SELECT *
          FROM route_disruptions
          ORDER BY created_at DESC
          LIMIT 500
          `
        );

      res.json({
        success: true,
        connected: true,
        source:
          "NEXUS database",
        disruptions:
          rowsOf(result)
      });
    } catch (error) {
      console.error(
        "Disruptions error:",
        error
      );

      res.status(500).json({
        success: false,
        disruptions: []
      });
    }
  }
);

/* =========================================================
   EMERGENCY REPORT
========================================================= */

app.post(
  "/api/emergency-reports",
  authenticateToken,
  requireCitizen,
  async (req, res) => {
    try {
      const title =
        String(
          req.body?.title ||
            "Emergency Report"
        ).trim();

      const description =
        String(
          req.body?.description ||
            ""
        ).trim();

      const location =
        String(
          req.body?.location ||
            ""
        ).trim();

      const severity =
        normalizeSeverity(
          req.body?.severity ||
            "CRITICAL"
        );

      if (!location) {
        return statusError(
          res,
          "Emergency location is required."
        );
      }

      const incidentResult =
        await query(
          `
          INSERT INTO incidents
            (
              user_id,
              title,
              description,
              location,
              severity,
              status,
              department_id
            )
          VALUES
            (
              ?,
              ?,
              ?,
              ?,
              ?,
              'REPORTED',
              NULL
            )
          `,
          [
            req.user.id,
            title,
            description,
            location,
            severity
          ]
        );

      const incidentId =
        incidentResult.insertId;

      if (
        await tableExists(
          "emergency_reports"
        )
      ) {
        await insertDynamic(
          "emergency_reports",
          {
            incident_id:
              incidentId,
            user_id:
              req.user.id,
            title,
            description,
            location,
            severity,
            status:
              "REPORTED",
            priority:
              "HIGH",
            created_at:
              new Date()
          }
        );
      }

      await addIncidentHistory({
        incidentId,
        actorId:
          req.user.id,
        action:
          "EMERGENCY_REPORT_CREATED",
        toStatus:
          "REPORTED",
        details: {
          priority:
            "HIGH",
          source:
            "EMERGENCY_MODE"
        }
      });

      await notifyAuthorityUsers({
        incidentId,
        title:
          `EMERGENCY: ${title}`,
        message:
          `Critical emergency report received at ${location}.`,
        type:
          "EMERGENCY",
        severity
      });

      res.status(201).json({
        success: true,
        message:
          "Emergency report submitted to NEXUS.",
        incidentId,
        status:
          "REPORTED",
        priority:
          "HIGH"
      });
    } catch (error) {
      console.error(
        "Emergency report error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to submit emergency report."
      });
    }
  }
);

/* =========================================================
   NEXUS AI — OLLAMA LOCAL MODEL
========================================================= */

function buildAISystemPrompt({
  mode = "crisis",
  location = "Tamil Nadu",
  context = {}
}) {
  return `
You are NEXUS AI, the intelligence assistant inside
NEXUS — Crisis Intelligence for Tamil Nadu.

Your job:
- Help citizens understand NEXUS information.
- Explain hazards, disruptions, reports and risk.
- Give calm, practical and safety-focused guidance.
- Never invent a live event, road closure, traffic condition,
  weather condition, authority action or emergency response.
- Clearly distinguish confirmed information from uncertainty.
- Use the supplied NEXUS context for current information.
- Never claim that you contacted police, fire, ambulance,
  government officers or another authority.
- Never claim live traffic unless live traffic data is supplied.
- Never fabricate coordinates or incident records.

Operating area:
${location}

Current mode:
${mode}

NEXUS context:
${JSON.stringify(context, null, 2)}

Response rules:
- Be concise but useful.
- Use plain language.
- For emergencies, prioritize immediate safe actions.
- When information is unavailable, say so directly.
- Never present guesses as confirmed facts.
`;
}


app.post(
  "/api/ai/chat",
  async (req, res) => {
    try {
      const message =
        String(
          req.body?.message || ""
        ).trim();

      const mode =
        String(
          req.body?.mode ||
          "crisis"
        );

      const location =
        String(
          req.body?.location ||
          "Tamil Nadu"
        );

      const context =
        req.body?.context || {};

      if (!message) {
        return statusError(
          res,
          "AI message is required."
        );
      }

      const systemPrompt =
        buildAISystemPrompt({
          mode,
          location,
          context
        });

      const ai =
        await callGroq({
          messages: [
            {
              role: "system",
              content:
                systemPrompt
            },
            {
              role: "user",
              content:
                message
            }
          ]
        });

      res.json({
        success: true,
        available: true,
        reply: ai.reply,
        model: ai.model,
        provider: ai.provider
      });
    } catch (error) {
      console.error(
        "NEXUS AI error:",
        error.message
      );

      res.status(503).json({
        success: false,
        available: false,
        message:
          "NEXUS AI is temporarily unavailable.",
        error:
          process.env.NODE_ENV ===
          "development"
            ? error.message
            : undefined
      });
    }
  }
);

/* =========================================================
   NEXUS AI — UNIFIED RISK ENGINE
========================================================= */

/*
  Risk severity values used by the NEXUS engine.
  Higher values represent higher operational risk.
*/
const RISK_SEVERITY_VALUES = {
  LOW: 20,
  MEDIUM: 45,
  HIGH: 70,
  CRITICAL: 90
};

function normalizeRiskLevel(value) {
  const level =
    String(value || "LOW")
      .trim()
      .toUpperCase();

  return [
    "LOW",
    "MEDIUM",
    "HIGH",
    "CRITICAL"
  ].includes(level)
    ? level
    : "LOW";
}

function clampRiskScore(value) {
  const number =
    Number(value);

  if (!Number.isFinite(number)) {
    return 0;
  }

  return Math.max(
    0,
    Math.min(
      100,
      Math.round(number * 100) / 100
    )
  );
}

/*
  Incident locations are currently stored as text.
  We therefore use conservative text matching and never
  invent coordinates.
*/
function locationMatches(
  incidentLocation,
  signalLocation
) {
  const incidentText =
    String(
      incidentLocation || ""
    )
      .trim()
      .toLowerCase();

  const signalText =
    String(
      signalLocation || ""
    )
      .trim()
      .toLowerCase();

  if (
    !incidentText ||
    !signalText
  ) {
    return false;
  }

  if (
    incidentText.includes(signalText) ||
    signalText.includes(incidentText)
  ) {
    return true;
  }

  const incidentParts =
    incidentText
      .split(/[,\-\/|]+/)
      .map((part) => part.trim())
      .filter(
        (part) =>
          part.length >= 4
      );

  return incidentParts.some(
    (part) =>
      signalText.includes(part)
  );
}

async function loadRiskContext(
  incident
) {
  const context = {
    hazards: [],
    traffic: [],
    communitySignals: [],
    disruptions: [],
    weather: null
  };

  const incidentLocation =
    incident?.location || "";

  /*
    HAZARDS
    Actual table timestamp: observed_at
  */
  try {
    if (
      await tableExists(
        "hazard_events"
      )
    ) {
      const result =
        await query(
          `
          SELECT *
          FROM hazard_events
          WHERE status IN ('ACTIVE', 'MONITORING')
          ORDER BY observed_at DESC
          LIMIT 100
          `
        );

      context.hazards =
        rowsOf(result).filter(
          (row) =>
            locationMatches(
              incidentLocation,
              row.location
            )
        );
    }
  } catch (error) {
    console.warn(
      "Risk context hazard lookup skipped:",
      error.message
    );
  }

  /*
    TRAFFIC
    Actual table timestamp: observed_at
  */
  try {
    if (
      await tableExists(
        "traffic_events"
      )
    ) {
      const result =
        await query(
          `
          SELECT *
          FROM traffic_events
          WHERE status = 'ACTIVE'
          ORDER BY observed_at DESC
          LIMIT 100
          `
        );

      context.traffic =
        rowsOf(result).filter(
          (row) =>
            locationMatches(
              incidentLocation,
              row.location ||
                row.road_name
            )
        );
    }
  } catch (error) {
    console.warn(
      "Risk context traffic lookup skipped:",
      error.message
    );
  }

  /*
    COMMUNITY / EXTERNAL SIGNALS

    External intelligence remains UNVERIFIED until
    authority review. Unverified signals are therefore
    given lower confidence and lower score contribution.
  */
  try {
    if (
      await tableExists(
        "community_signals"
      )
    ) {
      const result =
        await query(
          `
          SELECT *
          FROM community_signals
          WHERE status = 'ACTIVE'
          ORDER BY created_at DESC
          LIMIT 100
          `
        );

      context.communitySignals =
        rowsOf(result).filter(
          (row) =>
            locationMatches(
              incidentLocation,
              row.location
            )
        );
    }
  } catch (error) {
    console.warn(
      "Risk context community lookup skipped:",
      error.message
    );
  }

  /*
    ROUTE DISRUPTIONS
    Actual table timestamp: created_at
  */
  try {
    if (
      await tableExists(
        "route_disruptions"
      )
    ) {
      const result =
        await query(
          `
          SELECT *
          FROM route_disruptions
          WHERE status = 'ACTIVE'
          ORDER BY created_at DESC
          LIMIT 100
          `
        );

      context.disruptions =
        rowsOf(result).filter(
          (row) =>
            locationMatches(
              incidentLocation,
              row.location ||
                row.road_name
            )
        );
    }
  } catch (error) {
    console.warn(
      "Risk context disruption lookup skipped:",
      error.message
    );
  }

  /*
    Weather is intentionally not fabricated here.
    Incidents currently do not guarantee latitude/longitude.
    The frontend/backend weather endpoint remains available
    when real coordinates are supplied.
  */
  context.weather = null;

  return context;
}

function calculateRiskScore(
  incident,
  context
) {
  const severity =
    normalizeRiskLevel(
      incident?.severity
    );

  let score =
    RISK_SEVERITY_VALUES[
      severity
    ] || 20;

  const contributingSignals = [];

  if (
    severity === "CRITICAL"
  ) {
    contributingSignals.push({
      type: "INCIDENT",
      source: "CITIZEN",
      severity: "CRITICAL",
      weight: 20,
      description:
        "Citizen incident was reported as CRITICAL."
    });
  } else if (
    severity === "HIGH"
  ) {
    contributingSignals.push({
      type: "INCIDENT",
      source: "CITIZEN",
      severity: "HIGH",
      weight: 15,
      description:
        "Citizen incident was reported as HIGH severity."
    });
  }

  const hazards =
    Array.isArray(
      context?.hazards
    )
      ? context.hazards
      : [];

  const traffic =
    Array.isArray(
      context?.traffic
    )
      ? context.traffic
      : [];

  const communitySignals =
    Array.isArray(
      context?.communitySignals
    )
      ? context.communitySignals
      : [];

  const disruptions =
    Array.isArray(
      context?.disruptions
    )
      ? context.disruptions
      : [];

  /*
    HAZARD CONTRIBUTION
  */
  for (
    const hazard of hazards
  ) {
    const hazardSeverity =
      normalizeRiskLevel(
        hazard.severity
      );

    const weight =
      hazardSeverity ===
      "CRITICAL"
        ? 12
        : hazardSeverity ===
          "HIGH"
        ? 9
        : hazardSeverity ===
          "MEDIUM"
        ? 6
        : 3;

    score += weight;

    contributingSignals.push({
      type: "HAZARD",
      source:
        hazard.source_type ||
        "DATABASE",
      severity:
        hazardSeverity,
      weight,
      title:
        hazard.title ||
        hazard.hazard_type ||
        "Connected hazard",
      location:
        hazard.location ||
        null
    });
  }

  /*
    TRAFFIC CONTRIBUTION
  */
  for (
    const event of traffic
  ) {
    const trafficSeverity =
      normalizeRiskLevel(
        event.severity
      );

    let weight =
      trafficSeverity ===
      "CRITICAL"
        ? 8
        : trafficSeverity ===
          "HIGH"
        ? 6
        : trafficSeverity ===
          "MEDIUM"
        ? 4
        : 2;

    if (
      Number(event.delay_minutes || 0) >=
      30
    ) {
      weight += 3;
    }

    score += weight;

    contributingSignals.push({
      type: "TRAFFIC",
      source:
        event.source_type ||
        "DATABASE",
      severity:
        trafficSeverity,
      weight,
      title:
        event.event_type ||
        "Traffic event",
      location:
        event.location ||
        event.road_name ||
        null,
      delay_minutes:
        event.delay_minutes ?? null
    });
  }

  /*
    ROUTE DISRUPTION CONTRIBUTION
  */
  for (
    const disruption of disruptions
  ) {
    const disruptionSeverity =
      normalizeRiskLevel(
        disruption.severity
      );

    const weight =
      disruptionSeverity ===
      "CRITICAL"
        ? 10
        : disruptionSeverity ===
          "HIGH"
        ? 8
        : disruptionSeverity ===
          "MEDIUM"
        ? 5
        : 2;

    score += weight;

    contributingSignals.push({
      type: "ROUTE_DISRUPTION",
      source:
        disruption.source_type ||
        "DATABASE",
      severity:
        disruptionSeverity,
      weight,
      title:
        disruption.disruption_type ||
        "Route disruption",
      location:
        disruption.location ||
        disruption.road_name ||
        null,
      reason:
        disruption.reason ||
        null
    });
  }

  /*
    COMMUNITY / EXTERNAL SIGNAL CONTRIBUTION

    UNVERIFIED:
      lower contribution because authority has not
      confirmed the information.

    VERIFIED / AUTHORITY:
      stronger contribution.
  */
  for (
    const signal of communitySignals
  ) {
    const signalSeverity =
      normalizeRiskLevel(
        signal.severity
      );

    const verification =
      String(
        signal.verification_status ||
          "UNVERIFIED"
      ).toUpperCase();

    const baseWeight =
      signalSeverity ===
      "CRITICAL"
        ? 8
        : signalSeverity ===
          "HIGH"
        ? 6
        : signalSeverity ===
          "MEDIUM"
        ? 4
        : 2;

    const verified =
      verification ===
        "VERIFIED" ||
      verification ===
        "AUTHORITY";

    const weight =
      verified
        ? baseWeight
        : Math.max(
            1,
            Math.round(
              baseWeight * 0.5
            )
          );

    score += weight;

    contributingSignals.push({
      type: "COMMUNITY_SIGNAL",
      source:
        signal.source ||
        "COMMUNITY",
      severity:
        signalSeverity,
      verification,
      weight,
      title:
        signal.signal_type ||
        "Community signal",
      location:
        signal.location ||
        null,
      description:
        signal.description ||
        null
    });
  }

  score =
    clampRiskScore(
      score
    );

  let riskLevel =
    "LOW";

  if (
    score >= 85
  ) {
    riskLevel =
      "CRITICAL";
  } else if (
    score >= 65
  ) {
    riskLevel =
      "HIGH";
  } else if (
    score >= 35
  ) {
    riskLevel =
      "MEDIUM";
  }

  /*
    Confidence is based on the amount and quality of
    connected evidence, not simply on the risk score.
  */
  let confidence = 40;

  confidence +=
    Math.min(
      hazards.length * 8,
      24
    );

  confidence +=
    Math.min(
      traffic.length * 5,
      15
    );

  confidence +=
    Math.min(
      disruptions.length * 6,
      18
    );

  confidence +=
    Math.min(
      communitySignals.length * 3,
      12
    );

  const verifiedSignals =
    communitySignals.filter(
      (signal) => {
        const status =
          String(
            signal.verification_status ||
              ""
          ).toUpperCase();

        return (
          status === "VERIFIED" ||
          status === "AUTHORITY"
        );
      }
    ).length;

  confidence +=
    Math.min(
      verifiedSignals * 8,
      16
    );

  confidence =
    Math.min(
      100,
      Math.round(
        confidence
      )
    );

  let stage =
    "DETECTION";

  if (
    contributingSignals.length > 0
  ) {
    stage =
      "RISK_ASSESSMENT";
  }

  if (
    riskLevel === "HIGH" ||
    riskLevel === "CRITICAL"
  ) {
    stage =
      "PREDICTION";
  }

  if (
    riskLevel === "CRITICAL" &&
    confidence >= 70
  ) {
    stage =
      "ESCALATION";
  }

  return {
    riskScore:
      score,

    riskLevel,

    confidence,

    stage,

    contributingSignals
  };
}

function buildPrediction(
  risk
) {
  const level =
    normalizeRiskLevel(
      risk?.riskLevel
    );

  const confidence =
    Number(
      risk?.confidence || 0
    );

  if (
    level === "CRITICAL"
  ) {
    return {
      trend:
        "CRITICAL_ESCALATION",
      statement:
        "Connected NEXUS signals indicate a critical risk level. Immediate authority review and appropriate emergency response should be considered.",
      confidence:
        confidence >= 70
          ? "HIGH"
          : confidence >= 50
          ? "MEDIUM"
          : "LOW"
    };
  }

  if (
    level === "HIGH"
  ) {
    return {
      trend:
        "ELEVATED",
      statement:
        "Connected NEXUS signals indicate elevated risk. The incident should receive priority review and monitoring.",
      confidence:
        confidence >= 70
          ? "HIGH"
          : confidence >= 50
          ? "MEDIUM"
          : "LOW"
    };
  }

  if (
    level === "MEDIUM"
  ) {
    return {
      trend:
        "WATCH",
      statement:
        "The connected information indicates a situation that requires monitoring. Additional verified signals may increase or decrease the assessed risk.",
      confidence:
        confidence >= 60
          ? "MEDIUM"
          : "LOW"
    };
  }

  return {
    trend:
      "STABLE",
    statement:
      "Current connected information does not indicate a high escalation risk. Continue monitoring for new verified signals.",
    confidence:
      confidence >= 60
        ? "MEDIUM"
        : "LOW"
  };
}

async function saveRiskAssessment(
  incident,
  risk
) {
  try {
    if (
      !(await tableExists(
        "risk_assessments"
      ))
    ) {
      return false;
    }

    await query(
      `
      INSERT INTO risk_assessments
      (
        incident_id,
        location,
        risk_score,
        risk_level,
        stage,
        confidence,
        contributing_signals
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      [
        incident?.id ?? null,
        incident?.location ||
          "Unknown",
        risk.riskScore,
        risk.riskLevel,
        risk.stage,
        risk.confidence,
        JSON.stringify(
          risk.contributingSignals
        )
      ]
    );

    return true;
  } catch (error) {
    console.warn(
      "Risk assessment save failed:",
      error.message
    );

    return false;
  }
}

async function applyRiskEscalation(
  incident,
  risk
) {
  const level =
    normalizeRiskLevel(
      risk?.riskLevel
    );

  const confidence =
    Number(
      risk?.confidence || 0
    );

  /*
    The risk engine does NOT automatically verify,
    assign, resolve or complete an incident.
    It only creates authority notifications for
    sufficiently supported HIGH/CRITICAL risk.
  */
  if (
    level !== "HIGH" &&
    level !== "CRITICAL"
  ) {
    return {
      escalated: false,
      level,
      reason:
        "Risk level is below automatic escalation threshold."
    };
  }

  if (
    level === "CRITICAL" &&
    confidence < 60
  ) {
    return {
      escalated: false,
      level,
      reason:
        "Critical risk detected, but confidence is below the automatic escalation threshold. Authority review is required."
    };
  }

  const reason =
    level === "CRITICAL"
      ? "Unified Risk Engine calculated CRITICAL risk from connected signals."
      : "Unified Risk Engine calculated HIGH risk from connected signals.";

  try {
    await createEscalationNotifications({
      incidentId:
        incident?.id,
      title:
        incident?.title ||
        "NEXUS Incident",
      location:
        incident?.location ||
        "Unknown",
      severity:
        level,
      reason
    });

    return {
      escalated: true,
      level,
      confidence,
      reason
    };
  } catch (error) {
    console.warn(
      "Risk escalation notification failed:",
      error.message
    );

    return {
      escalated: false,
      level,
      confidence,
      reason:
        "Risk calculated, but escalation notification could not be completed.",
      error:
        error.message
    };
  }
}

async function generateIncidentRisk(
  incident
) {
  const context =
    await loadRiskContext(
      incident
    );

  const risk =
    calculateRiskScore(
      incident,
      context
    );

  const prediction =
    buildPrediction(
      risk
    );

  let assessmentSaved =
    false;

  try {
    assessmentSaved =
      await saveRiskAssessment(
        incident,
        risk
      );
  } catch (error) {
    console.warn(
      "Risk assessment save skipped:",
      error.message
    );
  }

  let escalation = {
    escalated: false,
    reason:
      "Risk level below escalation threshold."
  };

  try {
    escalation =
      await applyRiskEscalation(
        incident,
        risk
      );
  } catch (error) {
    console.warn(
      "Risk escalation skipped:",
      error.message
    );
  }

  let aiExplanation =
    "The risk assessment is based on connected NEXUS records. Groq explanation is unavailable.";

  try {
    const ai =
      await callGroq({
        messages: [
          {
            role: "system",
            content:
              "You are NEXUS Risk Intelligence for Tamil Nadu. Explain the supplied risk assessment using ONLY the supplied incident and connected NEXUS data. Never invent live conditions, road closures, weather, authority actions or emergency responses. Clearly distinguish verified information from unverified community/external intelligence. Do not claim that NEXUS contacted an authority. Do not present the prediction as a certainty."
          },
          {
            role: "user",
            content:
              JSON.stringify({
                incident,
                risk,
                prediction,
                context
              })
          }
        ]
      });

    if (
      ai &&
      ai.reply
    ) {
      aiExplanation =
        ai.reply;
    }
  } catch (error) {
    console.warn(
      "Groq risk explanation unavailable:",
      error.message
    );
  }

  return {
    risk_score:
      risk.riskScore,

    risk_level:
      risk.riskLevel,

    risk_factors:
      risk.contributingSignals,

    prediction: {
      ...prediction,
      confidence:
        risk.confidence
    },

    ai_explanation:
      aiExplanation,

    stage:
      risk.stage,

    confidence:
      risk.confidence,

    escalation,

    assessment_saved:
      assessmentSaved,

    intelligence: {
      hazards:
        context.hazards.length,

      traffic:
        context.traffic.length,

      disruptions:
        context.disruptions.length,

      community_signals:
        context.communitySignals.length,

      weather:
        context.weather
          ? true
          : false
    },

    contributing_signals:
      risk.contributingSignals,

    generated_at:
      new Date().toISOString(),

    source:
      "NEXUS Unified Risk Engine + Groq"
  };
}

/*
  Existing frontend-compatible analysis endpoint.
  DO NOT create a second endpoint with the same path.
*/
app.get(
  "/api/ai/analysis/:incidentId",
  authenticateToken,
  async (req, res) => {
    try {
      const incidentId =
        Number(
          req.params.incidentId
        );

      if (
        !Number.isInteger(
          incidentId
        )
      ) {
        return statusError(
          res,
          "Invalid incident ID."
        );
      }

      const incidentResult =
        await query(
          `
          SELECT *
          FROM incidents
          WHERE id = ?
          LIMIT 1
          `,
          [incidentId]
        );

      const incident =
        rowsOf(
          incidentResult
        )[0];

      if (!incident) {
        return res.status(404).json({
          success: false,
          message:
            "Incident not found."
        });
      }

      const role =
        String(
          req.user.role || ""
        ).toUpperCase();

      const authorized =
        role === "AUTHORITY" ||
        (
          role === "USER" &&
          Number(req.user.id) ===
            Number(
              incident.user_id
            )
        ) ||
        (
          role === "DEPARTMENT" &&
          Number(
            req.user.department_id
          ) ===
            Number(
              incident.department_id
            )
        );

      if (!authorized) {
        return res.status(403).json({
          success: false,
          message:
            "You are not authorized to view this analysis."
        });
      }

      const analysis =
        await generateIncidentRisk(
          incident
        );

      /*
        Keep the existing ai_analysis table integration.
        insertDynamic automatically ignores fields that
        do not exist in the installed schema.
      */
      try {
        if (
          await tableExists(
            "ai_analysis"
          )
        ) {
          await insertDynamic(
            "ai_analysis",
            {
              incident_id:
                incidentId,

              risk_score:
                analysis.risk_score,

              risk_level:
                analysis.risk_level,

              prediction:
                JSON.stringify(
                  analysis.prediction
                ),

              risk_factors:
                JSON.stringify(
                  analysis.risk_factors
                ),

              analysis:
                analysis.ai_explanation,

              explanation:
                analysis.ai_explanation,

              confidence:
                analysis.prediction
                  .confidence,

              created_at:
                new Date()
            }
          );
        }
      } catch (error) {
        console.warn(
          "AI analysis database save skipped:",
          error.message
        );
      }

      res.json({
        success: true,
        available: true,

        incident_id:
          incidentId,

        analysis
      });
    } catch (error) {
      console.error(
        "Risk analysis error:",
        error
      );

      res.status(500).json({
        success: false,
        message:
          "Unable to generate risk analysis."
      });
    }
  }
);

/* =========================================================
   GLOBAL ERROR
========================================================= */

app.use(
  (err, req, res, next) => {
    console.error(
      "Unhandled server error:",
      err
    );

    if (res.headersSent) {
      return next(err);
    }

    res.status(500).json({
      success: false,
      message:
        "Internal NEXUS server error."
    });
  }
);

/* =========================================================
   START
========================================================= */
// ===============================
// SERVE NEXUS FRONTEND
// ===============================

app.use(express.static(path.join(__dirname, "../frontend")));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});
app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log("");
    console.log(
      "=============================================="
    );
    console.log(
      " NEXUS — Crisis Intelligence"
    );
    console.log(
      "=============================================="
    );
    console.log(
      ` Server:   http://localhost:${PORT}`
    );
    console.log(
      ` API:      http://localhost:${PORT}/api/test`
    );
    console.log(
      " Database: MySQL"
    );
    console.log(
      " Auth:     JWT + bcrypt"
    );
    console.log(
      " Roles:    USER / AUTHORITY / DEPARTMENT"
    );
    console.log(
      ` AI:       ${isGroqConfigured ? "Groq configured" : "Groq NOT configured"}`
    );
    console.log(
      ` Model:    ${GROQ_MODEL}`
    );
    console.log(
      "=============================================="
    );
    console.log("");
  }
);
