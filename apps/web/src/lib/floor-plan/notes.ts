import type { TextNote } from "./model";

// SVG does not wrap text. Use the same fixed-width layout for the drawing,
// selection bounds and print fitting so long notes cannot get cut off.
export function noteLayout(note: TextNote) {
  const padding = 8, lineHeight = note.fontSize * 1.4;
  const capacity = Math.max(1, Math.floor((note.width - padding * 2) / (note.fontSize * 0.65)));
  const lines: string[] = [];
  for (const paragraph of note.text.replace(/\r\n?/g, "\n").replace(/\t/g, "    ").split("\n")) {
    let chars = Array.from(paragraph);
    while (chars.length > capacity) {
      const space = chars.slice(0, capacity + 1).lastIndexOf(" ");
      const split = space > 0 ? space : capacity;
      lines.push(chars.slice(0, split).join("").trimEnd());
      chars = chars.slice(split);
      while (chars[0] === " ") chars.shift();
    }
    lines.push(chars.join(""));
  }
  return { lines, padding, lineHeight, height: padding * 2 + lines.length * lineHeight };
}

export function noteCorners(note: TextNote) {
  const { height } = noteLayout(note);
  return [{ x: note.x, y: note.y }, { x: note.x + note.width, y: note.y + height }];
}
