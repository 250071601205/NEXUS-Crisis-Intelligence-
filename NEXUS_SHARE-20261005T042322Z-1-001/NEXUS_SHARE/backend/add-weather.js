const fs = require("fs");

const file = "server.js";
let source = fs.readFileSync(file, "utf8");

if (source.includes('"/api/weather"')) {
  console.log("Weather API is already installed.");
  process.exit(0);
}

/*
  Match the hazards route regardless of spaces,
  tabs, or Windows/Linux line endings.
*/
const markerRegex =
  /app\.get\s*\(\s*["']\/api\/hazards["']\s*,/;

const match = source.match(markerRegex);

if (!match) {
  console.error(
    "Could not locate the /api/hazards route in server.js."
  );
  process.exit(1);
}

const insertAt = match.index;

const weatherCode = `
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

`;

source =
  source.slice(0, insertAt) +
  weatherCode +
  source.slice(insertAt);

fs.writeFileSync(
  file,
  source,
  "utf8"
);

console.log(
  "NEXUS live weather API installed successfully."
);