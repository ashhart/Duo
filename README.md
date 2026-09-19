<div align="center">

# Duo

### Two models. One workspace.

An OMP plugin for models that talk through a task, agree on a split, and work together.

[![Checks](https://github.com/ashhart/Duo/actions/workflows/check.yml/badge.svg)](https://github.com/ashhart/Duo/actions/workflows/check.yml)
![OMP](https://img.shields.io/badge/OMP-tested%20on%2018.2.6-536dfe)
![Version](https://img.shields.io/badge/version-0.5.2-00897b)

</div>

Keep your current model, choose a partner, and give them a goal.
Duo connects them through OMP's **Agent Hub messages**, with a shared workspace,
working notes, and a live board showing who is doing what.
Each model runs its own conversation; Duo does not share KV caches or model weights.

## Get started

Already using [OMP](https://github.com/can1357/oh-my-pi) with a working model?
Setup is one terminal command, an OMP restart, and a model selection.

```sh
omp plugin install github:ashhart/Duo
```

Restart OMP in your project, type **`/duo`**, and select a partner from the picker.
Then give them a task, for example:

> Add search to this app, agree on who owns the implementation and tests, and check each other's work.

The picker uses the models already configured in OMP, so Duo needs no extra API keys
or configuration file.
You can choose two different models or two concurrent sessions of the same model.
Provider authentication and model downloads, if needed, are part of your OMP setup.

## A conversation you can follow

An illustrative exchange:

```text
Model A  PROPOSE I'll handle search; can you own the tests?
Model B  ASK q1 Should search include archived items?
Model A  ANSWER q1 No, only active items.
Model B  AGREE I'll own the tests, including archived-item exclusion.
```

Messages appear in the main chat and update a board above the editor:

```text
duo room · Model A + Model B
you   ▸ implementing search
peer  ▸ testing search and archived-item exclusion
```

Both models can inspect and edit your project.
They are prompted to negotiate ownership before editing, challenge each other's
assumptions, and verify the result together.
The visible session records their agreement in OMP's todo list; the peer runs in
a background task and communicates through Agent Hub.

## Commands

| Command | What it does |
| --- | --- |
| `/duo` | Open the model picker and start a room. |
| `/duo provider/model` | Start with a configured model directly. |
| `/duo status` | Show the pair and the peer's presence. |
| `/duo disable` | Request peer cancellation and close the room once confirmed. |

Shared working notes live in `.omp/duo/notes.md` in your project.
Room configuration is saved with the OMP session and restored when you resume it.
Open questions appear on the board while the room is running.

## Requirements and troubleshooting

Duo is tested on **OMP 18.2.6** and uses its model catalog, task agents, and Agent Hub.
Both sessions use your existing providers and consume their usual tokens and
compute; choosing the same model twice still opens two sessions.

| Symptom | What to do |
| --- | --- |
| `/duo` is missing | Restart OMP, then check `omp plugin list` for `omp-local-duo`. |
| No models appear | Configure and authenticate a model in OMP first. |
| The peer cannot start | Confirm the selected provider works and allows another concurrent session. |
| The room says cancellation is pending | Let the cancellation turn finish, then retry `/duo disable` if OMP reports a failure. |

The package keeps the name `omp-local-duo` so existing installations continue to work.
To update, rerun the install command and restart OMP.
To remove it, run `omp plugin uninstall omp-local-duo`.

## Development

```sh
git clone https://github.com/ashhart/Duo.git
cd Duo
bun install --frozen-lockfile
bun run check
```

The regression suite covers room lifecycle, peer admission, cancellation,
ASK/ANSWER tracking, message delivery, and session restoration.
`bun run typecheck` checks the plugin's TypeScript against its host interface shim.
For a full integration check against installed OMP, run `bun run check:host`.
It installs the packed plugin into a temporary OMP configuration and verifies peer
admission, native Hub ASK/ANSWER delivery, and question resolution using deterministic
model fixtures, with no paid inference.
For a smaller loading check without an inference request:

```sh
omp --no-session --no-title --no-extensions -e ./scripts/host-smoke.ts -p /duo-smoke
```

See [room behavior](docs/room-behavior.md) for protocol and lifecycle details.
