/**
 * test-e2e.js
 * Script de test End-to-End minimal pour Juria API
 */
import fs from "fs";
import path from "path";
import chalk from "chalk";

// ====== Configs ======
const BASE = process.env.JURIA_BASE || "http://localhost:8787";
const API = `${BASE}/api`;

const TEST_USER = {
  first_name: "Test",
  last_name: "User",
  email: `test_${Date.now()}@example.com`,
  password: "Passw0rd!",
};

let token = null;

// ====== Helpers réseau robustes ======
const MAX_RETRIES = 6;
const RETRY_BASE_MS = 500;

async function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`${API}/health`, { method: "GET" });
      if (r.ok) return;
    } catch {
      // serveur pas prêt
    }
    await sleep(500);
  }
  throw new Error(`Healthcheck indisponible sur ${BASE} après ${timeoutMs}ms`);
}

/**
 * http(path, opts, retries)
 * - Retente automatiquement sur erreurs réseau/5xx
 * - Retourne JSON si 'content-type' contient 'application/json', sinon texte
 */
async function http(path, opts = {}, retries = MAX_RETRIES) {
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(`${API}${path}`, {
        ...opts,
        // Timeout (Node 20+)
        signal: AbortSignal.timeout?.(15000),
      });

      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`[${res.status}] ${txt || res.statusText}`);
      }

      const ct = res.headers.get("content-type") || "";
      if (ct.includes("application/json")) return await res.json();
      return await res.text();
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const isRetryable =
        msg.includes("ECONN") ||
        msg.includes("fetch failed") ||
        msg.includes("[5"); // 5xx
      if (i < retries && isRetryable) {
        await sleep(RETRY_BASE_MS * (i + 1));
        continue;
      }
      break;
    }
  }
  throw lastErr;
}

async function main() {
  console.log(chalk.cyan("🚀 Lancement des tests E2E Juria..."));

  // Attendre que l'API soit prête
  await waitForHealth();

  // === 1) Health ===
  const health = await http("/health");
  console.log(chalk.green("✓ Health:"), health);

  // === 2) Register ===
  const register = await http("/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(TEST_USER),
  });
  token = register.token;
  if (!token) throw new Error("Token manquant après /auth/register");
  console.log(chalk.green("✓ Register: token reçu"));

  const authHeaders = { Authorization: `Bearer ${token}` };

  // === 3) /me ===
  const me = await http("/me", { headers: authHeaders });
  console.log(chalk.green("✓ Profil utilisateur:"), me.email);

  // === 4) Créer un dossier ===
  const folder = await http("/folders", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ name: "Dossier E2E" }),
  });
  console.log(chalk.green("✓ Dossier créé:"), folder);

  // === 5) Créer un client ===
  const client = await http("/clients", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ name: "Client E2E", email: "client@e2e.test" }),
  });
  console.log(chalk.green("✓ Client créé:"), client);

  // === 6) Créer une affaire ===
  const caseFile = await http("/cases", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      client_id: client.id,
      title: "Affaire E2E",
      description: "Test automatique",
    }),
  });
  console.log(chalk.green("✓ Affaire créée:"), caseFile);

  // === 7) Créer une conversation ===
  const conv = await http("/conversations", {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({ title: "Test RAG E2E" }),
  });
  console.log(chalk.green("✓ Conversation créée:"), conv);

  // === 8) Envoyer un message IA ===
  const msg = await http(`/conversations/${conv.id}/message`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      role: "user",
      content:
        "Explique la différence entre contrat de travail à durée déterminée et indéterminée.",
    }),
  });
  const answered = (msg.answer || msg.reply || "").toString();
  console.log(
    chalk.green("✓ Réponse IA reçue:"),
    answered.slice(0, 80) + "..."
  );

  // === 9) Upload d’un document texte factice ===
  const fakeFile = path.join(process.cwd(), "fake.txt");
  fs.writeFileSync(fakeFile, "Ceci est un document test E2E pour Juria.");

  // Utiliser FormData / Blob natifs Node (undici)
  const buf = fs.readFileSync(fakeFile);
  const blob = new Blob([buf], { type: "text/plain" });
  const form = new FormData();
  form.append("file", blob, "fake.txt");

  const uploadRes = await fetch(`${API}/documents/upload`, {
    method: "POST",
    headers: { ...authHeaders }, // ne pas mettre Content-Type, fetch le gère (boundary)
    body: form,
    signal: AbortSignal.timeout?.(20000),
  });
  if (!uploadRes.ok) {
    const errText = await uploadRes.text().catch(() => "");
    throw new Error(`[${uploadRes.status}] ${errText || "Upload failed"}`);
  }
  const doc =
    uploadRes.headers.get("content-type")?.includes("json")
      ? await uploadRes.json()
      : await uploadRes.text();

  console.log(chalk.green("✓ Document uploadé:"), doc);

  // === 10) TTS (test synthèse vocale) ===
  const ttsRes = await fetch(`${API}/tts/speak`, {
    method: "POST",
    headers: { ...authHeaders, "content-type": "application/json" },
    body: JSON.stringify({
      text: "Bonjour, ceci est un test de synthèse vocale automatique.",
    }),
    signal: AbortSignal.timeout?.(30000),
  });
  if (ttsRes.ok) {
    const arr = await ttsRes.arrayBuffer();
    fs.writeFileSync("tts-test.mp3", Buffer.from(arr));
    console.log(chalk.green("✓ Fichier tts-test.mp3 généré"));
  } else {
    const errText = await ttsRes.text().catch(() => "");
    throw new Error(`[${ttsRes.status}] ${errText || "TTS failed"}`);
  }

  console.log(chalk.bgGreen.black("\n✅ Tous les tests E2E ont réussi !\n"));
}

main().catch((err) => {
  console.error(chalk.bgRed.white("❌ Test échoué:"), err?.message || err);
  process.exit(1);
});
