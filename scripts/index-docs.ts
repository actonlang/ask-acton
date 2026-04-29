import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import OpenAI from "openai";

const openai = new OpenAI();

const docsDir = path.resolve(process.env.DOCS_DIR ?? "../acton/docs/acton-guide/src");
const vectorStoreName = process.env.VECTOR_STORE_NAME ?? "ask-acton-docs";
const docsSource = process.env.DOCS_SOURCE?.trim() || "acton-guide";
const docsRevision = process.env.DOCS_REVISION?.trim();
const replaceSource = readBoolean("INDEX_REPLACE_SOURCE", true);
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
console.log(`Source: ${docsSource}`);
console.log(`Uploading ${files.length} files from ${docsDir}`);

const replacedFileIds = replaceSource
  ? await listIndexedSourceFileIds(vectorStoreId, docsSource)
  : [];

for (const filePath of files) {
  const relativePath = path.relative(docsDir, filePath);
  const uploaded = await openai.files.create({
    file: fs.createReadStream(filePath),
    purpose: "assistants"
  });

  const attached = await openai.vectorStores.files.createAndPoll(vectorStoreId, {
    file_id: uploaded.id,
    attributes: {
      path: relativePath,
      source: docsSource,
      ...(docsRevision ? { revision: docsRevision } : {})
    }
  });

  if (attached.status !== "completed") {
    throw new Error(
      `Indexing failed for ${relativePath}: ${attached.last_error?.message ?? attached.status}`
    );
  }

  console.log(`${relativePath} -> ${uploaded.id}`);
}

if (replacedFileIds.length > 0) {
  await removeIndexedFiles(vectorStoreId, replacedFileIds, docsSource);
}

console.log("");
console.log(`Set OPENAI_VECTOR_STORE_ID=${vectorStoreId}`);
console.log("Files are indexed and ready for search.");

async function listIndexedSourceFileIds(vectorStoreId: string, source: string): Promise<string[]> {
  const existingFiles = [];

  for await (const file of openai.vectorStores.files.list(vectorStoreId, { limit: 100 })) {
    if (file.attributes?.source === source) {
      existingFiles.push(file.id);
    }
  }

  return existingFiles;
}

async function removeIndexedFiles(
  vectorStoreId: string,
  fileIds: string[],
  source: string
): Promise<void> {
  console.log(`Removing ${fileIds.length} replaced files for source ${source}`);

  for (const fileId of fileIds) {
    await openai.vectorStores.files.delete(fileId, { vector_store_id: vectorStoreId });

    try {
      await openai.files.delete(fileId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not delete uploaded file ${fileId}: ${message}`);
    }
  }
}

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

function readBoolean(name: string, defaultValue: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) {
    return defaultValue;
  }
  if (["1", "true", "yes", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(value)) {
    return false;
  }
  throw new Error(`${name} must be true or false, got ${process.env[name]}`);
}
