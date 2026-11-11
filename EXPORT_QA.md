# Export acceptance — 2026-11-11

Plugin 0.3.0 reuses WeiboGroup 1.0.26's existing background ExportService,
owner-scoped queue, renderers, quota and seven-day retention. Creation requires
`api:write`; list/status/download require `api:read`. The plugin streams the
authenticated file into Harness native attachments without exposing credentials
or putting file contents into model context.

The real headless Harness session
`session-9fd0c669-a639-4a0f-b350-5f47f91729d6` queried the `tt` test group,
created all five formats, polled each to `ready`, downloaded each with
`weibo_downloadExport`, and confirmed all jobs through `weibo_listExportJobs`.
No archive-message writes or Weibo sends/recalls were performed by this session.

| Format | Job ID | Bytes | Messages | Truncated |
| --- | --- | ---: | ---: | --- |
| CSV | 836eb004-57b2-47d9-8c36-73805c3ab7f6 | 420 | 3 | true |
| XLSX | f75349ea-97af-488a-b57a-18fa0c160e10 | 17305 | 3 | true |
| JSON | ef62ecc2-b006-45d6-8f58-3a2785296a62 | 772 | 3 | true |
| PDF | 13a35c21-a30c-4738-b521-3f3dedc4e5ee | 95018 | 1 | false |
| ZIP | ef889ee0-5963-426b-8c5d-b44629842ba1 | 648 | 1 | false |

The message exports intentionally requested the latest three messages. Their
truncation flags describe that limited sample. PDF/ZIP selected one sender on
2026-11-11, with zero assets and zero asset failures. Each saved file's SHA-256
matches its attachment ID, byte length matches the API, CSV/JSON contain three
rows, XLSX/ZIP pass ZIP CRC validation, and PDF has valid header/EOF markers.
These checks verify small-file delivery, not sustained export load or rendering
of large media collections.

Validation already completed: 15 plugin tests, plugin typecheck, 1150 backend
tests, 89 final focused backend checks, backend typecheck and migration metadata.
Desktop, web and headless installed packages report 0.3.0; all 29 compiled files
match the source build. Restart an already-running Harness instance to load it.

Local detailed evidence is retained at
`/opt/code/weibogroup/release/export-dsh-qa/` (events and verified attachment
metadata), with deployment verification at
`/opt/code/weibogroup/release/weibogroup-1.0.26-deployment.json`.
