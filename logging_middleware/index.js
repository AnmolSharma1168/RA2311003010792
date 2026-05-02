const axios = require("axios");
const { AUTH_CONFIG, BASE_URL } = require("./config");

let cachedToken = null;
let tokenExpiry = 0;

async function getAuthToken() {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && now < tokenExpiry - 60) {
    return cachedToken;
  }
  const response = await axios.post(`${BASE_URL}/auth`, {
    email: AUTH_CONFIG.email,
    name: AUTH_CONFIG.name,
    rollNo: AUTH_CONFIG.rollNo,
    accessCode: AUTH_CONFIG.accessCode,
    clientID: AUTH_CONFIG.clientID,
    clientSecret: AUTH_CONFIG.clientSecret,
  });
  cachedToken = response.data.access_token;
  tokenExpiry = response.data.expires_in;
  return cachedToken;
}

async function Log(stack, level, pkg, message) {
  const validStacks = ["backend", "frontend"];
  const validLevels = ["debug", "info", "warn", "error", "fatal"];
  const validPackages = [
    "cache", "controller", "cron_job", "db", "domain",
    "handler", "repository", "route", "service",
    "api", "component", "hook", "page", "state", "style",
    "auth", "config", "middleware", "utils",
  ];

  if (!validStacks.includes(stack)) return;
  if (!validLevels.includes(level)) return;
  if (!validPackages.includes(pkg)) return;

  try {
    const token = await getAuthToken();
    await axios.post(
      `${BASE_URL}/logs`,
      { stack, level, package: pkg, message },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (err) {
    // Silent fail — logging must never crash the application
  }
}

module.exports = { Log };