/** Check a packed or Git-installed plugin in an isolated OMP configuration. */
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = await mkdtemp(join(tmpdir(), "duo-check-"));
const config = join(scratch, "config");
const workspace = join(scratch, "workspace");
await mkdir(workspace);
const env = {
  ...process.env,
  PI_CONFIG_DIR: relative(homedir(), config),
  PI_CODING_AGENT_DIR: join(config, "agent"),
  OMP_PROFILE: "",
  PI_PROFILE: "",
};

async function run(args: string[], cwd = workspace): Promise<string> {
  const child = Bun.spawn(args, { cwd, env, stdout: "pipe", stderr: "pipe" });
  const timer = setTimeout(() => child.kill(), 45_000);
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
    ]);
    assert.equal(code, 0, `${args[0]} failed:\n${stderr}\n${stdout}`);
    return stdout;
  } finally { clearTimeout(timer); }
}

try {
  const source = process.argv[2];
  if (source) {
    const start = performance.now();
    await run(["omp", "plugin", "install", source]);
    console.log(`Git install: ${((performance.now() - start) / 1000).toFixed(2)}s`);
  } else {
    const pkg = await Bun.file(join(root, "package.json")).json();
    await run(["bun", "pm", "pack", "--destination", scratch], root);
    await run(["tar", "-xzf", join(scratch, `${pkg.name}-${pkg.version}.tgz`), "-C", scratch]);
    await run(["omp", "plugin", "link", join(scratch, "package")]);
  }
  const result = await run([
    "omp", "--no-session", "--no-title", "--no-skills", "--no-rules", "--no-lsp",
    "-e", join(root, "scripts/host-provider.ts"), "--model", "duo-check/visible",
    "--smol", "duo-check/visible", "--tools", "task,hub", "--mode", "json", "--max-time", "30s",
    "-p", "/duo duo-check/peer", "Run the Duo integration check.",
  ]);
  const events = result.split("\n").filter(line => line.startsWith("{")).map(line => JSON.parse(line));
  const messages = events.filter(event => event.type === "message_end").map(event => event.message);
  assert.ok(messages.some(message => message.role === "toolResult" && message.toolName === "hub" &&
    !message.isError && message.details?.waited?.from === "DuoPeer" &&
    message.details.waited.body === "ANSWER q1 DUO_PEER_RECEIVED"), "Native Hub must deliver the peer's answer");
  assert.ok(messages.some(message => message.customType === "local-duo-room" &&
    message.details?.kind === "answered" && message.details.refId === "q1" &&
    message.details.resolved === true), "The delivered answer must clear the board's pending question");
  assert.ok(messages.some(message => message.role === "assistant" && message.content?.some((part: any) =>
    part.type === "text" && part.text.startsWith("DUO_INTEGRATION_PASSED:"))), "Visible model must receive the answer");
  assert.ok(!messages.some(message => message.role === "assistant" && message.stopReason === "error"),
    "No provider or model errors may be hidden by the CLI exit code");
  console.log("PASS: package loading, peer discovery, selected-model admission, native Hub ASK/ANSWER, and question resolution.");
  console.log("Providers are deterministic fixtures; no paid inference or user credentials are used.");
} finally { await rm(scratch, { recursive: true, force: true }); }
