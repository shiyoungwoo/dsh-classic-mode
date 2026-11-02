# dsh-classic-mode

A DeepSeek Harness (DSH) bundle that adds a **Classic mode** button to the Web UI sidebar. One click starts the `classic` profile — a DSH instance without the DS Bot team layer — and opens it in Safari, reusing the already running instance when one exists.

[中文说明](#中文说明)

## What it solves

DS Bot mode and classic Agent mode share one data directory (`~/.dsh`) but render different UIs. DS Bot mode has no right-hand sidebar, so UI work needs the classic shell; the classic shell needs a separate running instance. This bundle removes the manual step of starting that instance and pasting its tokenized URL into a browser.

- **Host half** (`index.js`): reads `~/.dsh/classic-mode/state.json`, reuses a live process started by this same host, otherwise spawns `dsh --profile <profile> --no-open --port <port>`, captures the `?token=` URL from its output, writes state, and opens the browser. It also stops a server left over from a previous host run (see [Stale instance cleanup](#stale-instance-cleanup)).
- **Client half** (`client.js`): registers a button in the `sidebar.footer.action` slot using the official DeepSeek fish logo, matching the DS Bot entry. The button calls `GET /classic-mode/open`. It shows on every page, the classic Agent page and the DS Bot page alike, and needs no ds-bot.

## Requirements

- DSH `>=0.2.1-rc.3 <0.3.0` (Web or Desktop), Node `>=22.19`.
- A second DSH profile that contains the classic composition (default name `classic`).
- macOS, for `open -a <browser>`. On other platforms, point `browser` at a launcher you have, or read the returned `url` yourself.

## Install

1. Add this package to a profile, either from a checkout or from GitHub:

   ```sh
   pnpm add link:/path/to/dsh-classic-mode
   # or: pnpm add github:shiyoungwoo/dsh-classic-mode
   ```

2. Append the entry list in [`cordis.patch.yml`](cordis.patch.yml) to the profile's bundle list, or let the package's own patch apply, then set `config` (see below).

3. Restart DSH, or toggle the bundle in the Plugins page.

## Configuration

`cordis.patch.yml` ships placeholders. Set every field for your machine:

| Field | Meaning |
| --- | --- |
| `cliPath` | Absolute path to the `dsh` launcher. Required. Desktop example: `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`. |
| `profile` | Profile to launch. Default `classic`. |
| `port` | Loopback port for the classic server. Default `3090`. Keep it free. |
| `browser` | Application name for `open -a`. Default `Safari`. |

To keep machine paths out of the package, override the row in your own profile's `cordis.patch.yml` instead of editing this one:

```yaml
- id: local-classic-mode
  name: '@local/dsh-classic-mode'
  config:
    cliPath: /Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh
    profile: classic
    port: 3090
    browser: Safari
```

## Stale instance cleanup

The classic server is spawned detached, so it outlives the DSH host process that started it. After a DSH restart that leftover server still runs and still holds every Harness session it has open, so another DSH instance (the desktop app, another `dsh web`) reports those sessions as **already in use** until the leftover is gone.

The plugin records the host process id in `state.json` and stops such a leftover in two places:

- when the bundle loads in a host process that did not start it;
- when the button is clicked and the recorded server belongs to an earlier host process.

A process is only signalled when its command line carries this plugin's `profile` and `port` and names a DSH entry point; a stale pid that has been reused by an unrelated process is reported, not killed. A server started by the current host process is reused, never restarted.

## Security notes

- `/classic-mode/open` answers before DSH Connection authentication, so it rejects any request whose `Origin` header does not match the serving host (cross-site requests).
- The route only accepts `GET`; other methods return `405`.
- The spawned server binds loopback and its token is stored in `~/.dsh/classic-mode/state.json` (mode of your home directory). Do not copy that file into a repository.

## Files

- `index.js` — host: process supervision, state file, `/classic-mode/open` route.
- `client.js` — client: sidebar button and fetch call.
- `cordis.patch.yml` — bundle patch with placeholder config.
- `locale/zh.json`, `locale/en.json` — button label.

## 中文说明

这个插件在 DSH 网页版侧栏加一个「经典模式」按钮。点击后：若 classic 实例未运行，就启动 `dsh --profile classic --no-open --port 3090`，从输出里取出带 token 的地址，再用 Safari 打开；已在运行则直接复用。

按钮在两类页面都显示：经典 Agent 页和 DS Bot 页，且不依赖 ds-bot。

配置项：`cliPath`（必填，dsh 启动器绝对路径）、`profile`（默认 `classic`）、`port`（默认 `3090`）、`browser`（默认 `Safari`）。仓库里的 `cordis.patch.yml` 只放占位值，请在你自己的 profile 补丁里按上面的 `id: local-classic-mode` 覆盖配置，避免把本机路径写进仓库。

残留实例清理：classic 服务是 detached 启动的，会活过启动它的 DSH 进程。DSH 重启后，这个残留服务仍在运行，并继续占用它打开的 Harness 会话，其他 DSH 实例（桌面端、另一个 `dsh web`）就会报「当前会话已被占用」。插件在 `state.json` 里记录启动它的宿主进程 PID，并在两处清理这种残留：插件在新宿主进程加载时；以及点击按钮时发现记录的实例属于更早的宿主进程。只有命令行同时带本插件的 `profile`、`port` 且是 DSH 入口进程才会被终止；PID 被无关进程复用时只报告、不终止。当前宿主进程自己启动的实例始终复用，不重启。

## License

MIT
