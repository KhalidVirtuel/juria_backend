// src/services/rag.js
import { embedTexts, chatCompletion } from './llm.js';
import { searchSimilar, upsertPointsBatch } from './qdrant.js';
import { cfg } from '../config.js';

/**
 * Répond à une question en s'appuyant sur le contexte Qdrant (RAG).
 * metaFilter permet de filtrer par userId, fileId, etc.

export async function ragAnswer({ question, metaFilter = {} }) {
  const [qVec] = await embedTexts([question]);

  // Construire le filtre Qdrant
  const filter =
    metaFilter && Object.keys(metaFilter).length
      ? {
          must: Object.entries(metaFilter).map(([k, v]) => ({
            key: k,
            match: { value: v },
          })),
        }
      : null;

  // Recherche de passages similaires
  let results = [];
  try {
    results = await searchSimilar(qVec, 6, filter);
  } catch (e) {
    console.warn('[Qdrant search error]', e);
  }

  const context = (results || [])
    .map((r) => '• ' + (r.payload?.text || ''))
    .join('\n');

  // ✅ Système amélioré avec détection d'événements timeline
  const system = {
    role: 'system',
    content: `Tu es un assistant juridique. Réponds de façon précise et concise en t'appuyant sur le contexte si pertinent.

IMPORTANT - SYSTÈME DE BALISES TIMELINE:
Si ta réponse contient des éléments qui doivent être enregistrés dans une timeline juridique, utilise ces balises au début de ta réponse:

[PROCEDURE: titre court de la procédure]
Pour décrire une procédure juridique à suivre (démarche, étapes)

[FACT: titre du fait]
Pour un fait juridique important ou une information factuelle clé

[HEARING: titre de l'audience | date YYYY-MM-DD]
Pour une audience, comparution ou rendez-vous judiciaire (la date est obligatoire)

[DEADLINE: titre de l'échéance | date YYYY-MM-DD]
Pour une date limite, échéance ou délai légal (la date est obligatoire)

[EVENT: titre de l'événement | date YYYY-MM-DD]
Pour tout autre événement juridique important (date optionnelle)

RÈGLES:
- Place les balises AU DÉBUT de ta réponse, avant le texte principal
- Une seule balise par réponse (la plus pertinente)
- Le titre doit être court (max 80 caractères)
- Pour HEARING et DEADLINE, la date est OBLIGATOIRE au format YYYY-MM-DD après le |
- Le reste de ta réponse (après la balise) sera enregistré comme note/description
- Si aucune balise n'est nécessaire, réponds normalement sans balise

Exemples:
[PROCEDURE: Dépôt d'une requête en divorce]
Pour déposer une requête en divorce, voici les étapes...

[DEADLINE: Délai de réponse à la mise en demeure | 2024-03-15]
Vous avez reçu une mise en demeure. Selon l'article...

[HEARING: Audience de conciliation | 2024-04-10]
Votre audience de conciliation est prévue...`,
  };

  const user = {
    role: 'user',
    content: `Question:\n${question}\n\nContexte pertinent (peut être vide):\n${context}`,
  };

  const msg = await chatCompletion([system, user]);
  
  // ✅ Extraction des métadonnées timeline
  const metadata = extractTimelineMetadata(msg.content);
  
  return { 
    answer: metadata.cleanedAnswer, 
    context,
    timelineEvent: metadata.event, // null si aucun événement détecté
  };
} */



/**
 * Formate une date ISO en français pour le prompt
 */
function formatDateInPrompt(isoDate) {
  const mois = [
    'janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'
  ];
  
  const d = new Date(isoDate);
  const jour = d.getDate();
  const moisNom = mois[d.getMonth()];
  const annee = d.getFullYear();
  
  return `${jour} ${moisNom} ${annee}`;
}

/**
 * Répond à une question en s'appuyant sur le contexte Qdrant (RAG).
 */
export async function ragAnswer({ question, metaFilter = {} }) {
  const [qVec] = await embedTexts([question]);

  const filter =
    metaFilter && Object.keys(metaFilter).length
      ? {
          must: Object.entries(metaFilter).map(([k, v]) => ({
            key: k,
            match: { value: v },
          })),
        }
      : null;

  let results = [];
  try {
    results = await searchSimilar(qVec, 6, filter);
  } catch (e) {
    console.warn('[Qdrant search error]', e);
  }

  const context = (results || [])
    .map((r) => '• ' + (r.payload?.text || ''))
    .join('\n');

  // ✅ Date actuelle
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const todayFr = formatDateInPrompt(todayStr);
  
  // Exemples de dates futures
  const in15Days = new Date(today.getTime() + 15*24*60*60*1000).toISOString().split('T')[0];
  const in15DaysFr = formatDateInPrompt(in15Days);
  const in2Months = new Date(today.getTime() + 60*24*60*60*1000).toISOString().split('T')[0];
  const in2MonthsFr = formatDateInPrompt(in2Months);

  const system = {
    role: 'system',
    content: `Tu es un assistant juridique. Réponds de façon précise et concise en t'appuyant sur le contexte si pertinent.

📅 DATE ACTUELLE: ${todayFr} (${todayStr})

IMPORTANT - CALCUL DES DATES:
- Utilise TOUJOURS la date actuelle (${todayFr}) comme point de départ
- Pour les DEADLINE et HEARING, calcule les dates FUTURES à partir d'aujourd'hui
- Ne JAMAIS utiliser de dates passées (avant ${todayFr})
- Dans la BALISE: format technique YYYY-MM-DD pour le parsing
- Dans ton TEXTE: format français lisible (ex: ${in15DaysFr})

SYSTÈME DE BALISES TIMELINE:
[PROCEDURE: titre]
[FACT: titre]
[HEARING: titre | YYYY-MM-DD]
[DEADLINE: titre | YYYY-MM-DD]
[EVENT: titre | YYYY-MM-DD]

RÈGLES IMPORTANTES:
- Balise au début avec date ISO (YYYY-MM-DD)
- Texte avec date en français (jour mois année)
- Dates obligatoirement FUTURES

Exemples corrects:
[DEADLINE: Délai de réponse à la mise en demeure | ${in15Days}]
Vous avez 15 jours à compter d'aujourd'hui (${todayFr}) pour répondre, soit jusqu'au ${in15DaysFr}. Selon l'article...

[HEARING: Audience de conciliation | ${in2Months}]
Votre audience est prévue le ${in2MonthsFr}. Pensez à préparer les documents suivants...`,
  };

  const user = {
    role: 'user',
    content: `Question:\n${question}\n\nContexte pertinent (peut être vide):\n${context}`,
  };

  const msg = await chatCompletion([system, user]);
  const metadata = extractTimelineMetadata(msg.content);
  
  return { 
    answer: metadata.cleanedAnswer, 
    context,
    timelineEvent: metadata.event,
  };
}


/**
 * Extrait les métadonnées timeline de la réponse de l'IA
 */
function extractTimelineMetadata(rawAnswer) {
  // Pattern pour détecter les balises
  const pattern = /^\[(PROCEDURE|FACT|HEARING|DEADLINE|EVENT):\s*([^\]|]+)(?:\|\s*([^\]]+))?\]/i;
  const match = rawAnswer.match(pattern);

  if (!match) {
    return {
      event: null,
      cleanedAnswer: rawAnswer.trim(),
    };
  }

  const [fullMatch, type, title, dateStr] = match;
  
  // Nettoie la réponse en enlevant la balise
  const cleanedAnswer = rawAnswer.replace(fullMatch, '').trim();

  // Construction de l'événement
  const event = {
    type: type.toUpperCase(),
    title: title.trim(),
    description: cleanedAnswer,
    date: null,
  };

  // Parse la date si présente (pour HEARING, DEADLINE, EVENT)
  if (dateStr) {
    const parsedDate = parseDate(dateStr.trim());
    if (parsedDate) {
      event.date = parsedDate;
    }
  }

  // Validation: HEARING et DEADLINE nécessitent une date
  if ((type === 'HEARING' || type === 'DEADLINE') && !event.date) {
    console.warn(`[RAG] ${type} détecté mais sans date valide, ignoré`);
    return {
      event: null,
      cleanedAnswer: rawAnswer.trim(),
    };
  }

  return {
    event,
    cleanedAnswer,
  };
}

/**
 * Parse une date au format YYYY-MM-DD ou autres formats courants
 */
function parseDate(dateStr) {
  try {
    // Format ISO (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return new Date(dateStr + 'T00:00:00Z');
    }
    
    // Format DD/MM/YYYY
    const ddmmyyyy = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}T00:00:00Z`);
    }

    // Essai générique
    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

/**
 * Indexe du texte "brut" (déjà extrait) dans Qdrant pour un fichier donné.
 * - userId: propriétaire
 * - fileId: id Document en BDD (permettra delete par fichier)
 * - text: contenu texte déjà extrait
 * - metadata: objet libre (ex: { fileName })
 */
export async function upsertDocumentIntoQdrant({
  userId,
  fileId,
  text,
  metadata = {},
}) {
  const collection = cfg.qdrant.collection || 'company_knowledge_fr';
  const CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || '', 10) || 900;
  const CHUNK_OVERLAP =
    parseInt(process.env.RAG_CHUNK_OVERLAP || '', 10) || 150;

  // Découpe en chunks qui se recouvrent légèrement
  const chunks = [];
  let i = 0;
  while (i < text.length) {
    const end = Math.min(text.length, i + CHUNK_SIZE);
    const piece = text.slice(i, end).trim();
    if (piece) chunks.push(piece);
    i += CHUNK_SIZE - CHUNK_OVERLAP;
    if (i < 0 || i >= text.length) break;
  }

  if (!chunks.length) return { chunks: 0, points: 0 };

  // Embeddings en lots
  const BATCH_EMBED = parseInt(process.env.RAG_EMBED_BATCH || '', 10) || 24;
  const vectors = [];
  for (let k = 0; k < chunks.length; k += BATCH_EMBED) {
    const slice = chunks.slice(k, k + BATCH_EMBED);
    const emb = await embedTexts(slice);
    vectors.push(...emb);
  }

  // Construction des points
  const points = vectors.map((vec, idx) => ({
    vector: vec,
    payload: {
      userId,
      fileId,
      chunkIndex: idx,
      text: chunks[idx],
      ...metadata,
    },
  }));

  // Upsert dans Qdrant
  await upsertPointsBatch(points, collection);
  return { chunks: chunks.length, points: points.length };
}