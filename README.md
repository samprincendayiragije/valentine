# Valentine

A private, installable, end-to-end encrypted chat for **exactly two people**, hidden behind a love-letter
landing page. There is no sign-up, no profile, no search and no matching. One person creates a room, the
other joins with a one-time code, and they compare a short safety code to confirm nobody is in the middle.

Read [SECURITY.md](SECURITY.md) first: it says plainly what is and is not protected.

## How it works

- **Front end:** React + Vite + Tailwind, installable as a PWA (manifest, service worker, install prompt).
- **Encryption:** browser Web Crypto only. ECDH P-256 key pair per device (private key non-extractable,
  stored in IndexedDB) -> HKDF-SHA-256 -> AES-256-GCM with a fresh random nonce per message.
- **Backend:** a separate Supabase project with anonymous auth, a `messages` table, Realtime and Row Level
  Security. The server stores only ciphertext, nonce, timestamp, ids and public keys.
- **Retention:** a message is deleted from the server as soon as the other phone confirms it has it, and
  anyway after 7 days.

## Setup

1. Create a **new** Supabase project (do not reuse another one). Enable *Authentication -> Sign In / Providers ->
   Allow anonymous sign-ins*.
2. Paste `supabase/schema.sql` into *SQL Editor* and run it.
3. Copy the **Project URL** and the **anon public** key (*Project Settings -> API*). Never use the `service_role` key.
4. In the GitHub repo, *Settings -> Secrets and variables -> Actions -> Variables*, add `VITE_SUPABASE_URL`
   and `VITE_SUPABASE_ANON_KEY`. In *Settings -> Pages*, set the source to **GitHub Actions**.
5. Activate the workflow: the file is committed as `ci/deploy.yml` because the access token used to open the PR
   could not create workflow files. On GitHub, open `ci/deploy.yml` on this branch, click the pencil, change the
   file name to `.github/workflows/deploy.yml`, and commit. Then merge to `main`: it builds and deploys to
   `https://<user>.github.io/valentine/`.
6. On **each phone**: open that address, install the app (Android/Chrome: *Install app*; iPhone: Share ->
   *Add to Home Screen*), then **open the installed app** before pairing, because on iPhone the installed app
   and Safari keep separate storage.
7. Phone A: *Our private space -> Create room*. Phone B: *Join room* and type the code. Compare the safety code
   in person or on a call and tap *They match*.

## Photos, videos, voice notes and games

Text and the **Games** tab work with just `schema.sql`. To send photos, videos and voice notes, also paste
`supabase/media.sql` into the SQL Editor and run it once. It creates a private storage bucket that only the two
people in a room can use. Files are encrypted on the sender's phone before upload (AES-256-GCM, same room key as
messages), deleted from the server when the other phone has saved them, and swept after 7 days. Limit: 20 MB per
file, voice notes up to 3 minutes. Photos are re-drawn before sending, which strips location data.

Games are for two adults and are opt-in (an 18+ and consent screen comes first). Built-in decks go from sweet to
suggestive; anything beyond that is for you to write in *Games -> Create a deck*. Decks live only on your phones and
travel as encrypted messages. Any card can be passed.

## Reels

The **Reels** tab is a swipe-up feed of videos you share with each other: paste a YouTube, Vimeo or single Facebook
reel link (or a direct .mp4 from a site in `DIRECT_HOSTS` in `src/lib/embed.js`), pick a tag, and it appears for both
of you. To allow another video-file site, add it to `DIRECT_HOSTS` and to `media-src` in `index.html` and
`vite.config.js`; `npm test` checks they match.

## Develop

```bash
cp .env.example .env.local   # fill in the two public values
npm ci
npm run dev                  # local, relaxed CSP for hot reload
npm test                     # crypto tests (Node's built-in runner)
npm run test:sql             # schema + RLS tests; needs a local PostgreSQL, run as root
npm run lint && npm run build
```

Everything in `src/lib/crypto.js` is a thin wiring of `crypto.subtle`; there is no custom cryptography.
