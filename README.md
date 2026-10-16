# opencode-project-tabs

An [OpenCode](https://opencode.ai) TUI plugin that keeps your session tabs organised by project.

- Sorts the built-in tab bar so each project's sessions sit together, the most recently active
  project first and the newest session first within it.
- Adds a **Tabs by project** list to the session sidebar with project headers and how long ago
  each session was last active.

```
▼ Tabs by project

▼ atelier ~/scratchpad              now
  ● Executing the tools plan        now
  • ZMM Impl                         2m
  • Setting up Ps...pts in Atelier  26m

▼ atelier ~/GitHub/applause          6m
  • Deploying fixes to projects      6m
  • OpenCode v2 upgrade benefits     2d

▶ celld-fork (1)                     2d
```

## Features

- **Grouped and sorted tabs.** The built-in tab bar is reordered by project and recent activity.
  Turn this off from the command palette with **Stop sorting tabs by project**.
- **Last activity.** The time since the agent last finished in that session, or `now` while it is
  working.
- **Status dots.** A colored dot while the session is working, `!` when it needs you and a red dot
  after an error.
- **Collapsible projects.** Click a project header to collapse it. A collapsed project shows how
  many sessions it holds and its most urgent status. Collapsed projects are remembered.
- **Full titles on hover.** A title that does not fit scrolls right to left, like the titles in
  OpenCode's own tab bar.
- **Right-click menu**, like the one on OpenCode's own tabs: New session, Rename, Copy session ID,
  Close and Delete. Delete asks for a second click before it deletes.
- **Same-named projects** are told apart by their parent folder.

## Requirements

- **OpenCode 2.** Tested with OpenCode 2.0.28. Check yours with `opencode --version`.
  The plugin uses the OpenCode 2 CLI plugin API, which OpenCode provides at runtime, so there is
  nothing to install with npm or Bun.
- **Session tabs turned on.** Set `tabs.mode` to `auto` or `on` in `cli.json`. Sorting and
  **Close** need them. With tabs off, the list still shows your last open tabs and opens them,
  but it no longer updates. The `vertical` tab layout is recommended but not required.
- **The session sidebar.** The list appears at the top of the sidebar, so keep `session.sidebar`
  set to `auto` and use a terminal wide enough to show it.
- **Mouse support.** Keep `mouse` turned on in `cli.json` (the default) for clicking,
  right-clicking and hovering.
- **Copy session ID** uses the terminal clipboard (OSC 52). Inside tmux, enable it with
  `set -g set-clipboard on`.

## Installation

1. Clone a release anywhere on your machine:

   ```sh
   git clone --branch v0.1.0 https://github.com/cnicolov/opencode-project-tabs.git \
     ~/.local/share/opencode-project-tabs
   ```

2. Add the folder's absolute path to `plugins` in your CLI settings,
   `~/.config/opencode/cli.json` (or `$XDG_CONFIG_HOME/opencode/cli.json`). Keep any plugins you
   already list, and make sure session tabs are on:

   ```json
   {
     "$schema": "https://opencode.ai/v2/cli.json",
     "plugins": ["/Users/you/.local/share/opencode-project-tabs"],
     "tabs": {
       "mode": "auto",
       "layout": "vertical"
     }
   }
   ```

   Print the exact path to paste with `echo ~/.local/share/opencode-project-tabs`.

3. Restart OpenCode and open a session. **Tabs by project** appears at the top of the sidebar.

To try it once without changing your settings:

```sh
OPENCODE_CLI_CONFIG_CONTENT='{"plugins":["'"$HOME"'/.local/share/opencode-project-tabs"]}' opencode
```

This replaces your `plugins` list for that run only.

## Updating

```sh
git -C ~/.local/share/opencode-project-tabs fetch --tags
git -C ~/.local/share/opencode-project-tabs checkout v0.1.0
```

Replace `v0.1.0` with the release you want, then restart OpenCode.

## Uninstalling

Remove the path from `plugins` in `cli.json`, restart OpenCode, then delete the folder.

## Good to know

- Plugins cannot draw inside OpenCode's own tab bar, so project headers and times appear in the
  sidebar list. The tab bar itself is only reordered.
- Tabs move as sessions become active, so the `Ctrl+number` shortcuts point at different tabs over
  time. Turn sorting off from the command palette if you prefer a fixed order.
- Sessions in a folder that is not a git repository are grouped by their folder.

## License

[MIT](LICENSE)
