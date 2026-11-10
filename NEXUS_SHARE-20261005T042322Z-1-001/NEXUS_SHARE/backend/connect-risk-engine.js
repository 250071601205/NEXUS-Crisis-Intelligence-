const fs = require("fs");

const file = "server.js";
let source = fs.readFileSync(file, "utf8");

const routeMarker = '"/api/ai/analysis/:incidentId"';
const routeIndex = source.indexOf(routeMarker);

if (routeIndex === -1) {
  console.error(
    'Could not find "/api/ai/analysis/:incidentId" in server.js.'
  );
  process.exit(1);
}

/*
  Find the section comment immediately before
  the existing AI analysis route.
*/
let start = source.lastIndexOf(
  "/* =========================================================",
  routeIndex
);

if (start === -1) {
  console.error(
    "Could not find the AI analysis section boundary."
  );
  process.exit(1);
}

/*
  Find the next large section comment after
  the existing AI analysis route.
*/
let end = source.indexOf(
  "/* =========================================================",
  routeIndex + routeMarker.length
);

if (end === -1) {
  end = source.indexOf(
    "app.use(",
    routeIndex + routeMarker.length
  );
}

if (end === -1) {
  console.error(
    "Could not find the end of the AI analysis section."
  );
  process.exit(1);
}

/*
  Keep the server safe by making sure we only replace
  the section containing the existing analysis route.
*/
const existingSection = source.slice(start, end);

if (
  !existingSection.includes(
    "/api/ai/analysis/:incidentId"
  )
) {
  console.error(
    "The detected section does not contain the AI analysis route."
  );
  process.exit(1);
}

const block = `/* =========================================================
   NEXUS AI — RISK ANALYSIS & PREDICTION
========================================================= */

function calculateRiskScore(incident, context) {
  const base = {
    LOW: 20,
    MEDIUM: 45,
    HIGH: 70,
    CRITICAL: 90
  };

  let score =
    base[
      String(
        incident.severity || "LOW"
      ).toUpperCase()
    ] || 20;

  const factors = [];

  if (
    String(
      incident.severity || ""
    ).toUpperCase() === "CRITICAL"
  ) {
    factors.push(
      "Critical incident severity"
    );
  }

  if (
    String(
      incident.severity || ""
    ).toUpperCase() === "HIGH"
  ) {
    factors.push(
      "High incident severity"
    );
  }

  const hazards =
    Array.isArray(context.hazards)
      ? context.hazards
      : [];

  const traffic =
    Array.isArray(context.traffic)
      ? context.traffic
      : [];

  const signals =
    Array.isArray(context.signals)
      ? context.signals
      : [];

  const disruptions =
    Array.isArray(context.disruptions)
      ? context.disruptions
      : [];

  if (hazards.length) {
    score += Math.min(
      hazards.length * 3,
      12
    );

    factors.push(
      hazards.length === 1
        ? "Connected hazard record present"
        : \`\${hazards.length} connected hazard records present\`
    );
  }

  if (traffic.length) {
    score += Math.min(
      traffic.length * 2,
      8
    );

    factors.push(
      "Connected traffic records present"
    );
  }

  if (signals.length) {
    score += Math.min(
      signals.length * 2,
      8
    );

    factors.push(
      "Community signals present"
    );
  }

  if (disruptions.length) {
    score += Math.min(
      disruptions.length * 3,
      12
    );

    factors.push(
      "Route disruption records present"
    );
  }

  score = Math.max(
    0,
    Math.min(100, score)
  );

  let level = "LOW";

  if (score >= 80) {
    level = "CRITICAL";
  } else if (score >= 60) {
    level = "HIGH";
  } else if (score >= 35) {
    level = "MEDIUM";
  }

  return {
    score,
    level,
    factors
  };
}

function buildPrediction(
  assessment,
  context
) {
  const hasSignals =
    (
      Array.isArray(
        context.hazards
      ) &&
      context.hazards.length > 0
    ) ||
    (
      Array.isArray(
        context.disruptions
      ) &&
      context.disruptions.length > 0
    ) ||
    (
      Array.isArray(
        context.signals
      ) &&
      context.signals.length > 0
    );

  if (
    assessment.level === "CRITICAL" ||
    assessment.level === "HIGH"
  ) {
    return {
      trend: "ELEVATED",
      statement:
        "Connected indicators suggest that the situation may remain elevated or worsen unless the incident is addressed.",
      confidence:
        hasSignals
          ? "MEDIUM"
          : "LOW"
    };
  }

  if (
    assessment.level === "MEDIUM"
  ) {
    return {
      trend: "WATCH",
      statement:
        "The situation currently requires monitoring. Additional connected signals may increase or decrease the assessed risk.",
      confidence:
        hasSignals
          ? "MEDIUM"
          : "LOW"
    };
  }

  return {
    trend: "STABLE",
    statement:
      "Current connected information does not indicate a high escalation risk, but the situation should continue to be monitored.",
    confidence: "LOW"
  };
}

async function loadRiskContext() {
  const context = {
    hazards: [],
    traffic: [],
    signals: [],
    disruptions: []
  };

  try {
    if (
      await tableExists(
        "hazard_events"
      )
    ) {
      const r =
        await query(
          \`
          SELECT *
          FROM hazard_events
          ORDER BY created_at DESC
          LIMIT 20
          \`
        );

      context.hazards =
        rowsOf(r);
    }
  } catch {}

  try {
    if (
      await tableExists(
        "traffic_events"
      )
    ) {
      const r =
        await query(
          \`
          SELECT *
          FROM traffic_events
          ORDER BY created_at DESC
          LIMIT 20
          \`
        );

      context.traffic =
        rowsOf(r);
    }
  } catch {}

  try {
    if (
      await tableExists(
        "community_signals"
      )
    ) {
      const r =
        await query(
          \`
          SELECT *
          FROM community_signals
          ORDER BY created_at DESC
          LIMIT 20
          \`
        );

      context.signals =
        rowsOf(r);
    }
  } catch {}

  try {
    if (
      await tableExists(
        "route_disruptions"
      )
    ) {
      const r =
        await query(
          \`
          SELECT *
          FROM route_disruptions
          ORDER BY created_at DESC
          LIMIT 20
          \`
        );

      context.disruptions =
        rowsOf(r);
    }
  } catch {}

  return context;
}

async function generateIncidentRisk(
  incident
) {
  const context =
    await loadRiskContext();

  const assessment =
    calculateRiskScore(
      incident,
      context
    );

  const prediction =
    buildPrediction(
      assessment,
      context
    );

  let aiExplanation =
    "The risk assessment is based on the connected NEXUS records. Ollama explanation is unavailable.";

  try {
    const ai =
      await callOllama({
        messages: [
          {
            role: "system",
            content:
              "You are NEXUS Risk Intelligence. Explain the supplied risk assessment using only the supplied data. Never invent live conditions. Do not present uncertain predictions as facts."
          },
          {
            role: "user",
            content:
              JSON.stringify({
                incident,
                assessment,
                prediction,
                context
              })
          }
        ]
      });

    aiExplanation =
      ai.reply;
  } catch (error) {
    console.warn(
      "Ollama risk explanation unavailable:",
      error.message
    );
  }

  return {
    risk_score:
      assessment.score,
    risk_level:
      assessment.level,
    risk_factors:
      assessment.factors,
    prediction,
    ai_explanation:
      aiExplanation,
    generated_at:
      new Date().toISOString(),
    source:
      "NEXUS Risk Engine + Ollama"
  };
}

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
          \`
          SELECT *
          FROM incidents
          WHERE id = ?
          LIMIT 1
          \`,
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

`;

source =
  source.slice(0, start) +
  block +
  source.slice(end);

fs.writeFileSync(
  file,
  source,
  "utf8"
);

console.log(
  "NEXUS Risk Engine successfully connected."
);