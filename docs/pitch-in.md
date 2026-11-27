# Pitch in: design notes for contributors

Pitch in is the part of Pumasi Agent we most want help with. This page says what it is for, what is already built, and what is still open, so you can pick a piece and start.

## The idea

Most token-sharing projects collect API keys or credits in one place and hand them out. Whoever runs that pool sits in the middle of every request and can read it, and a shared key is easy to abuse: one heavy user drains it, and nobody can tell who did what.

Pitch in turns this around. Nobody shares tokens. You share the **problem**. Someone who wants to help takes it, solves it with whatever they have (their own key, their own model, their own head), and sends back only the result. Keys and credits never leave the people who own them, so there is no pool in the middle to drain or abuse.

## What is built (0.2 beta)

- **Relay** (`relay/server.mjs`): a small HTTP server that only moves sealed blobs. Members join with an invite code and are known by an anonymous Ed25519 public key. Every request is signed; replays are rejected.
- **Jobs and slots:** a team-mode run posts its tasks as a job; each task is a slot. A helper claims a slot, fetches the task, posts the result. Routes: `POST /v1/jobs`, `GET /v1/open`, `POST /v1/slots/:id/claim`, `GET|POST /v1/slots/:id/task|result`.
- **Sealing** (`electron/pumasi.cjs`): tasks and results are encrypted with X25519 + AES-256-GCM for one device. The relay sees ciphertext only.
- **Helper app:** the helper's app runs the task on the helper's own free key, inside the main process. The helper's window sees a token count and nothing else.
- **Asker app:** team mode tries helpers first and falls back to its own worker after five minutes. With two helpers per task, its own worker picks the better result, so one bad helper cannot win alone.
- **Points:** helping earns points; posting spends them.

## What is not built: people taking a role

The version we want has a person in the loop. You turn on Pitch in for a question. The lead splits it into roles. Someone who clicks Pitch in on that question takes one role and works on it with their own AI, back and forth, until the answer for that role is right. Then they hand it back. The asker's lead puts the roles together.

Open problems, roughly in the order they block each other:

1. **Consent and privacy.** Today the helper never sees the task. With a person in the loop, a stranger reads it. The asker has to agree to that per question, and the app should keep refusing text that looks like personal data or keys (`privateReason` in `electron/pumasi.cjs` is the start).
2. **A role the person can work on.** The lead's task format (`SYSTEMS.plan` in `electron/providers.cjs`) is written for a model. A role for a person needs a short title, what "done" means, and the context they need. No more than that.
3. **A helper's workspace.** A screen where the helper sees the role, chats with their own model about it, edits the answer, and submits. It can reuse chat mode.
4. **Matching and timeouts.** Who sees which open roles, how long a claim lasts, and what happens when a helper walks away.
5. **Trust.** Report and block bad results, limit how many roles one new member can claim, and decide how a result gets checked before it counts (a second helper, the asker's lead, or the asker).
6. **Points that mean something.** What a role is worth, so people with free keys and time can help people who need answers.
7. **Code mode.** The same flow for a coding task, where a role is a change to some files. This comes after the chat version works.

## How to help

- Pick one numbered problem above and open an issue saying how you would approach it. Small proposals are welcome; a sketch of a screen counts.
- The tests show how the current parts fit together: `tests/pumasi.test.ts` drives a full relay round trip.
- Run the relay locally with `PUMASI_INVITES=dev node relay/server.mjs` (it listens on port 8787; `PUMASI_DB` and `PUMASI_GRANT` set the database file and the starting points).
- Read [CONTRIBUTING.md](../CONTRIBUTING.md) before sending a pull request.
