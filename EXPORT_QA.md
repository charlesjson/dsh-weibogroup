# Export validation scope

The plugin reuses the backend's owner-scoped export queue, renderers, quota and
retention policy. Creation requires `api:write`; status and download require
`api:read`. Downloads become native Harness attachments while credentials stay
inside the plugin.

Validation covers CSV, XLSX, JSON, PDF and Markdown/image ZIP exports:

- Create and poll an owned export until ready, then download the same artifact.
- Check byte length, file format, attachment identity and truncation metadata.
- Check cancellation, size limits, redirects and response identity validation.
- Distinguish limited samples from complete archives and report missing assets.

Public examples and automated fixtures use placeholder data. Detailed run
evidence stays private and is not part of the public repository. Do not publish
real users, groups, instance URLs, session/job identifiers or archive contents.

These checks establish the covered behavior; they do not claim sustained-load
capacity or guarantee rendering of every possible media collection.
