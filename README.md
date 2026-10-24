# Zamio — ETF Student Portal

**Zamio** je moderna web platforma za evidenciju ocjena, bodova i prisustva studenata inspirisana klasičnim **Zamger** sistemom na **Elektrotehničkom fakultetu Univerziteta u Sarajevu (ETF Sarajevo)**.

Cilj aplikacije je zadržati prepoznatljivu i preglednu strukturu informacija starog Zamgera (prisustvo na vrhu, zatim zadaci, laboratorijske vježbe, parcijalni i završni ispiti, ukupni zbir bodova i kartica konačne ocjene), uz savremen, brz i responzivan korisnički interfejs te strogu kontrolu pristupa.

---

## 1. Pregled funkcionalnosti

### Studentski portal (samo čitanje vlastitih podataka)
- **Početna i Moji predmeti**: Brzi pregled svih upisanih predmeta, odgovornog nastavnika, osvojenih i maksimalnih bodova, procenta i statusa predmeta.
- **Ocjene i bodovi (Zamger struktura)**:
  1. **Prisustvo** (automatski obračun bodova na osnovu održanih termina)
  2. **Konfigurabilne kategorije** (npr. *Zadaci*, *Vježbe*, *I parcijalni ispit*, *II parcijalni ispit*, *Završni ispit*, *Ostalo*)
  3. **Pojedinačne stavke** sa datumima i povratnim komentarima nastavnika
  4. **Ukupno bodova** sa vizuelnom trakom napretka i prikazom skale ocjena (6–10)
  5. **Konačna ocjena** u posebnoj kartici (prikazuje se isključivo kada je zvanično zaključena i kada su ispunjeni pragovi predmeta)
- **Prisustvo po datumima**: Pregled održanih, otkazanih i budućih termina bez pogrešnog oduzimanja bodova za buduće ili otkazane časove.

### Profesorski portal
- **Moji predmeti**: Kreiranje novih predmeta i pregled statistike prolaznosti.
- **Studenti**: Tabela upisanih studenata sa pretragom po imenu ili broju indeksa, sortiranjem, filtriranjem, upisom novih studenata po broju indeksa, zaključivanjem ocjena (*Nacrt* / *Zaključena*) i **CSV eksportom**.
- **Evidencija bodova (Gradebook)**: Brzi tabelarni unos bodova i povratnih komentara direktno u redovima tabele bez otvaranja modala za svakog studenta pojedinačno, uz validaciju negativnih i prekoračenih bodova.
- **Prisustvo**: Kreiranje termina sa datumom i opcionim vremenom, opcija *"Označi sve prisutnim"*, brza pojedinačna korekcija prisustva i otkazivanje termina.
- **Postavke predmeta**: Konfiguracija maksimalnih bodova za prisustvo (podrazumijevano `10`), uključivanje/isključivanje praćenja prisustva, bonus bodova, kategorija ocjenjivanja i pragova za ocjene `6–10`.

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
4. Pokrenite automatske testove (obračun bodova, prisustva i sigurnosnih pravila) te provjeru tipova:
   ```bash
   npm test
   npm run lint
   npm run lint:rules
   ```

---

## 3. Postavljanje baze podataka i autentifikacije

Aplikacija u ovom okruženju koristi **Firebase Authentication (Google prijava)** i **Cloud Firestore** sa strogo tipiziranim pravilima pristupa (`firestore.rules`) i definicijom modela u `firebase-blueprint.json` (kao zamjenu za PostgreSQL / RLS sloj uz identičnu izolaciju po ulogama i dokumentima):

1. Kreirajte Firebase projekat i omogućite **Google Sign-In** u sekciji *Authentication -> Sign-in method*.
2. Kreirajte **Cloud Firestore** bazu podataka i upišite konfiguraciju klijenta u `firebase-applet-config.json`.
3. Objavite sigurnosna pravila iz `firestore.rules` (provjera sintakse se vrši putem `npm run lint:rules`).

### Struktura kolekcija i sigurnost
- `/userProfiles/{userId}` — Akademski profil bez ličnih kontakt podataka (ime, odsjek, broj indeksa, uloga).
- `/userPrivate/{userId}` — Strogo izolovani privatni podaci (`email`), čitljivi isključivo vlasniku naloga i administratoru.
- `/studentDirectory/{studentIndex}` — Imenik brojeva indeksa za siguran upis studenata na predmete.
- `/invitations/{inviteId}` — Kontrolisane jednokratne pozivnice za profesore.
- `/courses/{courseId}`, `/enrollments/{enrollmentId}`, `/gradingCategories/{categoryId}`, `/gradingItems/{itemId}`, `/scores/{scoreId}`, `/attendanceSessions/{sessionId}`, `/attendanceRecords/{recordId}`, `/finalGrades/{gradeId}`.

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
   - Svaki novi korisnik pri prvoj prijavi dobija ulogu `student` (isključivo pravo čitanja vlastitih zapisa).
   - Student na stranici **Profil** upisuje svoj **Broj indeksa** (npr. `18942`).
   - Predmetni profesor u sekciji **Studenti -> Upiši studenta** unosi broj indeksa i upisuje studenta na predmet.
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
   - Dodajte produkcijsku domenu (npr. `zamio.vercel.app`) u *Firebase Console -> Authentication -> Settings -> Authorized domains*.
