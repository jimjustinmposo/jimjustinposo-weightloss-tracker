# PROJECT STATE RULES

## PURPOSE

`PROJECT_STATE.md` is the project's current-state memory.

It should contain only information that helps Cline understand the project quickly without repeatedly reading the entire codebase.

The file must remain concise and up to date.

---

## 1. ALWAYS CHECK PROJECT_STATE.md FIRST

At the beginning of every task:

1. Check whether `PROJECT_STATE.md` exists.
2. Read it before exploring the project.
3. Use it to understand the current architecture, features, progress, known issues, and next steps.
4. Then inspect only the files relevant to the current task.

Do NOT scan the entire repository when the project state already provides the required context.

---

## 2. KEEP IT CURRENT

After completing a meaningful change, update `PROJECT_STATE.md`.

Update it when any of these change:

- Project purpose
- Current architecture
- Major features
- Database structure
- API structure
- Authentication
- Important dependencies
- Environment/configuration
- Completed features
- Current bugs
- Known limitations
- Current development stage
- Next planned task

Do NOT update it for trivial changes such as:
- typo fixes
- small CSS adjustments
- minor text changes
- simple formatting changes

---

## 3. NEVER TURN IT INTO DOCUMENTATION

`PROJECT_STATE.md` is NOT a full technical documentation file.

Keep it short.

Do not copy large amounts of source code into it.

Do not document every function.

Do not list every file.

Only record information that helps future development decisions.

---

## 4. CURRENT STATE OVER OLD STATE

`PROJECT_STATE.md` must describe the CURRENT implementation.

When something changes:

OLD:
`Authentication uses Firebase.`

NEW:
`Authentication uses Cloudflare Workers authentication.`

Replace outdated information instead of keeping historical information.

Do not maintain a long changelog inside this file.

---

## 5. DO NOT GUESS

Never write something into `PROJECT_STATE.md` based on assumptions.

Only record information verified from:

- Existing code
- Configuration
- Database schema
- Tests
- User instructions
- Successfully completed implementation

If something is uncertain, write:

`Unknown — needs verification.`

---

## 6. PROJECT STATE STRUCTURE

Maintain this structure unless the project requires additional sections:

# PROJECT STATE

## Project
- Name:
- Purpose:
- Status:

## Current Stack
- Frontend:
- Backend:
- Database:
- Hosting:
- AI/External Services:

## Architecture
Brief description of how the major parts communicate.

## Implemented Features
- [x] Feature
- [x] Feature
- [ ] Feature

Only mark a feature `[x]` when it is actually implemented and working.

## Current Focus
Describe the feature/task currently being worked on.

## Current Problems
List only known active problems.

## Important Decisions
Record important architectural or implementation decisions that future tasks need to respect.

## Database
Briefly describe important tables/collections and their purpose.

## API
List only important endpoints/services that future development needs to know.

## Environment
List required environment variables by NAME only.

NEVER store:
- API keys
- passwords
- access tokens
- secrets

## Recent Changes
Keep only the most recent important changes.

Maximum: 5 items.

## Next Steps
List the immediate planned tasks.

Maximum: 5 items.

## Known Limitations
List important limitations that future development should be aware of.

---

## 7. UPDATE RULE

After completing a task:

1. Determine whether the project state changed.
2. If YES, update `PROJECT_STATE.md`.
3. If NO, leave it unchanged.
4. Do not rewrite the entire file unnecessarily.
5. Modify only the affected sections.

---

## 8. AVOID TOKEN WASTE

When updating the state:

- Keep descriptions short.
- Use bullets.
- Avoid repeating information.
- Avoid copying code.
- Avoid explaining obvious implementation details.
- Remove outdated information.
- Do not create a changelog for every small change.

The target is a quick project snapshot that can be understood in under one minute.

---

## 9. BEFORE STARTING A NEW FEATURE

Read:

`PROJECT_STATE.md`

Then inspect only the files related to the feature.

Example:

If the task is:

"Add Excel export"

Do NOT automatically read:
- Authentication code
- Unrelated UI
- Payment system
- Unrelated API routes

First inspect the project state, then locate the existing data flow and export-related code.

---

## 10. BEFORE MAJOR ARCHITECTURAL CHANGES

If the requested change would significantly affect:

- Database
- Authentication
- API architecture
- Hosting
- Framework
- AI provider
- Data model
- Security

First inspect `PROJECT_STATE.md` and the relevant implementation.

Before making a destructive or difficult-to-reverse change, ask the user for confirmation.

---

## 11. COMPLETION REQUIREMENT

When a meaningful task is completed, ensure:

`PROJECT_STATE.md`

accurately reflects the new state.

Do not claim a feature is completed if it has not been implemented or tested.

Use:

`[x]` = implemented and verified

`[ ]` = not implemented

`[~]` = partially implemented / needs verification

---

## 12. PROJECT_STATE IS NOT INSTRUCTIONS

Do not put behavioral instructions for Cline inside `PROJECT_STATE.md`.

Global Cline rules belong in the global rules file.

`PROJECT_STATE.md` contains PROJECT INFORMATION.

Global Rules contain DEVELOPMENT BEHAVIOR.

Keep these separate.

---

## FINAL PRINCIPLE

Before working:

PROJECT_STATE.md → understand current state → targeted file inspection

After working:

implement → test → update PROJECT_STATE.md if needed

Never use PROJECT_STATE.md as a replacement for checking the actual code.

The codebase is always the final source of truth.