<p align="center">
  <img src="assets/logo.png" width="96" alt="Skill Session Profiles logo">
</p>

# Skill Session Profiles

[简体中文](README.zh-CN.md)

A macOS app for managing global and project-specific Codex skill defaults,
reusable profiles, and the persistent configuration used by subsequently
opened Codex tasks.

## Download

Download the latest Apple Silicon build from
[GitHub Releases](https://github.com/blueroy00/skill-session-profiles/releases/latest).
The app is currently unsigned and not notarized.

## Screenshots

### Task configuration

[![Task configuration](docs/images/task-configuration-en.png)](docs/images/task-configuration-en.png)

### Profile editor in Task Configuration

[![Reusable profile editor](docs/images/profile-editor-en.png)](docs/images/profile-editor-en.png)

### Dark theme

[![Dark theme](docs/images/dark-theme-en.png)](docs/images/dark-theme-en.png)

## Features

- Browse installed Codex skills and filter them by name or source.
- Enable or disable all skills in the current filtered result.
- Select, create, edit, copy, delete, import, and export reusable profiles
  directly from Task Configuration.
- Save profiles as reusable templates, then explicitly apply one on top of
  global defaults for subsequently opened tasks.
- Choose compatibility mode to save project-specific Skill guidance in
  `AGENTS.md`, or write it directly to the project's `.codex/config.toml`.
- Let a project follow a reusable task profile or maintain independent
  overrides.
- Select local projects in the same order as the Codex project sidebar.
- Edit global skill defaults through the Codex App Server contract.
- Switch between Chinese and English, light and dark themes.

## How It Works

The Electron app reads and writes configuration through Codex App Server APIs;
it does not edit `~/.codex/config.toml` directly.

Saving a profile only updates the reusable template. Selecting and applying it
from Task Configuration writes its explicit overrides to the user-level
configuration; editing the template later does not silently reapply it.

Project configurations contain explicit overrides only. Compatibility mode is
enabled by default. It updates a marked, managed block in the project-root
`AGENTS.md` through the Codex App Server filesystem API while preserving all
unrelated project guidance. If the project root already contains
`AGENTS.override.md`, the app updates that active file instead because Codex
gives it precedence over `AGENTS.md`. With compatibility mode disabled, the app
updates `[[skills.config]]` in the project's `.codex/config.toml` while
preserving its other TOML settings and comments. The selected mode is stored in
local app preferences.

When a project follows a task profile, the app persists that binding and
resynchronizes the project whenever the profile is edited or replaced through
import. Deleting the profile removes the binding while preserving the project's
last synchronized configuration.

Compatibility mode works around incomplete project override handling for some
plugin-provided Skills in Codex CLI 0.140.0. Project `AGENTS.md` guidance is
loaded after global guidance, so it can instruct Codex not to invoke selected
Skills in that project without changing global configuration. This is
instruction-level control: disabled Skills can still appear in discovery, and
an explicitly allowed Skill must already be installed, loaded, and enabled
globally. Native mode uses Codex's project configuration behavior, so its exact
effect depends on the installed Codex version.

User data is stored locally at:

```text
~/.codex/skill-session-profiles
```

The app supports macOS on Apple Silicon and Windows x64. Builds are unsigned;
macOS builds are not notarized.

## Requirements

- macOS on Apple Silicon or Windows x64
- Codex CLI installed and available in `PATH`

## Development

```bash
npm ci
npm run desktop
```

Useful commands:

```bash
npm run build
npm test
npm run test:e2e
npm run test:codex-integration
npm run test:electron
npm run dist:mac
npm run dist:win
```

`test:codex-integration` launches a real Codex app-server process.
`test:electron` launches the real desktop app. Both commands require a working
local Codex installation. The GitHub CI workflow runs only the portable build,
unit, and browser E2E checks.

## Build Artifacts

```bash
npm run dist:mac
# On Windows:
npm run dist:win
```

The macOS `.app` bundle and DMG, or the Windows NSIS installer, are written to
`output/`. Release artifacts are not committed to the repository.

## Security

Please report vulnerabilities through GitHub's private security advisory
feature. See [SECURITY.md](SECURITY.md).

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) and the
[Code of Conduct](CODE_OF_CONDUCT.md) before opening a pull request.

## License

Licensed under the [GNU General Public License v3.0 only](LICENSE).
