const https = require("https");

/*
=========================================================
 NEXUS — External Intelligence Collector
=========================================================

External signals are intelligence only.

They are NOT official incidents and must remain
UNVERIFIED until reviewed by an AUTHORITY user.
=========================================================
*/

const USER_AGENT =
  "NEXUS-Crisis-Intelligence/1.0";

/*
=========================================================
 EXISTING NEXUS AUTHORITY USER
=========================================================

ID 1 = Test User
Email = test@nexus.com
Role = AUTHORITY

Used as the owner of external intelligence records.
=========================================================
*/

const EXTERNAL_SIGNAL_USER_ID = 22;

/*
=========================================================
 TAMIL NADU LOCATION TERMS
=========================================================
*/

const TAMIL_NADU_TERMS = [
  "tamil nadu",
  "tamilnadu",
  "chennai",
  "coimbatore",
  "madurai",
  "trichy",
  "tiruchirappalli",
  "salem",
  "tirunelveli",
  "thoothukudi",
  "tuticorin",
  "erode",
  "vellore",
  "tiruppur",
  "dindigul",
  "thanjavur",
  "kumbakonam",
  "cuddalore",
  "villupuram",
  "chengalpattu",
  "kanchipuram",
  "avadi",
  "tambaram",
  "pallavaram",
  "neyveli",
  "nagapattinam",
  "pondicherry"
];

/*
=========================================================
 CRISIS KEYWORDS
=========================================================
*/

const CRISIS_KEYWORDS = {
  FLOOD: [
    "flood",
    "flooding",
    "waterlogging",
    "water logging",
    "inundation",
    "submerged"
  ],

  HEAVY_RAIN: [
    "heavy rain",
    "heavy rainfall",
    "extreme rainfall",
    "rainfall",
    "cloudburst"
  ],

  CYCLONE: [
    "cyclone",
    "tropical storm",
    "storm warning",
    "cyclonic"
  ],

  FIRE: [
    "fire",
    "fire accident",
    "blaze",
    "warehouse fire",
    "building fire"
  ],

  TRAFFIC: [
    "traffic jam",
    "traffic congestion",
    "traffic disruption",
    "road blocked",
    "road closure",
    "traffic diversion"
  ],

  ELECTRICITY: [
    "power outage",
    "power cut",
    "electricity outage",
    "transformer",
    "electrical accident"
  ],

  HEALTH: [
    "disease outbreak",
    "outbreak",
    "epidemic",
    "health emergency",
    "hospital emergency"
  ],

  LANDSLIDE: [
    "landslide",
    "mudslide",
    "rockslide"
  ]
};

/*
=========================================================
 HTTPS FETCH
=========================================================
*/

function fetchText(
  url,
  timeout = 15000
) {
  return new Promise(
    (resolve, reject) => {
      const request =
        https.get(
          url,
          {
            headers: {
              "User-Agent":
                USER_AGENT,

              Accept:
                "application/rss+xml, application/xml, text/xml, text/plain, */*"
            }
          },
          (response) => {
            let body = "";

            response.setEncoding(
              "utf8"
            );

            response.on(
              "data",
              (chunk) => {
                body += chunk;
              }
            );

            response.on(
              "end",
              () => {
                const statusCode =
                  response.statusCode ||
                  0;

                if (
                  statusCode < 200 ||
                  statusCode >= 300
                ) {
                  reject(
                    new Error(
                      `HTTP ${statusCode}`
                    )
                  );

                  return;
                }

                resolve(body);
              }
            );
          }
        );

      request.setTimeout(
        timeout,
        () => {
          request.destroy(
            new Error(
              "Request timed out."
            )
          );
        }
      );

      request.on(
        "error",
        reject
      );
    }
  );
}

/*
=========================================================
 TEXT CLEANING
=========================================================
*/

function stripHtml(value) {
  return String(value || "")
    .replace(
      /<script[\s\S]*?<\/script>/gi,
      ""
    )
    .replace(
      /<style[\s\S]*?<\/style>/gi,
      ""
    )
    .replace(
      /<[^>]+>/g,
      " "
    )
    .replace(
      /&nbsp;/gi,
      " "
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /\s+/g,
      " "
    )
    .trim();
}

function decodeXml(value) {
  return String(value || "")
    .replace(
      /<!\[CDATA\[([\s\S]*?)\]\]>/gi,
      "$1"
    )
    .replace(
      /&amp;/gi,
      "&"
    )
    .replace(
      /&lt;/gi,
      "<"
    )
    .replace(
      /&gt;/gi,
      ">"
    )
    .replace(
      /&quot;/gi,
      '"'
    )
    .replace(
      /&#39;/gi,
      "'"
    )
    .replace(
      /&#x27;/gi,
      "'"
    )
    .trim();
}

function cleanText(value) {
  return stripHtml(
    decodeXml(value)
  );
}

/*
=========================================================
 LOCATION DETECTION
=========================================================
*/

function detectTamilNadu(text) {
  const source =
    String(text || "")
      .toLowerCase();

  const matched =
    TAMIL_NADU_TERMS.filter(
      (term) =>
        source.includes(
          term.toLowerCase()
        )
    );

  return {
    relevant:
      matched.length > 0,

    matched
  };
}

/*
=========================================================
 CRISIS CLASSIFICATION
=========================================================
*/

function classifyCrisis(text) {
  const source =
    String(text || "")
      .toLowerCase();

  const matches = [];

  for (
    const [category, keywords]
    of Object.entries(
      CRISIS_KEYWORDS
    )
  ) {
    for (
      const keyword
      of keywords
    ) {
      if (
        source.includes(
          keyword.toLowerCase()
        )
      ) {
        matches.push({
          category,
          keyword
        });
      }
    }
  }

  const categories =
    [
      ...new Set(
        matches.map(
          (item) =>
            item.category
        )
      )
    ];

  return {
    isCrisis:
      categories.length > 0,

    categories,

    matchedKeywords:
      [
        ...new Set(
          matches.map(
            (item) =>
              item.keyword
          )
        )
      ]
  };
}

/*
=========================================================
 SEVERITY
=========================================================
*/

function classifySeverity(
  text,
  categories
) {
  const source =
    String(text || "")
      .toLowerCase();

  if (
    source.includes("death") ||
    source.includes("dead") ||
    source.includes("fatal") ||
    source.includes(
      "evacuation"
    ) ||
    source.includes(
      "emergency declared"
    ) ||
    source.includes(
      "major flood"
    ) ||
    source.includes(
      "severe cyclone"
    )
  ) {
    return "CRITICAL";
  }

  if (
    source.includes("severe") ||
    source.includes("major") ||
    source.includes("danger") ||
    source.includes("warning") ||
    source.includes("blocked") ||
    categories.includes(
      "FLOOD"
    ) ||
    categories.includes(
      "CYCLONE"
    )
  ) {
    return "HIGH";
  }

  if (
    categories.includes(
      "HEAVY_RAIN"
    ) ||
    categories.includes(
      "TRAFFIC"
    ) ||
    categories.includes(
      "ELECTRICITY"
    )
  ) {
    return "MEDIUM";
  }

  return "LOW";
}

/*
=========================================================
 RSS PARSER
=========================================================
*/

function parseRss(
  xml,
  sourceName
) {
  const items = [];

  const itemMatches =
    String(xml || "").match(
      /<item\b[\s\S]*?<\/item>/gi
    ) || [];

  for (
    const item
    of itemMatches
  ) {
    const title =
      cleanText(
        (
          item.match(
            /<title\b[^>]*>([\s\S]*?)<\/title>/i
          ) || []
        )[1]
      );

    const description =
      cleanText(
        (
          item.match(
            /<description\b[^>]*>([\s\S]*?)<\/description>/i
          ) || []
        )[1]
      );

    const link =
      cleanText(
        (
          item.match(
            /<link\b[^>]*>([\s\S]*?)<\/link>/i
          ) || []
        )[1]
      );

    const pubDate =
      cleanText(
        (
          item.match(
            /<pubDate\b[^>]*>([\s\S]*?)<\/pubDate>/i
          ) || []
        )[1]
      );

    if (!title) {
      continue;
    }

    items.push({
      title,
      description,
      link,
      pubDate,
      source: sourceName
    });
  }

  return items;
}

/*
=========================================================
 GDELT
=========================================================
*/

async function collectGdelt() {
  const query =
    encodeURIComponent(
      "(Tamil Nadu OR Chennai OR Coimbatore OR Madurai OR Salem OR Trichy) " +
        "(flood OR flooding OR waterlogging OR cyclone OR rainfall OR fire OR traffic OR electricity OR emergency)"
    );

  const url =
    "https://api.gdeltproject.org/api/v2/doc/doc" +
    "?query=" +
    query +
    "&mode=artlist" +
    "&maxrecords=50" +
    "&format=json" +
    "&sort=datedesc";

  try {
    const raw =
      await fetchText(url);

    let data;

    try {
      data =
        JSON.parse(raw);
    } catch {
      throw new Error(
        "GDELT returned invalid JSON."
      );
    }

    const articles =
      Array.isArray(
        data?.articles
      )
        ? data.articles
        : [];

    return articles.map(
      (article) => ({
        title:
          cleanText(
            article.title
          ),

        description:
          cleanText(
            article.seendate ||
              ""
          ),

        link:
          article.url ||
          "",

        pubDate:
          article.seendate ||
          "",

        source:
          article.domain ||
          "GDELT"
      })
    );
  } catch (error) {
    if (
      String(
        error.message || ""
      ).includes("HTTP 429")
    ) {
      console.warn(
        "[GDELT] Rate limited (HTTP 429). Skipping this source for this collection cycle."
      );
    } else {
      console.warn(
        "[GDELT] Collection failed:",
        error.message
      );
    }

    return [];
  }
}

/*
=========================================================
 RSS SOURCES
=========================================================
*/

const RSS_SOURCES = [
  {
    name:
      "Google News — Tamil Nadu Crisis",

    url:
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(
        "Tamil Nadu flood OR cyclone OR heavy rain OR fire OR traffic"
      ) +
      "&hl=en-IN&gl=IN&ceid=IN:en"
  },

  {
    name:
      "Google News — Chennai Crisis",

    url:
      "https://news.google.com/rss/search?q=" +
      encodeURIComponent(
        "Chennai flood OR waterlogging OR heavy rain OR traffic"
      ) +
      "&hl=en-IN&gl=IN&ceid=IN:en"
  }
];

async function collectRss() {
  const all = [];

  for (
    const source
    of RSS_SOURCES
  ) {
    try {
      const xml =
        await fetchText(
          source.url
        );

      const items =
        parseRss(
          xml,
          source.name
        );

      all.push(
        ...items
      );
    } catch (error) {
      console.warn(
        `[RSS] Source failed: ${source.name}`,
        error.message
      );
    }
  }

  return all;
}

/*
=========================================================
 NORMALIZATION
=========================================================
*/

function normalizeSignal(item) {
  const combinedText =
    [
      item.title,
      item.description
    ]
      .filter(Boolean)
      .join(" ");

  const location =
    detectTamilNadu(
      combinedText
    );

  const crisis =
    classifyCrisis(
      combinedText
    );

  if (
    !location.relevant ||
    !crisis.isCrisis
  ) {
    return null;
  }

  const severity =
    classifySeverity(
      combinedText,
      crisis.categories
    );

  /*
    signal_type is REQUIRED by the
    actual community_signals schema.

    Use the primary detected crisis
    category as signal_type.
  */

  const signalType =
    crisis.categories[0] ||
    "OTHER";

  return {
    user_id:
      EXTERNAL_SIGNAL_USER_ID,

    signal_type:
      signalType,

    description:
      combinedText.slice(
        0,
        4000
      ),

    location:
      location.matched
        .slice(0, 10)
        .join(", "),

    latitude:
      null,

    longitude:
      null,

    severity,

    verification_status:
      "UNVERIFIED",

    status:
      "ACTIVE",

    source:
      String(
        item.source ||
          "EXTERNAL"
      ).slice(0, 100),

    created_at:
      new Date()
  };
}

/*
=========================================================
 PUBLIC COLLECTOR
=========================================================
*/

async function collectExternalIntelligence() {
  const results = [];

  /*
    GDELT
  */

  try {
    const gdelt =
      await collectGdelt();

    results.push(
      ...gdelt
    );
  } catch (error) {
    console.warn(
      "GDELT collection failed:",
      error.message
    );
  }

  /*
    RSS
  */

  try {
    const rss =
      await collectRss();

    results.push(
      ...rss
    );
  } catch (error) {
    console.warn(
      "RSS collection failed:",
      error.message
    );
  }

  /*
    Normalize
  */

  const normalized = [];

  for (
    const item
    of results
  ) {
    const signal =
      normalizeSignal(item);

    if (signal) {
      normalized.push(
        signal
      );
    }
  }

  /*
    Remove duplicates from the
    same collection cycle.
  */

  const unique =
    new Map();

  for (
    const signal
    of normalized
  ) {
    const key =
      [
        signal.signal_type,
        signal.location,
        signal.description
      ]
        .join("|")
        .toLowerCase()
        .trim();

    if (
      !unique.has(key)
    ) {
      unique.set(
        key,
        signal
      );
    }
  }

  return [
    ...unique.values()
  ];
}

/*
=========================================================
 DATABASE STORAGE
=========================================================
*/

async function saveExternalSignals(
  db,
  signals
) {
  if (
    !Array.isArray(signals) ||
    !signals.length
  ) {
    return {
      inserted: 0,
      skipped: 0
    };
  }

  let inserted = 0;
  let skipped = 0;

  /*
    Actual community_signals schema:

    id
    user_id
    signal_type
    description
    location
    latitude
    longitude
    severity
    verification_status
    status
    source
    created_at
    verified_at
  */

  const available =
    await db.query(
      `SHOW COLUMNS FROM community_signals`
    );

  const availableRows =
    Array.isArray(available)
      ? available[0]
      : available;

  const availableNames =
    Array.isArray(
      availableRows
    )
      ? availableRows.map(
          (row) =>
            row.Field
        )
      : [];

  /*
    Required fields in the actual
    schema are included explicitly.
  */

  for (
    const signal
    of signals
  ) {
    try {
      /*
        Duplicate prevention.

        Since this schema does not have
        source_url, compare the core
        intelligence fields instead.
      */

      try {
        const existing =
          await db.query(
            `
            SELECT id
            FROM community_signals
            WHERE user_id = ?
              AND signal_type = ?
              AND location = ?
              AND description = ?
            LIMIT 1
            `,
            [
              EXTERNAL_SIGNAL_USER_ID,
              signal.signal_type,
              signal.location,
              signal.description
            ]
          );

        const rows =
          Array.isArray(existing)
            ? existing[0]
            : existing;

        if (
          Array.isArray(rows) &&
          rows.length
        ) {
          skipped++;
          continue;
        }
      } catch (error) {
        /*
          Continue if duplicate checking
          fails unexpectedly.
        */
      }

      /*
        Build INSERT based on actual
        available columns.
      */

      const valuesMap = {
        user_id:
          EXTERNAL_SIGNAL_USER_ID,

        signal_type:
          signal.signal_type,

        description:
          signal.description,

        location:
          signal.location,

        latitude:
          signal.latitude,

        longitude:
          signal.longitude,

        severity:
          signal.severity,

        verification_status:
          "UNVERIFIED",

        status:
          "ACTIVE",

        source:
          signal.source,

        created_at:
          signal.created_at
      };

      const selected =
        Object.keys(
          valuesMap
        ).filter(
          (column) =>
            availableNames.includes(
              column
            )
        );

      if (
        !selected.includes(
          "user_id"
        ) ||
        !selected.includes(
          "signal_type"
        ) ||
        !selected.includes(
          "description"
        ) ||
        !selected.includes(
          "location"
        )
      ) {
        throw new Error(
          "community_signals required columns are missing."
        );
      }

      const values =
        selected.map(
          (column) =>
            valuesMap[column]
        );

      const placeholders =
        selected
          .map(() => "?")
          .join(", ");

      const quotedColumns =
        selected
          .map(
            (column) =>
              `\`${column}\``
          )
          .join(", ");

      const sql = `
        INSERT INTO community_signals
        (${quotedColumns})
        VALUES
        (${placeholders})
      `;

      await db.query(
        sql,
        values
      );

      inserted++;
    } catch (error) {
      skipped++;

      console.warn(
        "External signal save skipped:",
        error.message
      );
    }
  }

  return {
    inserted,
    skipped
  };
}

/*
=========================================================
 MODULE EXPORTS
=========================================================
*/

module.exports = {
  collectExternalIntelligence,
  saveExternalSignals,
  classifyCrisis,
  classifySeverity,
  detectTamilNadu
};