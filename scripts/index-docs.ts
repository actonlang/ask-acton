import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const openai = new OpenAI();

const docsDir = path.resolve(process.env.DOCS_DIR ?? "../acton/docs/acton-guide/src");
const vectorStoreName = process.env.VECTOR_STORE_NAME ?? "ask-acton-docs";
const supportedExtensions = new Set([".act", ".md", ".txt"]);
const existingVectorStoreId = process.env.OPENAI_VECTOR_STORE_ID?.trim();

const vectorStoreId =
  existingVectorStoreId && existingVectorStoreId.length > 0
    ? existingVectorStoreId
    : (await openai.vectorStores.create({ name: vectorStoreName })).id;

const files = await listFiles(docsDir);

if (files.length === 0) {
  throw new Error(`No supported files found under ${docsDir}`);
}

console.log(`Vector store: ${vectorStoreId}`);
console.log(`Uploading ${files.length} files from ${docsDir}`);

for (const filePath of files) {
  const relativePath = path.relative(docsDir, filePath);
  const uploaded = await openai.files.create({
    file: fs.createReadStream(filePath),
    purpose: "assistants"
  });

  await openai.vectorStores.files.create(vectorStoreId, {
    file_id: uploaded.id,
    attributes: {
      path: relativePath,
      source: "acton-guide"
    }
  });

  console.log(`${relativePath} -> ${uploaded.id}`);
}

console.log("");
console.log(`Set OPENAI_VECTOR_STORE_ID=${vectorStoreId}`);
console.log("Files may take a short time to finish indexing before search uses them.");

async function listFiles(root: string): Promise<string[]> {
  const entries = await fs.promises.readdir(root, { withFileTypes: true });
  const paths = await Promise.all(
    entries.map(async (entry) => {
      if (entry.name.startsWith(".")) {
        return [];
      }

      const entryPath = path.join(root, entry.name);
      if (entry.isDirectory()) {
        return listFiles(entryPath);
      }
      if (entry.isFile() && supportedExtensions.has(path.extname(entry.name))) {
        return [entryPath];
      }
      return [];
    })
  );

  return paths.flat().sort();
}
