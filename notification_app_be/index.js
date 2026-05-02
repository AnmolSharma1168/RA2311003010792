const axios = require("axios");
const { Log } = require("../logging_middleware/index");
const { CREDENTIALS, SERVER_URL } = require("../logging_middleware/config");

let activeToken = null;
let expiresAt = 0;

// refresh token if expired, otherwise return the one we already have
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

// placement matters most, then results, events are lowest priority
function calcPriority(notification) {
  const weights = {
    Placement: 3,
    Result: 2,
    Event: 1,
  };

  const typeScore = weights[notification.Type] || 0;
  const timestamp = new Date(notification.Timestamp).getTime();

  // divide timestamp so type weight stays dominant
  const recencyBonus = timestamp / 1e13;

  return typeScore + recencyBonus;
}

// min-heap — keeps the lowest scoring item at the top for easy removal
class MinHeap {
  constructor() {
    this.data = [];
  }

  size() {
    return this.data.length;
  }

  peek() {
    return this.data[0];
  }

  push(item) {
    this.data.push(item);
    this._bubbleUp(this.data.length - 1);
  }

  pop() {
    const top = this.data[0];
    const last = this.data.pop();
    if (this.data.length > 0) {
      this.data[0] = last;
      this._sinkDown(0);
    }
    return top;
  }

  _bubbleUp(i) {
    while (i > 0) {
      const parent = Math.floor((i - 1) / 2);
      if (this.data[parent].score <= this.data[i].score) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }

  _sinkDown(i) {
    const len = this.data.length;
    while (true) {
      let lowest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < len && this.data[left].score < this.data[lowest].score) lowest = left;
      if (right < len && this.data[right].score < this.data[lowest].score) lowest = right;
      if (lowest === i) break;
      [this.data[lowest], this.data[i]] = [this.data[i], this.data[lowest]];
      i = lowest;
    }
  }
}

// keep heap size at N so we never sort the whole list
function findTopNotifications(notifications, limit) {
  const heap = new MinHeap();

  for (const item of notifications) {
    const score = calcPriority(item);
    if (heap.size() < limit) {
      heap.push({ score, item });
    } else if (score > heap.peek().score) {
      heap.pop();
      heap.push({ score, item });
    }
  }

  // drain heap and flip so highest priority comes first
  const sorted = [];
  while (heap.size() > 0) {
    sorted.push(heap.pop().item);
  }
  return sorted.reverse();
}

async function main() {
  try {
    await Log("backend", "info", "service", "pulling notifications from server");

    const token = await fetchToken();
    const res = await axios.get(`${SERVER_URL}/notifications`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    const allNotifications = res.data.notifications;
    await Log("backend", "info", "service", `loaded ${allNotifications.length} notifications`);

    const limit = 10;
    await Log("backend", "info", "controller", `building priority inbox, looking for top ${limit}`);

    const topList = findTopNotifications(allNotifications, limit);

    await Log("backend", "info", "controller", `priority inbox ready, ${topList.length} items returned`);

    console.log(`\n--- Top ${limit} Notifications Right Now ---\n`);
    topList.forEach((n, idx) => {
      console.log(`${idx + 1}. ${n.Type} | ${n.Message} | ${n.Timestamp}`);
    });

  } catch (err) {
    await Log("backend", "error", "controller", `something went wrong in notification inbox: ${err.message}`);
    console.error("error:", err.message);
  }
}

main();