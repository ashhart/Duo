# OMP Local Duo

Local Duo keeps the model already visible in OMP and lets you choose any authenticated model from OMP's current model catalog — including the visible model itself, which runs the room as two concurrent connections.

Run the command with no arguments:

~~~text
/duo
~~~

The picker shows each available model and its configured context window. Select one and press Enter. The selected model joins as an equal member in a hidden OMP task harness, while the current model remains visible.

Both members use the same repository and working directory. They introduce their strengths, inspect the goal and todo list, propose a split through Agent Hub, and agree before either claims work. The visible harness records their agreement in OMP's canonical todo list because task agents do not receive the todo tool; it does not act as manager.

The chat records room entry, negotiation, agreed assignments, blockers, and completion lines such as:

~~~text
[Duo] Model B is working on the API changes
[Duo] Model A is working on the integration tests
~~~

Both sides of the conversation stay visible: the visible member's hub messages echo as [Duo · <model>] lines, incoming peer messages update the board when OMP delivers their message events or when a hub `wait`, `inbox`, or `send await:true` result consumes them, including structured native replies, and a live team board above the editor tracks each member's latest reported task. Unconsumed transcript entries are recovered at the next turn boundary. Messages from other agents stay separate, and duplicate deliveries are shown once.

The plugin includes the current canonical todo snapshot in peer admission and every direct Hub message to the peer. The visible model still owns native todo writes and records changes agreed with the peer; the plugin does not infer completed tasks from arbitrary prose or bypass OMP's parent-owned todo tool.

Members ask each other structured questions with `ASK <id> <question>` and `ANSWER <id> <answer>` (send an ASK with `await: true` when blocking on the reply). Unanswered questions appear on the team board and as a turn-start reminder until resolved, with at most three open at once. The room also keeps shared working notes in `.omp/duo/notes.md` — sections DECISIONS, QUESTIONS, CLAIMS, OPEN, append-only — so agreements and claims survive context compaction; both members read them before proposing and record the split and file claims there.

Rooms survive restarts: the room is persisted in the session file and rebuilt on resume, with the peer model override re-installed automatically. Wake the parked hidden member with a hub message, or admit it once more if it is gone.

Use `/duo models` to list configured model IDs and `/duo help` for command help.
Use `/duo status` to inspect the room and `/duo stop` or `/duo disable` to close it.
Bypass the picker with `/duo provider/model` to keep your current model, or
`/duo provider/model-a provider/model-b` to select both. The first becomes your
visible model and stays selected after the room closes; the second joins as the peer.
Both selectors are resolved before switching models. A live room must close before
another pair can be selected.

To close the room, /duo disable requests native Hub agent cancellation with `op: "cancel"` and `ids: ["DuoPeer"]`. While cancellation is pending, the plugin blocks new tool work and room replacement, and reports the room closed only after Hub confirms cancellation or that the peer is absent. Failed or ambiguous cancellation stays visible and can be retried with /duo disable. In print/RPC mode, a subsequent model turn must consume the queued cancellation request. After confirmation, the original model override and thinking level are restored. Shutting down OMP clears runtime state without reopening the room, while retaining its saved configuration for resume. Subagent spawns that do not target duo-peer pass through untouched while the room is active.

Install or relink the local plugin, then restart OMP:

~~~bash
omp plugin link /absolute/path/to/omp-local-duo
~~~

Run `bun test` for the regression suite and `bun run typecheck` for strict TypeScript checks (the host import is typed by a small shim in `types/`). To check loading, room commands, and thinking restoration against the installed OMP without inference, run `omp --no-session --no-title --no-extensions -e ./scripts/host-smoke.ts -p /duo-smoke` from this directory.
