# Firebase (optional sync)

QPlan works without an account. Signing in with Google syncs days and the time-format setting across devices through Firebase (Authentication + Firestore). The app code is in `sync.js`; how it works is in `architecture.md` §3 (cloud data) and §4 (`sync.js`).

## One-time setup (Firebase console, about 10 minutes)

Free Spark plan, no billing account needed.

1. Go to https://console.firebase.google.com → **Create a project** → name it `qplan` → turn **off** Google Analytics → Create.
2. **Build → Authentication → Get started → Sign-in method → Google** → Enable → pick your support email → Save.
3. **Authentication → Settings → Authorized domains** → Add domain → `q-plan.netlify.app` (and the final domain once chosen). `localhost` is there already.
4. **Build → Firestore Database → Create database** → location **`eur3` (Europe)** → start in **production mode** → Create. The location can't be changed later.
5. **Firestore Database → Rules** → replace everything with the contents of [`firestore.rules`](firestore.rules) → **Publish**.
6. **Project settings** (gear icon) → **General → Your apps → Web (`</>`)** → nickname `QPlan web`, leave Hosting unchecked → Register. Copy the `firebaseConfig` object into `FIREBASE_CONFIG` at the top of `sync.js`.

The web config (including `apiKey`) is **not a secret**: it only identifies the project and ships to every browser. The security rules in step 5 are what protect each user's data. Never commit a service-account key.

Optional: Google's sign-in window shows `<project-id>.firebaseapp.com`. To show "QPlan" instead, set the app name on the OAuth consent screen in Google Cloud console (APIs & Services → OAuth consent screen).

Whenever `firestore.rules` changes, paste it into the console again and Publish.

## Local testing with emulators (no real project needed)

Needs Java 11+.

```bash
cd firebase && npx firebase-tools@15.34.1 emulators:start --project demo-qplan
```

Then open http://localhost:5173/?emulators. The app talks to the local Auth and Firestore emulators instead of Firebase. The Google sign-in pop-up offers fake accounts. Emulator UI (data, users): http://localhost:4000.

## Google Calendar sync: one-time setup (about 20 minutes)

Logged-in users can send their QPlan blocks to a separate "QPlan" calendar in their Google account (one way: QPlan → Google). The browser part is `calendar.js`; the server part is three Netlify Functions in `netlify/functions/`. Everything below happens in the same Google project Firebase created (`qplan-5c4d7`).

### 1. Turn on the Calendar API
https://console.cloud.google.com → project picker at the top → **qplan-5c4d7** → **APIs & Services → Library** → search **Google Calendar API** → **Enable**.

### 2. Consent screen (Google Auth Platform)
Left menu **Google Auth Platform** (older consoles: **APIs & Services → OAuth consent screen**).
1. **Branding:** app name `QPlan`, user support email = yours, developer contact = yours. Application home page `https://q-plan.netlify.app`. Authorized domains: add `q-plan.netlify.app`. **Don't upload a logo**: a logo makes Google review the branding before the app can go live.
2. **Audience:** user type **External**, then **Publish app** so it's **In production** (in "Testing", Google expires everyone's access after 7 days).
3. **Data Access → Add or remove scopes** → filter for `calendar.app.created` → tick **…/auth/calendar.app.created** ("Make secondary Google calendars, and see, create, change, and delete events on them") → **Update** → **Save**. It's listed under **Your non-sensitive scopes**.

### 3. A web client for the calendar connection
**Google Auth Platform → Clients → Create client** → type **Web application** → name `QPlan Calendar`.
- **Authorized JavaScript origins:** `https://q-plan.netlify.app`, `http://localhost:8888` (local testing).
- **Authorized redirect URIs:** leave empty.
- **Create.** Copy the **Client ID** and the **Client secret** right away (or download the JSON): newer consoles show the secret only once.

### 4. A Firebase service account (lets the functions read Firestore)
https://console.firebase.google.com → **qplan-5c4d7** → gear → **Project settings → Service accounts → Generate new private key** → a JSON file downloads. Keep it out of this folder and never commit it.

### 5. Netlify environment variables
Netlify → the site → **Site configuration → Environment variables → Add a variable** (scope: Functions; tick **Contains secret values** for the secret ones):

| Key | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | Client ID from step 3 |
| `GOOGLE_CLIENT_SECRET` | Client secret from step 3 (secret) |
| `FIREBASE_PROJECT_ID` | `qplan-5c4d7` |
| `FIREBASE_CLIENT_EMAIL` | `client_email` from the JSON in step 4 |
| `FIREBASE_PRIVATE_KEY` | `private_key` from the JSON, everything between the quotes, `\n`s included (secret) |

Then **Deploys → Trigger deploy → Deploy site** so the functions pick them up.

### 6. Firestore rules
`firestore.rules` changed for this feature: paste it into **Firestore Database → Rules** again and **Publish**.

### 7. Send me
- The **Client ID** (it's public; it goes into `calendar.js`). Never the secret.

### Google verification: not needed
`calendar.app.created` is a **non-sensitive** scope (confirmed in the console, Oct 2026), and so are `openid` and `email`. So people connecting see no "unverified app" warning, there's no user cap, and the app needs no Google review, as long as the consent screen has no logo and requests no other scopes. Adding a sensitive scope later (e.g. reading the person's other calendars) would bring in verification: a privacy policy covering Google data on the app's domain (B-009), the domain verified in Search Console (D-004) and a demo video.
