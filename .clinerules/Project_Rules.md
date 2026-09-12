# Cline Project Rules — Token Efficient

## 1. CORE RULE — MINIMIZE CONTEXT

The highest priority is to minimize token usage.

When working on a feature, DO NOT read or analyze the entire project.

Only inspect files that are necessary to complete the requested task.

Never scan the whole repository unless I explicitly ask you to.

---

## 2. START FROM MY FEATURE LOCATION

I will normally tell you where the feature is located, for example:

- `src/pages/Profile.jsx`
- `src/components/JobMatch.jsx`
- `workers/api/jobs.ts`
- `src/services/ai.js`

START THERE.

First inspect the file I mentioned.

Then inspect only the files directly related to that feature.

Do not explore unrelated directories.

---

## 3. FOLLOW THE MINIMUM DEPENDENCY PATH

After reading the starting file:

1. Identify the functions/components/services involved.
2. Read only the files those functions directly depend on.
3. Follow imports only when necessary.
4. Stop exploring once you have enough context to safely implement the feature.

Do NOT recursively read every imported file.

Do NOT inspect the entire dependency tree.

If a dependency is unrelated to the requested feature, ignore it.

---

## 4. DO NOT READ THE ENTIRE PROJECT

Never automatically:

- Read every file in `src`
- Read every component
- Read every API route
- Read every database file
- Read every configuration file
- Read the entire Git history
- Read every documentation file
- Search the entire repository
- Analyze all existing features

Only inspect what is relevant to the current task.

---

## 5. USE TARGETED SEARCH

When searching for code, search for:

- The feature name
- The function name
- The component name
- The API endpoint
- The database table
- The specific variable
- The specific error

Avoid broad searches such as:

"Show me everything related to the project."

Prefer:

"Find where `calculateMatchScore()` is defined and where it is called."

---

## 6. DO NOT REREAD FILES

If a file has already been inspected during the current task, do not read it again unless:

- It was modified
- New information requires it
- You need a specific section that was not previously inspected

Reuse the context you already have.

---

## 7. BEFORE EDITING

For a normal feature, inspect the minimum necessary files first.

Then briefly determine:

1. What needs to change
2. Which files need modification
3. Whether an existing function/component can be reused

Do not spend tokens explaining the entire architecture.

Only explain the architecture relevant to the requested feature.

---

## 8. MAKE MINIMAL CHANGES

Modify only the files required for the feature.

Do NOT:

- Rewrite entire files unnecessarily
- Refactor unrelated code
- Rename unrelated variables
- Reformat unrelated code
- Upgrade dependencies
- Change project architecture
- Remove existing functionality

unless I explicitly request it.

---

## 9. PRESERVE EXISTING FEATURES

Adding a feature must not remove or break existing functionality.

Before changing existing code, understand the specific section being modified.

Do not redesign existing features simply because you think another approach is better.

Prefer extending existing functionality over creating duplicate systems.

---

## 10. DATABASE RULE

If the feature uses the database:

First identify the specific table/query/API involved.

Read only the relevant database schema/migration/query files.

Do NOT inspect the entire database structure unless necessary.

Do NOT create a new database.

Do NOT create duplicate tables when an existing table can be reused.

Do NOT modify unrelated tables.

If a schema change is required, explain it briefly before making the change.

---

## 11. API RULE

If the feature uses an API:

Find the specific endpoint/service involved.

Read only:

- The relevant route
- The relevant service
- The relevant client call
- Necessary types/interfaces

Do not inspect every API route.

---

## 12. FRONTEND RULE

If the feature is a frontend feature:

Start from the page/component where I tell you to work.

Inspect only:

- That component
- Directly related components
- Relevant hooks
- Relevant API/service calls
- Relevant types

Do not scan the entire UI.

---

## 13. AI/API MODEL RULE

If the feature involves AI:

Only inspect the existing AI integration used by that feature.

Do not inspect every AI-related file in the project.

Reuse the existing provider, API client, environment configuration, and response handling whenever possible.

Do not switch AI providers unless explicitly requested.

---

## 14. GIT RULE

Do not:

- Commit
- Push
- Reset
- Revert
- Delete branches
- Change branches

unless I explicitly ask.

Do not inspect Git history unless it is necessary to solve the requested problem.

---

## 15. TESTING RULE

After implementing a feature:

Run only the smallest relevant validation.

Examples:

- Check the modified file for errors
- Run the relevant test
- Run the relevant type check
- Run the relevant build only if necessary

Do NOT automatically run a full project build/test suite if it is unnecessary.

---

## 16. ERROR FIXING

If I give you an error:

Start from the error location.

Read:

1. The file containing the error
2. The directly related code
3. The relevant dependency only if necessary

Do NOT scan the whole project looking for the cause.

Fix the smallest possible area.

---

## 17. STOP EXPLORING WHEN ENOUGH CONTEXT IS AVAILABLE

Once you understand enough to safely implement the feature, STOP reading files.

Do not continue exploring the project just to gain more context.

More context is NOT automatically better.

The goal is:

MINIMUM FILES → MINIMUM TOKENS → SAFE CHANGE

---

## 18. IF INFORMATION IS MISSING

If you cannot safely implement the feature because an important file or dependency is unknown:

Ask me for the specific file/path.

Do NOT compensate by scanning the entire repository.

Example:

"I need to inspect `src/services/jobMatcher.ts` because the component calls a function defined there."

Then inspect only that file.

---

## 19. USER-PROVIDED SCOPE HAS PRIORITY

If I say:

"Work only on `src/pages/Profile.jsx`"

then work only there unless another file is absolutely required.

If another file is required, tell me which file and why before expanding the scope.

---

## 20. FEATURE TASK FORMAT

When I give you a new feature, follow this workflow:

STEP 1:
Identify the exact starting file/path I provided.

STEP 2:
Read only that file.

STEP 3:
Identify the minimum directly related files.

STEP 4:
Read only those files.

STEP 5:
Create a short implementation plan.

STEP 6:
Implement the feature with minimal changes.

STEP 7:
Validate only the affected functionality.

STEP 8:
Stop.

Do not continue analyzing unrelated parts of the project.

---

## 21. DEFAULT BEHAVIOR

When I say:

"Add feature X"

interpret it as:

"Add feature X using the existing architecture with the minimum amount of repository inspection and minimum necessary code changes."

Do NOT interpret it as:

"Understand the entire project before doing anything."

---

## 22. TOKEN CONSERVATION

Every file read consumes context.

Every unnecessary search consumes context.

Every unnecessary explanation consumes context.

Therefore:

Prefer targeted inspection over broad inspection.

Prefer existing code over new code.

Prefer small changes over refactoring.

Prefer concise responses over long explanations.

Do not repeat information already established during the task.

---

## FINAL PRINCIPLE

DO NOT EXPLORE THE WHOLE PROJECT.

START WHERE I TELL YOU.

READ ONLY WHAT IS NECESSARY.

FOLLOW ONLY THE RELEVANT DEPENDENCIES.

MAKE THE SMALLEST SAFE CHANGE.

VALIDATE ONLY WHAT IS RELEVANT.

STOP WHEN DONE.