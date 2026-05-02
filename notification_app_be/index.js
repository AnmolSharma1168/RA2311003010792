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

// higher score = higher priority
function getScore(notification) {
  const typeWeight = {
    Placement: 3,
    Result: 2,
    Event: 1,
  };

  const weight = typeWeight[notification.Type] || 0;
  const recency = new Date(notification.Timestamp).getTime();

  // normalize recency to a small number so type weight dominates
  const recencyScore = recency / 1e13;

  return weight + recencyScore;
}

// min-heap implementation
class MinHeap {
  constructor() {
    this.heap = [];
  }

  size() {
    return this.heap.length;
  }

  peek() {
    return this.heap[0];
  }

  push(item) {
    this.heap.push(item);
    this._bubbleUp(this.heap.length - 1);
  }

  pop() {
    const top = this.heap[0];
    const last = this.heap.pop();
    if (this.heap.length > 0) {
      this.heap[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.heap[parent].score <= this.heap[i].score) break;
      [this.heap[parent], this.heap[i]] = [this.heap[i], this.heap[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const n = this.heap.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.heap[left].score < this.heap[smallest].score) smallest = left;
      if (right < n && this.heap[right].score < this.heap[smallest].score) smallest = right;
      if (smallest === i) break;
      [this.heap[smallest], this.heap[i]] = [this.heap[i], this.heap[smallest]];
      i = smallest;
    }
  }
}

function getTopN(notifications, n) {
  const heap = new MinHeap();

  for (const notif of notifications) {
    const score = getScore(notif);
    if (heap.size() < n) {
      heap.push({ score, notif });
    } else if (score > heap.peek().score) {
      heap.pop();
      heap.push({ score, notif });
    }
  }

  // extract and sort highest first
  const result = [];
  while (heap.size() > 0) {
    result.push(heap.pop().notif);
  }
  return result.reverse();
}

async function run() {
  try {
    await Log("backend", "info", "service", "Fetching notifications from evaluation service");

    const token = await getAuthToken();
    const response = await axios.get(`${BASE_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const notifications = response.data.notifications;
    await Log("backend", "info", "service", `Fetched ${notifications.length} notifications successfully`);

    const topN = 10;
    await Log("backend", "info", "controller", `Running priority inbox to find top ${topN} notifications`);

    const topNotifications = getTopN(notifications, topN);

    await Log("backend", "info", "controller", `Priority inbox computed successfully with ${topNotifications.length} results`);

    console.log(`\n===== TOP ${topN} PRIORITY NOTIFICATIONS =====\n`);
    topNotifications.forEach((n, i) => {
      console.log(`${i + 1}. [${n.Type}] ${n.Message} — ${n.Timestamp}`);
    });

  } catch (err) {
    await Log("backend", "error", "controller", `Priority inbox failed: ${err.message}`);
    console.error("Error:", err.message);
  }
}

run();