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

**PATCH** `/api/notifications/:notificationId/read`
```json
{ "message": "marked as read", "notificationId": "uuid" }
```

**POST** `/api/notifications`
```json
{
  "type": "Placement",
  "message": "Amazon hiring drive on May 5th",
  "targetStudents": ["all"]
}
```
Response: `{ "message": "notification queued", "notificationId": "uuid" }`

**GET** `/api/notifications/:studentId/unread-count`
Response: `{ "unreadCount": 5 }`

**DELETE** `/api/notifications/:notificationId`
Response: `{ "message": "notification removed" }`

### Real-Time Mechanism
WebSockets via Socket.io. Student joins a personal room on login, server pushes notifications to that room instantly. SSE as fallback.

---

## Stage 2

### Database — PostgreSQL
Fixed structure, needs joins and filters regularly, native enum support for notification types. PostgreSQL fits well here.

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

### Key Queries

```sql
-- get all notifications for a student
SELECT n.id, n.type, n.message, sn.is_read, n.created_at
FROM notifications n
JOIN student_notifications sn ON n.id = sn.notification_id
WHERE sn.student_id = $1
ORDER BY n.created_at DESC;

-- mark as read
UPDATE student_notifications
SET is_read = true, read_at = NOW()
WHERE notification_id = $1 AND student_id = $2;

-- unread count
SELECT COUNT(*) as unread_count
FROM student_notifications
WHERE student_id = $1 AND is_read = false;
```

### Scaling Issues
50k students x 100 notifications = 5M rows fast. No indexes means full scans. Bulk inserts for everyone at once will choke the DB. Fix: indexes, date partitioning, message queue for bulk sends.

---

## Stage 3

### Slow Query
```sql
SELECT * FROM notifications
WHERE studentID = 1042 AND isRead = false
ORDER BY createdAt DESC;
```
`SELECT *` is wasteful, no indexes on `studentID` or `isRead`, full table scan on millions of rows.

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

Indexing every column is bad — hurts write performance, wastes storage, confuses the query planner. Only index what you filter or sort on.

### Placement notifications in last 7 days
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
Every page load hits the DB. At 50k students this breaks down quickly.

### Fix — Redis Cache
First load fetches from DB and caches in Redis with 60s TTL. Subsequent loads hit Redis. Cache clears when a new notification arrives for that student.

| Strategy | Pro | Con |
|---|---|---|
| Redis Cache | Fast, low DB load | Slight staleness |
| Pagination | Less data per query | Doesnt fix repeated hits |
| CDN | Good for static | Useless for personalized data |

---

## Stage 5

### Problem
```
function notify_all(student_ids, message):
  for student_id in student_ids:
    send_email(student_id, message)
    save_to_db(student_id, message)
    push_to_app(student_id, message)
```
Email fails at student 200 → rest never notified. No retries. Synchronous loop over 50k is too slow.

### Fix — Message Queue
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
    if still failing: mark failed, log it
```
DB write first always. Email failure = retry that student only, no records lost.

---

## Stage 6

### Priority Inbox
Scores: Placement=3, Result=2, Event=1 + small recency bonus for newer ones.

Min-heap of size N tracks top N at all times. Each new notification compares against heap minimum — if it scores higher, minimum gets dropped and new one goes in. O(M log N), no full list sorting needed.