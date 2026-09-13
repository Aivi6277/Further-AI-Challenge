# Further ISE Technical Challenge (2026)

- **Task 1** — runnable lead form: `server.js`, `public/index.html`, `.env.example`
- **Task 2** — `Task_2.md`
- **Task 3** — `Task_3.md`

Rejected leads are appended to `logs/validation-failures.jsonl`. The server creates the `logs/` directory on startup if it does not already exist.

## Running it

Node 18 or newer. No dependencies to install — this uses Node's built-in `http`, `fetch`, and `FormData`, so the HTTP request is genuinely constructed in code rather than handed to a library.

The API key is intentionally **not hardcoded** and is not included in this repository. The app reads it from the process environment.

PowerShell:

```powershell
$env:FURTHER_API_KEY = "your_key_here"
npm start
```

macOS/Linux:

```bash
FURTHER_API_KEY="your_key_here" npm start
```

Then open `http://localhost:3000`.

`.env.example` documents the expected variable names, but this dependency-free version does not automatically load a `.env` file.

## How it works

The browser posts the four lead fields — first name, last name, email, phone — to a small local server. The server validates them, adds the community ID, and constructs the authenticated multipart request to Further. The indirection is there for two reasons: the API key never reaches client-side JavaScript, and a cross-origin POST carrying an `Authorization` header triggers a CORS preflight that would fail unless Further allowlists the origin. In production the form would live on a community's own site, so the server has to exist anyway.

`community_id` is hardcoded for this exercise. In production it would come from per-community configuration, since the same form code would serve many communities.

Validation happens in `validateLead()`, not in HTML attributes — the form is marked `novalidate` and the inputs carry no `type="email"` or `pattern`. Email gets a practical format check rather than an RFC 5322 attempt, because full RFC compliance accepts addresses that no mail server will take and rejects nothing anyone actually types wrong. Phone strips to digits and requires ten.

Validation failures append to `logs/validation-failures.jsonl` before the error goes back to the browser.

## Decisions worth explaining

**Why a JSONL file for rejected leads.** It's the smallest thing that keeps each failure as a structured record without adding a database to a two-hour exercise. One object per line means I can grep it or replay it with a loop.

I wouldn't ship this as-is. The file holds raw PII with no retention policy, which isn't something I'd put on a server. The real version would send structured events to whatever we already use for logging, with the lead fields minimized or hashed and an actual expiry. Nothing from my own testing is included in this archive for the same reason.

**Only validation failures are captured, not API failures.** That's what the task asked for, but it's the wrong stopping point and I'd rather name it than have it look like an oversight. A lead lost to a 502 is worse than one lost to a typo, because nobody finds out. The same log with a `reason` of `api_error` and the response body attached would close it.

**The auth header.** The Task 2 sample uses `Authorization: Api-Key <key>`, which is inherited from deliberately broken code, so I verified it against the live endpoint rather than trusting it.

## Error handling

- Validation errors return 400 with a readable message.
- 4xx and 5xx from Further are treated as failures, since `fetch` resolves on both.
- The response body is read as text before parsing, so an HTML error page doesn't throw a JSON parse error on top of the real status code.
- The browser gets a generic failure message; the status and response body go to the server log.

## What I'd do next

Add a timeout to the outbound request, since a hanging Further response currently hangs the browser indefinitely. Persist API failures alongside validation failures, and move both off a flat file into structured logging with retention and field minimization. The 10-digit rule is the specified requirement, so I followed it; for production I'd clarify which formats are accepted and normalize to something agreed, such as E.164. For 429 and 5xx responses I'd add retries only alongside an idempotency key, so a retry can't create a duplicate lead.

## AI disclosure

I used Claude to pressure-test the Task 2 bug list against the API reference and to review this code for gaps — it flagged the missing request timeout and that I wasn't persisting API failures, both of which are noted above. The structure, the validation rules, and the endpoint verification are mine, and I ran the failure-path tests myself. I used Grammarly for basic grammar, spelling, punctuation, and structural proofreading. Happy to walk through any decision here.

