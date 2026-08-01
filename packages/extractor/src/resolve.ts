import { builtinModules } from "node:module";
import path from "node:path";
import type { DefFact, Fact, FileFacts, ImportFact } from "./facts.js";
import { moduleQualname } from "./qualname.js";
import { normalizeSource, shortHash, sloc } from "./hash.js";
import { langForFile } from "./grammars/registry.js";
import type { RepoManifests } from "./manifest.js";
import type { FileChurn } from "./vcs.js";
import type { SymbolEdge, SymbolExternal, SymbolGraph, SymbolUnit } from "./symbol-graph.js";

// Python 3.12 standard library top-level module names (stdlib + de facto stdlib built-ins).
const PYTHON_STDLIB = new Set([
  "os", "sys", "time", "json", "typing", "dataclasses", "pathlib", "hashlib",
  "asyncio", "collections", "functools", "re", "abc", "itertools", "logging",
  "datetime", "math", "random", "subprocess", "io", "contextlib", "enum",
  "argparse", "array", "ast", "base64", "bisect", "builtins", "bz2",
  "calendar", "cgi", "cmath", "codecs", "colorsys",
  "concurrent", "configparser", "contextvars", "copy", "copyreg", "csv",
  "ctypes", "decimal", "difflib", "dis", "email", "encodings", "ensurepip",
  "errno", "faulthandler", "fcntl", "filecmp", "fileinput", "fnmatch",
  "fractions", "ftplib", "gc", "getopt", "getpass", "gettext", "glob",
  "graphlib", "gzip", "hmac", "html", "http", "imaplib", "importlib",
  "inspect", "ipaddress", "keyword", "linecache", "locale", "lzma",
  "mailbox", "mimetypes", "mmap", "multiprocessing", "numbers", "operator",
  "optparse", "pdb", "pickle", "pickletools", "pkgutil", "platform",
  "plistlib", "poplib", "pprint", "profile", "pstats", "pty", "pwd",
  "pyclbr", "pydoc", "queue", "quopri", "reprlib", "resource", "sched",
  "secrets", "select", "selectors", "shelve", "shlex", "shutil", "signal",
  "site", "smtplib", "sndhdr", "socket", "socketserver", "sqlite3", "ssl",
  "stat", "statistics", "string", "stringprep", "struct", "symtable",
  "sysconfig", "syslog", "tabnanny", "tarfile", "telnetlib", "tempfile",
  "termios", "textwrap", "threading", "timeit", "tkinter", "token",
  "tokenize", "tomllib", "trace", "traceback", "tracemalloc", "tty",
  "turtle", "types", "unicodedata", "unittest", "urllib", "uuid",
  "venv", "warnings", "wave", "weakref", "webbrowser", "wsgiref", "xml",
  "xmlrpc", "zipapp", "zipfile", "zipimport", "zlib", "zoneinfo",
  "__future__",
]);

// Node.js builtin module names, without the "node:" prefix.
const NODE_BUILTINS = new Set(builtinModules);

// Import top-level name -> PyPI package name, where the two diverge.
const PYPI_IMPORT_ALIASES: Record<string, string> = {
  jose: "python-jose",
  dotenv: "python-dotenv",
  yaml: "pyyaml",
  jwt: "pyjwt",
  docx: "python-docx",
  cv2: "opencv-python",
  bs4: "beautifulsoup4",
  PIL: "pillow",
};

interface UnitBuild {
  fact: DefFact;
  qualname: string;
  parentQualname: string | null;
}

function unitId(qualname: string): string {
  return `u:${qualname}`;
}

/** Resolves a TS-style relative import ("./pricing", "../orders/repo") to a module qualname. */
function resolveRelativeModule(fromFile: string, moduleSpecifier: string): string | null {
  if (!moduleSpecifier.startsWith(".")) return null;
  const fromDir = path.dirname(fromFile);
  const joined = path.normalize(path.join(fromDir, moduleSpecifier));
  return joined.split(path.sep).join(".");
}

export function resolveGraph(
  files: FileFacts[],
  knownModules: Set<string>,
  manifests: RepoManifests,
  churn: Map<string, FileChurn>,
): SymbolGraph {
  const unitsByQualname = new Map<string, UnitBuild>();
  const childrenOf = new Map<string, string[]>();

  for (const ff of files) {
    const modQualname = moduleQualname(ff.file);
    const defFacts = ff.facts.filter((f): f is DefFact => f.kind === "def");
    const nameStack: string[] = [];
    for (const def of defFacts) {
      let qualname: string;
      let parentQualname: string;
      if (def.unitKind === "module") {
        qualname = modQualname;
        parentQualname = "";
      } else if (def.parentName === null) {
        qualname = `${modQualname}.${def.name}`;
        parentQualname = modQualname;
      } else {
        const parentEntry = [...unitsByQualname.values()]
          .filter((u) => u.fact.file === ff.file && u.fact.name === def.parentName)
          .pop();
        parentQualname = parentEntry ? parentEntry.qualname : modQualname;
        qualname = `${parentQualname}.${def.name}`;
      }
      unitsByQualname.set(`${ff.file}::${def.name}::${def.startLine}`, { fact: def, qualname, parentQualname });
      nameStack.push(qualname);
    }
  }

  // Build a lookup: (file, defName) -> qualname, for parent resolution and refs
  const byFileAndName = new Map<string, string>();
  for (const build of unitsByQualname.values()) {
    byFileAndName.set(`${build.fact.file}::${build.fact.name}`, build.qualname);
  }

  const units: SymbolUnit[] = [];
  for (const build of unitsByQualname.values()) {
    const { fact, qualname, parentQualname } = build;
    const parent = parentQualname ? unitId(parentQualname) : null;
    if (parent) {
      const kids = childrenOf.get(parent) ?? [];
      kids.push(unitId(qualname));
      childrenOf.set(parent, kids);
    }
    const fileChurn = churn.get(fact.file) ?? null;
    units.push({
      id: unitId(qualname),
      kind: fact.unitKind,
      name: fact.name,
      qualname,
      lang: langForFile(fact.file) ?? "unknown",
      parent,
      children: [],
      loc: { file: fact.file, start: fact.startLine, end: fact.endLine },
      sloc: sloc(fact.text),
      params: fact.params,
      returns: fact.returns,
      bases: fact.bases,
      hash: { struct: shortHash(`${fact.unitKind}:${qualname}:${fact.params.map((p) => p.name).join(",")}`), text: shortHash(normalizeSource(fact.text)) },
      metrics: {
        fanIn: 0,
        fanOut: 0,
        churn: fileChurn ? fileChurn.added + fileChurn.deleted : 0,
        commits: fileChurn ? fileChurn.commits : 0,
      },
      authors: fileChurn
        ? [...fileChurn.authors.entries()]
            .sort((a, b) => b[1] - a[1])
            .map(([name, lines]) => ({ name, lines }))
        : [],
    });
  }
  for (const u of units) {
    u.children = childrenOf.get(u.id) ?? [];
  }

  const edges: SymbolEdge[] = [];
  let edgeSeq = 0;
  interface ExternalKey {
    ecosystem: "pypi" | "npm";
    name: string;
  }
  const externalReachedBy = new Map<string, { key: ExternalKey; reachedBy: Set<string> }>();

  // imports: binding -> resolved module qualname (if it's a repo module)
  for (const ff of files) {
    const modQualname = moduleQualname(ff.file);
    const moduleUnit = units.find((u) => u.qualname === modQualname && u.kind === "module");
    if (!moduleUnit) continue;
    const importFacts = ff.facts.filter((f): f is ImportFact => f.kind === "import");
    const bindingTargets = new Map<string, string>(); // binding -> resolved qualname (module or symbol)
    const fileLang = langForFile(ff.file);
    const fileEcosystem: "pypi" | "npm" | null =
      fileLang === "python" ? "pypi" : fileLang === "typescript" || fileLang === "javascript" ? "npm" : null;

    for (const imp of importFacts) {
      const relativeModule = resolveRelativeModule(ff.file, imp.module);
      const moduleQualnameCandidate = relativeModule ?? imp.module;
      const candidates: string[] = [];
      if (imp.imported) {
        candidates.push(`${moduleQualnameCandidate}.${imp.imported}`);
      }
      candidates.push(moduleQualnameCandidate);

      let resolvedQualname: string | null = null;
      for (const c of candidates) {
        if (units.some((u) => u.qualname === c)) {
          resolvedQualname = c;
          break;
        }
        if (knownModules.has(c)) {
          resolvedQualname = c;
          break;
        }
      }

      if (resolvedQualname) {
        const targetUnit = units.find((u) => u.qualname === resolvedQualname);
        bindingTargets.set(imp.binding, resolvedQualname);
        edges.push({
          id: `e:${edgeSeq++}`,
          from: moduleUnit.id,
          to: targetUnit ? targetUnit.id : unitId(resolvedQualname),
          kind: "imports",
          confidence: targetUnit ? 1 : 0.5,
          evidence: { file: ff.file, line: imp.line },
        });
      } else {
        // external or unresolved
        edges.push({
          id: `e:${edgeSeq++}`,
          from: moduleUnit.id,
          to: `ext:${imp.module}`,
          kind: "imports",
          confidence: 0.3,
          evidence: { file: ff.file, line: imp.line },
        });
        if (!imp.module.startsWith(".") && fileEcosystem) {
          const withoutSubpath = imp.module.startsWith("@")
            ? imp.module.split("/").slice(0, 2).join("/")
            : imp.module.split("/")[0]!;
          const topLevel = withoutSubpath.split(".")[0]!;
          const isStdlib =
            (fileEcosystem === "pypi" && PYTHON_STDLIB.has(topLevel)) ||
            (fileEcosystem === "npm" && (imp.module.startsWith("node:") || NODE_BUILTINS.has(topLevel)));
          if (!isStdlib) {
            const packageName = fileEcosystem === "pypi" ? (PYPI_IMPORT_ALIASES[topLevel] ?? topLevel) : topLevel;
            const key = `${fileEcosystem}:${packageName}`;
            const entry = externalReachedBy.get(key) ?? { key: { ecosystem: fileEcosystem, name: packageName }, reachedBy: new Set<string>() };
            entry.reachedBy.add(moduleUnit.id);
            externalReachedBy.set(key, entry);
          }
        }
      }
    }

    // calls: resolve bare-name and attribute-style calls against known bindings/defs in this file
    const refFacts = ff.facts.filter((f) => f.kind === "ref") as Extract<Fact, { kind: "ref" }>[];
    for (const ref of refFacts) {
      const fromQualname = byFileAndName.get(`${ff.file}::${ref.fromFunction}`) ?? modQualname;
      const fromUnit = units.find((u) => u.qualname === fromQualname);
      if (!fromUnit) continue;

      let targetQualname: string | null = null;
      let confidence = 0;

      if (ref.name.includes(".")) {
        const [obj, attr] = ref.name.split(".", 2) as [string, string];
        const target = bindingTargets.get(obj);
        if (target) {
          const asFunction = `${target}.${attr}`;
          if (units.some((u) => u.qualname === asFunction)) {
            targetQualname = asFunction;
            confidence = 1;
          } else if (units.some((u) => u.qualname === target)) {
            targetQualname = target;
            confidence = 0.6;
          }
        }
      } else {
        const localQualname = byFileAndName.get(`${ff.file}::${ref.name}`);
        if (localQualname) {
          targetQualname = localQualname;
          confidence = 1;
        } else {
          const imported = bindingTargets.get(ref.name);
          if (imported) {
            targetQualname = imported;
            confidence = 1;
          }
        }
      }

      if (targetQualname) {
        const targetUnit = units.find((u) => u.qualname === targetQualname);
        if (targetUnit && targetUnit.id === fromUnit.id) continue;
        edges.push({
          id: `e:${edgeSeq++}`,
          from: fromUnit.id,
          to: targetUnit ? targetUnit.id : unitId(targetQualname),
          kind: "calls",
          confidence,
          evidence: { file: ff.file, line: ref.line },
        });
      }
    }
  }

  const unitsById = new Map(units.map((u) => [u.id, u]));
  for (const e of edges) {
    const fromUnit = unitsById.get(e.from);
    if (fromUnit) fromUnit.metrics.fanOut++;
    const toUnit = unitsById.get(e.to);
    if (toUnit) toUnit.metrics.fanIn++;
  }

  const externals: SymbolExternal[] = [...externalReachedBy.values()]
    .map(({ key, reachedBy }) => {
      const pinned = key.ecosystem === "pypi" ? manifests.pypi?.pinned : manifests.npm?.pinned;
      const version = pinned?.get(key.name) ?? null;
      return {
        id: version ? `x:${key.ecosystem}:${key.name}@${version}` : `x:${key.ecosystem}:${key.name}`,
        ecosystem: key.ecosystem,
        name: key.name,
        version,
        direct: pinned?.has(key.name) ?? false,
        depth: 1,
        reachedBy: [...reachedBy].sort(),
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));

  return { units, edges, externals };
}
