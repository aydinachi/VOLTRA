import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import {
  initializeTestEnvironment,
  assertFails,
  RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
} from 'firebase/firestore';

const rulesPath = path.resolve(process.cwd(), 'firestore.rules');
const rulesContent = fs.readFileSync(rulesPath, 'utf8');
const hasEmulator = Boolean(process.env.FIRESTORE_EMULATOR_HOST);

describe('Firestore Security Rules — Structural & Dirty Dozen Verification', () => {
  it('enforces rules_version 2, global default-deny, zero blanket reads, and zero get() inside allow list', () => {
    expect(rulesContent).toContain("rules_version = '2';");
    expect(rulesContent).toContain('match /{document=**}');
    expect(rulesContent).toContain('allow read, write: if false;');
    expect(rulesContent).not.toMatch(/allow\s+(read|list)\s*:\s*if\s+isSignedIn\(\)\s*;/);

    // Extract every allow list statement and verify get()/exists() are absent
    const listMatches = rulesContent.match(/allow\s+list\s*:[^;]+;/g) || [];
    expect(listMatches.length).toBeGreaterThanOrEqual(13);
    for (const listRule of listMatches) {
      expect(listRule).not.toContain('get(');
      expect(listRule).not.toContain('exists(');
    }
  });

  describe.runIf(hasEmulator)('Live Emulator Dirty Dozen Payloads', () => {
    let testEnv: RulesTestEnvironment;

    beforeAll(async () => {
      const [host, portStr] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
      testEnv = await initializeTestEnvironment({
        projectId: 'zamio-security-test',
        firestore: {
          rules: rulesContent,
          host,
          port: Number(portStr),
        },
      });

      await testEnv.withSecurityRulesDisabled(async (ctx) => {
        const db = ctx.firestore();
        const now = Timestamp.now();

        await setDoc(doc(db, 'userProfiles', 'prof_1'), {
          uid: 'prof_1',
          fullName: 'Prof. Samir Ribić',
          studentIndex: '',
          department: 'RI',
          role: 'professor',
          academicYear: '2026/2027',
          redeemedInviteId: '',
          isSeed: false,
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'userPrivate', 'stu_victim'), {
          uid: 'stu_victim',
          email: 'victim@etf.unsa.ba',
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'courses', 'crs_ar'), {
          code: 'OR-AR',
          name: 'Arhitektura računara',
          semester: 'Zimski semestar',
          academicYear: '2026/2027',
          ects: 6,
          leadProfessorId: 'prof_1',
          leadProfessorName: 'Prof. Samir Ribić',
          professorIds: ['prof_1'],
          categoryIds: ['cat_ar_1'],
          itemIds: ['item_ar1'],
          sessionIds: [],
          attendanceEnabled: true,
          attendanceMaxPoints: 10,
          allowBonusPoints: false,
          grade6Threshold: 55,
          grade7Threshold: 65,
          grade8Threshold: 75,
          grade9Threshold: 85,
          grade10Threshold: 95,
          isSeed: false,
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'enrollments', 'crs_ar_stu_1'), {
          courseId: 'crs_ar',
          courseCode: 'OR-AR',
          courseName: 'Arhitektura računara',
          leadProfessorName: 'Prof. Samir Ribić',
          academicYear: '2026/2027',
          studentId: 'stu_1',
          studentName: 'Haris Begović',
          studentIndex: '18942',
          studentDepartment: 'RI',
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'gradingCategories', 'cat_ar_1'), {
          courseId: 'crs_ar',
          name: 'Zadaci',
          maxPoints: 10,
          order: 1,
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'gradingItems', 'item_ar1'), {
          courseId: 'crs_ar',
          categoryId: 'cat_ar_1',
          name: 'Intel 386 MMU',
          maxPoints: 10,
          date: '2026-10-15',
          description: '',
          order: 1,
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'scores', 'item_ar1_stu_1'), {
          courseId: 'crs_ar',
          categoryId: 'cat_ar_1',
          itemId: 'item_ar1',
          studentId: 'stu_1',
          points: 8,
          feedback: '',
          gradedBy: 'prof_1',
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: now,
          updatedAt: now,
        });

        await setDoc(doc(db, 'finalGrades', 'crs_ar_stu_1'), {
          courseId: 'crs_ar',
          studentId: 'stu_1',
          totalPoints: 88,
          finalGrade: 9,
          status: 'finalized',
          finalizedBy: 'prof_1',
          comment: '',
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: now,
          updatedAt: now,
        });
      });
    });

    afterAll(async () => {
      if (testEnv) {
        await testEnv.cleanup();
      }
    });

    it('1. Rejects student self-promoting to professor on registration', async () => {
      const db = testEnv
        .authenticatedContext('stu_attacker', {
          email: 'attacker@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        setDoc(doc(db, 'userProfiles', 'stu_attacker'), {
          uid: 'stu_attacker',
          fullName: 'Attacker',
          studentIndex: '99999',
          department: 'RI',
          role: 'professor',
          academicYear: '2026/2027',
          redeemedInviteId: '',
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('2. Rejects professor escalating own role to admin', async () => {
      const db = testEnv
        .authenticatedContext('prof_1', {
          email: 'prof@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        updateDoc(doc(db, 'userProfiles', 'prof_1'), {
          role: 'admin',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('3. Rejects unverified bootstrap admin email spoof', async () => {
      const db = testEnv
        .authenticatedContext('spoof_uid', {
          email: 'aydinachi@gmail.com',
          email_verified: false,
        })
        .firestore();

      await assertFails(getDoc(doc(db, 'userPrivate', 'stu_victim')));
    });

    it('4. Rejects cross-student PII harvest on userPrivate', async () => {
      const db = testEnv
        .authenticatedContext('stu_attacker', {
          email: 'attacker@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(getDoc(doc(db, 'userPrivate', 'stu_victim')));
    });

    it('5. Rejects student modifying own score', async () => {
      const db = testEnv
        .authenticatedContext('stu_1', {
          email: 'stu1@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        updateDoc(doc(db, 'scores', 'item_ar1_stu_1'), {
          points: 10,
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('6. Rejects unassigned professor writing score to another course', async () => {
      const db = testEnv
        .authenticatedContext('prof_other', {
          email: 'other@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        updateDoc(doc(db, 'scores', 'item_ar1_stu_1'), {
          points: 9,
          gradedBy: 'prof_other',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('7. Rejects shadow field injection on score update', async () => {
      const db = testEnv
        .authenticatedContext('prof_1', {
          email: 'prof@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        updateDoc(doc(db, 'scores', 'item_ar1_stu_1'), {
          points: 9,
          gradedBy: 'prof_1',
          isVerifiedBonus: true,
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('8. Rejects negative score and overflow score when bonus disabled', async () => {
      const db = testEnv
        .authenticatedContext('prof_1', {
          email: 'prof@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        updateDoc(doc(db, 'scores', 'item_ar1_stu_1'), {
          points: -2,
          gradedBy: 'prof_1',
          updatedAt: serverTimestamp(),
        })
      );

      await assertFails(
        updateDoc(doc(db, 'scores', 'item_ar1_stu_1'), {
          points: 25,
          gradedBy: 'prof_1',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('9. Rejects unconstrained list scraping of scores by student', async () => {
      const db = testEnv
        .authenticatedContext('stu_1', {
          email: 'stu1@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(getDocs(collection(db, 'scores')));
    });

    it('10. Rejects mutating a finalized grade by non-admin professor (terminal state lock)', async () => {
      const db = testEnv
        .authenticatedContext('prof_1', {
          email: 'prof@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        updateDoc(doc(db, 'finalGrades', 'crs_ar_stu_1'), {
          finalGrade: 10,
          totalPoints: 96,
          finalizedBy: 'prof_1',
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('11. Rejects orphaned grading item referencing non-existent course', async () => {
      const db = testEnv
        .authenticatedContext('prof_1', {
          email: 'prof@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        setDoc(doc(db, 'gradingItems', 'item_orphan'), {
          courseId: 'missing_course',
          categoryId: 'cat_ar_1',
          name: 'Orphan',
          maxPoints: 10,
          date: '2026-10-20',
          description: '',
          order: 1,
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    });

    it('12. Rejects forged client timestamp and poisoned document ID', async () => {
      const db = testEnv
        .authenticatedContext('prof_1', {
          email: 'prof@etf.unsa.ba',
          email_verified: true,
        })
        .firestore();

      await assertFails(
        setDoc(doc(db, 'attendanceSessions', 'ses_forged'), {
          courseId: 'crs_ar',
          date: '2026-10-22',
          time: '10:00',
          topic: 'Forged time',
          isCancelled: false,
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: Timestamp.fromMillis(1577836800000),
          updatedAt: Timestamp.fromMillis(1577836800000),
        })
      );

      await assertFails(
        setDoc(doc(db, 'attendanceSessions', 'bad$id!'), {
          courseId: 'crs_ar',
          date: '2026-10-22',
          time: '10:00',
          topic: 'Bad ID',
          isCancelled: false,
          professorIds: ['prof_1'],
          isSeed: false,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
      );
    });
  });
});
