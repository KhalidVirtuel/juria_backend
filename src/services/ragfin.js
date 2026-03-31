// src/services/rag.js
import { embedTexts, chatCompletion } from './llm.js';
import { searchSimilar, upsertPointsBatch } from './qdrant.js';
import { cfg } from '../config.js';

function parseDate(dateStr) {
  try {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return new Date(dateStr + 'T00:00:00Z');
    }
    
    const ddmmyyyy = dateStr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (ddmmyyyy) {
      return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}T00:00:00Z`);
    }

    const date = new Date(dateStr);
    return isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

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

function extractAllMetadata(rawAnswer) {
  const timelinePattern = /\[(PROCEDURE|FACT|HEARING|DEADLINE|EVENT):\s*([^\]|]+)(?:\|\s*([^\]]+))?\]/gi;
  const timelineMatches = [...rawAnswer.matchAll(timelinePattern)];
  
  const docPattern = /\[(CONTRACT|CONCLUSION|NOTE|LETTER|REPORT):\s*([^\]]+)\]/gi;
  const docMatches = [...rawAnswer.matchAll(docPattern)];

  const timelineEvents = [];
  const documents = [];
  const allBalises = [];

  for (const match of timelineMatches) {
    const [fullMatch, type, title, dateStr] = match;
    
    allBalises.push({
      fullMatch,
      index: match.index,
      length: fullMatch.length,
      type: 'timeline',
    });
    
    const event = {
      type: type.toUpperCase(),
      title: title.trim(),
      description: '',
      date: null,
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
    };

    if (dateStr) {
      const parsedDate = parseDate(dateStr.trim());
      if (parsedDate) {
        event.date = parsedDate;
      }
    }

    if ((event.type === 'HEARING' || event.type === 'DEADLINE') && !event.date) {
      console.warn(`[RAG] ${event.type} détecté mais sans date valide, ignoré`);
      continue;
    }

    timelineEvents.push(event);
  }

  for (const match of docMatches) {
    const [fullMatch, type, title] = match;
    
    allBalises.push({
      fullMatch,
      index: match.index,
      length: fullMatch.length,
      type: 'document',
    });
    
    const document = {
      type: type.toUpperCase(),
      title: title.trim(),
      content: '',
      startIndex: match.index,
      endIndex: match.index + fullMatch.length,
    };

    documents.push(document);
  }

  let cleanedAnswer = rawAnswer;
  for (const balise of allBalises.sort((a, b) => b.index - a.index)) {
    cleanedAnswer = cleanedAnswer.substring(0, balise.index) + cleanedAnswer.substring(balise.index + balise.length);
  }
  cleanedAnswer = cleanedAnswer.trim();

  const allItems = [...timelineEvents, ...documents].sort((a, b) => a.startIndex - b.startIndex);
  
  for (let i = 0; i < allItems.length; i++) {
    const currentItem = allItems[i];
    const nextItem = allItems[i + 1];
    
    let sectionStart = currentItem.endIndex;
    let sectionEnd = nextItem ? nextItem.startIndex : rawAnswer.length;
    
    let section = rawAnswer.substring(sectionStart, sectionEnd).trim();
    section = section.replace(/\[(PROCEDURE|FACT|HEARING|DEADLINE|EVENT|CONTRACT|CONCLUSION|NOTE|LETTER|REPORT):[^\]]+\]/gi, '').trim();
    
    if ('description' in currentItem) {
      currentItem.description = section || cleanedAnswer;
    } else {
      currentItem.content = section || cleanedAnswer;
    }
  }

  timelineEvents.forEach(e => {
    delete e.startIndex;
    delete e.endIndex;
  });
  
  documents.forEach(d => {
    delete d.startIndex;
    delete d.endIndex;
  });

  const uniqueDocuments = [];
  const seenDocs = new Set();
  
  for (const doc of documents) {
    const key = `${doc.type}:${doc.title.toLowerCase()}`;
    if (!seenDocs.has(key)) {
      seenDocs.add(key);
      uniqueDocuments.push(doc);
    }
  }

  const uniqueTimelines = [];
  const seenTimelines = new Set();
  
  for (const event of timelineEvents) {
    const key = `${event.type}:${event.title.toLowerCase()}`;
    if (!seenTimelines.has(key)) {
      seenTimelines.add(key);
      uniqueTimelines.push(event);
    }
  }

  return {
    timelineEvents: uniqueTimelines,
    documents: uniqueDocuments,
    cleanedAnswer,
  };
}

/**
 * 🔍 DÉTECTION D'INTENTION
 */
function detectIntention(question) {
  const q = question.toLowerCase();
  
  // 📝 Création de documents
  const docCreationKeywords = [
    'créer un contrat', 'rédiger un contrat', 'générer un contrat', 'faire un contrat',
    'créer une lettre', 'rédiger une lettre', 'écrire une lettre',
    'créer une note', 'rédiger une note',
    'créer un rapport', 'rédiger un rapport',
    'créer une conclusion', 'rédiger une conclusion',
    'préparer un contrat', 'établir un contrat', 'créer un document', 'rédiger un document'
  ];
  
  // 📅 Création de deadlines
  const deadlineKeywords = [
    'créer un deadline', 'ajouter un deadline', 'créer une échéance', 'ajouter une échéance',
    'fixer une date', 'programmer une audience', 'planifier une audience',
    'date limite', 'rappel pour', 'créer une audience'
  ];
  
  // 📚 Recherche de modèles
  const modelKeywords = [
    'modèle de', 'exemple de', 'template de', 'format de',
    'modèle', 'exemple', 'template', 'gabarit'
  ];
  
  // ⚖️ Questions juridiques
  const legalKeywords = [
    'article', 'loi', 'code', 'jurisprudence', 'droit',
    'légal', 'illégal', 'procédure', 'tribunal', 'juge',
    'avocat', 'défense', 'plainte', 'condamnation', 'peine',
    'dahir', 'décret', 'réglementation', 'texte de loi'
  ];

  if (docCreationKeywords.some(keyword => q.includes(keyword))) {
    return 'create_document';
  }
  
  if (deadlineKeywords.some(keyword => q.includes(keyword))) {
    return 'create_deadline';
  }
  
  if (modelKeywords.some(keyword => q.includes(keyword))) {
    return 'search_model';
  }
  
  if (legalKeywords.some(keyword => q.includes(keyword))) {
    return 'legal_question';
  }
  
  return 'general';
}

/**
 * 🔍 RECHERCHE INTELLIGENTE DANS RAG
 */
async function smartRAGSearch(question, intention, metaFilter = {}) {
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
    let limit = 6;
    
    if (intention === 'search_model') {
      limit = 10;
    } else if (intention === 'legal_question') {
      limit = 8;
    } else if (intention === 'create_document') {
      limit = 10;
    }
    
    results = await searchSimilar(qVec, limit, filter);
    console.log(`[RAG] 🔍 Intention: ${intention} → ${results?.length || 0} documents trouvés (limit: ${limit})`);
    
  } catch (e) {
    console.warn('[RAG] ⚠️ Erreur Qdrant:', e);
  }

  return results || [];
}

/**
 * 🏗️ CONSTRUCTION DU PROMPT SYSTÈME
 */
function buildSystemPrompt({ 
  intention, 
  hasDocuments, 
  documentsCount, 
  context, 
  todayFr, 
  in15DaysFr, 
  in2MonthsFr, 
  folderSummary 
}) {
  
  const datesInfo = `Date du jour: ${todayFr}
Dans 15 jours: ${in15DaysFr}
Dans 2 mois: ${in2MonthsFr}`;

  const balises = `🏷️ BALISES SPÉCIALES - UTILISATION OBLIGATOIRE

📅 CHRONOLOGIE (ajoute à la timeline du dossier):
[PROCEDURE:titre] - Procédure juridique
[FACT:titre] - Fait important  
[HEARING:titre|JJ/MM/AAAA] - Audience (DATE OBLIGATOIRE)
[DEADLINE:titre|JJ/MM/AAAA] - Échéance (DATE OBLIGATOIRE)
[EVENT:titre] - Événement

📄 DOCUMENTS (crée un nouveau document dans le dossier):
[CONTRACT:titre] - Contrat
[CONCLUSION:titre] - Conclusions
[NOTE:titre] - Note/Mémo  
[LETTER:titre] - Lettre
[REPORT:titre] - Rapport

⚠️ RÈGLES ABSOLUES:
1. TOUJOURS mettre la balise AVANT le contenu du document
2. La balise doit être sur sa propre ligne
3. Une seule balise par document

✅ EXEMPLE CORRECT:
[NOTE: Procédure obtention crédit bancaire]

**PROCÉDURE D'OBTENTION D'UN CRÉDIT BANCAIRE**
...`;

  const contractRules = `RÈGLES ABSOLUES POUR LES CONTRATS:
1. Ne JAMAIS demander la durée d'un CDI (c'est indéterminé par définition)
2. TOUJOURS utiliser [CONTRACT: titre] après confirmation finale
3. Ne JAMAIS afficher HTML brut sans balise [CONTRACT:]
4. Distinguer: CONTRAT DE TRAVAIL (employeur↔employé) vs CONTRAT DE PRESTATION (cabinet↔client)`;

  const folderContext = folderSummary ? `
📂 CONTEXTE DU DOSSIER:
${folderSummary}

⚠️ IMPORTANT: Utilise ce contexte pour éviter de redemander des informations déjà fournies.
` : '';

  if (intention === 'create_document') {
    return `Tu es MIZEN, assistant juridique marocain spécialisé en RÉDACTION DE DOCUMENTS.

${folderContext}

🚨🚨🚨 CONTRAINTE ABSOLUE 🚨🚨🚨
Tu es OBLIGÉ de suivre ce format de réponse pour ta PREMIÈRE réponse:

Format obligatoire: "Parfait ! [UNE SEULE QUESTION] ?"

Exemples valides:
- "Parfait ! Quel est le nom complet de l'employeur ?"
- "D'accord ! Quelle est l'adresse du siège social ?"
- "Très bien ! Quel est le salaire mensuel ?"

❌ INTERDICTION ABSOLUE de commencer par:
- "Pour créer..."
- "J'ai besoin de..."
- "Pourriez-vous me fournir..."
- Toute phrase contenant une liste numérotée (1., 2., 3...)

🎯 MISSION: Collecter les informations UNE PAR UNE.

${hasDocuments ? `
✅ ${documentsCount} modèle(s) trouvé(s):
${context}

📌 UTILISE CES MODÈLES comme base.
` : `
⚠️ Aucun modèle trouvé.
✅ Utilise tes connaissances générales.
`}

📝 MÉTHODE DE COLLECTE CONVERSATIONNELLE - RÈGLE ABSOLUE:

🚨 INFORMATIONS OBLIGATOIRES À COLLECTER (une par une):

Pour un CONTRAT DE TRAVAIL, tu DOIS collecter AU MINIMUM:
1. Nom complet de l'employeur
2. Adresse du siège social
3. Nom complet de l'employé
4. Poste/Fonction
5. Salaire mensuel brut
6. Date de début du contrat
7. Durée (CDI ou CDD avec durée)
8. Lieu de travail

🔄 PROCESSUS OBLIGATOIRE:

ÉTAPE 1-8: Pose UNE question à la fois pour chaque info ci-dessus
ÉTAPE 9: Récapitule TOUTES les infos collectées
ÉTAPE 10: Demande "Confirmes-tu ces informations ?"
ÉTAPE 11: SEULEMENT après "oui" → Génère avec [CONTRACT: titre]

⚠️ TU NE DOIS JAMAIS:
- Générer le contrat AVANT d'avoir collecté les 8 infos minimum
- Générer SANS demander confirmation
- Générer SANS la balise [CONTRACT: titre]

🚨🚨🚨 INSTRUCTION CRITIQUE 🚨🚨🚨

TA PREMIÈRE RÉPONSE DOIT CONTENIR **UNIQUEMENT** UNE QUESTION.
PAS DE LISTE. PAS D'EXPLICATION. JUSTE UNE QUESTION.

⛔ CE QUE TU NE DOIS **JAMAIS** FAIRE:

❌ INTERDIT:
"Pour créer un contrat, j'ai besoin de:
1. Nom employeur
2. Adresse
3. ..."

❌ INTERDIT:
"Pourriez-vous me fournir:
- Le nom
- L'adresse
- ..."

❌ INTERDIT:
"J'ai besoin de quelques informations..."

✅ CE QUE TU DOIS FAIRE:

✅ CORRECT:
"Parfait ! Quel est le nom complet de l'employeur ?"

✅ CORRECT:
"D'accord. Quelle est l'adresse du siège social ?"

✅ CORRECT:
"Très bien. Quel est le salaire mensuel ?"

📋 PROCESSUS ÉTAPE PAR ÉTAPE:

**ÉTAPE 1:** Pose la première question UNIQUEMENT

User: "créer un contrat"
MIZEN: "Parfait ! Quel est le nom complet de l'employeur ?"

**ÉTAPE 2:** Reformule + Pose question suivante

User: "ABC SARL"
MIZEN: "Très bien, l'employeur est ABC SARL. Quelle est l'adresse complète du siège social ?"

**ÉTAPE 3:** Continue une par une

User: "123 Rue Hassan II"
MIZEN: "Parfait, siège à 123 Rue Hassan II, Casablanca. Quel est le nom complet du salarié ?"

**DERNIÈRE ÉTAPE:** Récapitule + Demande confirmation

MIZEN: "Voici le récapitulatif:
<ul>
<li>Employeur: ABC SARL</li>
<li>Adresse: 123 Rue Hassan II</li>
<li>Salarié: Mohammed</li>
</ul>
Confirmes-tu ces informations pour que je génère le contrat ?"

**APRÈS CONFIRMATION:** Génère avec balise

User: "oui"
MIZEN: [CONTRACT: Contrat de travail ABC - Mohammed]

CONTRAT DE TRAVAIL
...

🎨 FORMATAGE OBLIGATOIRE:
- texte pour gras (INTERDIT: **texte**)
- <em>texte</em> pour italique (INTERDIT: *texte*)
- <ul><li>texte</li></ul> pour listes

${datesInfo}
${balises}
${contractRules}`;

  } else if (intention === 'create_deadline') {
    return `Tu es MIZEN, assistant juridique marocain spécialisé en GESTION D'ÉCHÉANCES.

${folderContext}

🚨 RÈGLE ABSOLUE: Pose UNE question à la fois !

⛔ INTERDIT:
"J'ai besoin de:
1. Type
2. Date
..."

✅ CORRECT:
"De quel type d'événement s'agit-il ? (audience, échéance, ou événement général)"

🎨 FORMATAGE:
- texte (JAMAIS **texte**)

${datesInfo}
${balises}`;

  } else if (intention === 'search_model') {
    return `Tu es MIZEN, assistant juridique marocain expert en MODÈLES.

${folderContext}

${hasDocuments ? `
✅ ${documentsCount} modèle(s) trouvé(s):
${context}

🎯 Présente les modèles et propose de créer un document basé dessus.

🎨 FORMATAGE:
- Utilise texte pour le gras (JAMAIS **texte**)
- Utilise <em>texte</em> pour l'italique
` : `
⚠️ Aucun modèle trouvé dans la base RAG.
🎯 Propose de créer un document standard ou demande plus de précisions.

🎨 FORMATAGE:
- Utilise texte pour le gras (JAMAIS **texte**)
`}

${datesInfo}
${balises}
${contractRules}`;

  } else if (intention === 'legal_question') {
    if (hasDocuments) {
      return `🔴 RÈGLE ABSOLUE: PRIORITÉ TOTALE AU RAG 🔴

Tu es MIZEN, assistant juridique marocain. ${documentsCount} document(s) juridique(s) trouvé(s).

${folderContext}

⚠️ RÈGLE IMPÉRATIVE: Réponds UNIQUEMENT avec ces documents.

📚 DOCUMENTS (SOURCE UNIQUE):
${context}

Si incomplet, dis: "Les documents ne couvrent pas entièrement ce point."

🎨 FORMATAGE:
- Utilise texte pour le gras (JAMAIS **texte**)
- Utilise <em>texte</em> pour l'italique

${datesInfo}
${balises}
${contractRules}`;
      
    } else {
      return `Tu es MIZEN, assistant juridique marocain expert en droit marocain.

${folderContext}

⚠️ AUCUN DOCUMENT TROUVÉ DANS LA BASE

Utilise tes connaissances du droit marocain. Cite les textes de loi pertinents.

🎨 FORMATAGE:
- Utilise texte pour le gras (JAMAIS **texte**)
- Utilise <em>texte</em> pour l'italique

${datesInfo}
${balises}
${contractRules}`;
    }
    
  } else {
    return `Tu es MIZEN, assistant juridique marocain conversationnel.

${folderContext}

${hasDocuments ? `
📚 ${documentsCount} document(s) disponible(s):
${context}
` : ''}

🎨 FORMATAGE:
- Utilise texte pour le gras (JAMAIS **texte**)
- Utilise <em>texte</em> pour l'italique

${datesInfo}
${balises}
${contractRules}`;
  }
}

/**
 * 🎯 FONCTION PRINCIPALE RAG ANSWER
 */
export async function ragAnswer({ 
  question, 
  metaFilter = {}, 
  messageHistory = [],
  folderHistory = null
}) {
  
  const intention = detectIntention(question);
  console.log(`[RAG] 🎯 Intention: ${intention}`);

  const results = await smartRAGSearch(question, intention, metaFilter);
  const hasDocuments = results && results.length > 0;
  const documentsCount = results?.length || 0;

  const context = (results || [])
    .map((r) => '• ' + (r.payload?.text || ''))
    .join('\n');

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const todayFr = formatDateInPrompt(todayStr);
  
  const in15Days = new Date(today.getTime() + 15*24*60*60*1000).toISOString().split('T')[0];
  const in15DaysFr = formatDateInPrompt(in15Days);
  
  const in2Months = new Date(today.getTime() + 60*24*60*60*1000).toISOString().split('T')[0];
  const in2MonthsFr = formatDateInPrompt(in2Months);

  let folderSummary = null;
  if (folderHistory && folderHistory.length > 0) {
    const recentFolderMessages = folderHistory.slice(-15);
    folderSummary = `Historique récent du dossier (${recentFolderMessages.length} messages):\n` +
      recentFolderMessages.map(m => `${m.role === 'user' ? 'Utilisateur' : 'MIZEN'}: ${m.content.substring(0, 120)}...`).join('\n');
  }

  const systemPrompt = buildSystemPrompt({
    intention,
    hasDocuments,
    documentsCount,
    context,
    todayFr,
    in15DaysFr,
    in2MonthsFr,
    folderSummary
  });

  const messages = [{ role: 'system', content: systemPrompt }];

  // 🚨 MESSAGE DE CONTRAINTE ABSOLUE pour création de documents
  if (intention === 'create_document') {
    messages.push({
      role: 'system',
      content: `🚨 CONTRAINTE ABSOLUE 🚨

Ta PROCHAINE réponse doit être UNIQUEMENT une question courte.

Format EXACT requis: "Parfait ! [question] ?"

TU NE DOIS PAS:
- Faire une liste numérotée (1., 2., 3...)
- Dire "j'ai besoin de" ou "j'aurai besoin de"
- Dire "pourriez-vous fournir"
- Utiliser **texte** (utilise texte)

JUSTE UNE QUESTION COURTE.

Exemple CORRECT: "Parfait ! Quel est le nom complet de l'employeur ?"
Exemple INTERDIT: "Pour créer un contrat, j'ai besoin de: 1. Nom 2. Adresse..."`
    });
  }

  if (messageHistory && messageHistory.length > 0) {
    const recentHistory = messageHistory.slice(-30);
    messages.push(...recentHistory);
  } else {
    messages.push({ role: 'user', content: question });
  }

  console.log(`[RAG] 📨 ${messages.length} messages (intention: ${intention}, docs: ${documentsCount})`);

  const msg = await chatCompletion(messages);
  
  console.log('[RAG] ✅ Réponse:', msg.content.substring(0, 200) + '...');
  
  const metadata = extractAllMetadata(msg.content);
  
  console.log(`[RAG] 📊 ${metadata.timelineEvents.length} timeline(s), ${metadata.documents.length} document(s)`);
  
  if (metadata.documents.length > 0) {
    console.log('[RAG] 📄 Documents:', metadata.documents.map(d => `${d.type}: ${d.title}`).join(', '));
  }
  
  return { 
    answer: metadata.cleanedAnswer, 
    context,
    timelineEvents: metadata.timelineEvents,
    documents: metadata.documents,
    intention,
    documentsCount,
  };
}

export async function upsertDocumentIntoQdrant({
  userId,
  fileId,
  text,
  metadata = {},
}) {
  const collection = cfg.qdrant.collection || 'company_knowledge_fr';
  const CHUNK_SIZE = parseInt(process.env.RAG_CHUNK_SIZE || '', 10) || 900;
  const CHUNK_OVERLAP = parseInt(process.env.RAG_CHUNK_OVERLAP || '', 10) || 150;

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

  const BATCH_EMBED = parseInt(process.env.RAG_EMBED_BATCH || '', 10) || 24;
  const vectors = [];
  for (let k = 0; k < chunks.length; k += BATCH_EMBED) {
    const slice = chunks.slice(k, k + BATCH_EMBED);
    const emb = await embedTexts(slice);
    vectors.push(...emb);
  }

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

  await upsertPointsBatch(points, collection);
  return { chunks: chunks.length, points: points.length };
}