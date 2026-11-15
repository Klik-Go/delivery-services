# Demo accounts and data: reference

Every account, store and rider for local development and hosted demos, how each one signs in, and
what data comes with it.

- **Everyone here is invented.** Names, phone numbers, plates, payout names and KYC files are
  placeholders. None of them is a real person's data.
- **This file holds no secrets.** The local code `123456` is the Supabase CLI's local test fixture
  (`supabase/config.toml`) and works on your machine only. Hosted codes and passwords are chosen by
  the owner and live only in Vercel or Supabase settings. Never write them here.
- Phone numbers are shown as `+63 917 000 xxxx`. Type them as `0917 000 xxxx` or `+639170000xxx`.

## 1. How each role signs in

| Role | Sign-in page | On your machine | On the hosted app |
| --- | --- | --- | --- |
| Customer | `/auth/sign-in` (phone + code) | A seeded customer's number (§2.1) and code `123456` | Any Philippine mobile and the placeholder code (`PLACEHOLDER_OTP_CODE` in Vercel, Q20) |
| Rider | `/auth/sign-in` (phone + code), then `/rider` | A seeded or demo rider's number (§2.1, §4) and code `123456` | A demo rider's number after you add it as a Supabase test number (§4.2). The placeholder code never works for riders |
| Store owner / staff | `/auth/staff` (email + password + authenticator app) | `pnpm seed:staff-link` for a seeded owner (§2.1), or be the demo stores' owner (§3) | The demo stores' owner: the email you gave **Load demo data** (§3) |
| Coordinator | `/auth/staff` | `pnpm seed:staff-link` for Cora Coordinator (§2.1) | Invite from `/admin/staff`, scoped to a zone |
| Admin | `/auth/staff`, then `/admin` | `pnpm seed:staff-link` for Ada Admin (§2.1) | **Bootstrap first admin** workflow (one-time link) |

Staff accounts always need a password **and** an authenticator app (TOTP, AAL2). The first sign-in
from a one-time link asks for both. Customers and riders never have passwords.

## 2. Local seed (`supabase/seed.sql`)

`pnpm db:reset` loads this seed into the local database. The hosted database never gets it. Every
person and store is in **Makati City**. Fixed ids look like `5eed0000-…`.

### 2.1 People

| Name | Role | Signs in with | What they have |
| --- | --- | --- | --- |
| Ada Admin | Admin (all zones) | `admin@seed.klikgo.test` | Whole console: zones, stores, riders, settings, staff |
| Cora Coordinator | Coordinator, Makati | `coordinator@seed.klikgo.test` | Makati's ops map, order board, rider KYC queue |
| Nena Santos | Store owner | `nena@seed.klikgo.test` | Aling Nena's Karinderya |
| Kiko Reyes | Store owner | `kiko@seed.klikgo.test` | Kape't Tinapay |
| Juan Dizon | Store owner | `juan@seed.klikgo.test` | Milk Tea ni Juan |
| Sol Garcia | Store owner | `sol@seed.klikgo.test` | Silog Express |
| Mila Cruz | Store owner | `mila@seed.klikgo.test` | Merienda Corner |
| Sam Staff | Store staff | `sam@seed.klikgo.test` | Staff member at Aling Nena's Karinderya |
| Rico Rider | Rider, approved, online | `+63 917 000 0021`, code `123456` | Motorcycle `NAB 1234`, parked near Aling Nena's |
| Rosa Rider | Rider, approved, online | `+63 917 000 0022`, code `123456` | Motorcycle `NAC 5678`, parked near Kape't Tinapay |
| Rey Rider | Rider, waiting for KYC | `+63 917 000 0023`, code `123456` | Tricycle `TRY 9012`, no documents sent yet |
| Carmen Customer | Customer | `+63 917 000 0031`, code `123456` | Home: P. Burgos St., Poblacion ("beside the sari-sari store with a blue gate") |
| Diego Customer | Customer | `+63 917 000 0032`, code `123456` | Office: Pasay Road, San Lorenzo ("across the barangay hall") |
| Liza Customer | Customer | `+63 917 000 0033`, code `123456` | Home: Singkamas ("near the chapel, green house") |

Seeded staff have **no password**. To sign in as one on your machine:

```bash
STAFF_EMAIL=nena@seed.klikgo.test pnpm seed:staff-link
```

Open the printed link, set a password, scan the QR code with an authenticator app, and you are in.
The script works only against the local Supabase stack and only for staff accounts. It needs
`NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from
`pnpm exec supabase status -o env`. Staff profiles also have phone numbers
(`+63 917 000 0001` … `0016`), but staff never sign in by phone.

### 2.2 Stores, fees, promos

| Store | Owner | Menu (prices in pesos) |
| --- | --- | --- |
| Aling Nena's Karinderya | Nena (+ Sam as staff) | Adobong Manok 95, Sinigang na Baboy 120, Pinakbet 85, Extra Rice 20, Leche Flan 45 |
| Kape't Tinapay | Kiko | Pandesal ×10 40, Ensaymada 35, Spanish Bread ×5 45, Kapeng Barako 60, Iced Coffee 75 |
| Milk Tea ni Juan | Juan | Wintermelon 90, Okinawa 95, Taro 95, Brown Sugar 110 (Large +15, add-ons +10) |
| Silog Express | Sol | Tapsilog 110, Longsilog 95, Tocilog 95, Bangsilog 120 |
| Merienda Corner | Mila | Turon ×3 45, Banana Cue 30, Lumpiang Shanghai ×10 80, Pancit Canton 90, Halo-halo 110 |

- **Hours** (Manila time): Mon–Fri 10:00–14:00 and 17:00–21:00; Sat–Sun 10:00–21:00. Every store
  takes cash on delivery and has a 15-minute default prep time.
- **Commission**: 20%, waived for the first 90 days (founding partners).
- **Makati delivery fees**: ₱39 up to 2 km, ₱49 for 2–4 km, ₱59 beyond, plus ₱20 on orders under ₱150.
- **Promo codes**: `KAINTAYO` (₱50 off orders of ₱300+) and `LIBREHATID` (free delivery on ₱200+).
- **Feature flags**: `sms_fallback` on; `pabili_mode` and `merchant_auto_accept` off.

### 2.3 Numbers kept for automated tests

`+63 917 000 0101` … `0114` (code `123456`) belong to the Cucumber and Playwright suites, which
create and reset those accounts. Don't use them for demos.

## 3. Demo stores (`pnpm demo:data`, workflow **Load demo data**)

Nine open stores with full menus in the three launch zones. They are for the hosted app, but they
work locally too. Details and the customer/store walkthrough are in `docs/OPEN_QUESTIONS.md` Q28.

| Zone | Stores |
| --- | --- |
| Makati City | Lutong Bahay ni Lola Ising, Kape at Pandesal Salcedo, Inasal Grill Poblacion |
| San Fernando, Pampanga | Kusinang Kapampangan, Tibok-Tibok at Kakanin, Pancit at Lomi House |
| San Marcelino, Zambales | Mangga ng Zambales, Pares at Mami ni Mang Lito, Sari-Sari Plus San Marcelino (grocery) |

- **Owner**: one account manages all nine stores. It is the email you give the workflow
  (`owner_email`) or `DEMO_OWNER_EMAIL` locally. A new owner gets a one-time link to set a
  password and enrol an authenticator app. Later, sign in at `/auth/staff`.
- **Hours**: 6:00–23:00 daily, cash on delivery.
- **Promo codes**: `DEMOKAIN` (₱50 off ₱300+), `DEMOHATID` (free delivery on ₱200+), `DEMO10`
  (10% off up to ₱60 on ₱150+).
- **Delivery fees** (only zones that had none): ₱39 / ₱49 / ₱59 (₱69 beyond 4 km in San
  Marcelino), ₱20 small-order fee under ₱150.
- **Remove**: action `hide` suspends the stores and switches the codes off. History is kept.

## 4. Demo riders (`pnpm demo:riders`, workflow **Load demo riders**)

Ten invented riders across the three zones, parked a few hundred metres from the demo stores. Data
lives in `scripts/demo/demo-riders.ts`. Fixed ids look like `de400000-…`.

### 4.1 Riders

| Phone | Name | Zone | Vehicle | State after `load` | Rating | Shows |
| --- | --- | --- | --- | --- | --- | --- |
| +63 917 000 0901 | Andoy Villanueva | Makati | Motorcycle `NDA 1101` | Approved, **online** | 4.8 (42) | Job offers near Lutong Bahay ni Lola Ising |
| +63 917 000 0902 | Bea Manalo | Makati | Bicycle | Approved, offline | 4.6 (18) | Going online from the rider app |
| +63 917 000 0903 | Carlo Bautista | Makati | Motorcycle `NDC 3303` | Approved, **online** | 3.2 (6) | Riders → **Coaching** list (below 3.5 with 5+ ratings) |
| +63 917 000 0904 | Dina Ramos | Makati | Motorcycle `NDD 4404` | **Waiting for KYC** | none | Government ID already accepted, 4 documents to review |
| +63 917 000 0905 | Edwin Castro | Makati | Tricycle `TRE 5505` | **Suspended** | 3.9 (14) | The suspension reason, then **Reactivate** |
| +63 917 000 0906 | Faye Mercado | San Fernando | Motorcycle `PMF 6606` | Approved, **online** | 4.9 (27) | Offers near Kusinang Kapampangan |
| +63 917 000 0907 | Gilbert Lansangan | San Fernando | Tricycle `PMG 7707` | Approved, **online** | 4.7 (11) | Offers near Tibok-Tibok at Kakanin |
| +63 917 000 0908 | Hazel David | San Fernando | Motorcycle `PMH 8808` | **Waiting for KYC** | none | All 5 documents to review, then **Approve** |
| +63 917 000 0909 | Ito Fariñas | San Marcelino | Motorcycle `ZBI 9909` | Approved, **online** | 4.5 (9) | Offers near Mangga ng Zambales |
| +63 917 000 0910 | Jessa Ebalo | San Marcelino | Bicycle | Approved, offline | 4.4 (5) | Going online from the rider app |

- **KYC files** are one-page PDFs titled "KLIK GO DEMO - PLACEHOLDER DOCUMENT". They sit in the
  private `rider-kyc` bucket and open from the console through the usual 60-second link. Each
  view is audited.
- **Ratings** are placeholder numbers set on the rider. Real ratings come from delivered orders
  (Phase 9). Earnings, cash on hand and job history start empty and fill as you run demo
  deliveries.
- **Payout names** are set for every rider, so payouts (Phase 10) have a name to show.

### 4.2 Letting demo riders sign in on the hosted app

Riders sign in only with a texted code, and SMS isn't live yet (Q30). Supabase test numbers solve
this. No text is sent, and the code is the one you choose:

1. Supabase → **Authentication** → **Sign In / Providers** → **Phone** → **Test phone numbers and OTPs**.
2. Add the numbers the workflow prints, without `+`, each with a 6-digit code you choose:
   `639170000901=<code>,639170000902=<code>,…,639170000910=<code>`. Save.
3. On a phone, open the app → **Sign in** → `0917 000 0901` → your code → open `/rider`.

Remove the test numbers before launch.

### 4.3 Things to know when demoing riders

- **Location must be fresh.** Dispatch only offers jobs to riders whose position is under
  2 minutes old. `load` stamps every position as fresh. After that, a rider gets offers only while
  `/rider` is open, because the app shares GPS every 7 seconds.
- **The rider's real GPS wins.** Once the rider app is open, the phone's own position replaces the
  demo position. If you are not in the zone, the rider moves to where you are and stops getting
  that zone's offers. To demo from elsewhere, open the rider app in desktop Chrome and set a fake
  location (DevTools → ⋮ → More tools → **Sensors** → Location), for example San Fernando
  `15.0322, 120.6858`.
- **Load the demo stores too**, so the online riders have orders to take.
- **Replay the KYC demo.** Run `load` again: applicants go back to "waiting for review", the
  suspended rider is suspended again and positions are fresh. A rider in the middle of a delivery
  is left as they are, and the run says so.
- **Remove**: action `hide` takes every demo rider offline and suspends them with the reason
  "Demo rider hidden". Accounts and history are kept, and `load` brings them back.

## 5. Running the whole demo on your machine

Start Supabase and load the seed:

```bash
pnpm db:start
```

```bash
pnpm db:reset
```

Export the local keys (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`)
from `pnpm exec supabase status -o env`, then load the demo stores and riders:

```bash
DEMO_OWNER_EMAIL=owner@demo.klikgo.test pnpm demo:data
```

```bash
pnpm demo:riders
```

Start the app at http://localhost:3000:

```bash
pnpm dev
```

A typical run uses four browser windows (use private windows so the sessions stay apart):

1. **Customer** (Carmen, `0917 000 0031`, code `123456`) orders from Lutong Bahay ni Lola Ising
   with cash on delivery.
2. **Store** (the demo owner) accepts the order on `/merchant/orders`, then marks it ready.
3. **Rider** (Andoy, `0917 000 0901`, code `123456`) sees the offer on `/rider`, accepts it,
   picks up and delivers. Orders of ₱500 or more ask for the customer's PIN.
4. **Console** (Ada Admin through `pnpm seed:staff-link`) watches the order on `/admin`, reviews
   Dina's documents under `/admin/riders` and checks the coaching list.

## 6. Before launch

- Run **Load demo data** and **Load demo riders** with `hide`.
- Delete the Supabase test phone numbers and `PLACEHOLDER_OTP_CODE` in Vercel (Q20, Q30).
- Treat accounts created during demos as test data.
