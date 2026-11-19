/// Amount in words for printed documents (Algerian dinar): fr / ar / en.
export type DocLang = "fr" | "ar" | "en";

/* ───────────────────────── French ───────────────────────── */
const FR_U = ["zéro", "un", "deux", "trois", "quatre", "cinq", "six", "sept", "huit", "neuf", "dix", "onze", "douze", "treize", "quatorze", "quinze", "seize", "dix-sept", "dix-huit", "dix-neuf"];
const FR_T = ["", "", "vingt", "trente", "quarante", "cinquante", "soixante"];

function fr99(n: number): string {
  if (n < 20) return FR_U[n];
  if (n < 70) {
    const t = Math.floor(n / 10), u = n % 10;
    return FR_T[t] + (u === 1 ? " et un" : u ? "-" + FR_U[u] : "");
  }
  if (n < 80) return "soixante" + (n === 71 ? " et onze" : "-" + FR_U[n - 60]);
  if (n === 80) return "quatre-vingts";
  return "quatre-vingt-" + FR_U[n - 80];
}
function fr999(n: number, last: boolean): string {
  const c = Math.floor(n / 100), r = n % 100;
  let s = "";
  if (c) s = (c === 1 ? "cent" : FR_U[c] + " cent") + (c > 1 && r === 0 && last ? "s" : "");
  if (r) s += (s ? " " : "") + (r === 80 && !last ? "quatre-vingt" : fr99(r));
  return s;
}
function frInt(n: number): string {
  if (n === 0) return "zéro";
  const parts: string[] = [];
  const bil = Math.floor(n / 1e9), mil = Math.floor((n % 1e9) / 1e6), th = Math.floor((n % 1e6) / 1e3), r = n % 1e3;
  if (bil) parts.push(fr999(bil, false) + " milliard" + (bil > 1 ? "s" : ""));
  if (mil) parts.push(fr999(mil, false) + " million" + (mil > 1 ? "s" : ""));
  if (th) parts.push(th === 1 ? "mille" : fr999(th, false) + " mille");
  if (r) parts.push(fr999(r, true));
  return parts.join(" ");
}

/* ───────────────────────── English ───────────────────────── */
const EN_U = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const EN_T = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
function en999(n: number): string {
  const c = Math.floor(n / 100), r = n % 100;
  let s = c ? EN_U[c] + " hundred" : "";
  if (r) s += (s ? " and " : "") + (r < 20 ? EN_U[r] : EN_T[Math.floor(r / 10)] + (r % 10 ? "-" + EN_U[r % 10] : ""));
  return s;
}
function enInt(n: number): string {
  if (n === 0) return "zero";
  const parts: string[] = [];
  const bil = Math.floor(n / 1e9), mil = Math.floor((n % 1e9) / 1e6), th = Math.floor((n % 1e6) / 1e3), r = n % 1e3;
  if (bil) parts.push(en999(bil) + " billion");
  if (mil) parts.push(en999(mil) + " million");
  if (th) parts.push(en999(th) + " thousand");
  if (r) parts.push(en999(r));
  return parts.join(" ");
}

/* ───────────────────────── Arabic ───────────────────────── */
const AR_U = ["صفر", "واحد", "اثنان", "ثلاثة", "أربعة", "خمسة", "ستة", "سبعة", "ثمانية", "تسعة", "عشرة", "أحد عشر", "اثنا عشر", "ثلاثة عشر", "أربعة عشر", "خمسة عشر", "ستة عشر", "سبعة عشر", "ثمانية عشر", "تسعة عشر"];
const AR_T = ["", "", "عشرون", "ثلاثون", "أربعون", "خمسون", "ستون", "سبعون", "ثمانون", "تسعون"];
const AR_H = ["", "مئة", "مئتان", "ثلاثمئة", "أربعمئة", "خمسمئة", "ستمئة", "سبعمئة", "ثمانمئة", "تسعمئة"];
function ar99(n: number): string {
  if (n < 20) return AR_U[n];
  const t = Math.floor(n / 10), u = n % 10;
  return u ? `${AR_U[u]} و${AR_T[t]}` : AR_T[t];
}
function ar999(n: number): string {
  const c = Math.floor(n / 100), r = n % 100;
  const parts: string[] = [];
  if (c) parts.push(AR_H[c]);
  if (r) parts.push(ar99(r));
  return parts.join(" و");
}
function arScale(n: number, one: string, two: string, few: string, many: string): string {
  if (n === 1) return one;
  if (n === 2) return two;
  if (n <= 10) return `${ar999(n)} ${few}`;
  return `${ar999(n)} ${many}`;
}
function arInt(n: number): string {
  if (n === 0) return "صفر";
  const parts: string[] = [];
  const bil = Math.floor(n / 1e9), mil = Math.floor((n % 1e9) / 1e6), th = Math.floor((n % 1e6) / 1e3), r = n % 1e3;
  if (bil) parts.push(arScale(bil, "مليار", "ملياران", "مليارات", "مليار"));
  if (mil) parts.push(arScale(mil, "مليون", "مليونان", "ملايين", "مليوناً"));
  if (th) parts.push(arScale(th, "ألف", "ألفان", "آلاف", "ألف"));
  if (r) parts.push(ar999(r));
  return parts.join(" و");
}

export function amountInWords(value: number, lang: DocLang): string {
  const v = Math.max(0, Math.round(value * 100) / 100);
  const dinars = Math.floor(v);
  const cents = Math.round((v - dinars) * 100);
  if (lang === "ar") {
    const d = `${arInt(dinars)} دينار جزائري`;
    return cents ? `${d} و${arInt(cents)} سنتيماً` : d;
  }
  if (lang === "en") {
    const d = `${enInt(dinars)} algerian dinar${dinars === 1 ? "" : "s"}`;
    return cents ? `${d} and ${enInt(cents)} centime${cents === 1 ? "" : "s"}` : d;
  }
  const de = dinars >= 1e6 && dinars % 1e6 === 0 ? " de" : "";
  const d = `${frInt(dinars)}${de} dinar${dinars > 1 ? "s" : ""} algérien${dinars > 1 ? "s" : ""}`;
  return cents ? `${d} et ${frInt(cents)} centime${cents > 1 ? "s" : ""}` : d;
}
