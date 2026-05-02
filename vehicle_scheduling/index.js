const axios = require("axios");
const { Log } = require("../logging_middleware/index");
const { CREDENTIALS, SERVER_URL } = require("../logging_middleware/config");

let activeToken = null;
let expiresAt = 0;

// refresh token if expired, otherwise use the cached one
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

// pull depot list — each depot has an hour budget we need for knapsack
async function loadDepots(token) {
  await Log("backend", "info", "service", "pulling depot list from server");
  const res = await axios.get(`${SERVER_URL}/depots`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await Log("backend", "info", "service", `got ${res.data.depots.length} depots back`);
  return res.data.depots;
}

// pull vehicle task list — each task has a duration and impact score
async function loadVehicles(token) {
  await Log("backend", "info", "service", "pulling vehicle task list from server");
  const res = await axios.get(`${SERVER_URL}/vehicles`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  await Log("backend", "info", "service", `got ${res.data.vehicles.length} vehicle tasks back`);
  return res.data.vehicles;
}

// classic 0/1 knapsack — pick tasks that maximize impact within hour limit
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

  // backtrack through dp table to figure out which tasks got picked
  const picked = [];
  let i = n;
  let w = capacity;
  for (; i > 0; i--) {
    if (dp[i][w] !== dp[i - 1][w]) {
      picked.push(tasks[i - 1]);
      w -= tasks[i - 1].Duration;
    }
  }

  return {
    totalImpact: dp[n][capacity],
    selectedTasks: picked,
  };
}

async function main() {
  try {
    await Log("backend", "info", "controller", "maintenance scheduler starting up");

    const token = await fetchToken();
    const depots = await loadDepots(token);
    const vehicles = await loadVehicles(token);

    const output = [];

    for (const depot of depots) {
      await Log("backend", "info", "controller", `running knapsack for depot ${depot.ID}, budget: ${depot.MechanicHours}hrs`);

      const { totalImpact, selectedTasks } = knapsack(vehicles, depot.MechanicHours);

      if (selectedTasks.length === 0) {
        await Log("backend", "warn", "controller", `depot ${depot.ID} had no tasks fitting within ${depot.MechanicHours}hr budget`);
      }

      await Log("backend", "info", "controller", `depot ${depot.ID} done — impact: ${totalImpact}, tasks picked: ${selectedTasks.length}`);

      output.push({
        depotID: depot.ID,
        mechanicHours: depot.MechanicHours,
        totalImpact,
        selectedTasks: selectedTasks.map((t) => t.TaskID),
      });
    }

    console.log("\n--- Scheduler Results by Depot ---\n");
    console.log(JSON.stringify(output, null, 2));

    await Log("backend", "info", "controller", "scheduler finished, all depots processed");

  } catch (err) {
    await Log("backend", "error", "controller", `scheduler hit an error: ${err.message}`);
    console.error("something went wrong:", err.message);
  }
}

main();