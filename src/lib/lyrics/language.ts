/**
 * The language a lyric line is written in, from its function words (Latin
 * scripts) or its script. Whisper picks one language per 30 s window; this
 * tells which lines of a window are in another one (an English hook in a
 * German song), so they can be labelled and their neighbours double-checked.
 * It answers only when the evidence is clear, otherwise null.
 */

// Frequent words per language; words that occur in more than one list are ignored.
const WORDS: Record<string, string> = {
  en: `the and you your you're i'm i've i'll i'd it it's that that's don't can't won't ain't let's we're they're there's
    what's my we they with for from this what when where all just never ever every through into about been have has are
    were would could should gonna wanna gotta our their them these those if but not of to be do how who why only can
    she he her his him at up down out know feel want need like love heart time tonight night there because`,
  de: `und ich nicht ist ein eine einen einem einer der das den dem wir ihr sie er mit auf für von zu im ins aus bei
    nach über unter durch bis wie mein meine meinen dein deine deinen dich mich mir dir uns euch sich kein keine nur
    noch schon auch immer nie wenn dann weil dass oder aber doch jetzt heute nichts wieder mehr bin bist sind hab habe
    hat haben kann wird werden gibt geht komm herz liebe zeit gehen zum zur vom ganz viel als`,
  es: `el los las yo estoy eres soy pero cuando donde muy más sí aquí ahora siempre conmigo hay ya eso ella él
    nosotros tú mí quiero corazón nadie tengo puedo al del y está esta este`,
  fr: `les des du et est je il elle nous vous ils ne pas dans sur avec pour mon mes ton ta tes sa ses ce cette c'est
    j'ai suis mais plus tout tous rien toujours jamais moi toi leur au aux où oui très bien cœur coeur veux fait être
    avoir non y qui ma lui`,
  it: `il gli i è di da tra che chi non ci io lui lei noi voi loro mio tuo sono sei siamo ho hai questo questa quello
    quella dove perché anche sempre mai più tutto tutti niente amore cuore della dei delle del al nel nella sul alla
    ancora adesso qui ma sua`,
  pt: `os é da das em nas não eu você ele ela nós vocês eles elas meu minha teu seu sua tudo muito coração estou sou
    são isso aqui agora já também só então sempre está esta este`,
  nl: `het een ik je jij hij zij ze we wij jullie niet zijn met op aan voor van uit naar bij om dat wat wie waar hoe
    maar ook nog dan als mijn jouw jou mij ons onze hebben heb heeft moet zal gaan gaat ga nooit altijd niets nu daar
    liefde`,
};

const LEXICON = (() => {
  const seen = new Map<string, string | null>();
  for (const [language, words] of Object.entries(WORDS)) {
    for (const word of words.split(/\s+/).filter(Boolean)) {
      const previous = seen.get(word);
      seen.set(word, previous === undefined || previous === language ? language : null);
    }
  }
  return seen;
})();

/** Scripts that name a language (checked when most letters are not Latin). */
const SCRIPTS: [RegExp, string][] = [
  [/\p{Script=Hangul}/u, "ko"],
  [/[\p{Script=Hiragana}\p{Script=Katakana}]/u, "ja"],
  [/\p{Script=Han}/u, "zh"],
  [/[іїєґ]/iu, "uk"],
  [/\p{Script=Cyrillic}/u, "ru"],
  [/\p{Script=Greek}/u, "el"],
  [/\p{Script=Arabic}/u, "ar"],
  [/\p{Script=Hebrew}/u, "he"],
  [/\p{Script=Devanagari}/u, "hi"],
  [/\p{Script=Thai}/u, "th"],
];

export function textLanguage(text: string): string | null {
  const letters = text.match(/\p{L}/gu) ?? [];
  if (letters.length === 0) return null;
  const latin = letters.filter((c) => /\p{Script=Latin}/u.test(c)).length;
  if (latin < letters.length / 2) {
    for (const [script, language] of SCRIPTS) if (script.test(text)) return language;
    return null;
  }
  const words = text.replace(/[’`]/g, "'").match(/[\p{L}']+/gu) ?? [];
  const hits = new Map<string, number>();
  for (const word of words) {
    // "I" is English; lower-case "i" is an Italian article
    const language = word === "I" || word.startsWith("I'") ? "en" : LEXICON.get(word.toLowerCase().replace(/^'+|'+$/g, ""));
    if (language) hits.set(language, (hits.get(language) ?? 0) + 1);
  }
  const ranked = [...hits].sort((a, b) => b[1] - a[1]);
  if (ranked.length === 0) return null;
  const [best, count] = ranked[0];
  const runnerUp = ranked[1]?.[1] ?? 0;
  return count >= 2 && count >= 0.25 * words.length && count >= 2 * runnerUp ? best : null;
}
