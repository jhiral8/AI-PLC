/**
 * @file coreflow CLI
 * @description `run` takes arguments and returns an exit code, so tests can drive it without
 * spawning processes. `main.ts` wires it to the real process.
 */

import { parseArgs } from "node:util";
import {
  approveGate,
  formatGate,
  formatScan,
  formatSuspects,
  formatTrace,
  listTemplates,
  newArtifact,
  Project,
  runGates,
} from "@coreflow/store";
import { LinkType } from "@coreflow/trace";
import { runHook } from "./hook";
import { writeKiroHooks } from "./kiro";

export interface CliIO {
  cwd: string;
  env: NodeJS.ProcessEnv;
  out: (text: string) => void;
  err: (text: string) => void;
  readStdin: () => Promise<string>;
  /** How this CLI is invoked, used when writing Kiro hooks. */
  selfCommand: string;
}

export const USAGE = `coreflow: trace product evidence to requirements, code and tests

Usage:
  coreflow init [--kiro] [--force]       Create .coreflow/ (and Kiro hooks with --kiro)
  coreflow scan                          Read Markdown definitions and rehash files
  coreflow link <from> <to> [--type T]   Record that <to> relies on <from>
  coreflow unlink <from> <to> [--type T]
  coreflow trace <id|file> [--up|--down] [--json]
  coreflow suspects [--json] [--check]   List items whose upstream changed (--check exits 1 if any)
  coreflow confirm <id|file> [--from <id>]
  coreflow mark-changed <id> --reason "..."
  coreflow work [<id>...] [--clear] [--session S]   Set what edits are linked to
  coreflow new <template> "<title>" [--id ART-4] [--stage S] [--from INS-1,INS-2]
  coreflow new --list                    List artifact templates
  coreflow gate [<gate|stage>] [--json]  Run stage gates (exits 1 if any is blocked)
  coreflow approve <gate|stage> --by <name>   Approve what is in the stage now
  coreflow hook <claude|kiro> [--event E] [--file F] [--prompt P]

Link types: ${LinkType.options.join(", ")}`;

class UsageError extends Error {}

function need(value: string | undefined, what: string): string {
  if (!value) throw new UsageError(`Missing ${what}.`);
  return value;
}

export async function run(argv: string[], io: CliIO): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "hook") return hook(rest, io);
  const { values, positionals } = parseArgs({
    args: rest,
    allowPositionals: true,
    strict: true,
    options: {
      type: { type: "string", short: "t" },
      up: { type: "boolean" },
      down: { type: "boolean" },
      json: { type: "boolean" },
      check: { type: "boolean" },
      from: { type: "string" },
      reason: { type: "string" },
      id: { type: "string" },
      stage: { type: "string" },
      by: { type: "string" },
      list: { type: "boolean" },
      clear: { type: "boolean" },
      session: { type: "string" },
      kiro: { type: "boolean" },
      force: { type: "boolean" },
      event: { type: "string" },
      file: { type: "string" },
      prompt: { type: "string" },
      help: { type: "boolean", short: "h" },
    },
  });

  if (!command || command === "help" || values.help) {
    io.out(USAGE);
    return command ? 0 : 1;
  }

  const root = Project.findRoot(io.cwd, io.env);

  if (command === "init") {
    const project = Project.init(root);
    const scan = await project.scan();
    project.save();
    io.out(`Initialised CoreFlow in ${root}/.coreflow`);
    io.out(formatScan(scan));
    if (values.kiro) {
      const { path, written } = writeKiroHooks(root, io.selfCommand, values.force);
      io.out(written ? `Wrote Kiro hooks to ${path}` : `${path} already exists; use --force to replace it`);
    }
    return 0;
  }

  if (!Project.isInitialised(root)) {
    io.err(`No .coreflow/ found from ${io.cwd}. Run "coreflow init" first.`);
    return 1;
  }
  const project = Project.open(root);

  switch (command) {
    case "scan": {
      const scan = await project.scan();
      project.save();
      io.out(formatScan(scan));
      return 0;
    }
    case "link":
    case "unlink": {
      const from = need(positionals[0], "<from>");
      const to = need(positionals[1], "<to>");
      const type = values.type ? LinkType.parse(values.type) : undefined;
      await project.scan();
      if (command === "link") {
        const link = project.link(from, to, type ?? "derived_from");
        io.out(`Linked ${link.from} -> ${link.to} (${link.type})`);
      } else {
        const removed = project.graph.unlink(project.resolveRef(from), project.resolveRef(to), type);
        io.out(`Removed ${removed} link${removed === 1 ? "" : "s"}`);
      }
      project.save();
      return 0;
    }
    case "trace": {
      await project.scan();
      project.save();
      const id = project.resolveRef(need(positionals[0], "<id|file>"));
      const direction = values.up ? "up" : values.down ? "down" : "both";
      if (values.json) {
        io.out(
          JSON.stringify(
            {
              node: project.graph.getNode(id),
              upstream: direction === "down" ? [] : project.graph.upstream(id),
              downstream: direction === "up" ? [] : project.graph.downstream(id),
            },
            null,
            2,
          ),
        );
      } else io.out(formatTrace(project.graph, id, direction));
      return 0;
    }
    case "suspects": {
      await project.scan();
      project.save();
      const items = project.graph.suspects();
      if (values.json) io.out(JSON.stringify(items, null, 2));
      else io.out(formatSuspects(items));
      return values.check && items.length > 0 ? 1 : 0;
    }
    case "confirm": {
      await project.scan();
      const to = project.resolveRef(need(positionals[0], "<id|file>"));
      const from = values.from ? project.resolveRef(values.from) : undefined;
      const count = project.graph.confirm(to, from);
      project.save();
      io.out(`Confirmed ${count} link${count === 1 ? "" : "s"} into ${to}`);
      return 0;
    }
    case "mark-changed": {
      const id = project.resolveRef(need(positionals[0], "<id>"));
      project.graph.markChanged(id, need(values.reason, "--reason"));
      project.save();
      io.out(`Marked ${id} changed. ${project.graph.downstream(id).length} downstream items are now suspect.`);
      return 0;
    }
    case "work": {
      await project.scan();
      project.save();
      const session = values.session ?? "default";
      const active = values.clear ? project.setActive(session, []) : positionals.length ? project.setActive(session, positionals) : project.activeIds(session);
      io.out(active.length ? `Edits in session "${session}" link to: ${active.join(", ")}` : `Nothing active in session "${session}".`);
      return 0;
    }
    case "new": {
      await project.scan();
      if (values.list) {
        for (const t of listTemplates(project)) io.out(`${t.name.padEnd(22)} ${t.description} (stage: ${t.stage})`);
        return 0;
      }
      const { id, path } = newArtifact(project, {
        template: need(positionals[0], "<template> (see coreflow new --list)"),
        title: need(positionals[1], '"<title>"'),
        id: values.id,
        stage: values.stage,
        from: values.from ? values.from.split(/[\s,]+/).filter(Boolean) : undefined,
      });
      project.save();
      io.out(`Created ${id} at ${path}. Fill in each section and cite sources like [INS-3].`);
      return 0;
    }
    case "gate": {
      await project.scan();
      project.save();
      if (project.config.gates.length === 0) {
        io.out('No gates defined. Add them under "gates" in .coreflow/config.json.');
        return 0;
      }
      const reports = runGates(project, positionals[0]);
      if (values.json) io.out(JSON.stringify(reports, null, 2));
      else io.out(reports.map(formatGate).join("\n\n"));
      return reports.some((r) => r.status === "blocked") ? 1 : 0;
    }
    case "approve": {
      await project.scan();
      project.save();
      const record = approveGate(project, need(positionals[0], "<gate|stage>"), need(values.by, "--by <name>"));
      io.out(`Approved ${Object.keys(record.hashes).join(", ")} for gate ${record.gate} as ${record.by}.`);
      io.out("The approval stops counting if any of them changes.");
      return 0;
    }
    default:
      throw new UsageError(`Unknown command: ${command}`);
  }
}

/** Hooks must never fail, including on a flag a host adds, so parsing is lenient here. */
async function hook(args: string[], io: CliIO): Promise<number> {
  const { values, positionals } = parseArgs({
    args,
    allowPositionals: true,
    strict: false,
    options: { event: { type: "string" }, file: { type: "string" }, prompt: { type: "string" } },
  });
  const text = (v: unknown) => (typeof v === "string" ? v : undefined);
  const output = await runHook({
    host: positionals[0] === "kiro" ? "kiro" : "claude",
    stdin: await io.readStdin().catch(() => ""),
    file: text(values.file),
    prompt: text(values.prompt),
    event: text(values.event),
    cwd: io.cwd,
    env: io.env,
  });
  if (output) io.out(output);
  return 0;
}

/** Runs the CLI and turns errors into messages. */
export async function runSafe(argv: string[], io: CliIO): Promise<number> {
  try {
    return await run(argv, io);
  } catch (error) {
    if (argv[0] === "hook") return 0;
    io.err(`coreflow: ${(error as Error).message}`);
    if (error instanceof UsageError) io.err(`Run "coreflow help" for usage.`);
    return 2;
  }
}
