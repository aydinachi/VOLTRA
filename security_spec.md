# Security Specification — VOLTRA (ETF Student Portal)

## 1. Data Invariants

1. **Default-Deny Catch-All**: All unspecified Firestore paths default to `allow read, write: if false;`.
2. **Email Verification & Admin-Provisioned Account Gate**:
   - Every rule that evaluates `request.auth.token.email` (`isBootstrapAdmin()`, `/invitations`, `/provisionedAccounts`, `/userPrivate` email match, and self-registration) strictly requires `request.auth.token.email_verified == true` (`isVerified()`).
   - UID/role-based academic operations accept `isAuthorizedUser()` (`isVerified() || isAdminProvisionedUser()`), where `provisionedByAdmin == true` on `/userProfiles/{uid}` is a system-restricted boolean settable ONLY by `isAdmin()`.
3. **Self-Privilege Escalation Ban & Student Faculty-Field Locking**:
   - Users registering `/userProfiles/{userId}` can only assign `role == 'student'` unless `isAdmin()` or atomically redeeming a valid `pending` `/invitations/{inviteId}` or `/provisionedAccounts/{provId}` matching their verified `request.auth.token.email` via `getAfter()`.
   - **Student Profile Locking**: Students (`existing().role == 'student'`) can ONLY modify `['personalNote', 'notificationPrefs', 'updatedAt']` on `/userProfiles/{userId}` and `['phone', 'updatedAt']` on `/userPrivate/{userId}`. Faculty-assigned fields (`fullName`, `studentIndex`, `department`, `studyTrack`, `studyYear`, `academicYear`, `role`) are strictly locked for students.
   - **Professor Profile Freedom**: Professors (`existing().role == 'professor'`) can update their academic and office profile fields (`fullName`, `department`, `academicYear`, `academicTitle`, `officeLocation`, `consultationHours`, `personalNote`, `notificationPrefs`, `updatedAt`), while `role` and `provisionedByAdmin` remain locked.
4. **PII Split-Collection Isolation**:
   - `/userProfiles/{userId}` stores zero PII (`email` and `phone` are prohibited).
   - `/userPrivate/{userId}` isolates `email` and `phone`, readable strictly by `request.auth.uid == userId || isAdmin()`.
5. **Administrator-Only Announcements & Academic State**:
   - `/announcements/{announcementId}` can ONLY be created, updated, or deleted by `isAdmin()`. Students and Professors have read-only access strictly to published announcements (`resource.data.isPublished == true`).
   - `/academicState/{stateId}` and `/provisionedAccounts/{provId}` writes are strictly restricted to `isAdmin()` (except verified target email claiming their own `/provisionedAccounts/{provId}`).
6. **Student Read-Only Academic Records & Scoped Exam Self-Registration**:
   - Students can read (`get`/`list`) only their own `/enrollments`, `/scores`, `/attendanceRecords`, `/finalGrades`, and `/examRegistrations` (`resource.data.studentId == request.auth.uid`), and can `get` `/courses`, `/gradingCategories`, `/gradingItems`, `/attendanceSessions`, `/examTerms`, and `/scheduleEvents` strictly when enrolled (`isEnrolledStudent(courseId)`), including archived past-semester enrollments.
   - Students have zero write permissions on `courses`, `enrollments`, `gradingCategories`, `gradingItems`, `scores`, `attendanceSessions`, `attendanceRecords`, `finalGrades`, `examTerms`, `scheduleEvents`, `announcements`, and `academicState`.
7. **Course-Scoped Professor Authorization (Master Gate)**:
   - Professors can create, update, or delete academic records (`gradingCategories`, `gradingItems`, `scores`, `attendanceSessions`, `attendanceRecords`, `finalGrades`, `enrollments`, `examTerms`, `examRegistrations`, `scheduleEvents`) strictly for courses where `request.auth.uid in get(/databases/$(database)/documents/courses/$(courseId)).data.professorIds`.
8. **Zero-Lookup Secure List Queries**:
   - Zero `allow list` blocks contain `get()` or `exists()`, and zero collections permit blanket `isSignedIn()` listing. Every `allow list` restricts `resource.data` directly (`studentId`, `professorIds`, `isPublished == true`, or `isBootstrapAdmin()`).
9. **Score, Threshold & Exam Chronology Integrity**:
   - Scores disallow negative values (`points >= 0`) and enforce `points <= item.maxPoints` when `course.allowBonusPoints == false`.
   - Course thresholds strictly increase (`0 <= grade6 < grade7 < grade8 < grade9 < grade10 <= 200`).
   - Published exam terms enforce chronological dates (`registrationOpenDate <= registrationCloseDate && registrationCloseDate <= examDate`).
10. **Terminal State & Temporal Integrity**:
    - Once `/finalGrades/{gradeId}` transitions to `status == 'finalized'`, further updates are rejected unless `isAdmin()`.
    - Every `create` requires `createdAt == request.time && updatedAt == request.time`, and every `update` preserves immutable keys and requires `updatedAt == request.time`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 1 — Student Self-Promotes to Professor on Registration (Identity / RBAC Escalation)**
   - Path: `POST /userProfiles/stu_attacker` -> `PERMISSION_DENIED`
2. **Payload 2 — Professor Escalates Own Profile to Admin & Student Mutates Locked Faculty Fields (`studentIndex` / `studyTrack`)**
   - Path: `PATCH /userProfiles/prof_1` (`role: 'admin'`) and `PATCH /userProfiles/stu_1` (`studentIndex: '99999'`, `studyTrack: 'Master · Telekomunikacije'`) -> `PERMISSION_DENIED`
3. **Payload 3 — Unverified Bootstrap Admin Email Spoof (Email Spoofing Attack)**
   - Path: `GET /userPrivate/stu_victim` with `{ email: 'aydinachi@gmail.com', email_verified: false }` -> `PERMISSION_DENIED`
4. **Payload 4 — Cross-Student PII Harvest on `userPrivate` (`email` + `phone`)**
   - Path: `GET /userPrivate/stu_victim` as `stu_attacker` -> `PERMISSION_DENIED`
5. **Payload 5 — Student Modifies Own Exam Score or Publishes Official Announcement**
   - Path: `PATCH /scores/item_ar1_stu_1` and `POST /announcements/ann_fake` as `stu_1` -> `PERMISSION_DENIED`
6. **Payload 6 — Professor Modifies Score on Unassigned Course or Publishes Official Announcement**
   - Path: `PATCH /scores/item_ar1_stu_1` as `prof_other` and `POST /announcements/ann_prof` as `prof_1` -> `PERMISSION_DENIED`
7. **Payload 7 — Shadow Field Injection on Score Update**
   - Path: `PATCH /scores/item_ar1_stu_1` with `{ isVerifiedBonus: true }` -> `PERMISSION_DENIED`
8. **Payload 8 — Negative Score & Bonus-Disabled Overflow**
   - Path: `PATCH /scores/item_ar1_stu_1` with `points: -2` and `points: 25` -> `PERMISSION_DENIED`
9. **Payload 9 — Unconstrained List Scraping of Student Scores or Unpublished Announcements**
   - Path: `LIST /scores` and unconstrained `LIST /announcements` -> `PERMISSION_DENIED`
10. **Payload 10 — Mutating a Finalized Grade by Non-Admin Professor (Terminal State Locking)**
    - Path: `PATCH /finalGrades/crs_ar_stu_1` -> `PERMISSION_DENIED`
11. **Payload 11 — Orphaned Grading Item Referencing Non-Existent Course**
    - Path: `POST /gradingItems/item_orphan` -> `PERMISSION_DENIED`
12. **Payload 12 — Forged Client Timestamp, ID Poisoning & Locked Exam Registration**
    - Path: `POST /attendanceSessions/ses_forged`, `POST /attendanceSessions/bad$id!`, `POST /examRegistrations/term_locked_stu_1` -> `PERMISSION_DENIED`

---

## 3. Automated Security Rule Verification

All adversarial payloads and structural invariants are codified in `/firestore.rules.test.ts` using `@firebase/rules-unit-testing` and `vitest`.
