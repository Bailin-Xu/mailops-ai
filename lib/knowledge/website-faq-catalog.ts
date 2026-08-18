export type WebsiteFaqCatalogItem = {
  key: string;
  title: string;
  canonicalQuestion: string;
  proposedAnswer: string;
  category: string;
  language: "fr";
  sourceUrl: string;
  sourceTitle: string;
  sectionHeading: string;
};

const artistPage = "https://www.loriginal.org/fr/devenir-artiste";
const galleryPage = "https://www.loriginal.org/fr/nos-galeries";
const muralPage = "https://www.loriginal.org/fr/faq/fresques-murales";

/**
 * Human-curated, stable FAQ claims from the public French website.
 * Deliberately excludes the seven policy-conflict topics in
 * website-review-seed-data.ts and volatile promotional metrics.
 */
export const websiteFaqCatalog: WebsiteFaqCatalogItem[] = [
  {
    key: "artist-sale-guarantee",
    title: "Garantie de vente pour un artiste",
    canonicalQuestion: "L’Original garantit-elle qu’un artiste vendra ses œuvres ?",
    proposedAnswer:
      "Non. Une présence sur la plateforme ne garantit pas une vente. Les résultats dépendent notamment de la qualité des œuvres, de la cohérence de la démarche et de l’intérêt des collectionneurs.",
    category: "ARTIST_APPLICATION",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Est-ce garanti que je vais vendre ?",
  },
  {
    key: "artist-partnership-includes",
    title: "Services inclus dans le partenariat artiste",
    canonicalQuestion: "Que comprend le partenariat avec L’Original ?",
    proposedAnswer:
      "Le partenariat comprend une présence dans la galerie en ligne, un compte personnel pour gérer les œuvres et une diffusion sur Artsy.",
    category: "ARTIST_APPLICATION",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Que comprend le partenariat ?",
  },
  {
    key: "artist-physical-gallery-access",
    title: "Accès aux galeries physiques",
    canonicalQuestion: "Toutes les œuvres d’un artiste sont-elles exposées dans une galerie physique ?",
    proposedAnswer:
      "Non. La présence commence principalement en ligne et sur les écrans des galeries. Une exposition physique peut ensuite être proposée selon le parcours de l’artiste et les résultats observés.",
    category: "ARTIST_APPLICATION",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Est-ce que mes œuvres seront exposées en galerie physique ?",
  },
  {
    key: "artist-minimum-price",
    title: "Prix minimal recommandé pour une œuvre",
    canonicalQuestion: "Existe-t-il un prix minimal pour publier une œuvre ?",
    proposedAnswer:
      "La page artiste indique un minimum de 1 $ par pouce carré. Au-dessus de ce seuil, l’artiste reste libre de fixer son prix.",
    category: "ARTIST_PRICING",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Comment fixer le prix de mes œuvres ?",
  },
  {
    key: "artist-muralist-registration",
    title: "Inscription comme muraliste",
    canonicalQuestion: "Comment s’inscrire comme muraliste ?",
    proposedAnswer:
      "Il faut d’abord créer un compte artiste. L’inscription comme muraliste peut ensuite être complétée depuis le compte.",
    category: "ARTIST_APPLICATION",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Comment devenir muraliste ?",
  },
  {
    key: "artist-meeting-required",
    title: "Rencontre avant l’inscription artiste",
    canonicalQuestion: "Une rencontre en personne est-elle obligatoire avant de s’inscrire ?",
    proposedAnswer:
      "Non. Les démarches peuvent être effectuées en ligne. Il reste possible de communiquer avec l’équipe ou de visiter une galerie si une discussion est souhaitée.",
    category: "ARTIST_APPLICATION",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Dois-je vous rencontrer avant de m’inscrire ?",
  },
  {
    key: "artist-selection-criteria",
    title: "Critères de sélection des artistes",
    canonicalQuestion: "Quels éléments sont examinés lors d’une candidature d’artiste ?",
    proposedAnswer:
      "L’équipe examine notamment la qualité et l’éclairage des photos, la cohérence de l’univers artistique et la cohérence des prix avec le minimum publié.",
    category: "ARTIST_APPLICATION",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Quels sont les critères de sélection ?",
  },
  {
    key: "artist-chooses-listed-works",
    title: "Choix des œuvres publiées",
    canonicalQuestion: "Qui choisit les œuvres publiées sur le profil d’un artiste ?",
    proposedAnswer:
      "L’artiste choisit les œuvres qu’il souhaite proposer sur son profil, sous réserve des règles de publication de la plateforme.",
    category: "ARTIST_CATALOG",
    language: "fr",
    sourceUrl: artistPage,
    sourceTitle: "Devenir artiste en galerie d'art",
    sectionHeading: "Qui choisit les œuvres en ligne ?",
  },
  {
    key: "gallery-hours-addresses",
    title: "Horaires et adresses des galeries",
    canonicalQuestion: "Quand et où peut-on visiter les galeries L’Original à Montréal ?",
    proposedAnswer:
      "Les galeries sont ouvertes tous les jours de 11 h à 18 h. Les adresses publiées sont le 4455, rue Saint-Denis et le 163, rue Saint-Paul Ouest à Montréal.",
    category: "GALLERY_VISIT",
    language: "fr",
    sourceUrl: galleryPage,
    sourceTitle: "Nos galeries à Montréal",
    sectionHeading: "Horaires et adresses",
  },
  {
    key: "gallery-free-entry",
    title: "Entrée gratuite aux galeries",
    canonicalQuestion: "L’entrée aux galeries est-elle gratuite ?",
    proposedAnswer: "Oui. L’entrée aux deux galeries est gratuite.",
    category: "GALLERY_VISIT",
    language: "fr",
    sourceUrl: galleryPage,
    sourceTitle: "Nos galeries à Montréal",
    sectionHeading: "Faut-il payer pour entrer ?",
  },
  {
    key: "gallery-appointment",
    title: "Rendez-vous pour visiter une galerie",
    canonicalQuestion: "Faut-il prendre rendez-vous pour visiter une galerie ?",
    proposedAnswer:
      "Non. Aucun rendez-vous n’est requis pour une visite libre. Un rendez-vous peut être utile pour un accompagnement personnalisé ou un projet de murale.",
    category: "GALLERY_VISIT",
    language: "fr",
    sourceUrl: galleryPage,
    sourceTitle: "Nos galeries à Montréal",
    sectionHeading: "Faut-il réserver ?",
  },
  {
    key: "gallery-browse-only",
    title: "Visite sans achat",
    canonicalQuestion: "Peut-on visiter une galerie sans acheter ?",
    proposedAnswer:
      "Oui. Les visiteurs peuvent découvrir les œuvres et les lieux sans obligation d’achat.",
    category: "GALLERY_VISIT",
    language: "fr",
    sourceUrl: galleryPage,
    sourceTitle: "Nos galeries à Montréal",
    sectionHeading: "Peut-on simplement regarder ?",
  },
  {
    key: "gallery-photography",
    title: "Photos et vidéos dans les galeries",
    canonicalQuestion: "Peut-on prendre des photos ou filmer dans les galeries ?",
    proposedAnswer:
      "Les photos sont permises. Pour filmer de près dans un atelier d’artiste, il est préférable de demander l’autorisation avant de commencer.",
    category: "GALLERY_VISIT",
    language: "fr",
    sourceUrl: galleryPage,
    sourceTitle: "Nos galeries à Montréal",
    sectionHeading: "Peut-on prendre des photos ?",
  },
  {
    key: "gallery-accessibility",
    title: "Accessibilité des galeries",
    canonicalQuestion: "Les galeries sont-elles accessibles aux personnes à mobilité réduite ?",
    proposedAnswer:
      "La galerie de la rue Saint-Denis est accessible au rez-de-chaussée, mais ses ateliers sont à l’étage. Pour le Vieux-Montréal, il est recommandé de contacter l’équipe afin de confirmer les conditions exactes avant la visite.",
    category: "GALLERY_VISIT",
    language: "fr",
    sourceUrl: galleryPage,
    sourceTitle: "Nos galeries à Montréal",
    sectionHeading: "Accessibilité",
  },
  {
    key: "gallery-children",
    title: "Visites avec des enfants",
    canonicalQuestion: "Les enfants sont-ils les bienvenus dans les galeries ?",
    proposedAnswer: "Oui. Les enfants sont les bienvenus dans les galeries.",
    category: "GALLERY_VISIT",
    language: "fr",
    sourceUrl: galleryPage,
    sourceTitle: "Nos galeries à Montréal",
    sectionHeading: "Les enfants sont-ils les bienvenus ?",
  },
  {
    key: "mural-definition",
    title: "Définition d’une murale sur mesure",
    canonicalQuestion: "Qu’est-ce qu’une murale personnalisée ?",
    proposedAnswer:
      "Une murale personnalisée est une œuvre peinte à la main directement sur une surface intérieure ou extérieure, conçue pour le lieu et les objectifs du client.",
    category: "MURAL_PROJECT",
    language: "fr",
    sourceUrl: muralPage,
    sourceTitle: "FAQ — Fresques murales",
    sectionHeading: "Qu’est-ce qu’une fresque murale sur mesure ?",
  },
  {
    key: "mural-surfaces",
    title: "Surfaces compatibles avec une murale",
    canonicalQuestion: "Sur quelles surfaces une murale peut-elle être peinte ?",
    proposedAnswer:
      "Une murale peut être réalisée sur plusieurs surfaces, notamment le béton, la brique, le plâtre, le bois, le métal ou la tuile, à l’intérieur comme à l’extérieur, après validation de l’état du support.",
    category: "MURAL_PROJECT",
    language: "fr",
    sourceUrl: muralPage,
    sourceTitle: "FAQ — Fresques murales",
    sectionHeading: "Sur quelles surfaces peut-on peindre ?",
  },
  {
    key: "mural-preview",
    title: "Aperçu avant réalisation d’une murale",
    canonicalQuestion: "Le client peut-il voir le concept avant la réalisation d’une murale ?",
    proposedAnswer:
      "Oui. Un aperçu du concept est présenté avant la réalisation afin que le client puisse valider la direction visuelle du projet.",
    category: "MURAL_PROJECT",
    language: "fr",
    sourceUrl: muralPage,
    sourceTitle: "FAQ — Fresques murales",
    sectionHeading: "Puis-je voir un aperçu avant la réalisation ?",
  },
  {
    key: "mural-wall-preparation",
    title: "Préparation du mur",
    canonicalQuestion: "Comment préparer un mur avant la réalisation d’une murale ?",
    proposedAnswer:
      "La surface doit idéalement être propre et sèche. L’équipe doit être informée à l’avance de toute fissure, humidité, peinture qui s’écaille ou autre condition particulière.",
    category: "MURAL_PROJECT",
    language: "fr",
    sourceUrl: muralPage,
    sourceTitle: "FAQ — Fresques murales",
    sectionHeading: "Dois-je préparer le mur ?",
  },
  {
    key: "mural-outdoor",
    title: "Murales extérieures",
    canonicalQuestion: "Peut-on réaliser une murale à l’extérieur ?",
    proposedAnswer:
      "Oui. Des murales extérieures peuvent être réalisées avec des produits adaptés aux conditions extérieures, après évaluation du mur et du projet.",
    category: "MURAL_PROJECT",
    language: "fr",
    sourceUrl: muralPage,
    sourceTitle: "FAQ — Fresques murales",
    sectionHeading: "Réalisez-vous des fresques extérieures ?",
  },
];
