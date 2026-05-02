const axios = require("axios");
const { Log } = require("../logging_middleware/index");
const { AUTH_CONFIG, BASE_URL } = require("../logging_middleware/config");

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

async function getDepots(token) {
  await Log("backend", "info", "service", "Fetching depots from evaluation service");
  const response = await axios.get(`${BASE_URL}/depots`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await Log("backend", "info", "service", `Fetched ${response.data.depots.length} depots successfully`);
  return response.data.depots;
}

async function getVehicles(token) {
  await Log("backend", "info", "service", "Fetching vehicles from evaluation service");
  const response = await axios.get(`${BASE_URL}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await Log("backend", "info", "service", `Fetched ${response.data.vehicles.length} vehicle tasks successfully`);
  return response.data.vehicles;
}

function knapsack(tasks, capacity) {
  const n = tasks.length;
  const dp = Array(n + 1).fill(null).map(() => Array(capacity + 1).fill(0));

  for (let i = 1; i <= n; i++) {
    const { Duration, Impact } = tasks[i - 1];
    for (let w = 0; w <= capacity; w++) {
      dp[i][w] = dp[i - 1][w];
      if (Duration <= w) {
        dp[i][w] = Math.max(dp[i][w], dp[i - 1][w - Duration] + Impact);
      }
    }
  }

  // Backtrack to find selected tasks
  const selected = [];
  let w = capacity;
  for (let i = n; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      selected.push(tasks[i - 1]);
      w -= tasks[i - 1].Duration;
    }
  }

  return {
    totalImpact: dp[n][capacity],
    selectedTasks: selected,
  };
}

async function runScheduler() {
  try {
    await Log("backend", "info", "controller", "Vehicle maintenance scheduler started");

    const token = await getAuthToken();
    const depots = await getDepots(token);
    const vehicles = await getVehicles(token);

    const results = [];

    for (const depot of depots) {
      await Log("backend", "info", "controller", `Running knapsack for depot ${depot.ID} with ${depot.MechanicHours} mechanic hours`);

      const { totalImpact, selectedTasks } = knapsack(vehicles, depot.MechanicHours);

      await Log("backend", "info", "controller", `Depot ${depot.ID} optimal impact: ${totalImpact} with ${selectedTasks.length} tasks selected`);

      results.push({
        depotID: depot.ID,
        mechanicHours: depot.MechanicHours,
        totalImpact,
        selectedTasks: selectedTasks.map((t) => t.TaskID),
      });
    }

    console.log("\n===== VEHICLE MAINTENANCE SCHEDULER RESULTS =====\n");
    console.log(JSON.stringify(results, null, 2));

    await Log("backend", "info", "controller", "Vehicle maintenance scheduler completed successfully");

  } catch (err) {
    await Log("backend", "error", "controller", `Scheduler failed: ${err.message}`);
    console.error("Error:", err.message);
  }
}

runScheduler();