# VOLTRA — ETF Student Portal

**VOLTRA** je moderna akademska web platforma za evidenciju ocjena, bodova, prisustva i prijave ispita na **Elektrotehničkom fakultetu Univerziteta u Sarajevu (ETF Sarajevo)**, inspirisana prepoznatljivom strukturom klasičnog **Zamger** sistema.

Cilj aplikacije je zadržati preglednu akademsku strukturu informacija (prisustvo na vrhu, zatim zadaci, laboratorijske vježbe, parcijalni i završni ispiti, ukupni zbir bodova i kartica konačne ocjene), uz savremen, brz i intuitivan korisnički interfejs za studente i nastavnike te strogu kontrolu pristupa.

---

## 1. Pregled funkcionalnosti

### Studentski portal
- **Pregled i bodovi**: Brzo prebacivanje između upisanih predmeta jednim klikom, pregled nastavnika, osvojenih i maksimalnih bodova, procenta, skale ocjena (`6–10`) i zaključene ocjene.
- **Prijava ispita**:
  - Pregled svih objavljenih parcijalnih i završnih ispitnih rokova na upisanim predmetima (termin ispita, sala, datum početka prijave i datum isteka prijave).
  - Prijava izlaska na ispit (*Prijavi ispit*) ili odjava izlaska (*Ne izlazim* / *Odjavi prijavu*) jednim klikom dok je rok za prijavu otvoren.
- **Prisustvo po datumima**: Automatski obračun bodova za prisustvo na osnovu održanih termina bez pogrešnog oduzimanja bodova za buduće ili otkazane časove.
- **Zadaci i vježbe**: Filtrirani pregled svih pojedinačnih stavki ocjenjivanja i komentara predmetnog nastavnika.

### Profesorski portal
- **Predmeti**: Kreiranje novih predmeta i trenutni uvid u broj upisanih studenata, izlaznost na predstojeći ispit i prolaznost.
- **Prijava ispita**:
  - Objavljivanje termina ispita (naziv roka, datum i vrijeme ispita, sala/amfiteatar, datum početka prijave i datum isteka prijave).
  - Praćenje izlaznosti uživo (*Izlaze na ispit*, *Odjavili izlazak*, *Bez odgovora*), ručno zaključavanje/otključavanje prijava i **CSV eksport spiska za ispitnu salu**.
- **Unos bodova**: Brzi tabelarni unos bodova i komentara direktno u redovima tabele uz validaciju negativnih i prekoračenih bodova.
- **Prisustvo**: Kreiranje termina, opcija *"Označi sve prisutnim"*, brza pojedinačna korekcija i otkazivanje termina.
- **Studenti i ocjene**: Pretraga, filtriranje i sortiranje studenata, upis po broju indeksa, zaključivanje ocjena (*Nacrt* / *Zaključena*) i **CSV eksport ocjena**.
- **Postavke predmeta**: Konfiguracija maksimalnih bodova za prisustvo (podrazumijevano `10`), kategorija ocjenjivanja i pragova za ocjene `6–10`.

---

## 2. Instalacija i lokalni razvoj

### Preduslovi
- **Node.js** `v20+`
- **npm** ili **bun**

### Koraci za pokretanje
1. Klonirajte repozitorij i instalirajte zavisnosti:
   ```bash
   npm install
   ```
2. Kopirajte `.env.example` u `.env`:
   ```bash
   cp .env.example .env
   ```
3. Pokrenite razvojni server (port `3000`):
   ```bash
   npm run dev
   ```
4. Pokrenite automatske testove (obračun bodova, prisustva, rokova za prijavu ispita i sigurnosnih pravila) te provjeru tipova:
   ```bash
   npm test
   npm run lint
   npm run lint:rules
   ```

---

## 3. Postavljanje baze podataka i autentifikacije

Aplikacija koristi **Firebase Authentication (Google prijava)** i **Cloud Firestore** sa strogo tipiziranim pravilima pristupa (`firestore.rules`) i definicijom modela u `firebase-blueprint.json`:

1. Kreirajte Firebase projekat i omogućite **Google Sign-In** u sekciji *Authentication -> Sign-in method*.
2. Kreirajte **Cloud Firestore** bazu podataka i upišite konfiguraciju klijenta u `firebase-applet-config.json`.
3. Objavite sigurnosna pravila iz `firestore.rules` (provjera sintakse se vrši putem `npm run lint:rules`).

### Struktura kolekcija i sigurnost
- `/userProfiles/{userId}` — Akademski profil bez ličnih kontakt podataka (ime, odsjek, broj indeksa, uloga).
- `/userPrivate/{userId}` — Strogo izolovani privatni podaci (`email`), čitljivi isključivo vlasniku naloga i administratoru.
- `/studentDirectory/{studentIndex}` — Imenik brojeva indeksa za siguran upis studenata na predmete.
- `/invitations/{inviteId}` — Kontrolisane jednokratne pozivnice za profesore.
- `/courses/{courseId}`, `/enrollments/{enrollmentId}`, `/gradingCategories/{categoryId}`, `/gradingItems/{itemId}`, `/scores/{scoreId}`, `/attendanceSessions/{sessionId}`, `/attendanceRecords/{recordId}`, `/finalGrades/{gradeId}`.
- `/examTerms/{termId}` — Objavljeni ispitni rokovi sa datumom početka i isteka prijave.
- `/examRegistrations/{registrationId}` — Pojedinačne prijave i odjave izlaska studenata na ispite (`${termId}_${studentId}`).

---

## 4. Kreiranje prvog administratora, profesora i studenata

1. **Prvi administrator**:
   - Inicijalni administrator je definisan u `firestore.rules` (`isBootstrapAdmin()`) i u `src/lib/firebase.ts` (`BOOTSTRAP_ADMIN_EMAIL`) uz obaveznu provjeru `email_verified == true`.
   - Dodatni administratori se mogu evidentirati u kolekciji `/admins/{uid}`.
2. **Dodjela profesorske uloge (Kontrolisane pozivnice)**:
   - Korisnici **ne mogu** sami sebi dodijeliti ulogu profesora niti administratora.
   - Administrator na stranici **Profil** unosi e-mail adresu nastavnika i generiše jednokratni kod pozivnice (npr. `INV-ETF-XXXXXX`).
   - Nastavnik se prijavljuje svojim verifikovanim Google računom i na stranici **Profil** unosi kod pozivnice, čime se atomskom transakcijom (`writeBatch` + `getAfter` pravilo) njegov nalog unapređuje u ulogu `professor`.
3. **Kreiranje studentskih naloga i upis na predmete**:
   - Svaki novi korisnik pri prvoj prijavi dobija ulogu `student`.
   - Student na stranici **Profil** upisuje svoj **Broj indeksa** (npr. `18942`).
   - Predmetni profesor u sekciji **Studenti i ocjene -> Upiši studenta** unosi broj indeksa i upisuje studenta na predmet.
4. **Razvojni (seed) podaci**:
   - Svi razvojni demo zapisi nose oznaku `isSeed: true` i potpuno su odvojeni od produkcijskih podataka. Administrator ih može jednim klikom učitati ili obrisati na stranici **Profil**.

---

## 5. Produkcijska objava (Vercel / Cloud Run)

1. Provjerite da projekat prolazi build bez TypeScript grešaka:
   ```bash
   npm run build
   ```
2. Na **Vercel** platformi:
   - Povežite Git repozitorij.
   - Build komanda: `npm run build`
   - Output direktorij: `dist`
   - Dodajte produkcijsku domenu (npr. `voltra-etf.vercel.app`) u *Firebase Console -> Authentication -> Settings -> Authorized domains*.
