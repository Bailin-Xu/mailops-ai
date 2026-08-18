export type WebsiteReviewSeedItem = {
  key: string;
  title: string;
  questionForOwner: string;
  evidence: Array<{
    sourceUrl: string;
    sourceTitle: string;
    sectionHeading: string;
    claim: string;
  }>;
};

export const websiteReviewSeedItems: WebsiteReviewSeedItem[] = [
  {
    key: "artist-commission-split",
    title: "Artist commission split",
    questionForOwner:
      "Quel est le partage de commission actuellement applicable entre l’artiste et L’Original ? Est-ce le même pour les œuvres originales, les commandes sur mesure et les murales ?",
    evidence: [
      {
        sourceUrl: "https://www.loriginal.org/fr/devenir-artiste",
        sourceTitle: "Devenir artiste en galerie d'art",
        sectionHeading: "Comment se passent les commissions ?",
        claim: "L’artiste reçoit 62 % de chaque vente et la galerie conserve 38 %.",
      },
      {
        sourceUrl: "https://www.loriginal.org/fr/legal/conditions-generales",
        sourceTitle: "Conditions Générales de Vente",
        sectionHeading: "Rémunération de l’artiste",
        claim:
          "L’artiste reçoit 55 % du prix final avant taxes pour les œuvres originales, commandes et fresques sur mesure.",
      },
    ],
  },
  {
    key: "original-artwork-returns",
    title: "Original artwork return policy",
    questionForOwner:
      "Quelle est la politique actuelle de retour pour une œuvre originale ? Précise le délai, l’état requis, les frais de retour et le traitement des œuvres endommagées.",
    evidence: [
      {
        sourceUrl: "https://www.loriginal.org/fr/faq/peinture-originale",
        sourceTitle: "FAQ — Peinture originale",
        sectionHeading: "Puis-je retourner un tableau original si je change d'avis ?",
        claim:
          "Les tableaux originaux ne sont ni repris ni échangés, sauf en cas de dommage pendant le transport.",
      },
      {
        sourceUrl: "https://www.loriginal.org/fr/legal/conditions-generales",
        sourceTitle: "Conditions Générales de Vente",
        sectionHeading: "Politique de retour",
        claim:
          "Les impressions et œuvres originales peuvent être retournées sous 14 jours si elles sont non ouvertes et dans leur emballage d’origine.",
      },
    ],
  },
  {
    key: "shipping-price-treatment",
    title: "Shipping price treatment",
    questionForOwner:
      "Comment les frais de livraison sont-ils calculés et affichés aujourd’hui ? Sont-ils inclus dans le prix publié ou ajoutés au paiement final, et qui les paie ?",
    evidence: [
      {
        sourceUrl: "https://www.loriginal.org/fr/devenir-artiste",
        sourceTitle: "Devenir artiste en galerie d'art",
        sectionHeading: "Pourquoi le prix publié n'est-il pas celui que j'ai indiqué ?",
        claim:
          "Le prix affiché inclut un coût moyen d’expédition ajouté afin de présenter un prix tout compris.",
      },
      {
        sourceUrl: "https://www.loriginal.org/fr/legal/conditions-generales",
        sourceTitle: "Conditions Générales de Vente",
        sectionHeading: "Affichage des prix",
        claim:
          "Les frais de livraison sont ajoutés au paiement final et sont à la charge du client.",
      },
    ],
  },
  {
    key: "mural-project-timeline",
    title: "Mural project timeline",
    questionForOwner:
      "Quel délai devons-nous annoncer pour une fresque murale : délai total du projet et durée d’exécution sur place ?",
    evidence: [
      {
        sourceUrl: "https://www.loriginal.org/fr/faq/fresques-murales",
        sourceTitle: "FAQ — Fresques murales",
        sectionHeading: "Quel est le délai de réalisation ?",
        claim: "La réalisation est annoncée entre 2 et 10 jours selon le projet.",
      },
      {
        sourceUrl: "https://www.loriginal.org/fr/legal/conditions-generales",
        sourceTitle: "Conditions Générales de Vente",
        sectionHeading: "Délais moyens d’exécution",
        claim:
          "Les commandes d’œuvres et fresques sur mesure sont annoncées entre 2 et 6 semaines selon la complexité.",
      },
    ],
  },
  {
    key: "prints-and-digital-scope",
    title: "Prints and digital artwork scope",
    questionForOwner:
      "L’Original accepte-t-elle ou vend-elle actuellement des impressions et des œuvres numériques ? Distingue les œuvres qu’un artiste peut soumettre des produits que la galerie peut vendre.",
    evidence: [
      {
        sourceUrl: "https://www.loriginal.org/fr/devenir-artiste",
        sourceTitle: "Devenir artiste en galerie d'art",
        sectionHeading: "Puis-je vendre mes prints ou œuvres digitales ?",
        claim:
          "Seules les œuvres originales physiques sont acceptées ; impressions et œuvres digitales ne sont pas autorisées.",
      },
      {
        sourceUrl: "https://www.loriginal.org/support-page/faq/prints",
        sourceTitle: "FAQ — Impressions",
        sectionHeading: "Commande, livraison et retour",
        claim:
          "Une FAQ publique décrit la commande, la livraison et le retour d’impressions proposées par la plateforme.",
      },
    ],
  },
  {
    key: "artist-subscription-plans",
    title: "Artist subscription plans",
    questionForOwner:
      "Quels abonnements artistes sont actuellement offerts ? Confirme les prix, la facturation mensuelle ou annuelle, les taxes, les différences entre plans et les règles d’annulation.",
    evidence: [
      {
        sourceUrl: "https://www.loriginal.org/fr/devenir-artiste",
        sourceTitle: "Devenir artiste en galerie d'art",
        sectionHeading: "Quelle est la différence entre les deux abonnements ?",
        claim:
          "La page présente des plans à 8 $ et 22 $ par mois, le plan à 8 $ exigeant une page dédiée sur le site de l’artiste.",
      },
    ],
  },
  {
    key: "dynamic-public-metrics",
    title: "Dynamic public metrics",
    questionForOwner:
      "Quels chiffres pouvons-nous citer dans les courriels : nombre d’artistes, nombre de collectionneurs, taux d’acceptation et taux de vente ? Qui doit les maintenir à jour ?",
    evidence: [
      {
        sourceUrl: "https://www.loriginal.org/fr/devenir-artiste",
        sourceTitle: "Devenir artiste en galerie d'art",
        sectionHeading: "Promotional metrics",
        claim:
          "La page affiche plusieurs chiffres évolutifs sur les collectionneurs, les artistes, les candidatures et les ventes.",
      },
      {
        sourceUrl: "https://www.loriginal.org/fr/nos-galeries",
        sourceTitle: "Nos galeries à Montréal",
        sectionHeading: "Artist rosters",
        claim:
          "La page affiche des nombres d’artistes par galerie qui peuvent changer avec la programmation.",
      },
    ],
  },
];
