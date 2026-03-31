// scripts/rag-reset.mjs
import fs from "node:fs/promises";

const QDRANT_URL = process.env.QDRANT_URL || "http://qdrant:6333";
const COLLECTION = process.env.RAG_COLLECTION || "company_knowledge_fr";
const EMB_DIM = Number(process.env.RAG_EMBED_DIM || 1536); // adapte si tu utilises un autre modèle
const DISTANCE = process.env.RAG_DISTANCE || "Cosine";     // "Cosine" | "Euclid" | "Dot"
const ON_DISK = true;

async function jfetch(path, method="GET", body) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    method,
    headers: { "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const txt = await res.text();
  let data;
  try { data = txt ? JSON.parse(txt) : {}; } catch { data = { raw: txt }; }
  if (!res.ok) {
    const e = new Error(`[Qdrant ${method} ${path}] ${res.status} ${res.statusText} ${txt}`);
    e.data = data; e.status = res.status;
    throw e;
  }
  return data;
}

async function deleteCollectionIfExists() {
  try {
    await jfetch(`/collections/${COLLECTION}`, "GET");
  } catch {
    console.log(`ℹ️  Collection '${COLLECTION}' déjà absente.`);
    return;
  }
  console.log(`🗑  Suppression de '${COLLECTION}'...`);
  await jfetch(`/collections/${COLLECTION}`, "DELETE");
  console.log(`✅  Supprimée.`);
}

async function createCollection() {
  console.log(`🧰  Création de '${COLLECTION}' (dim=${EMB_DIM}, distance=${DISTANCE})...`);
  await jfetch(`/collections/${COLLECTION}`, "PUT", {
    vectors: { size: EMB_DIM, distance: DISTANCE, on_disk: ON_DISK },
    optimizers_config: { memmap_threshold: 20000 },
    hnsw_config: { on_disk: ON_DISK },
  });
  console.log("✅  Créée.");
}

async function main() {
  await deleteCollectionIfExists();
  await createCollection();
  console.log("🎯 Reset terminé.");
}
main().catch(e => { console.error("Erreur reset:", e); process.exit(1); });
