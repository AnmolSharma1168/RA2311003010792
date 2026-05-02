const axios = require("axios");
const { CREDENTIALS, SERVER_URL } = require("./config");

let activeToken = null;
let expiresAt = 0;

// fetches fresh token or returns the one if it is valid
async function fetchToken() {
  const now = Math.floor(Date.now() / 1000);
  if (activeToken && now < expiresAt - 60) {
    return activeToken;
  }
  const res = await axios.post(`${SERVER_URL}/auth`, {
    email: CREDENTIALS.email,
    name: CREDENTIALS.name,
    rollNo: CREDENTIALS.rollNo,
    accessCode: CREDENTIALS.accessCode,
    clientID: CREDENTIALS.clientID,
    clientSecret: CREDENTIALS.clientSecret,
  });
  activeToken = res.data.access_token;
  expiresAt = res.data.expires_in;
  return activeToken;
}

async function Log(stack, level, pkg, message) {
  const allowedStacks = ["backend", "frontend"];
  const allowedLevels = ["debug", "info", "warn", "error", "fatal"];
  const allowedPackages = [
    "cache", "controller", "cron_job", "db", "domain",
    "handler", "repository", "route", "service",
    "api", "component", "hook", "page", "state", "style",
    "auth", "config", "middleware", "utils",
  ];

  // skip if any value is outside the allowed list
  if (!allowedStacks.includes(stack)) return;
  if (!allowedLevels.includes(level)) return;
  if (!allowedPackages.includes(pkg)) return;

  try {
    const token = await fetchToken();
    await axios.post(
      `${SERVER_URL}/logs`,
      { stack, level, package: pkg, message },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    // never let a logging failure break the main app
  }
}

module.exports = { Log };