import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const DATA_PATH = fileURLToPath(new URL("../src/lib/opcodeDocDetails.json", import.meta.url));
const ENTRY_ID = "\0opcode-doc-details";
const CHUNK_PREFIX = "\0opcode-doc-data-";
const MAX_CHUNK_BYTES = 160_000;

function splitDocumentation() {
  const entries = Object.entries(JSON.parse(readFileSync(DATA_PATH, "utf8")));
  const chunks = [];
  let members = [];
  let bytes = 2;

  for (const [name, details] of entries) {
    const member = `${JSON.stringify(name)}:${JSON.stringify(details)}`;
    const memberBytes = Buffer.byteLength(member, "utf8") + 1;
    if (members.length > 0 && bytes + memberBytes > MAX_CHUNK_BYTES) {
      chunks.push(`{${members.join(",")}}`);
      members = [];
      bytes = 2;
    }
    members.push(member);
    bytes += memberBytes;
  }
  if (members.length > 0) chunks.push(`{${members.join(",")}}`);
  return chunks;
}

/** @param {string} id */
export function opcodeDocsChunkName(id) {
  if (id === ENTRY_ID) return "opcode-docs";
  if (id.startsWith(CHUNK_PREFIX)) return id.slice(1);
  return undefined;
}

// Keep the generated JSON as the single source of truth while giving the
// bundler smaller modules without changing the help data or its consumers.
/** @returns {import("vite").Plugin} */
export function opcodeDocsChunks() {
  return {
    name: "opcode-docs-chunks",
    apply: "build",
    enforce: "pre",
    resolveId(source, importer) {
      if (source.startsWith(CHUNK_PREFIX)) return source;
      if (importer && resolve(dirname(importer), source) === DATA_PATH) return ENTRY_ID;
    },
    load(id) {
      if (id !== ENTRY_ID && !id.startsWith(CHUNK_PREFIX)) return;
      this.addWatchFile(DATA_PATH);
      const chunks = splitDocumentation();
      if (id === ENTRY_ID) {
        const imports = chunks.map((_, index) => `import part${index} from ${JSON.stringify(CHUNK_PREFIX + index)};`);
        const parts = chunks.map((_, index) => `part${index}`);
        return `${imports.join("\n")}\nexport default Object.assign({}, ${parts.join(",")});`;
      }
      const index = Number(id.slice(CHUNK_PREFIX.length));
      if (!chunks[index]) return this.error(`Unknown opcode documentation chunk: ${id}`);
      return `export default ${chunks[index]};`;
    }
  };
}
