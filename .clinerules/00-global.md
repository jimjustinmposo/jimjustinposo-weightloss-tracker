# Cline Global Rules

## 1. Primary Objective

Build the requested functionality correctly while using the minimum necessary:
- tokens
- file reads
- terminal commands
- tool calls
- code changes

Do not perform unnecessary work.

## 2. Windows Environment

The project runs on Windows PowerShell.

Use PowerShell syntax only.

Never use CMD syntax such as:
- `cd /d`
- `&&`
- `dir /a /s /b`

Prefer:
- `Set-Location`
- `Get-ChildItem`
- `Get-Content`
- `Select-String`
- `Remove-Item`
- `Copy-Item`
- `Move-Item`

Do not repeatedly determine the current directory.

## 3. Project State

The file:

`.cline/PROJECT_STATE.md`

is the authoritative project handoff file.

At the beginning of a new Cline chat:

1. Read `.cline/PROJECT_STATE.md`.
2. Inspect only files relevant to the current task.
3. Do not reconstruct the entire project from the conversation.
4. Do not scan the entire repository unless required.

Do not assume information that is not present in the project state or verified from the repository.

## 4. Avoid Hallucination

Never invent:
- files
- functions
- APIs
- database tables
- routes
- dependencies
- completed features
- test results
- configuration
- project requirements

If something is unknown, inspect the relevant file or state that it is unknown.

Do not assume a previous implementation exists just because it is mentioned in conversation.

## 5. Inspect Before Modifying

Before changing code:
- inspect the relevant existing implementation
- understand its current behavior
- make the smallest required change

Do not reread unrelated files.

Do not rewrite working code.

## 6. Minimal Changes

Only modify files necessary for the current task.

Do not:
- refactor unrelated code
- rename unrelated files
- redesign the application
- replace working dependencies
- add unrequested features

## 7. Token Efficiency

Avoid:
- full repository dumps
- unnecessary recursive searches
- repeated file reads
- repeated builds
- repeated tests
- long explanations

Use targeted inspection.

Prefer one focused implementation followed by one relevant test.

## 8. Error Handling

When an error occurs:

1. Read the actual error.
2. Identify the direct cause.
3. Inspect only the relevant code.
4. Make the smallest fix.
5. Run the relevant test again.

Do not restart the implementation.

## 9. Dependencies

Before adding a dependency:
- check package configuration
- determine whether an existing dependency can solve the problem

Do not add duplicate libraries.

## 10. Testing

Test the smallest relevant scope.

Do not run expensive full-project tests when a targeted test is sufficient.

After a successful change, do not keep testing unnecessarily.

## 11. Security

Never hard-code:
- passwords
- API keys
- SMTP credentials
- tokens

Use `.env`.

Never expose secrets to frontend code.

Never commit `.env`.

## 12. Git Safety

Never perform destructive Git operations without explicit user instruction.

Do not:
- force push
- reset
- delete branches
- delete user files
- overwrite uncommitted work

## 13. Project State Updates

After completing a meaningful task, update:

`.cline/PROJECT_STATE.md`

Only update the relevant sections.

Keep the file concise.

Do not store long explanations or conversation history.

## 14. Completion

Stop when the requested task works and relevant tests/builds pass.

Do not continue improving unrelated areas.

## 15. Communication

Keep responses concise.

After implementation report:

- What changed
- Files changed
- Test/build result
- Remaining issue, if any

Do not provide unnecessary explanations.