# Notification System Design

## Stage 1

### REST API Endpoints

**GET** `/api/notifications/:studentId`
Headers: `Authorization: Bearer <token>`
```json
{
  "notifications": [
    {
      "id": "uuid",
      "type": "Placement",
      "message": "Google is hiring!",
      "isRead": false,
      "createdAt": "2026-04-22T10:00:00Z"
    }
  ]
}
```

---

**PATCH** `/api/notifications/:notificationId/read`
Headers: `Authorization: Bearer <token>`
```json
{
  "message": "Notification marked as read",
  "notificationId": "uuid"
}
```

---

**POST** `/api/notifications`
Headers: `Authorization: Bearer <token>`, `Content-Type: application/json`
```json
{
  "type": "Placement",
  "message": "Amazon hiring drive on May 5th",
  "targetStudents": ["all"]
}
```
Response:
```json
{ "message": "Notification sent successfully", "notificationId": "uuid" }
```

---

**GET** `/api/notifications/:studentId/unread-count`
```json
{ "unreadCount": 5 }
```

---

**DELETE** `/api/notifications/:notificationId`
```json
{ "message": "Notification deleted successfully" }
```

---

### Real-Time Mechanism
Using **WebSockets** via Socket.io. Each student joins a room on login. When HR sends a notification, server emits to that room instantly. SSE as fallback for unsupported clients.

---

## Stage 2

### Database — PostgreSQL
Structured data, complex filters, native enum support — PostgreSQL is the right fit here.

### Schema
```sql
CREATE TYPE notification_type AS ENUM ('Placement', 'Event', 'Result');

CREATE TABLE students (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type notification_type NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE student_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id UUID REFERENCES students(id),
  notification_id UUID REFERENCES notifications(id),
  is_read BOOLEAN DEFAULT false,
  read_at TIMESTAMP
);
```

### Queries

Get all notifications for a student:
```sql
SELECT n.id, n.type, n.message, sn.is_read, n.created_at
FROM notifications n
JOIN student_notifications sn ON n.id = sn.notification_id
WHERE sn.student_id = $1
ORDER BY n.created_at DESC;
```

Mark as read:
```sql
UPDATE student_notifications
SET is_read = true, read_at = NOW()
WHERE notification_id = $1 AND student_id = $2;
```

Unread count:
```sql
SELECT COUNT(*) as unread_count
FROM student_notifications
WHERE student_id = $1 AND is_read = false;
```

### Scaling Issues
- 50k students x 100 notifications = 5M rows quickly
- No indexes means full table scans which get very slow
- Bulk inserts for all students at once creates a DB bottleneck
- Fix: add indexes, partition by date, use a message queue for bulk sends

---

## Stage 3

### Slow Query
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```

Problems: `SELECT *` is wasteful, no indexes on `studentID` or `isRead`, results in a full table scan on millions of rows.

### Fixed Query
```sql
SELECT n.id, n.type, n.message, n.created_at
FROM student_notifications sn
JOIN notifications n ON sn.notification_id = n.id
WHERE sn.student_id = 1042 AND sn.is_read = false
ORDER BY n.created_at DESC;
```

### Indexes
```sql
CREATE INDEX idx_sn_student_id ON student_notifications(student_id);
CREATE INDEX idx_sn_is_read ON student_notifications(is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
```

### Indexing every column is a bad idea
Slows down writes, wastes disk space, confuses the query planner. Only index columns you actually filter or sort on.

### Students who got a Placement notification in last 7 days
```sql
SELECT DISTINCT s.id, s.name, s.email
FROM students s
JOIN student_notifications sn ON s.id = sn.student_id
JOIN notifications n ON sn.notification_id = n.id
WHERE n.type = 'Placement'
AND n.created_at >= NOW() - INTERVAL '7 days';
```

---

## Stage 4

### Problem
Fetching from DB on every page load is killing performance at scale.

### Fix — Redis Cache
- Cache each students notifications in Redis with 60s TTL
- Page load hits Redis first, DB only on cache miss
- Invalidate cache when a new notification arrives for that student

| Strategy | Pro | Con |
|---|---|---|
| Redis Cache | Fast reads, low DB load | Slight staleness |
| Pagination | Less data per query | Doesnt stop repeated DB hits |
| CDN | Good for static assets | Useless for personalized data |

---

## Stage 5

### Problem with current pseudocode
```
function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)
    save_to_db(student_id, message)
    push_to_app(student_id, message)
```

- If send_email fails at student 200, the rest never get notified
- No retry logic at all
- Email and DB can go out of sync
- Synchronous loop for 50k students is way too slow

### Better Approach — Message Queue
```
function notify_all(student_ids, message):
  for student_id in student_ids:
    save_to_db(student_id, message, status="pending")
    push_to_queue({ student_id, message })

worker:
  try:
    send_email(student_id, message)
    push_to_app(student_id, message)
    update_db(student_id, status="delivered")
  catch:
    retry 3 times with backoff
    if still failing: mark as failed, log it
```

DB save happens first always as the source of truth. Email is a side effect — if it fails we know exactly who to retry without losing any records.

---

## Stage 6

### Priority Inbox

Score per notification:
- Placement = 3, Result = 2, Event = 1
- Newer notifications get a higher recency bonus on top

Using a **min-heap of size N** to maintain top N at all times — O(M log N) instead of sorting the full list. When a new notification arrives, compare its score with the heap minimum and swap if it scores higher. Top N stays current without reprocessing everything.