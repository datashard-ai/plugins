# Maintaining the distribution

Only client integration files belong here. Keep product implementations in their
private repositories. Build release executables privately, review the artifacts,
then distribute only the selected binaries with checksums and required third-party
notices. Do not attach private source archives, debug symbols containing private
paths, build logs, credentials or personal databases.

The GitHub-generated source archives for this repository contain integration files;
they must never include product implementation. The package tests enforce a narrow
file allowlist. Adding a new distribution component requires reviewing that allowlist.
Public skill instructions and shell glue are readable by installers.

The Datashard package starts at 0.26.0 in this new marketplace. Both its plugin name
and marketplace name remain datashard to preserve client tool naming. The original
repository is not transferred or deleted by this change. Do not point an old
single-package publishing script at this multi-package repository: such a script
could erase its other packages. This repository needs its own release process.

No hosted MCP connection, account, endpoint or access permission is changed merely
by publishing this repository. Existing installs need the documented marketplace
migration. The mnem0nic preview ships no executable or MCP entry; add those only
when the corresponding release and protocol implementation have been validated.

Before publishing, run the package tests and review the complete Git file list.
Ensure GitHub repository visibility matches the intended distribution audience;
people can install only if they can read the repository. No open-source licence for
private product code is implied by making integration files publicly readable.

This is an independently hosted marketplace, not an Anthropic directory submission.
The directory validator also reports missing licensing metadata, listing icons and
Datashard privacy-policy metadata. Resolve those before submitting to that directory;
ordinary manifest validation does not certify directory eligibility. No product
licensing terms have been invented as part of this packaging change.
