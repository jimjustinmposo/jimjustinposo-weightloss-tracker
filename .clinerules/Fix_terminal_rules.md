# Windows Terminal Rules

## Shell

The development environment uses Windows PowerShell.

Always generate commands compatible with PowerShell.

DO NOT use CMD syntax such as:

- `cd /d`
- `&&`
- `dir /a /s /b`
- `del`
- `copy`
- `move`

Prefer PowerShell commands:

- Change directory:
  `Set-Location "D:\Webapps Project\ProjectName"`

- List files:
  `Get-ChildItem`

- Recursive file listing:
  `Get-ChildItem -Recurse`

- Delete:
  `Remove-Item`

- Copy:
  `Copy-Item`

- Move:
  `Move-Item`

For sequential commands, execute them separately instead of using CMD `&&`.

Example:

WRONG:
`cd /d "D:\Project" && npm install && npm run dev`

CORRECT:
`Set-Location "D:\Project"`
`npm install`
`npm run dev`

When possible, prefer a single PowerShell command that performs the required operation.

Before executing a terminal command, ensure the syntax matches PowerShell.

Do not switch shells unless explicitly requested.