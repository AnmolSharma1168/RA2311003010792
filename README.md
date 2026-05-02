# RA2311003010792 — Affordmed Backend Evaluation

This repo contains my submission for the Affordmed Campus Hiring Backend Evaluation.

---

## What's inside

### logging_middleware
A reusable logging package that sends structured logs to the Affordmed evaluation server. Every other module in this repo uses this for logging — no console.log anywhere.

### vehicle_scheduling
Solves the vehicle maintenance scheduling problem using a 0/1 knapsack algorithm. Fetches depot budgets and vehicle tasks from the evaluation API, then finds the optimal set of tasks for each depot that maximizes impact without exceeding the mechanic-hour limit.

### notification_app_be
Priority inbox implementation for campus notifications. Fetches notifications from the evaluation API and returns the top N most important ones using a min-heap. Priority is based on notification type (Placement > Result > Event) with a recency bonus for newer ones.

### notification_system_design.md
Design document covering all 6 stages of the campus notification system — REST API design, database schema, query optimization, caching strategy, bulk notification reliability, and the priority inbox approach.

---

## Stack
- Node.js
- JavaScript
- Axios

---

## How to run

Install dependencies:
```bash
npm install
```

Run vehicle scheduler:
```bash
node vehicle_scheduling/index.js
```

Run priority inbox:
```bash
node notification_app_be/index.js
```
