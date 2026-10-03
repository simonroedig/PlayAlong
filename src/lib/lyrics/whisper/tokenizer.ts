/**
 * Whisper's byte-level BPE vocabulary, for decoding only: token id → bytes
 * (from the model's tokens.txt: "<base64 bytes> <id>" per line).
 */

/** Python's string.punctuation (whisper tests `word.strip() in string.punctuation`, a substring test). */
const PUNCTUATION = "!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~";
/** Languages written without spaces between words (split at characters instead). */
const NO_SPACE_LANGUAGES = new Set(["zh", "ja", "th", "lo", "my", "yue"]);

function base64ToBytes(b64: string): Uint8Array {
  let bin: string;
  try {
    bin = atob(b64);
  } catch {
    return new Uint8Array(0); // one token has no bytes and is listed as "="
  }
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export class WhisperTokenizer {
  private readonly bytes: Uint8Array[];
  private readonly decoder = new TextDecoder("utf-8", { fatal: false });
  /** First special token id (end of text); everything at or above is not text. */
  readonly eot: number;

  constructor(tokensTxt: string, eot: number) {
    this.eot = eot;
    this.bytes = [];
    for (const line of tokensTxt.split("\n")) {
      const space = line.lastIndexOf(" ");
      if (space <= 0) continue;
      const id = Number(line.slice(space + 1));
      this.bytes[id] = base64ToBytes(line.slice(0, space));
    }
  }

  private concat(tokens: readonly number[]): Uint8Array {
    let length = 0;
    for (const t of tokens) if (t < this.eot) length += this.bytes[t]?.length ?? 0;
    const out = new Uint8Array(length);
    let offset = 0;
    for (const t of tokens) {
      if (t >= this.eot) continue;
      const b = this.bytes[t];
      if (!b) continue;
      out.set(b, offset);
      offset += b.length;
    }
    return out;
  }

  /** Text of the given tokens (special tokens are skipped). */
  decode(tokens: readonly number[]): string {
    return this.decoder.decode(this.concat(tokens));
  }

  /**
   * Groups tokens into words like whisper's split_to_word_tokens: subwords
   * that decode to whole characters, joined unless they start with a space
   * or are punctuation. Special tokens become their own (empty) words.
   */
  splitToWordTokens(tokens: readonly number[], language: string): { words: string[]; tokens: number[][] } {
    // Split where the accumulated bytes form complete UTF-8 characters.
    const subwords: string[] = [];
    const subTokens: number[][] = [];
    let current: number[] = [];
    for (const t of tokens) {
      current.push(t);
      if (t >= this.eot) {
        if (current.length > 1) {
          const text = current.slice(0, -1);
          subwords.push(this.decode(text));
          subTokens.push(text);
        }
        subwords.push("");
        subTokens.push([t]);
        current = [];
        continue;
      }
      const text = this.decode(current);
      if (!text.includes("�")) {
        subwords.push(text);
        subTokens.push(current);
        current = [];
      }
    }
    if (current.length) {
      subwords.push(this.decode(current));
      subTokens.push(current);
    }
    if (NO_SPACE_LANGUAGES.has(language)) return { words: subwords, tokens: subTokens };

    const words: string[] = [];
    const wordTokens: number[][] = [];
    subwords.forEach((subword, i) => {
      const special = subTokens[i][0] >= this.eot;
      const withSpace = subword.startsWith(" ");
      const punctuation = PUNCTUATION.includes(subword.trim());
      if (special || withSpace || punctuation || words.length === 0) {
        words.push(subword);
        wordTokens.push([...subTokens[i]]);
      } else {
        words[words.length - 1] += subword;
        wordTokens[wordTokens.length - 1].push(...subTokens[i]);
      }
    });
    return { words, tokens: wordTokens };
  }
}
