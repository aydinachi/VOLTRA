# VOLTRA --- ETF Student Portal

**VOLTRA** is a modern academic web platform for managing grades,
points, attendance, and exam registrations at the **Faculty of
Electrical Engineering, University of Sarajevo (ETF Sarajevo)**. Its
design is inspired by the familiar structure of the classic **Zamger**
system.

The goal of the application is to preserve a clear and intuitive
academic information structure (attendance at the top, followed by
assignments, laboratory exercises, midterm and final exams, total
points, and a final grade card), while providing students and professors
with a modern, fast, and intuitive user interface backed by strict
access control.

------------------------------------------------------------------------

## 1. Feature Overview

### Student Portal

-   **Grades and Points Overview**: Quickly switch between enrolled
    courses with a single click and view course instructors, earned and
    maximum points, percentages, the grading scale (`6–10`), and final
    grades.
-   **Exam Registration**:
    -   View all published midterm and final exam sessions for enrolled
        courses, including exam time, room, registration start date, and
        registration deadline.
    -   Register for an exam (*Register for Exam*) or cancel a
        registration (*Not Attending* / *Cancel Registration*) with a
        single click while the registration period is open.
-   **Attendance Tracking by Date**: Automatically calculates attendance
    points based on completed class sessions, without incorrectly
    deducting points for future or cancelled sessions.
-   **Assignments and Exercises**: Filtered overview of individual
    grading items and comments provided by course instructors.

### Professor Portal

-   **Course Management**: Create new courses and instantly view the
    number of enrolled students, upcoming exam attendance, and pass
    rates.
-   **Exam Registration**:
    -   Publish exam sessions, including the exam name, date and time,
        room/amphitheater, registration start date, and registration
        deadline.
    -   Monitor exam attendance in real time (*Registered*, *Cancelled*,
        *No Response*), manually open or close registrations, and
        **export exam attendance lists as CSV files**.
-   **Grade Management**: Quickly enter points and comments directly
    into table rows, with validation to prevent negative scores and
    scores exceeding the maximum allowed points.
-   **Attendance Management**: Create attendance sessions, use the *Mark
    All as Present* option, make individual attendance corrections, and
    cancel sessions.
-   **Student and Grade Management**: Search, filter, and sort students,
    enroll students using their student ID numbers, finalize grades
    (*Draft* / *Finalized*), and **export grades as CSV files**.
-   **Course Settings**: Configure maximum attendance points (default:
    `10`), grading categories, and grade thresholds for grades `6–10`.

------------------------------------------------------------------------

## 2. Installation and Local Development

### Prerequisites

-   **Node.js** `v20+`
-   **npm** or **bun**

### Getting Started

1.  Clone the repository and install dependencies:

    ``` bash
    npm install
    ```

2.  Copy `.env.example` to `.env`:

    ``` bash
    cp .env.example .env
    ```

3.  Start the development server (port `3000`):

    ``` bash
    npm run dev
    ```

4.  Run the automated tests (covering point calculations, attendance,
    exam registration periods, and security rules) and type checks:

    ``` bash
    npm test
    npm run lint
    npm run lint:rules
    ```

------------------------------------------------------------------------

## 3. Database and Authentication Setup

The application uses **Firebase Authentication (Google Sign-In)** and
**Cloud Firestore**, with strictly typed access control rules
(`firestore.rules`) and a data model definition in
`firebase-blueprint.json`.

1.  Create a Firebase project and enable **Google Sign-In** under
    *Authentication -\> Sign-in method*.
2.  Create a **Cloud Firestore** database and add the client
    configuration to `firebase-applet-config.json`.
3.  Deploy the security rules from `firestore.rules` (syntax validation
    is performed using `npm run lint:rules`).

### Collection Structure and Security

-   `/userProfiles/{userId}` --- Academic profile without personal
    contact information (name, department, student ID, role).
-   `/userPrivate/{userId}` --- Strictly isolated private data
    (`email`), accessible only to the account owner and administrators.
-   `/studentDirectory/{studentIndex}` --- Directory of student ID
    numbers used for secure course enrollment.
-   `/invitations/{inviteId}` --- Controlled, single-use invitations for
    professors.
-   `/courses/{courseId}`, `/enrollments/{enrollmentId}`,
    `/gradingCategories/{categoryId}`, `/gradingItems/{itemId}`,
    `/scores/{scoreId}`, `/attendanceSessions/{sessionId}`,
    `/attendanceRecords/{recordId}`, `/finalGrades/{gradeId}`.
-   `/examTerms/{termId}` --- Published exam sessions with registration
    start dates and deadlines.
-   `/examRegistrations/{registrationId}` --- Individual student exam
    registrations and cancellations (`${termId}_${studentId}`).

------------------------------------------------------------------------

## 4. Setting Up the First Administrator, Professors, and Students

1.  **Initial Administrator**:
    -   The initial administrator is defined in `firestore.rules`
        (`isBootstrapAdmin()`) and `src/lib/firebase.ts`
        (`BOOTSTRAP_ADMIN_EMAIL`), with a mandatory
        `email_verified == true` check.
    -   Additional administrators can be registered in the
        `/admins/{uid}` collection.
2.  **Assigning Professor Roles (Controlled Invitations)**:
    -   Users **cannot** assign themselves the professor or
        administrator role.
    -   On the **Profile** page, an administrator enters the professor's
        email address and generates a single-use invitation code
        (e.g. `INV-ETF-XXXXXX`).
    -   The professor signs in using their verified Google account and
        enters the invitation code on the **Profile** page. Their
        account is then upgraded to the `professor` role through an
        atomic transaction (`writeBatch` + `getAfter` rule).
3.  **Creating Student Accounts and Enrolling in Courses**:
    -   Every new user is automatically assigned the `student` role upon
        their first sign-in.
    -   Students enter their **Student ID Number** (e.g. `18942`) on the
        **Profile** page.
    -   The course professor enters the student's ID number under
        **Students and Grades -\> Enroll Student** to enroll them in the
        course.
4.  **Development (Seed) Data**:
    -   All development demo records are marked with `isSeed: true` and
        are completely separated from production data. Administrators
        can load or delete them with a single click on the **Profile**
        page.

------------------------------------------------------------------------

## 5. Production Deployment (Vercel / Cloud Run)

1.  Make sure the project builds successfully without TypeScript errors:

    ``` bash
    npm run build
    ```

2.  On the **Vercel** platform:

    -   Connect your Git repository.
    -   Build command: `npm run build`
    -   Output directory: `dist`
    -   Add your production domain (e.g. `voltra-etf.vercel.app`) under
        *Firebase Console -\> Authentication -\> Settings -\> Authorized
        domains*.
