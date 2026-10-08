const fractions: Record<string, string> = { "⅛": "1/8", "¼": "1/4", "⅜": "3/8", "½": "1/2", "⅝": "5/8", "¾": "3/4", "⅞": "7/8" };
const invalid = () => new Error('Enter feet (10), inches (120"), or feet and inches (10\' 0").');

export function parseLengthInput(input: string): number {
  const text = input.trim().replace(/[′’‘]/g, "'").replace(/[″“”]/g, '"').replace(/[⅛¼⅜½⅝¾⅞]/g, f => ` ${fractions[f]}`).trim();
  const number = (part: string) => {
    const value = part.trim();
    if (/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value)) return Number(value);
    const match = value.match(/^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)$/);
    if (!match || Number(match[3]) === 0) throw invalid();
    return Number(match[1] ?? 0) + Number(match[2]) / Number(match[3]);
  };
  const feet = text.indexOf("'");
  let inches: number;
  if (feet >= 0) {
    const remainder = text.slice(feet + 1).trim().replace(/^-\s*/, "");
    inches = number(text.slice(0, feet)) * 12 + (remainder ? number(remainder.replace(/"$/, "")) : 0);
  } else inches = number(text.replace(/"$/, "")) * (text.endsWith('"') ? 1 : 12);
  if (!Number.isFinite(inches) || inches <= 0) throw invalid();
  return inches;
}
