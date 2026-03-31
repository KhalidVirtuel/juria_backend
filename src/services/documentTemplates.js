// backend/src/services/documentTemplates.js

export const DOCUMENT_TEMPLATES = {
  CDD: {
    name: "Contrat à Durée Déterminée (CDD)",
    type: "contract",
    fields: [
      { key: "employeur_nom", question: "Quel est le nom de l'employeur ?", required: true },
      { key: "employeur_adresse", question: "Quelle est l'adresse complète de l'employeur ?", required: true },
      { key: "employeur_representant", question: "Qui représente l'employeur (nom et fonction) ?", required: true },
      { key: "salarie_nom", question: "Quel est le nom complet du salarié ?", required: true },
      { key: "salarie_cin", question: "Quel est le numéro de CIN du salarié ?", required: true },
      { key: "salarie_adresse", question: "Quelle est l'adresse complète du salarié ?", required: true },
      { key: "poste", question: "Quel est le poste occupé ?", required: true },
      { key: "duree", question: "Quelle est la durée du contrat (ex: 6 mois, 1 an) ?", required: true },
      { key: "date_debut", question: "Quelle est la date de début du contrat (JJ/MM/AAAA) ?", required: true },
      { key: "salaire", question: "Quel est le salaire brut mensuel en dirhams (MAD) ?", required: true },
      { key: "lieu_signature", question: "Quel est le lieu de signature du contrat ?", required: true },
      { key: "date_signature", question: "Quelle est la date de signature du contrat (JJ/MM/AAAA) ?", required: false }
    ],
    template: (data) => `
<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; max-width: 800px; margin: 0 auto;">
  <h1 style="text-align: center; text-transform: uppercase; margin-bottom: 30px;">
    Contrat de Travail à Durée Déterminée (CDD)
  </h1>
  
  <p style="margin-bottom: 20px;"><strong>Entre les soussignés :</strong></p>
  
  <div style="margin-bottom: 30px;">
    <p><strong>L'Employeur :</strong></p>
    <ul style="list-style: none; padding-left: 20px;">
      <li>Raison sociale : <strong>${data.employeur_nom}</strong></li>
      <li>Adresse : ${data.employeur_adresse}</li>
      <li>Représenté par : ${data.employeur_representant}</li>
    </ul>
  </div>
  
  <p style="margin-bottom: 10px;"><strong>D'une part,</strong></p>
  
  <div style="margin-bottom: 30px;">
    <p><strong>Et le Salarié :</strong></p>
    <ul style="list-style: none; padding-left: 20px;">
      <li>Nom et prénom : <strong>${data.salarie_nom}</strong></li>
      <li>CIN : ${data.salarie_cin}</li>
      <li>Adresse : ${data.salarie_adresse}</li>
    </ul>
  </div>
  
  <p style="margin-bottom: 30px;"><strong>D'autre part,</strong></p>
  
  <p style="margin-bottom: 30px;">Il a été convenu et arrêté ce qui suit :</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 1 – Objet du contrat</h2>
  <p>Le présent contrat est conclu pour une durée déterminée conformément aux dispositions du Code du travail marocain (Loi 65-99).</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 2 – Fonction</h2>
  <p>Le salarié est engagé en qualité de <strong>${data.poste}</strong>.</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 3 – Durée du contrat</h2>
  <p>Le présent contrat est conclu pour une durée de <strong>${data.duree}</strong> à compter du <strong>${data.date_debut}</strong>.</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 4 – Rémunération</h2>
  <p>Le salarié percevra une rémunération brute mensuelle de <strong>${data.salaire} MAD</strong>.</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 5 – Conditions de travail</h2>
  <p>Les conditions de travail seront conformes aux dispositions légales et réglementaires en vigueur au Maroc, notamment en ce qui concerne la durée du travail, les congés payés et la sécurité sociale.</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 6 – Résiliation</h2>
  <p>Le contrat peut être résilié par l'une ou l'autre des parties dans les conditions prévues par la législation marocaine du travail.</p>
  
  <div style="margin-top: 60px; margin-bottom: 30px;">
    <p>Fait à <strong>${data.lieu_signature}</strong>, le <strong>${data.date_signature || '____________________'}</strong></p>
  </div>
  
  <div style="display: flex; justify-content: space-between; margin-top: 80px;">
    <div style="text-align: center;">
      <p><strong>Signature de l'Employeur</strong></p>
      <p style="margin-top: 60px; border-top: 1px solid #000; padding-top: 10px;">(Signature et cachet)</p>
    </div>
    <div style="text-align: center;">
      <p><strong>Signature du Salarié</strong></p>
      <p style="margin-top: 60px; border-top: 1px solid #000; padding-top: 10px;">(Signature)</p>
    </div>
  </div>
</div>
    `
  },

  CDI: {
    name: "Contrat à Durée Indéterminée (CDI)",
    type: "contract",
    fields: [
      { key: "employeur_nom", question: "Quel est le nom de l'employeur ?", required: true },
      { key: "employeur_adresse", question: "Quelle est l'adresse complète de l'employeur ?", required: true },
      { key: "employeur_representant", question: "Qui représente l'employeur (nom et fonction) ?", required: true },
      { key: "salarie_nom", question: "Quel est le nom complet du salarié ?", required: true },
      { key: "salarie_cin", question: "Quel est le numéro de CIN du salarié ?", required: true },
      { key: "salarie_adresse", question: "Quelle est l'adresse complète du salarié ?", required: true },
      { key: "poste", question: "Quel est le poste occupé ?", required: true },
      { key: "date_debut", question: "Quelle est la date de début du contrat (JJ/MM/AAAA) ?", required: true },
      { key: "salaire", question: "Quel est le salaire brut mensuel en dirhams (MAD) ?", required: true },
      { key: "periode_essai", question: "Quelle est la durée de la période d'essai (ex: 3 mois) ?", required: false },
      { key: "lieu_signature", question: "Quel est le lieu de signature du contrat ?", required: true },
      { key: "date_signature", question: "Quelle est la date de signature du contrat (JJ/MM/AAAA) ?", required: false }
    ],
    template: (data) => `
<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; max-width: 800px; margin: 0 auto;">
  <h1 style="text-align: center; text-transform: uppercase; margin-bottom: 30px;">
    Contrat de Travail à Durée Indéterminée (CDI)
  </h1>
  
  <p style="margin-bottom: 20px;"><strong>Entre les soussignés :</strong></p>
  
  <div style="margin-bottom: 30px;">
    <p><strong>L'Employeur :</strong></p>
    <ul style="list-style: none; padding-left: 20px;">
      <li>Raison sociale : <strong>${data.employeur_nom}</strong></li>
      <li>Adresse : ${data.employeur_adresse}</li>
      <li>Représenté par : ${data.employeur_representant}</li>
    </ul>
  </div>
  
  <p style="margin-bottom: 10px;"><strong>D'une part,</strong></p>
  
  <div style="margin-bottom: 30px;">
    <p><strong>Et le Salarié :</strong></p>
    <ul style="list-style: none; padding-left: 20px;">
      <li>Nom et prénom : <strong>${data.salarie_nom}</strong></li>
      <li>CIN : ${data.salarie_cin}</li>
      <li>Adresse : ${data.salarie_adresse}</li>
    </ul>
  </div>
  
  <p style="margin-bottom: 30px;"><strong>D'autre part,</strong></p>
  
  <p style="margin-bottom: 30px;">Il a été convenu et arrêté ce qui suit :</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 1 – Objet du contrat</h2>
  <p>Le présent contrat est conclu pour une durée indéterminée conformément aux dispositions du Code du travail marocain (Loi 65-99).</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 2 – Fonction</h2>
  <p>Le salarié est engagé en qualité de <strong>${data.poste}</strong>.</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 3 – Date d'entrée en vigueur</h2>
  <p>Le présent contrat prend effet à compter du <strong>${data.date_debut}</strong>.</p>
  
  ${data.periode_essai ? `
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article 4 – Période d'essai</h2>
  <p>Le contrat est assorti d'une période d'essai de <strong>${data.periode_essai}</strong>, durant laquelle chacune des parties peut y mettre fin sans préavis ni indemnité.</p>
  ` : ''}
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article ${data.periode_essai ? '5' : '4'} – Rémunération</h2>
  <p>Le salarié percevra une rémunération brute mensuelle de <strong>${data.salaire} MAD</strong>.</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article ${data.periode_essai ? '6' : '5'} – Durée du travail</h2>
  <p>La durée normale du travail est fixée conformément aux dispositions légales en vigueur au Maroc, soit 44 heures par semaine.</p>
  
  <h2 style="margin-top: 30px; margin-bottom: 15px;">Article ${data.periode_essai ? '7' : '6'} – Résiliation</h2>
  <p>Le contrat peut être résilié par l'une ou l'autre des parties moyennant le respect d'un préavis et dans les conditions prévues par la législation marocaine du travail.</p>
  
  <div style="margin-top: 60px; margin-bottom: 30px;">
    <p>Fait à <strong>${data.lieu_signature}</strong>, le <strong>${data.date_signature || '____________________'}</strong></p>
  </div>
  
  <div style="display: flex; justify-content: space-between; margin-top: 80px;">
    <div style="text-align: center;">
      <p><strong>Signature de l'Employeur</strong></p>
      <p style="margin-top: 60px; border-top: 1px solid #000; padding-top: 10px;">(Signature et cachet)</p>
    </div>
    <div style="text-align: center;">
      <p><strong>Signature du Salarié</strong></p>
      <p style="margin-top: 60px; border-top: 1px solid #000; padding-top: 10px;">(Signature)</p>
    </div>
  </div>
</div>
    `
  },

  LETTRE_DEMISSION: {
    name: "Lettre de démission",
    type: "letter",
    fields: [
      { key: "salarie_nom", question: "Quel est votre nom complet ?", required: true },
      { key: "salarie_adresse", question: "Quelle est votre adresse complète ?", required: true },
      { key: "employeur_nom", question: "Quel est le nom de l'employeur/entreprise ?", required: true },
      { key: "employeur_adresse", question: "Quelle est l'adresse de l'employeur ?", required: true },
      { key: "poste", question: "Quel est votre poste actuel ?", required: true },
      { key: "date_demission", question: "Quelle est la date de prise d'effet de la démission (JJ/MM/AAAA) ?", required: true },
      { key: "lieu_signature", question: "Quel est le lieu de signature ?", required: true },
      { key: "date_signature", question: "Quelle est la date de signature (JJ/MM/AAAA) ?", required: false }
    ],
    template: (data) => `
<div style="font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; max-width: 800px; margin: 0 auto;">
  <div style="margin-bottom: 40px;">
    <p><strong>${data.salarie_nom}</strong></p>
    <p>${data.salarie_adresse}</p>
  </div>
  
  <div style="margin-bottom: 60px;">
    <p><strong>À l'attention de :</strong></p>
    <p><strong>${data.employeur_nom}</strong></p>
    <p>${data.employeur_adresse}</p>
  </div>
  
  <p style="margin-bottom: 40px;"><strong>Objet : Lettre de démission</strong></p>
  
  <p style="margin-bottom: 20px;">Madame, Monsieur,</p>
  
  <p style="margin-bottom: 20px;">Par la présente, je vous informe de ma décision de démissionner de mon poste de <strong>${data.poste}</strong> au sein de votre entreprise.</p>
  
  <p style="margin-bottom: 20px;">Conformément aux dispositions légales et contractuelles, ma démission prendra effet à compter du <strong>${data.date_demission}</strong>.</p>
  
  <p style="margin-bottom: 20px;">Je reste à votre disposition pour assurer la passation de mes responsabilités dans les meilleures conditions possibles.</p>
  
  <p style="margin-bottom: 40px;">Je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.</p>
  
  <div style="margin-top: 80px;">
    <p>Fait à <strong>${data.lieu_signature}</strong>, le <strong>${data.date_signature || '____________________'}</strong></p>
    <p style="margin-top: 60px;"><strong>Signature :</strong></p>
    <p style="margin-top: 40px; border-top: 1px solid #000; padding-top: 10px; max-width: 200px;">
      ${data.salarie_nom}
    </p>
  </div>
</div>
    `
  }
};

// Fonction helper pour identifier le type de document
export function identifyDocumentType(userMessage) {
  const message = userMessage.toLowerCase();
  
  if (/cdd|durée déterminée|contrat temporaire/i.test(message)) {
    return 'CDD';
  }
  
  if (/cdi|durée indéterminée|contrat permanent/i.test(message)) {
    return 'CDI';
  }
  
  if (/démission|démissionner|quitter mon poste/i.test(message)) {
    return 'LETTRE_DEMISSION';
  }
  
  return null;
}

// Fonction helper pour détecter une intention de génération
export function detectDocumentGeneration(userMessage) {
  const triggers = [
    /créer un (contrat|document|courrier|lettre)/i,
    /générer un (contrat|document|courrier|lettre)/i,
    /je veux un (contrat|document|courrier|lettre)/i,
    /rédiger un (contrat|document|courrier|lettre)/i,
    /préparer un (contrat|document|courrier|lettre)/i,
    /faire un (contrat|document|courrier|lettre)/i,
    /démissionner|lettre de démission/i
  ];
  
  return triggers.some(trigger => trigger.test(userMessage));
}
