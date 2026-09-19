<div align="center">

<img src="assets/duo-banner.png" alt="Duo: Two models. One workspace. Two AI partners exchange messages." width="1200">

An OMP plugin for models that talk through a task, agree on a split, and work together.

[![Checks](https://github.com/ashhart/Duo/actions/workflows/check.yml/badge.svg)](https://github.com/ashhart/Duo/actions/workflows/check.yml)
![OMP](https://img.shields.io/badge/OMP-tested%20on%2018.2.6-536dfe)
![Version](https://img.shields.io/badge/version-0.5.3-00897b)

</div>

Keep your current model, choose a partner, and give them a goal.
Duo connects them through OMP's **Agent Hub messages**, with a shared workspace,
working notes, and a live board showing who is doing what.
Each model runs its own conversation; Duo does not share KV caches or model weights.

## Get started

With OMP installed and your models authenticated, install Duo in your terminal:

```sh
omp plugin install github:ashhart/Duo
```

Open a terminal in the project you want the models to work on, then launch OMP:

```sh
omp
```

Inside OMP, type:

```text
/duo
```

Choose a partner and press Enter. Your current OMP model is the first member;
the model you pick is the second. Once the room opens, type a task normally:

> Add search to this app, agree on who owns the implementation and tests, and check each other's work.

**Want to choose both models in one command?** First see your configured model IDs:

```text
/duo models
```

Then use two IDs from that list:

```text
/duo provider/model-a provider/model-b
```

Replace `provider/model-a` and `provider/model-b` with your actual model IDs.
The first becomes your visible OMP model; the second joins as its partner.
Use the same ID twice to run two sessions of one model.
If you want to keep your current model, supply only the partner's ID:

```text
/duo provider/model-b
```

Duo uses your existing OMP providers, so it needs no separate API keys or config file.
If OMP is already running when you install or update Duo, restart it first.
For a fresh OMP installation, follow [OMP's setup instructions](https://github.com/can1357/oh-my-pi)
and configure at least one working model before starting Duo.
Provider setup and any model downloads take additional time.

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
| `/duo` | Keep your current model, open the picker, and choose a partner. |
| `/duo provider/model` | Keep your current model and start with this partner. |
| `/duo provider/model-a provider/model-b` | Select both models: first is visible, second is the partner. |
| `/duo models` | List configured model IDs to use in the commands above. |
| `/duo help` | Show the commands and next steps inside OMP. |
| `/duo status` | Show the pair and the peer's presence. |
| `/duo stop` | Request peer cancellation and close the room once confirmed. |
| `/duo disable` | Alias for `/duo stop`. |

Shared working notes live in `.omp/duo/notes.md` in your project.
To change partners, run `/duo stop`, wait for closure, then start another room.
Selecting two models changes your visible OMP model; it stays selected after the room closes.
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
