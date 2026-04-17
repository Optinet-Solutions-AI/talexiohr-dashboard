# HR Insights (Ask AI) — Development Update

## What Changed

The Ask AI feature was rebuilt to handle **1,000+ employees** and provide a significantly better user experience.

### Smarter Query Engine

Previously, the system loaded all employee and attendance data into a single prompt — an approach that works at small scale but breaks completely beyond a few hundred employees. The new architecture uses an **intelligent tool-calling agent** that decides what data it needs, fetches only that data from the database via purpose-built query tools, and summarizes the results.

Five specialized tools handle different question types:

- **Employee directory lookups** — "List all remote employees", "Who is in the Ops unit?"
- **Attendance analytics** — "Who has the most office days this month?", "Top 5 by attendance", "Compare Unit A vs Unit B"
- **Point-in-time status** — "Who is on leave today?", "Who was sick yesterday?"
- **Compliance checks** — "Which Malta office employees broke the 4-day rule this month?" — business rules are encoded in code, not left for the AI to interpret
- **Ad-hoc queries** — for questions none of the above cover, with strict security guardrails (read-only access, 3-second timeout, 500-row cap, table whitelist)

### Live Streaming Responses

Instead of a 3-4 second silent wait followed by the full answer appearing at once, users now see **real-time progress**:

- Status messages appear within ~500ms ("Analyzing attendance...", "Checking compliance rules...")
- The answer builds up progressively as the AI generates it
- If the user navigates away, the system stops doing work immediately (no wasted API costs)

### Voice Input Improvements

Speech-to-text now **auto-submits after a 2-second pause** once the user stops speaking — no need to manually press the search button. Works on Chrome (desktop + Android) and Safari (iOS).

### Observability & Cost Control

- Every question is logged with full audit trail (tools used, tokens consumed, response time)
- Per-user rate limiting (30 questions/hour) to prevent runaway API costs
- Token budget cap per question to prevent expensive outliers

### Security

The system is hardened against the AI accidentally (or maliciously) accessing data it shouldn't:

- **Layer 1:** Node-side SQL parser blocks anything that isn't a simple SELECT on authorized tables
- **Layer 2:** Dedicated read-only database role with access to only 2 tables
- **Layer 3:** Database-level query timeout (3s) and row cap (500) enforced by a server function

Non-HR questions (e.g. "Who is Donald Trump?") are rejected before any tools run, using a lightweight classifier.

### Test Coverage

81 automated unit tests covering all tools, the security layers, the streaming pipeline, and the agent loop. 5 additional integration tests verify the database security layers against a live Postgres instance.

---

## Why We Didn't Use RAG (Vector Search) — And When We Will

**RAG (Retrieval-Augmented Generation)** uses vector embeddings to search through unstructured text — documents, policies, emails, notes. It's excellent for answering questions like "What does the leave policy say about bereavement?" or "What feedback did the manager give in the last performance review?"

We deliberately chose **not** to implement RAG for this phase because:

1. **All current data is structured.** Employee records, attendance rows, hours worked, dates, statuses — these are database tables with columns and types. SQL aggregation ("give me the top 5 by attendance this month") is the right tool for structured data. Vector similarity search would be like using a search engine to add up numbers — technically possible, but the wrong tool for the job.

2. **Building RAG infrastructure for data that doesn't exist yet wastes effort.** RAG requires an embedding pipeline (chunking documents, generating vectors, storing them, keeping them in sync). Building and maintaining that pipeline before there are actual documents to index means cost and complexity with zero value.

3. **The architecture is designed to add RAG later without rework.** The agent's tool-calling system is pluggable — each tool is a self-contained module. When unstructured data arrives, adding a `search_documents` vector tool is one new file plus one line in the tool registry. The agent will automatically choose between SQL tools (for structured questions) and the vector tool (for document/policy questions) based on what the user asks. Nothing built today needs to change.

### When to Add RAG

- When the system starts ingesting **unstructured content** — HR policy PDFs, free-text manager notes, performance review comments, internal communications
- The planned approach: a `pgvector`-backed documents table, an ingestion pipeline (PDF/text to chunks to embeddings via `text-embedding-3-small`), and a new `search_documents` tool registered alongside the existing five
- Estimated effort: 3-5 days for the minimum viable version
- No rework of anything already built

---

## What's Next (Deferred Items)

| Item | Description | When |
|---|---|---|
| **Re-enable authentication** | Login/signup are currently disabled project-wide; the API accepts anonymous requests | When auth is restored |
| **Saved & shareable questions** | The "Saved" tab exists in the UI; backend wiring is needed | When client requests it |
| **Multi-turn conversations** | Follow-up questions like "drill into that" or "what about last quarter instead" | Separate design needed |
| **Vector RAG** | Search unstructured documents (policies, notes, reviews) | When unstructured data arrives |
| **Cancel button** | Let users cancel a slow query mid-stream | Small UX polish (~2 hours) |
