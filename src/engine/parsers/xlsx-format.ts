/**
 * A deliberately small Excel number-format engine. It covers what spreadsheets overwhelmingly use: General,
 * integers and decimals with thousands separators, percentages, scientific notation, currency/text affixes,
 * negative sections, and the common date/time tokens. Anything else (fractions, elapsed time, conditions,
 * locale-specific systems) falls back to General and is reported through `unsupported`.
 */

export interface Formatted {
  text: string;
  unsupported?: boolean;
}

const BUILTIN: Record<number, string> = {
  0: "General",
  1: "0",
  2: "0.00",
  3: "#,##0",
  4: "#,##0.00",
  9: "0%",
  10: "0.00%",
  11: "0.00E+00",
  12: "# ?/?",
  13: "# ??/??",
  14: "m/d/yyyy",
  15: "d-mmm-yy",
  16: "d-mmm",
  17: "mmm-yy",
  18: "h:mm AM/PM",
  19: "h:mm:ss AM/PM",
  20: "h:mm",
  21: "h:mm:ss",
  22: "m/d/yyyy h:mm",
  37: "#,##0 ;(#,##0)",
  38: "#,##0 ;[Red](#,##0)",
  39: "#,##0.00;(#,##0.00)",
  40: "#,##0.00;[Red](#,##0.00)",
  45: "mm:ss",
  46: "[h]:mm:ss",
  47: "mmss.0",
  48: "##0.0E+0",
  49: "@",
};

export function builtinFormat(id: number): string | undefined {
  return BUILTIN[id];
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

export function general(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a >= 1e11 || a < 1e-6)) {
    const [m, e] = n.toExponential(5).split("e");
    const exp = Number(e);
    return `${m!.replace(/\.?0+$/, "")}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return String(Number(n.toPrecision(15)));
}

/** Splits a format into sections on unquoted, unbracketed semicolons. */
function sections(code: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote = false;
  let bracket = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i]!;
    if (ch === "\\" && !quote) {
      cur += ch + (code[++i] ?? "");
      continue;
    }
    if (ch === '"') quote = !quote;
    else if (!quote && ch === "[") bracket = true;
    else if (!quote && ch === "]") bracket = false;
    if (ch === ";" && !quote && !bracket) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

interface Token {
  kind: "lit" | "y" | "m" | "d" | "h" | "s" | "ampm";
  text: string;
}

function tokenizeDate(fmt: string): Token[] | null {
  const tokens: Token[] = [];
  for (let i = 0; i < fmt.length; ) {
    const ch = fmt[i]!;
    const lower = ch.toLowerCase();
    if (ch === '"') {
      const end = fmt.indexOf('"', i + 1);
      tokens.push({ kind: "lit", text: fmt.slice(i + 1, end < 0 ? undefined : end) });
      i = end < 0 ? fmt.length : end + 1;
    } else if (ch === "\\") {
      tokens.push({ kind: "lit", text: fmt[i + 1] ?? "" });
      i += 2;
    } else if (ch === "_" || ch === "*") {
      if (ch === "_") tokens.push({ kind: "lit", text: " " });
      i += 2;
    } else if (ch === "[") {
      const end = fmt.indexOf("]", i);
      const inner = fmt.slice(i + 1, end < 0 ? undefined : end);
      if (/^(h+|m+|s+)$/i.test(inner)) return null; // elapsed time
      i = end < 0 ? fmt.length : end + 1;
    } else if (/^(am\/pm|a\/p)/i.test(fmt.slice(i))) {
      const m = /^(am\/pm|a\/p)/i.exec(fmt.slice(i))![0];
      tokens.push({ kind: "ampm", text: m });
      i += m.length;
    } else if ("ymdhs".includes(lower)) {
      let j = i;
      while (j < fmt.length && fmt[j]!.toLowerCase() === lower) j++;
      tokens.push({ kind: lower as Token["kind"], text: fmt.slice(i, j).toLowerCase() });
      i = j;
    } else {
      tokens.push({ kind: "lit", text: ch });
      i++;
    }
  }
  return tokens;
}

function isDateFormat(section: string): boolean {
  const stripped = section.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, "").replace(/_.|\*./g, "");
  return /[ymdhs]/i.test(stripped) && !/e[+-]/i.test(stripped) && !/^[#0?.,%\s$€£¥()+-]*$/.test(stripped);
}

function formatDate(serial: number, tokens: Token[], date1904: boolean): string {
  const days = Math.floor(serial);
  let secs = Math.round((serial - days) * 86400);
  let dayNum = days;
  if (secs >= 86400) {
    secs -= 86400;
    dayNum += 1;
  }
  // Excel counts a non-existent 29 Feb 1900; serial 60 and below sit one day off the proleptic calendar.
  const base = date1904 ? Date.UTC(1904, 0, 1) : serial < 61 ? Date.UTC(1899, 11, 31) : Date.UTC(1899, 11, 30);
  const d = new Date(base + dayNum * 86400000);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth();
  const da = d.getUTCDate();
  const dow = d.getUTCDay();
  const H = Math.floor(secs / 3600);
  const M = Math.floor((secs % 3600) / 60);
  const S = secs % 60;
  const hasAmPm = tokens.some((t) => t.kind === "ampm");
  const p2 = (n: number) => String(n).padStart(2, "0");
  let out = "";
  tokens.forEach((t, i) => {
    switch (t.kind) {
      case "lit":
        out += t.text;
        break;
      case "y":
        out += t.text.length <= 2 ? p2(y % 100) : String(y).padStart(4, "0");
        break;
      case "d":
        out += t.text.length === 1 ? String(da) : t.text.length === 2 ? p2(da) : t.text.length === 3 ? DAYS[dow]!.slice(0, 3) : DAYS[dow]!;
        break;
      case "h": {
        const h = hasAmPm ? H % 12 || 12 : H;
        out += t.text.length === 1 ? String(h) : p2(h);
        break;
      }
      case "s":
        out += t.text.length === 1 ? String(S) : p2(S);
        break;
      case "ampm":
        out += /^a\/p$/i.test(t.text) ? (H < 12 ? "A" : "P") : H < 12 ? "AM" : "PM";
        break;
      case "m": {
        // "m" means minutes right after hours or right before seconds, otherwise months.
        const prev = tokens.slice(0, i).reverse().find((x) => x.kind !== "lit");
        const next = tokens.slice(i + 1).find((x) => x.kind !== "lit");
        if (prev?.kind === "h" || next?.kind === "s") out += t.text.length === 1 ? String(M) : p2(M);
        else out += t.text.length === 1 ? String(mo + 1) : t.text.length === 2 ? p2(mo + 1) : t.text.length === 3 ? MONTHS[mo]!.slice(0, 3) : t.text.length === 4 ? MONTHS[mo]! : MONTHS[mo]![0]!;
        break;
      }
    }
  });
  return out;
}

function withCommas(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Formats a numeric value with a numeric (non-date) format section. */
function formatNumeric(value: number, section: string, negativeHandled: boolean): Formatted | null {
  if (/[?]\s*\/|\/\s*[?#0-9]/.test(section.replace(/"[^"]*"/g, ""))) return null; // fractions
  let code = section.replace(/\[[^\]]*\]/g, (m) => {
    const cur = /^\[\$([^\]\-]*)(?:-[^\]]*)?\]$/.exec(m);
    return cur ? `"${cur[1]}"` : "";
  });
  const percent = /%/.test(code.replace(/"[^"]*"/g, ""));
  let v = percent ? value * 100 : value;
  const sci = /0\.?0*E[+-]0+/i.exec(code.replace(/"[^"]*"/g, ""));
  // Locate the numeric placeholder run outside quotes.
  let out = "";
  let i = 0;
  let placed = false;
  const neg = v < 0 && !negativeHandled;
  if (neg) v = -v;
  const decimalsOf = (run: string) => {
    const dot = run.indexOf(".");
    return dot < 0 ? 0 : run.slice(dot + 1).replace(/[^0#?]/g, "").length;
  };
  while (i < code.length) {
    const ch = code[i]!;
    if (ch === '"') {
      const end = code.indexOf('"', i + 1);
      out += code.slice(i + 1, end < 0 ? undefined : end);
      i = end < 0 ? code.length : end + 1;
    } else if (ch === "\\") {
      out += code[i + 1] ?? "";
      i += 2;
    } else if (ch === "_") {
      out += " ";
      i += 2;
    } else if (ch === "*") {
      i += 2;
    } else if (/[0#?.,]/.test(ch) && !placed) {
      let j = i;
      while (j < code.length && /[0#?.,E+\-]/i.test(code[j]!)) {
        if (/[E+\-]/i.test(code[j]!) && !(sci && /E/i.test(code[j]!) || /[+-]/.test(code[j]!) && /E/i.test(code[j - 1] ?? ""))) break;
        j++;
        if (/[0]/.test(code[j - 1]!) && /E/i.test(code[j] ?? "")) continue;
      }
      let run = code.slice(i, j);
      const exp = /E[+-]0+$/i.exec(run);
      if (exp) run = run.slice(0, run.length - exp[0].length);
      const dec = decimalsOf(run);
      const thousands = /[0#?],[0#?]/.test(run.split(".")[0]!);
      const minInt = (run.split(".")[0]!.match(/0/g) ?? []).length;
      let text: string;
      if (exp) {
        text = v.toExponential(dec).replace(/e([+-])(\d)$/i, "E$10$2").replace(/e/i, "E");
      } else {
        // Commas after the last digit placeholder divide by 1,000 each; commas between placeholders are thousands separators.
        const intRun = run.split(".")[0]!;
        const trailingScale = /,+$/.exec(intRun);
        const scaled = trailingScale ? v / 1000 ** trailingScale[0].length : v;
        const fixed = scaled.toFixed(Math.min(dec, 15));
        let [ip, fp = ""] = fixed.split(".");
        ip = ip!.padStart(minInt, "0");
        if (minInt === 0 && ip === "0" && (fp || dec)) ip = "";
        if (thousands) ip = withCommas(ip);
        text = fp ? `${ip}.${fp}` : ip;
        if (dec && !fp) text = ip;
      }
      out += text;
      placed = true;
      i = j;
    } else {
      out += ch;
      i++;
    }
  }
  if (!placed) return null;
  return { text: (neg ? "-" : "") + out };
}

export function formatNumber(value: number, code: string | undefined, date1904: boolean): Formatted {
  if (!code || code === "General") return { text: general(value) };
  if (code === "@") return { text: general(value) };
  const secs = sections(code);
  let idx = 0;
  let negHandled = false;
  if (value < 0 && secs.length > 1) {
    idx = 1;
    negHandled = true;
  } else if (value === 0 && secs.length > 2) idx = 2;
  const section = secs[idx] ?? secs[0]!;
  if (/^\s*general\s*$/i.test(section.replace(/\[[^\]]*\]/g, ""))) return { text: general(negHandled ? Math.abs(value) : value) };
  if (/\[[<>=]/.test(section)) return { text: general(value), unsupported: true };
  if (isDateFormat(section)) {
    const tokens = tokenizeDate(section);
    if (!tokens || value < 0 || value > 2958465) return { text: general(value), unsupported: true };
    return { text: formatDate(value, tokens, date1904) };
  }
  const v = negHandled ? Math.abs(value) : value;
  // A section with no digit placeholder is plain text, e.g. the "zero" in 0.00;-0.00;"zero".
  if (!/[0#?]/.test(section.replace(/"[^"]*"/g, "").replace(/\\./g, "").replace(/\[[^\]]*\]/g, ""))) {
    return { text: section.replace(/"([^"]*)"/g, "$1").replace(/\\(.)/g, "$1").replace(/_./g, " ").replace(/\*./g, "") };
  }
  const n = formatNumeric(v, section, negHandled);
  if (!n) return { text: general(value), unsupported: true };
  return negHandled && !/[(\-]/.test(section.replace(/"[^"]*"/g, "")) ? { text: `-${n.text}` } : n;
}
