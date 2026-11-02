# Security

**Valentine is an unaudited hobby project for exactly two people.** It uses standard, well-reviewed
browser cryptography, but nobody independent has reviewed how it is put together. It is fine for
private conversation between two people who trust each other. Do not rely on it where a leak could
put someone in danger, and do not treat it as a replacement for Signal.

## What is protected

- **Message text.** Every message is encrypted on the sender's phone with AES-256-GCM and a fresh
  random 12-byte nonce, and decrypted only on the other person's phone. The server stores ciphertext,
  not text. Tampering with a message is detected, and a ciphertext cannot be moved to a different room,
  sender or message id without detection (these are bound in as authenticated data).
- **Keys.** Each device makes its own ECDH P-256 key pair using the browser's Web Crypto API. The private
  key is created *non-extractable* and kept in IndexedDB, so even this app's own JavaScript cannot read
  its bytes. The shared key comes from ECDH followed by HKDF-SHA-256 and is also non-extractable.
  No cryptography is hand-written and no crypto library is used.
- **Who can read the room.** Row Level Security limits a room to its two members. A third person cannot
  join: the pairing code works once, expires after 30 minutes, and the database refuses a third member
  even if the code were reused. These rules are tested against a real Postgres (`npm run test:sql`).
- **Local history.** Messages saved on a phone are encrypted at rest with a separate non-extractable key.
- **No tracking by default.** No analytics, no third-party scripts, fonts or trackers load on their own. A strict
  Content-Security-Policy only allows the app's own files, your Supabase project, and (only after you tap play in
  Reels) the named video players: youtube-nocookie.com, player.vimeo.com, facebook.com, and video files from the sites
  listed in `DIRECT_HOSTS`. A test fails if the policy and the code ever disagree.

## Photos, videos and voice notes

Files are encrypted in the browser before upload with the room's message key and stored as opaque bytes. The server
can see that a file exists, its approximate size and when it was uploaded, but not its type or content (the type is
inside the encrypted message). The recipient's phone deletes the file from the server after saving it, and the app
removes anything left after 7 days or when the room is deleted. Received photos and videos are blurred until tapped.
Once received, the other person can save or screenshot anything you send. Local copies are encrypted at rest on each
phone with a non-extractable key.

## Reels (shared video links)

Links to YouTube, Vimeo, a single Facebook reel or video, or a video file from a named site can be shared to a feed
that both of you see. The link and its tag travel as an end-to-end encrypted message, and every link is re-checked
on the receiving phone. Nothing from those sites loads until someone taps play; at that moment that site (and, for
Facebook, the logged-in account if there is one) can see the video was opened and that the request came from this
app's address. The tag is chosen by the sender and cannot be verified; each person can hide any item from their own
feed.

## What the server (and hosting) can see

The server cannot read your messages, but it does know:

- that two anonymous accounts share a room, and each account's random id;
- both **public** keys;
- **when** each message was sent and roughly **how long** it is (ciphertext size);
- when each device is online (the realtime connection), and each device's **IP address**, as with any website;
- GitHub (which hosts the page) sees ordinary web-visit information.

Messages are deleted from the server once the other person's phone confirms receipt, and in any case after
7 days. "Deleted" means deleted from the live database. Supabase may keep backups or operational logs
outside this project's control.

## What is NOT protected

- **Lost phone or cleared browser = history gone.** Keys and messages live only on the device. There is no
  backup and no recovery. Clearing site data also drops the anonymous sign-in, so that browser can no longer
  open the room; you have to delete it and pair again.
- **Not forward-secret.** One long-lived key per room protects every message. If a device's keys are ever
  compromised, anyone who had also recorded the ciphertext could decrypt past and future messages for that room.
  Deleting messages from the server limits how much ciphertext exists, but it is not a cryptographic guarantee.
  There is no key rotation and no post-compromise recovery.
- **A compromised or unlocked phone.** Anyone holding an unlocked phone can read the chat. There is no app lock.
  Malware, screenshots and shoulder-surfing are out of scope.
- **Trust in the code you are served.** This is a web app. Whoever controls the GitHub repository, the Pages
  deployment or your Supabase project could ship modified code that reads messages before they are encrypted.
  Protect the GitHub account with two-factor authentication.
- **Pairing depends on you comparing the safety code.** If nobody compares it, a malicious server could swap
  public keys and sit in the middle without either phone noticing. Compare it in person or by voice call. If the
  server later swaps the partner's key, the app notices and disables sending, but only if the key was already stored.
- **Pairing codes are 60 bits.** Strong against guessing for a 30-minute, single-use code; not meant to be
  published or reused.
- **Message times are claimed by the sender**, so the order shown can be wrong if a phone's clock is wrong.
- **No push notifications.** Messages arrive while the app is open or when you next open it.
- **No deniability or anonymity.** The other person can screenshot or copy anything.

## Dependencies and audits

Runtime dependencies are deliberately few: React, `@supabase/supabase-js`, `qrcode-generator`, Tailwind and
`lucide-react`. `npm audit --omit=dev` reports no vulnerabilities. A handful of moderate findings remain in the
ESLint development tooling (via `minimatch`, no upstream fix yet). They are not part of the shipped app.
CI fails on any production finding and on high or critical findings anywhere.

## What has and has not been tested

Tested: the crypto layer (`npm test`); the database rules, pairing, third-person rejection, delete-after-delivery
and 7-day purge on a real Postgres; and the client flow with two simulated devices against a fake server.
**Not done:** an independent security review, and testing on real phones against a live Supabase project.

## Reporting a problem

Open a private security advisory on the GitHub repository, or contact the repository owner directly.
