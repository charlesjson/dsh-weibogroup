# Harness message pagination verification

Package: 0.6.3. Date: 2026-11-17 (Asia/Shanghai).

- Search/window: default 10, maximum 20 messages, 24,000-byte text budget.
- Context: `pageSize`/`pageCursor`, bound to normalized scope and context snapshot.
- Compact output preserves complete message text, resource identifiers and status;
  full details remain available. No REST contract or vendor implementation changes.
- Typecheck passed. Full plugin suite: 50 tests passed, no failures/skips.
- Native Harness execution verifies registration, parameter validation and context
  page output. Tests cover cursor mismatch/staleness, byte-driven shrinking,
  Unicode text fidelity, search continuation, both window directions, scoped
  sender filtering, cancellation, total deadline and configured message cap.

Private captured-result replay (fixtures were not added to the repository):

| Result | Original bytes | Messages | Pages | Largest output page bytes |
| --- | ---: | ---: | ---: | ---: |
| Context | 106064 | 121 | 13 | 9790 |
| Search | 90636 | 100 | 10 | 10039 |

Message IDs and order match the original captured arrays exactly. Search replay
uses a local paginated fixture; this is not an assertion of a frozen live archive.
Live read-only API verification also passed: 7 context messages across 3 pages,
no duplicates, largest text page 3397 bytes. No production data was changed.
A single record exceeding the list budget returns
`MESSAGE_TOO_LARGE` and an exact resource key instead of a clipped message.
Single-record detail reads can still produce large output; invoke them on demand.

Installation: use github:charlesjson/dsh-weibogroup#v0.6.3 or the local tarball
dsh-weibogroup-0.6.3.tgz. The desktop profile is managed exclusively by the
Electron application: install through the desktop plugin UI and restart that
instance to load the new schemas and system instructions.
