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

export async function ragAnswer({ question, metaFilter = {}, messageHistory = [] }) {
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

  // ✅ Vérifier si des documents ont été trouvés
  const hasDocuments = results && results.length > 0;
  const documentsFound = results?.length || 0;

  const context = (results || [])
    .map((r) => '• ' + (r.payload?.text || ''))
    .join('\n');

  console.log(`[RAG] Documents trouvés: ${documentsFound}`);

  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const todayFr = formatDateInPrompt(todayStr);
  
  const in15Days = new Date(today.getTime() + 15*24*60*60*1000).toISOString().split('T')[0];
  const in15DaysFr = formatDateInPrompt(in15Days);
  const in2Months = new Date(today.getTime() + 60*24*60*60*1000).toISOString().split('T')[0];
  const in2MonthsFr = formatDateInPrompt(in2Months);

  // ✅ PRIORITÉ ABSOLUE AU RAG : Deux prompts différents selon les documents trouvés
  let systemPrompt;

  if (hasDocuments) {
    // 🟢 CAS 1: Des documents ont été trouvés → RÉPONDRE UNIQUEMENT DEPUIS CES DOCUMENTS
    console.log(`[RAG] Mode: STRICT RAG ONLY (${documentsFound} documents trouvés)`);
    
    systemPrompt = `🔴 RÈGLE ABSOLUE DE PRIORITÉ RAG 🔴

Tu es MIZEN, assistant juridique marocain. ${documentsFound} document(s) pertinent(s) ont été trouvés dans la base de connaissances.

⚠️ RÈGLE IMPÉRATIVE ⚠️
Tu DOIS répondre EXCLUSIVEMENT en utilisant les informations contenues dans ces documents.
Tu NE DOIS PAS utiliser tes connaissances générales.
Si les documents ne contiennent pas assez d'informations, dis-le clairement :
"Les documents disponibles ne contiennent pas suffisamment d'informations sur ce point."

📚 DOCUMENTS DISPONIBLES (SOURCE PRIORITAIRE):
${context}

🎯 CONSIGNES:
1. Cite UNIQUEMENT les informations présentes dans les documents ci-dessus
2. Si la réponse n'est pas dans les documents, dis "Cette information n'est pas disponible dans les documents fournis"
3. Ne complète PAS avec tes connaissances générales
4. Reste factuel et précis selon les documents

Date du jour: ${todayFr}
Dans 15 jours: ${in15DaysFr}
Dans 2 mois: ${in2MonthsFr}

🏷️ BALISES SPÉCIALES:
- Timeline: [PROCEDURE:...], [FACT:...], [HEARING:...|date], [DEADLINE:...|date], [EVENT:...]
- Documents: [CONTRACT:...], [CONCLUSION:...], [NOTE:...], [LETTER:...], [REPORT:...]

RÈGLES ABSOLUES POUR LES CONTRATS:
1. Ne JAMAIS demander la durée d'un CDI.
2. TOUJOURS utiliser la balise [CONTRACT: ...] après une confirmation.
3. Ne JAMAIS afficher de HTML brut sans balise [CONTRACT: ...] en tête.
4. Toujours distinguer CONTRAT DE TRAVAIL (employeur/employé) vs CONTRAT DE PRESTATION (cabinet/client).`;

  } else {
    // 🔴 CAS 2: Aucun document trouvé → Utiliser les connaissances générales
    console.log('[RAG] Mode: CONNAISSANCES GÉNÉRALES (aucun document trouvé)');
    
    systemPrompt = `Tu es MIZEN, assistant juridique marocain expert en droit marocain.

⚠️ AUCUN DOCUMENT TROUVÉ DANS LA BASE DE CONNAISSANCES ⚠️

Puisqu'aucun document pertinent n'a été trouvé dans la base de connaissances, tu vas utiliser tes connaissances générales du droit marocain pour répondre.

🎯 CONSIGNES:
1. Réponds en utilisant tes connaissances du droit marocain
2. Sois précis et rigoureux
3. Cite les textes de loi que tu connais (Code pénal, Code de procédure civile, etc.)
4. Adapte-toi au niveau de ton interlocuteur (avocat, assistant, citoyen)
5. Sois pédagogique et clair

### 👥 Adaptation selon l'interlocuteur

| Interlocuteur          | Ton et niveau de langage    |
| ---------------------- | --------------------------- |
| Avocat                 | Technique, direct           |
| Assistant juridique    | Semi-technique, pédagogique |
| Citoyen ou justiciable | Vulgarisé, accessible       |

Date du jour: ${todayFr}
Dans 15 jours: ${in15DaysFr}
Dans 2 mois: ${in2MonthsFr}

🏷️ BALISES SPÉCIALES:
- Timeline: [PROCEDURE:...], [FACT:...], [HEARING:...|date], [DEADLINE:...|date], [EVENT:...]
- Documents: [CONTRACT:...], [CONCLUSION:...], [NOTE:...], [LETTER:...], [REPORT:...]

RÈGLES ABSOLUES POUR LES CONTRATS:
1. Ne JAMAIS demander la durée d'un CDI.
2. TOUJOURS utiliser la balise [CONTRACT: ...] après une confirmation.
3. Ne JAMAIS afficher de HTML brut sans balise [CONTRACT: ...] en tête.
4. Toujours distinguer CONTRAT DE TRAVAIL (employeur/employé) vs CONTRAT DE PRESTATION (cabinet/client).`;
  }

  const messages = [{ role: 'system', content: systemPrompt }];

  if (messageHistory && messageHistory.length > 0) {
    const recentHistory = messageHistory.slice(-30);
    messages.push(...recentHistory);
  } else {
    messages.push({ role: 'user', content: question });
  }

  console.log(`[RAG] Envoi de ${messages.length} messages`);

  const msg = await chatCompletion(messages);
  
  console.log('[RAG] Réponse brute:', msg.content.substring(0, 300));
  
  const metadata = extractAllMetadata(msg.content);
  
  console.log(`[RAG] Timeline: ${metadata.timelineEvents.length}, Documents: ${metadata.documents.length}`);
  
  if (metadata.documents.length > 0) {
    console.log('[RAG] Documents détectés:', metadata.documents.map(d => `${d.type}: ${d.title}`));
  }
  
  return { 
    answer: metadata.cleanedAnswer, 
    context,
    timelineEvents: metadata.timelineEvents,
    documents: metadata.documents,
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