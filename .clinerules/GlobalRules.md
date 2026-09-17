# GLOBAL CLINE RULES

## 1. CURRENT PROJECT FIRST
- Always focus only on the current project and current task.
- Before making changes, inspect the existing project structure and relevant files.
- Treat the existing codebase as the source of truth.
- Never assume the project is empty or follows a standard structure.
- Preserve existing functionality unless the task specifically requires changing it.

## 2. SAVE TOKENS
- Be highly token-efficient.
- Do NOT read the entire project unless absolutely necessary.
- Read only files directly relevant to the current task.
- Do NOT repeatedly read files that have already been inspected.
- Do NOT summarize large files unless requested.
- Prefer targeted searches, specific functions, components, and configuration files.
- Avoid unnecessary web searches or external research.

## 3. UNDERSTAND BEFORE EDITING
Before modifying code:
1. Identify the relevant files.
2. Inspect the existing implementation.
3. Understand dependencies and data flow.
4. Make the smallest change necessary.
5. Re-check the affected code after editing.

Do not make changes based on assumptions.

## 4. MINIMAL CHANGES
- Modify only what is required.
- Do not rewrite working code unnecessarily.
- Do not rename files, variables, components, APIs, or database fields unless required.
- Do not introduce new libraries when existing dependencies can solve the problem.
- Do not refactor unrelated code.
- Do not change project architecture without a clear reason.

## 5. CURRENT STATE IS PRIORITY
Always consider the current state of the project before following older instructions.

If previous instructions conflict with the current implementation:
- Inspect the current code.
- Determine what is actually implemented.
- Preserve the working current state.
- Ask before making a major architectural change.

Never blindly recreate functionality that already exists.

## 6. DO NOT OVERENGINEER
- Prefer simple, maintainable solutions.
- Do not add unnecessary abstractions.
- Do not create unnecessary components, services, utilities, APIs, or database tables.
- Build only what is needed for the current requirement.

## 7. ERROR HANDLING
When an error occurs:
1. Identify the actual error.
2. Inspect only the relevant files.
3. Find the root cause.
4. Fix the root cause.
5. Test the affected functionality.

Do not randomly change multiple files hoping the error disappears.

## 8. TESTING
After making changes:
- Run the smallest relevant test/build/check.
- Check for syntax, type, import, and runtime errors.
- Do not run expensive or unrelated tests unless necessary.
- If testing cannot be performed, clearly state what was not tested.

## 9. DEPENDENCIES
Before installing a package:
- Check whether an existing dependency can solve the problem.
- Prefer existing project libraries.
- Avoid unnecessary packages.
- Do not upgrade dependencies unless required.

## 10. SECURITY
- Never expose API keys, passwords, tokens, secrets, or credentials.
- Never hardcode secrets.
- Use environment variables for sensitive configuration.
- Do not commit `.env` files containing secrets.
- Preserve existing security mechanisms.

## 11. DATABASE
- Inspect the existing schema before changing database-related code.
- Do not create duplicate tables or fields.
- Preserve existing data.
- Do not perform destructive migrations without explicit approval.
- Use migrations when the project already uses a migration system.

## 12. UI/UX
- Preserve the existing design system and styling.
- Reuse existing components whenever possible.
- Do not redesign unrelated screens.
- Ensure responsive behavior when modifying UI.
- Match the existing visual style unless a redesign is explicitly requested.

## 13. FILE MANAGEMENT
- Do not create unnecessary files.
- Keep related functionality in the existing project structure.
- Do not duplicate files as backups unless requested.
- Do not modify generated/build files unless necessary.

## 14. GIT
- Do not reset, revert, force-push, delete branches, or discard user changes without explicit approval.
- Never overwrite existing user work.
- Before potentially destructive Git operations, ask for confirmation.
- Keep changes focused on the current task.

## 15. USER CHANGES
- Assume existing uncommitted changes may be intentional.
- Do not remove or overwrite them.
- If a user's existing change conflicts with the requested task, explain the conflict before proceeding.

## 16. COMMUNICATION
Keep responses concise.

Before implementation, briefly state:
- What you found.
- What you will change.

After implementation, report only:
- What changed.
- Files changed.
- Test/check performed.
- Any remaining issue.

Do not provide long explanations unless requested.

## 17. WHEN TO ASK
Ask for clarification only when the missing information materially affects implementation.

Do NOT ask unnecessary questions when a reasonable implementation can be determined from the current project.

For major architectural decisions, destructive operations, production changes, or security-sensitive changes, ask first.

## 18. TASK BOUNDARY
Never expand the task unnecessarily.

If the user asks:
"Fix login"

Do not automatically:
- redesign the dashboard
- update dependencies
- refactor authentication
- change database architecture
- improve unrelated UI

Fix the login issue first.

## 19. PRIORITY ORDER
Follow this priority:

1. Current user request
2. Current project implementation
3. Existing project conventions
5
4. Existing configuration/dependencies