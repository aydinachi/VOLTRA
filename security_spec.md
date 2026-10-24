# Security Specification — Zamio (ETF Student Portal)

## 1. Data Invariants

1. **Default-Deny Catch-All**: All unspecified Firestore paths default to `allow read, write: if false;`.
2. **Email Verification Gate**: Every write operation requires `request.auth != null && request.auth.token.email_verified == true`.
3. **Self-Privilege Escalation Ban**:
   - Users registering `/userProfiles/{userId}` can only assign `role == 'student'` unless they are `isAdmin()` or atomically redeem a valid `pending` `/invitations/{inviteId}` matching their verified `request.auth.token.email` via `getAfter()`.
   - Professors can never elevate their own `role` to `'admin'`.
4. **PII Split-Collection Isolation**:
   - `/userProfiles/{userId}` stores zero PII (`email` is prohibited).
   - `/userPrivate/{userId}` isolates `email` and is readable strictly by `request.auth.uid == userId || isAdmin()`.
5. **Student Read-Only Enforcement**:
   - Students can read (`get`/`list`) only their own `/enrollments`, `/scores`, `/attendanceRecords`, and `/finalGrades` (`resource.data.studentId == request.auth.uid`), and can `get` `/courses`, `/gradingCategories`, `/gradingItems`, and `/attendanceSessions` strictly when enrolled (`exists(/databases/$(database)/documents/enrollments/$(courseId + '_' + request.auth.uid))`).
   - Students have zero write (`create`, `update`, `delete`) permissions on academic records (`courses`, `enrollments`, `gradingCategories`, `gradingItems`, `scores`, `attendanceSessions`, `attendanceRecords`, `finalGrades`).
6. **Course-Scoped Professor Authorization (Master Gate)**:
   - Professors can create, update, or delete academic records (`gradingCategories`, `gradingItems`, `scores`, `attendanceSessions`, `attendanceRecords`, `finalGrades`, `enrollments`) strictly for courses where `request.auth.uid in get(/databases/$(database)/documents/courses/$(courseId)).data.professorIds`.
7. **Zero-Lookup Secure List Queries**:
   - No `allow list` block contains `get()` or `exists()`, and no collection permits blanket `isSignedIn()` listing. Every `allow list` restricts `resource.data` directly against `request.auth.uid` or `isBootstrapAdmin()`.
8. **Score & Threshold Integrity**:
   - Scores disallow negative values (`points >= 0`) and enforce `points <= item.maxPoints` when `course.allowBonusPoints == false`.
   - Course thresholds strictly increase (`0 <= grade6 < grade7 < grade8 < grade9 < grade10 <= 200`).
9. **Terminal State Locking**:
   - Once `/finalGrades/{gradeId}` transitions to `status == 'finalized'`, further updates are rejected unless `isAdmin()`.
   - Once `/invitations/{inviteId}` transitions out of `status == 'pending'`, further updates are rejected unless `isAdmin()`.
10. **Temporal & Immutable Integrity**:
    - Every `create` requires `createdAt == request.time && updatedAt == request.time`.
    - Every `update` preserves immutable keys (`createdAt`, `courseId`, `studentId`, `uid`, `isSeed`) and requires `updatedAt == request.time`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Student Self-Promotes to Professor on Registration (Identity / RBAC Escalation)**
   - Path: `POST /userProfiles/stu_attacker`
   - Auth: `{ uid: 'stu_attacker', email: 'attacker@etf.unsa.ba', email_verified: true }`
   - Payload: `{ uid: 'stu_attacker', fullName: 'Malicious Student', studentIndex: '99999', department: 'RI', role: 'professor', academicYear: '2026/2027', redeemedInviteId: '', isSeed: false, createdAt: SERVER_TIME, updatedAt: SERVER_TIME }`
   - Expected: `PERMISSION_DENIED`

2. **Payload 2 — Professor Escalates Own Profile to Admin (Action-Branch Bypass)**
   - Path: `PATCH /userProfiles/prof_1`
   - Auth: `{ uid: 'prof_1', email: 'prof@etf.unsa.ba', email_verified: true }`
   - Payload: `{ role: 'admin', updatedAt: SERVER_TIME }`
   - Expected: `PERMISSION_DENIED`

3. **Payload 3 — Unverified Bootstrap Admin Email Spoof (Email Spoofing Attack)**
   - Path: `POST /courses/crs_spoof`
   - Auth: `{ uid: 'spoof_uid', email: 'aydinachi@gmail.com', email_verified: false }`
   - Payload: Valid `Course` object.
   - Expected: `PERMISSION_DENIED`

4. **Payload 4 — Cross-Student PII Harvest on `userPrivate` (PII Blanket Leak)**
   - Path: `GET /userPrivate/stu_victim`
   - Auth: `{ uid: 'stu_attacker', email: 'attacker@etf.unsa.ba', email_verified: true }`
   - Expected: `PERMISSION_DENIED`

5. **Payload 5 — Student Modifies Own Exam Score (Unauthorized Academic Write)**
   - Path: `PATCH /scores/item_exam1_stu_1`
   - Auth: `{ uid: 'stu_1', email: 'student1@etf.unsa.ba', email_verified: true }`
   - Payload: `{ points: 20, updatedAt: SERVER_TIME }`
   - Expected: `PERMISSION_DENIED`

6. **Payload 6 — Professor Modifies Score on Unassigned Course (Cross-Course Privilege Leak)**
   - Path: `POST /scores/item_ar1_stu_1`
   - Auth: `{ uid: 'prof_other', email: 'otherprof@etf.unsa.ba', email_verified: true }` (not in `crs_ar.professorIds`)
   - Payload: `{ courseId: 'crs_ar', categoryId: 'cat_ar_1', itemId: 'item_ar1', studentId: 'stu_1', points: 10, feedback: '', gradedBy: 'prof_other', professorIds: ['prof_other'], isSeed: false, createdAt: SERVER_TIME, updatedAt: SERVER_TIME }`
   - Expected: `PERMISSION_DENIED`

7. **Payload 7 — Shadow Field Injection on Score Update (Shadow Update Test)**
   - Path: `PATCH /scores/item_ar1_stu_1`
   - Auth: Assigned professor `prof_ar`
   - Payload: `{ points: 9, isVerifiedBonus: true, updatedAt: SERVER_TIME }`
   - Expected: `PERMISSION_DENIED`

8. **Payload 8 — Negative Score & Bonus-Disabled Overflow (Value Poisoning Test)**
   - Path: `PATCH /scores/item_ar1_stu_1` (where `maxPoints == 10` and `course.allowBonusPoints == false`)
   - Auth: Assigned professor `prof_ar`
   - Payload: `{ points: -5, updatedAt: SERVER_TIME }` and `{ points: 99, updatedAt: SERVER_TIME }`
   - Expected: `PERMISSION_DENIED`

9. **Payload 9 — Unconstrained List Scraping of All Student Scores (Query Trust Test)**
   - Path: `LIST /scores` (without `where('studentId', '==', 'stu_1')`)
   - Auth: `{ uid: 'stu_1', email: 'student1@etf.unsa.ba', email_verified: true }`
   - Expected: `PERMISSION_DENIED`

10. **Payload 10 — Mutating a Finalized Grade by Non-Admin Professor (Terminal State Locking)**
    - Path: `PATCH /finalGrades/crs_ar_stu_1` (existing `status == 'finalized'`)
    - Auth: Assigned professor `prof_ar` (non-admin)
    - Payload: `{ finalGrade: 10, totalPoints: 98, updatedAt: SERVER_TIME }`
    - Expected: `PERMISSION_DENIED`

11. **Payload 11 — Orphaned Grading Item Referencing Non-Existent Course (Relational Integrity)**
    - Path: `POST /gradingItems/item_orphan`
    - Auth: Assigned professor `prof_ar`
    - Payload: `{ courseId: 'non_existent_course', categoryId: 'cat_none', ... }`
    - Expected: `PERMISSION_DENIED`

12. **Payload 12 — Forged Client Timestamp & ID Poisoning (Temporal / Resource Poisoning)**
    - Path: `POST /attendanceSessions/bad..id$%` or forged `createdAt: Timestamp(2020-01-01)`
    - Auth: Assigned professor `prof_ar`
    - Expected: `PERMISSION_DENIED`

---

## 3. Automated Security Rule Verification

All 12 adversarial payloads are codified in `/firestore.rules.test.ts` using `@firebase/rules-unit-testing` and `vitest` (`assertFails`).
