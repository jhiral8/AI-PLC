/**
 * @file New artifacts from templates
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { COREFLOW_DIR, type Project } from "./project";
import { slugify } from "./markdown";
import { renderTemplate, TEMPLATES, type Template } from "./templates";

export interface NewArtifactOptions {
  template: string;
  title: string;
  /** Defaults to the next free ART-n. */
  id?: string;
  stage?: string;
  /** IDs this artifact is derived from, written into front-matter. */
  from?: string[];
  date?: string;
}

/** Built-in templates plus any in `.coreflow/templates/`, which win on name clashes. */
export function listTemplates(project: Project): Template[] {
  const byName = new Map(TEMPLATES.map((t) => [t.name, t]));
  const dir = join(project.root, COREFLOW_DIR, "templates");
  if (existsSync(dir)) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".md")).sort()) {
      const name = file.slice(0, -3);
      const text = readFileSync(join(dir, file), "utf8");
      const kind = text.match(/^kind:\s*(\S+)/m)?.[1] ?? name;
      const stage = text.match(/^stage:\s*(\S+)/m)?.[1];
      byName.set(name, {
        name,
        description: `Project template (.coreflow/templates/${file})`,
        kind,
        stage: stage && !stage.includes("{{") ? stage : (byName.get(name)?.stage ?? "draft"),
        text,
      });
    }
  }
  return [...byName.values()];
}

export function nextArtifactId(project: Project, prefix = "ART"): string {
  let max = 0;
  for (const node of project.graph.listNodes()) {
    const m = node.id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${max + 1}`;
}

/** Writes a new artifact file and scans it. Returns its ID and repo-relative path. */
export function newArtifact(project: Project, options: NewArtifactOptions): { id: string; path: string } {
  const templates = listTemplates(project);
  const template = templates.find((t) => t.name === options.template);
  if (!template) {
    throw new Error(`Unknown template "${options.template}". Templates: ${templates.map((t) => t.name).join(", ")}`);
  }
  const id = options.id ?? nextArtifactId(project);
  if (project.graph.getNode(id)) throw new Error(`${id} already exists at ${project.graph.getNode(id)!.location}`);
  for (const upstream of options.from ?? []) {
    if (!project.graph.getNode(upstream)) throw new Error(`Unknown node: ${upstream}`);
  }
  const path = `${project.config.artifactsDir.replace(/\/+$/, "")}/${id.toLowerCase()}-${slugify(options.title)}.md`;
  const abs = join(project.root, path);
  if (existsSync(abs)) throw new Error(`${path} already exists`);
  mkdirSync(join(abs, ".."), { recursive: true });
  writeFileSync(
    abs,
    renderTemplate(template, {
      id,
      title: options.title,
      stage: options.stage,
      derivedFrom: options.from,
      date: options.date ?? new Date().toISOString().slice(0, 10),
    }),
  );
  if (!project.isDefinitionFile(path)) {
    throw new Error(`${path} was written, but it is outside "include" in .coreflow/config.json, so it will not be scanned`);
  }
  project.scanFile(path);
  return { id, path };
}
