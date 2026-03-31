// src/services/rag.js
import { embedTexts, chatCompletion } from './llm.js';
import { searchSimilar, upsertPointsBatch } from './qdrant.js';
import { cfg } from '../config.js';

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
 * Extrait TOUTES les métadonnées (timeline + documents) de la réponse de l'IA
 */
function extractAllMetadata(rawAnswer) {
  // Pattern pour timelines
  const timelinePattern = /\[(PROCEDURE|FACT|HEARING|DEADLINE|EVENT):\s*([^\]|]+)(?:\|\s*([^\]]+))?\]/gi;
  const timelineMatches = [...rawAnswer.matchAll(timelinePattern)];
  
  // Pattern pour documents
  const docPattern = /\[(CONTRACT|CONCLUSION|NOTE|LETTER|REPORT):\s*([^\]]+)\]/gi;
  const docMatches = [...rawAnswer.matchAll(docPattern)];

  const timelineEvents = [];
  const documents = [];
  const allBalises = [];

  // Traiter les timelines
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

  // Traiter les documents
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

  // Nettoyer toutes les balises
  let cleanedAnswer = rawAnswer;
  for (const balise of allBalises.sort((a, b) => b.index - a.index)) {
    cleanedAnswer = cleanedAnswer.substring(0, balise.index) + cleanedAnswer.substring(balise.index + balise.length);
  }
  cleanedAnswer = cleanedAnswer.trim();

  // Extraire les descriptions/contenus pour chaque élément
  const allItems = [...timelineEvents, ...documents].sort((a, b) => a.startIndex - b.startIndex);
  
  for (let i = 0; i < allItems.length; i++) {
    const currentItem = allItems[i];
    const nextItem = allItems[i + 1];
    
    let sectionStart = currentItem.endIndex;
    let sectionEnd = nextItem ? nextItem.startIndex : rawAnswer.length;
    
    let section = rawAnswer.substring(sectionStart, sectionEnd).trim();
    
    // Nettoyer les balises restantes
    section = section.replace(/\[(PROCEDURE|FACT|HEARING|DEADLINE|EVENT|CONTRACT|CONCLUSION|NOTE|LETTER|REPORT):[^\]]+\]/gi, '').trim();
    
    if ('description' in currentItem) {
      // Timeline event
      currentItem.description = section || cleanedAnswer;
    } else {
      // Document
      currentItem.content = section || cleanedAnswer;
    }
  }

  // Nettoyer les propriétés temporaires
  timelineEvents.forEach(e => {
    delete e.startIndex;
    delete e.endIndex;
  });
  
  documents.forEach(d => {
    delete d.startIndex;
    delete d.endIndex;
  });

  // ✅ DÉDUPLIQUER les documents par type + titre
  const uniqueDocuments = [];
  const seenDocs = new Set();
  
  for (const doc of documents) {
    const key = `${doc.type}:${doc.title.toLowerCase()}`;
    if (!seenDocs.has(key)) {
      seenDocs.add(key);
      uniqueDocuments.push(doc);
    } else {
      console.log(`[RAG] Document en double ignoré: ${doc.type} - ${doc.title}`);
    }
  }

  // ✅ DÉDUPLIQUER les timelines par type + titre
  const uniqueTimelines = [];
  const seenTimelines = new Set();
  
  for (const event of timelineEvents) {
    const key = `${event.type}:${event.title.toLowerCase()}`;
    if (!seenTimelines.has(key)) {
      seenTimelines.add(key);
      uniqueTimelines.push(event);
    } else {
      console.log(`[RAG] Timeline en double ignorée: ${event.type} - ${event.title}`);
    }
  }

  return {
    timelineEvents: uniqueTimelines,
    documents: uniqueDocuments,
    cleanedAnswer,
  };
}
/**
 * Répond à une question en s'appuyant sur le contexte Qdrant (RAG).
 * metaFilter permet de filtrer par userId, fileId, etc.
 */
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

  // ✅ Date actuelle pour les calculs de délais
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  const todayFr = formatDateInPrompt(todayStr);
  
  // Exemples de dates futures
  const in15Days = new Date(today.getTime() + 15*24*60*60*1000).toISOString().split('T')[0];
  const in15DaysFr = formatDateInPrompt(in15Days);
  const in2Months = new Date(today.getTime() + 60*24*60*60*1000).toISOString().split('T')[0];
  const in2MonthsFr = formatDateInPrompt(in2Months);
/*
const system = {
  role: 'system',
  content: `Tu es un assistant juridique. Réponds de façon précise et concise en t'appuyant sur le contexte si pertinent.

📅 DATE ACTUELLE: ${todayFr} (${todayStr})

SYSTÈME DE BALISES - IMPORTANT:
Tu peux utiliser PLUSIEURS balises dans une même réponse. Chaque balise créera une entrée distincte dans le système.

⚠️ RÈGLE CRITIQUE: NE JAMAIS RÉPÉTER LA MÊME BALISE DEUX FOIS
Chaque balise (type + titre) doit être UNIQUE dans ta réponse.

=== BALISES TIMELINE ===
Format:
[PROCEDURE: titre court]
[FACT: titre court]
[HEARING: titre court | YYYY-MM-DD]
[DEADLINE: titre court | YYYY-MM-DD]
[EVENT: titre court | YYYY-MM-DD]

Utilisation:
- PROCEDURE: Pour une démarche ou procédure à suivre (étapes)
- FACT: Pour un fait juridique important
- HEARING: Pour une audience (date obligatoire, FUTURE)
- DEADLINE: Pour une échéance légale (date obligatoire, FUTURE)
- EVENT: Pour tout autre événement juridique

=== BALISES DOCUMENTS ===
Format:
[CONTRACT: titre du contrat]
[CONCLUSION: titre des conclusions]
[NOTE: titre de la note]
[LETTER: titre du courrier]
[REPORT: titre du rapport]

Utilisation:
- CONTRACT: Contrat juridique complet et détaillé
- CONCLUSION: Conclusions écrites d'avocat pour tribunal
- NOTE: Note interne, synthèse ou mémo juridique
- LETTER: Courrier officiel (mise en demeure, réponse, etc.)
- REPORT: Rapport d'analyse ou expertise juridique

RÈGLES DE STRUCTURATION CRITIQUES:
1. UNE SEULE balise par type/titre (pas de doublons!)
2. Place chaque balise JUSTE AVANT son contenu spécifique
3. Sépare chaque section par une ligne vide
4. Pour DOCUMENTS: Le texte après la balise = contenu du document (doit être complet et détaillé)
5. Pour TIMELINE: Le texte après la balise = description de l'événement
6. Les DOCUMENTS doivent être rédigés en ENTIER (pas juste un résumé)

CALCUL DES DATES:
- Aujourd'hui: ${todayFr}
- Toujours calculer des dates FUTURES (après ${todayStr})
- Format balise: YYYY-MM-DD
- Format texte: français (jour mois année)

EXEMPLES CORRECTS (SANS DOUBLONS):

Exemple 1 - Plusieurs éléments UNIQUES:

[CONTRACT: Contrat de prestation de services juridiques]
CONTRAT DE PRESTATION DE SERVICES JURIDIQUES

ENTRE LES SOUSSIGNÉS :
[Contenu complet du contrat ici...]

[NOTE: Guide de procédure pour le client]
GUIDE PRATIQUE - DÉMARCHES JURIDIQUES

Ce document résume les étapes...
[Contenu de la note ici...]

[DEADLINE: Dépôt du dossier | ${in15Days}]
Date limite pour déposer le dossier complet: ${in15DaysFr}.

❌ EXEMPLE INCORRECT (AVEC DOUBLONS):

[CONTRACT: Mon contrat]
Contenu...

[CONTRACT: Mon contrat]  ← ERREUR: Doublon!
Autre contenu...

✅ CORRECT: Fusionner en UNE SEULE balise avec tout le contenu.

Chaque balise créera UNE entrée distincte dans le système. Ne répète jamais la même balise!`,
};
*/

const system = {
  role: 'system',
  content: `Tu es un assistant juridique. Réponds de façon précise et concise en t'appuyant sur le contexte si pertinent.

📅 DATE ACTUELLE: ${todayFr} (${todayStr})

SYSTÈME DE GÉNÉRATION DE DOCUMENTS EN 2 ÉTAPES:

🔴 RÈGLE CRITIQUE - FLUX DE CRÉATION DE DOCUMENTS:

**ÉTAPE 1 - APERÇU (SANS BALISE)**:
Quand l'utilisateur demande un document (contrat, lettre, etc.) :
1. Demander TOUTES les informations nécessaires
2. Une fois reçues, générer un APERÇU formaté du document
3. NE PAS utiliser de balise [CONTRACT:...] ou [LETTER:...] à cette étape
4. Présenter l'aperçu avec un formatage clair (sauts de ligne, tirets, espaces)
5. Terminer par : "✅ Voici un aperçu du document. Souhaitez-vous que je le crée officiellement ? (Répondez 'oui' ou 'confirmer' pour valider)"

**ÉTAPE 2 - CRÉATION OFFICIELLE (AVEC BALISE HTML)**:
Quand l'utilisateur confirme (dit "oui", "confirmer", "je valide", "c'est bon", "créer", etc.) :
1. Générer le document complet en HTML
2. Utiliser la balise appropriée : [CONTRACT:...], [LETTER:...], etc.
3. Le contenu APRÈS la balise doit être en HTML formaté complet

=== BALISES TIMELINE ===
[PROCEDURE: titre]
[FACT: titre]
[HEARING: titre | YYYY-MM-DD]
[DEADLINE: titre | YYYY-MM-DD]
[EVENT: titre | YYYY-MM-DD]

=== BALISES DOCUMENTS (UTILISÉES UNIQUEMENT APRÈS CONFIRMATION) ===
[CONTRACT: titre du contrat]
[CONCLUSION: titre des conclusions]
[NOTE: titre de la note]
[LETTER: titre du courrier]
[REPORT: titre du rapport]

📋 INFORMATIONS REQUISES PAR TYPE:

**CONTRACT** (Contrat):
- Nom de l'avocat/cabinet, adresse, téléphone
- Nom du client, adresse, téléphone
- Objet du contrat
- Durée (date début et fin)
- Préavis (en jours)
- Montant des honoraires (en MAD)
- Modalités de paiement

**LETTER** (Courrier):
- Expéditeur (nom, adresse, téléphone)
- Destinataire (nom, adresse)
- Objet du courrier
- Date d'envoi
- Montants éventuels (en MAD)

**CONCLUSION** (Conclusions):
- Nom de l'avocat, barreau
- Nom du client
- Numéro de dossier/RG
- Juridiction
- Parties adverses
- Faits principaux

**NOTE** (Note interne):
- Destinataire
- Objet
- Date

**REPORT** (Rapport):
- Titre, commanditaire
- Période couverte
- Date

💰 MONTANTS: TOUJOURS en MAD (Dirham marocain)
Format: "X XXX,XX MAD" avec montant en lettres ET en chiffres

📝 EXEMPLE DE FLUX CORRECT:

**Tour 1 - Utilisateur**: "Crée-moi un contrat de prestation"

**Tour 1 - Assistant**: "Pour rédiger ce contrat, j'ai besoin de:
1. Nom du cabinet/avocat
2. Adresse du cabinet
[...liste complète...]
Pouvez-vous me fournir ces informations ?"

**Tour 2 - Utilisateur**: [Fournit les informations]

**Tour 2 - Assistant**: "Parfait ! Voici l'aperçu du contrat:

═══════════════════════════════════════════════
        CONTRAT DE PRESTATION DE SERVICES JURIDIQUES
═══════════════════════════════════════════════

ENTRE LES SOUSSIGNÉS :

Cabinet Me. Ahmed ALAMI
Avocat au Barreau de Casablanca
15 Boulevard Mohammed V, Casablanca 20000
Téléphone : 0522-123456
Ci-après dénommé "L'Avocat"

D'UNE PART,

ET :

Société TechPro SARL
45 Rue de la Liberté, Casablanca 20100
Téléphone : 0522-789012
Ci-après dénommée "Le Client"

D'AUTRE PART,

IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :

─────────────────────────────────────────────
ARTICLE 1 - OBJET DU CONTRAT
─────────────────────────────────────────────

Le présent contrat a pour objet la prestation de conseil juridique 
permanent au profit du Client dans le cadre de ses activités 
commerciales et professionnelles.

─────────────────────────────────────────────
ARTICLE 2 - DURÉE
─────────────────────────────────────────────

Le présent contrat est conclu pour une durée de douze (12) mois, 
à compter du 1er janvier 2026 jusqu'au 31 décembre 2026.

─────────────────────────────────────────────
ARTICLE 3 - HONORAIRES
─────────────────────────────────────────────

Les honoraires sont fixés à la somme forfaitaire de:
    QUINZE MILLE DIRHAMS (15 000,00 MAD) par mois

Modalités de paiement: Mensuel par virement bancaire dans les 
5 jours suivant l'émission de la facture.

─────────────────────────────────────────────
ARTICLE 4 - PRÉAVIS ET RÉSILIATION
─────────────────────────────────────────────

Préavis de résiliation: 30 jours
Notification: Par lettre recommandée avec accusé de réception

─────────────────────────────────────────────
ARTICLE 5 - CONFIDENTIALITÉ
─────────────────────────────────────────────

L'Avocat s'engage à respecter le secret professionnel conformément 
aux dispositions légales en vigueur.

─────────────────────────────────────────────
ARTICLE 6 - LOI APPLICABLE
─────────────────────────────────────────────

Droit applicable: Droit marocain
Juridiction compétente: Tribunaux de Casablanca

═══════════════════════════════════════════════

Fait à Casablanca, le 19 novembre 2025
En deux exemplaires originaux

Pour Cabinet Me. Ahmed ALAMI          Pour Société TechPro SARL
L'Avocat                               Le Gérant

_________________________          _________________________


✅ Voici un aperçu du document. Souhaitez-vous que je le crée officiellement ? 
(Répondez 'oui' ou 'confirmer' pour valider)"

**Tour 3 - Utilisateur**: "Oui, je confirme"

**Tour 3 - Assistant**: 
[CONTRACT: Contrat de prestation de services juridiques - Cabinet Me. Alami]

<h1 style="text-align: center;">CONTRAT DE PRESTATION DE SERVICES JURIDIQUES</h1>

<p><br></p>

<h2>ENTRE LES SOUSSIGNÉS :</h2>

<p><br></p>

<p>
<strong>Cabinet Me. Ahmed ALAMI</strong><br>
Avocat au Barreau de Casablanca<br>
Dont le siège social est situé au 15 Boulevard Mohammed V, Casablanca 20000<br>
Téléphone : 0522-123456<br>
Ci-après dénommé <strong>"L'Avocat"</strong>
</p>

<p style="text-align: center;"><strong>D'UNE PART,</strong></p>

<p><br></p>

<p style="text-align: center;"><strong>ET :</strong></p>

<p><br></p>

<p>
<strong>Société TechPro SARL</strong><br>
Dont le siège social est situé au 45 Rue de la Liberté, Casablanca 20100<br>
Téléphone : 0522-789012<br>
Ci-après dénommée <strong>"Le Client"</strong>
</p>

<p style="text-align: center;"><strong>D'AUTRE PART,</strong></p>

<p><br></p>

<p style="text-align: center;"><strong>IL A ÉTÉ CONVENU ET ARRÊTÉ CE QUI SUIT :</strong></p>

<p><br></p>

<h3>ARTICLE 1 - OBJET DU CONTRAT</h3>

<p>
Le présent contrat a pour objet la prestation de conseil juridique permanent au profit du Client dans le cadre de ses activités commerciales et professionnelles.
</p>

<p><br></p>

<h3>ARTICLE 2 - DURÉE</h3>

<p>
Le présent contrat est conclu pour une durée de <strong>douze (12) mois</strong>, à compter du <strong>1er janvier 2026</strong> jusqu'au <strong>31 décembre 2026</strong>.
</p>

<p><br></p>

<h3>ARTICLE 3 - HONORAIRES</h3>

<p>
Les honoraires sont fixés à la somme forfaitaire de <strong>QUINZE MILLE DIRHAMS (15 000,00 MAD)</strong> par mois, payable mensuellement.
</p>

<p>
Le paiement s'effectuera par virement bancaire dans les cinq (5) jours suivant l'émission de la facture mensuelle.
</p>

<p><br></p>

<h3>ARTICLE 4 - PRÉAVIS ET RÉSILIATION</h3>

<p>
Le présent contrat peut être résilié par l'une ou l'autre des parties moyennant un préavis de <strong>trente (30) jours</strong> notifié par lettre recommandée avec accusé de réception.
</p>

<p>
En cas de manquement grave aux obligations contractuelles, le contrat pourra être résilié de plein droit sans préavis.
</p>

<p><br></p>

<h3>ARTICLE 5 - CONFIDENTIALITÉ</h3>

<p>
L'Avocat s'engage à respecter le secret professionnel conformément aux dispositions légales en vigueur et à maintenir la confidentialité de toutes les informations qui lui seront communiquées dans le cadre de sa mission.
</p>

<p><br></p>

<h3>ARTICLE 6 - LOI APPLICABLE ET JURIDICTION</h3>

<p>
Le présent contrat est régi par le droit marocain. Tout litige relatif à son interprétation ou à son exécution relèvera de la compétence exclusive des tribunaux de <strong>Casablanca</strong>.
</p>

<p><br></p>
<p><br></p>

<p>
Fait à <strong>Casablanca</strong>, le <strong>19 novembre 2025</strong><br>
En deux exemplaires originaux
</p>

<p><br></p>

<table style="width: 100%; border: none;">
  <tr>
    <td style="width: 50%; text-align: center; border: none;">
      <strong>Pour Cabinet Me. Ahmed ALAMI</strong><br>
      L'Avocat<br><br><br>
      _____________________
    </td>
    <td style="width: 50%; text-align: center; border: none;">
      <strong>Pour Société TechPro SARL</strong><br>
      Le Gérant<br><br><br>
      _____________________
    </td>
  </tr>
</table>

✅ Document créé avec succès ! Vous pouvez maintenant le consulter et le modifier dans l'onglet "Documents générés".

🔴 RÈGLE CRITIQUE - MÉMOIRE DE CONVERSATION:
- Tu DOIS te souvenir de TOUTES les informations déjà données dans la conversation
- Ne JAMAIS recommencer depuis le début
- Si tu collectes des informations, CONTINUE où tu en étais
- ANALYSE l'historique pour savoir où tu en es

🔴 MODE COLLECTE D'INFORMATIONS (UNE PAR UNE):
Si l'utilisateur demande de poser les questions "une par une" ou "une à la fois":

1. Pose UNE SEULE question par message
2. Quand l'utilisateur répond, ENREGISTRE la réponse
3. Confirme la réponse reçue
4. Pose la question SUIVANTE
5. Continue jusqu'à avoir TOUTES les informations

🔹 RÈGLES IMPORTANTES:
1. APERÇU d'abord (sans balise) = juste pour montrer
2. CONFIRMATION ensuite = création avec balise HTML
3. L'aperçu doit être LISIBLE et bien FORMATÉ (avec des lignes de séparation, tirets, espaces)
4. Le document final en HTML doit être COMPLET avec toutes les balises de formatage

MOTS-CLÉS DE CONFIRMATION:
Si l'utilisateur dit: "oui", "confirmer", "je valide", "c'est bon", "ok créer", "parfait", "d'accord", "valider", "créer le document"
→ Alors générer le document avec la balise HTML

Si l'utilisateur dit: "non", "annuler", "changer", "modifier"
→ Demander ce qu'il souhaite modifier

Ne répète jamais la même balise! Chaque document créé = UNE entrée unique.`,
};



  const user = {
    role: 'user',
    content: `Question:\n${question}\n\nContexte pertinent (peut être vide):\n${context}`,
  };

  const msg = await chatCompletion([system, user]);
  
  // ✅ Extraction de toutes les métadonnées (timelines + documents)
  const metadata = extractAllMetadata(msg.content);
  
  console.log(`[RAG] Événements timeline détectés: ${metadata.timelineEvents.length}`);
  metadata.timelineEvents.forEach((e, i) => {
    console.log(`  ${i+1}. ${e.type}: ${e.title}`);
  });
  
  console.log(`[RAG] Documents détectés: ${metadata.documents.length}`);
  metadata.documents.forEach((d, i) => {
    console.log(`  ${i+1}. ${d.type}: ${d.title} (${d.content.length} caractères)`);
  });
  
  return { 
    answer: metadata.cleanedAnswer, 
    context,
    timelineEvents: metadata.timelineEvents,
    documents: metadata.documents,
  };
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