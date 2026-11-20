/// "Free" wording for printed documents (A4 pages follow the document's `?lang=`;
/// the thermal ticket only has ar/fr). Gift lines keep their price 0 and their
/// quantity — this tag just makes the gift obvious to the client.
export const FREE_LABEL = { ar: "مجاني", fr: "Gratuit", en: "Free" } as const;
export type FreeLang = keyof typeof FREE_LABEL;
