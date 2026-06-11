# SAH Helper — Elite UI/UX Design Specification
### Top .00001% Tier — Motion-First, Precision-Crafted

---

## Philosophy

This app handles serious work — VA paperwork that affects veterans' housing. The design reflects that gravity: **zero decoration, maximum clarity, motion as language not ornament**. Every pixel earns its place. Every animation communicates state, not style. The feeling is a Bloomberg Terminal crossed with Linear crossed with a premium fintech tool — dark, precise, fast, and trustworthy.

---

## 1. Design Tokens

### 1.1 Color System

The current palette is generic. Replace it with a system built around **VA-grade trust + technical precision**.

```css
/* globals.css — new token layer on top of Tailwind v4 */
@layer base {
  :root {
    /* Neutrals — warm-tinted zinc, not cold gray */
    --surface-base: 18 18 20;           /* near-black background */
    --surface-raised: 24 24 27;         /* cards */
    --surface-overlay: 30 30 35;        /* modals, popovers */
    --surface-sunken: 12 12 14;         /* inputs, code blocks */

    /* Primary — electric indigo: authority + intelligence */
    --accent: 99 102 241;               /* indigo-500 */
    --accent-glow: 79 70 229;           /* indigo-600 for shadows */
    --accent-subtle: 99 102 241 / 0.12; /* tinted backgrounds */

    /* Semantic status — rich, distinguishable */
    --status-unsigned: 251 191 36;      /* amber-400 — pending action */
    --status-signed:   99  102 241;     /* indigo-500 — in progress */
    --status-complete: 52  211 153;     /* emerald-400 — done */

    /* Borders — barely visible by default, vivid on interaction */
    --border-default: 255 255 255 / 0.07;
    --border-hover:   255 255 255 / 0.14;
    --border-active:  99 102 241 / 0.6;

    /* Text hierarchy */
    --text-primary:   255 255 255 / 0.93;
    --text-secondary: 255 255 255 / 0.54;
    --text-tertiary:  255 255 255 / 0.32;
    --text-disabled:  255 255 255 / 0.20;
  }
}
```

**Rule:** Every background has a matching glow variant. Every status color has a 12% opacity surface variant.

### 1.2 Typography

Replace Inter (generic) with a **dual-font system** for maximum legibility and personality:

```css
/* Layout font: Geist — Linear/Vercel's house font. Dense, technical, confident. */
/* Monospace: Geist Mono — for amounts, IDs, invoice numbers */
/* Fallback: system-ui */

--font-sans: 'Geist', 'Inter', system-ui;
--font-mono: 'Geist Mono', 'JetBrains Mono', monospace;

/* Type scale — optical, not mechanical */
--text-2xs:  10px;  /* labels, badges */
--text-xs:   11px;  /* metadata */
--text-sm:   13px;  /* body */
--text-base: 15px;  /* default */
--text-lg:   17px;  /* section headers */
--text-xl:   20px;  /* page titles */
--text-2xl:  26px;  /* hero moments */

/* Tracking overrides — tight headings, wide micro-labels */
--tracking-tight:   -0.025em;
--tracking-normal:   0em;
--tracking-widest:   0.12em;  /* ALL-CAPS labels */
```

**Rule:** All monetary values, dates, draw counts, and IDs use `font-mono tabular-nums`. Never let proportional fonts handle numbers that need to align.

### 1.3 Spacing & Radius

```css
/* Geometry: sharp where it matters, soft where it helps */
--radius-none:  0px;
--radius-sm:    3px;   /* badges, inline chips */
--radius-md:    6px;   /* cards, inputs */
--radius-lg:    10px;  /* modals */
--radius-pill:  999px; /* avatars */

/* Consistent 4pt grid. No 5, 7, 9, 11px values anywhere. */
```

**Rule:** Cards and modals use `radius-md`. Status badges use `radius-sm`. Nothing uses `radius-xl` (24px+) — that reads as consumer app, not professional tool.

---

## 2. Motion System

> Motion is the most undercapitalized design resource. Used correctly it eliminates confusion about what changed, where you are, and what the app is doing.

### 2.1 Motion Vocabulary

| Gesture | Spring Config | Purpose |
|---|---|---|
| **Enter** (mount) | `{ type:"spring", stiffness:380, damping:36 }` | Elements arriving from below (+10px y) |
| **Exit** (unmount) | `{ duration:0.18, ease:[0.4,0,1,1] }` | Elements leaving (scale 0.97, opacity 0) |
| **Layout shift** | `{ type:"spring", stiffness:500, damping:42 }` | Reordering, filter switches |
| **Emphasis** | `{ type:"spring", stiffness:600, damping:20 }` | Badge pop, success burst |
| **Gentle** | `{ duration:0.35, ease:"easeOut" }` | Color fades, opacity |

```typescript
// lib/motion.ts — centralize all variants so nothing is one-off
export const fadeUp = {
  hidden: { opacity: 0, y: 10 },
  visible: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 380, damping: 36 } },
  exit:    { opacity: 0, scale: 0.97, transition: { duration: 0.18 } },
};

export const stagger = (delay = 0.05) => ({
  visible: { transition: { staggerChildren: delay } },
});

export const popIn = {
  hidden:  { scale: 0.85, opacity: 0 },
  visible: { scale: 1, opacity: 1, transition: { type: "spring", stiffness: 600, damping: 20 } },
};

export const slideRight = {
  hidden:  { x: -12, opacity: 0 },
  visible: { x: 0,   opacity: 1, transition: { type: "spring", stiffness: 380, damping: 36 } },
};
```

### 2.2 Page Transitions

**Current:** Hard cuts between pages. Zero. Not acceptable.

**Target:** Coordinated page-level transitions using `AnimatePresence` in the root layout.

```tsx
// (app)/layout.tsx
<AnimatePresence mode="wait">
  <motion.main
    key={pathname}
    variants={fadeUp}
    initial="hidden"
    animate="visible"
    exit="exit"
  >
    {children}
  </motion.main>
</AnimatePresence>
```

The header and sidebar never animate — they're static anchors. Only the content area transitions.

### 2.3 Shared Element Transitions (FLIP)

When clicking a client card on the dashboard to enter the client detail page, the client's **name** and **status badge** should animate into their new positions on the detail page using Framer Motion's `layoutId`.

```tsx
// Client card row
<motion.span layoutId={`client-name-${client._id}`} className="font-semibold">
  {client.name}
</motion.span>

// Client detail page heading
<motion.h1 layoutId={`client-name-${client._id}`} className="text-2xl font-semibold">
  {client.name}
</motion.h1>
```

This creates a **magical morphing transition** — the name appears to fly from the list into the heading. No other app in the VA tooling space does this.

### 2.4 Micro-Interactions

**Button hover:** Subtle upward lift + glow pulse on the accent variant.
```css
.btn-primary {
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.btn-primary:hover {
  transform: translateY(-1px);
  box-shadow: 0 0 0 1px rgb(var(--accent) / 0.5),
              0 4px 16px -4px rgb(var(--accent-glow) / 0.6);
}
.btn-primary:active {
  transform: translateY(0px);
  transition-duration: 60ms;
}
```

**Input focus:** Border transitions from `--border-default` to `--border-active` with a faint inset glow, not just a color change.
```css
input:focus {
  border-color: rgb(var(--border-active));
  box-shadow: 0 0 0 3px rgb(var(--accent) / 0.10),
              inset 0 1px 2px rgb(0 0 0 / 0.3);
  outline: none;
}
```

**Status badge pulse:** The "Unsigned" badge gets a very subtle pulse ring to signal urgency — like an OS notification dot.
```tsx
// status-badge.tsx
{status === "unsigned" && (
  <motion.span
    className="absolute -inset-0.5 rounded-sm bg-amber-400/20"
    animate={{ opacity: [0.5, 0, 0.5] }}
    transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
  />
)}
```

---

## 3. Component Redesign

### 3.1 Header — Elevated Command Bar

**Current:** Basic logo + icons. Functional but flat.

**Target:** Sticky frosted glass bar with ambient depth.

```tsx
<header className="
  sticky top-0 z-50
  border-b border-[rgb(var(--border-default))]
  bg-[rgb(var(--surface-base)/0.85)]
  backdrop-blur-xl
  backdrop-saturate-150
">
  {/* Thin accent line along bottom — 1px, indigo gradient */}
  <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r
    from-transparent via-indigo-500/40 to-transparent pointer-events-none" />

  <div className="mx-auto flex h-13 w-full max-w-6xl items-center justify-between px-4">
    {/* Logo: animated on hover — the icon rotates 12deg with spring */}
    <Link href="/dashboard" className="group flex items-center gap-2.5">
      <motion.div
        whileHover={{ rotate: 12, scale: 1.08 }}
        transition={{ type: "spring", stiffness: 500, damping: 22 }}
        className="flex size-7 items-center justify-center
          rounded-sm bg-indigo-500 shadow-[0_0_12px_-2px_rgb(99_102_241/0.6)]"
      >
        <FileTextIcon className="size-4 text-white" />
      </motion.div>
      <span className="text-[13px] font-semibold tracking-[-0.01em] text-[rgb(var(--text-primary))]">
        SAH Helper
      </span>
    </Link>

    <nav className="hidden sm:flex items-center gap-1">
      {/* Nav pill tabs — active one has solid bg, rest are ghost */}
      {[
        { href: "/dashboard", label: "Clients" },
        { href: "/settings",  label: "Settings" },
      ].map(({ href, label }) => (
        <NavItem key={href} href={href} label={label} />
      ))}
    </nav>

    <div className="flex items-center gap-1.5">
      <ModeToggle />
      <UserMenu />
    </div>
  </div>
</header>
```

**NavItem:** Uses `layoutId="nav-active-pill"` so the active indicator **slides smoothly** between nav items. One of those tiny details that makes a UI feel like polished software.

### 3.2 Dashboard — Stat Row Above Client List

Add a compact **stat strip** between the heading and the filter/search row. Three stats: Total Clients, Total Value, Completion Rate.

```tsx
<div className="mb-6 grid grid-cols-3 gap-3 sm:gap-4">
  {[
    { label: "TOTAL CLIENTS", value: counts.all,                     mono: false },
    { label: "TOTAL VALUE",   value: formatCurrency(totalValue),      mono: true  },
    { label: "COMPLETED",     value: `${completionPct}%`,             mono: true  },
  ].map(({ label, value }) => (
    <motion.div
      key={label}
      variants={fadeUp}
      className="border border-[rgb(var(--border-default))]
        bg-[rgb(var(--surface-raised))]
        px-4 py-3
        rounded-[var(--radius-md)]"
    >
      <p className="text-[10px] font-medium tracking-[0.1em] uppercase
        text-[rgb(var(--text-tertiary))] mb-1">{label}</p>
      <p className="text-xl font-semibold font-mono tabular-nums
        text-[rgb(var(--text-primary))]">{value}</p>
    </motion.div>
  ))}
</div>
```

### 3.3 Client Card — Information Density Upgrade

**Current:** Two columns, basic. Single hover state.

**Target:** Three visual zones, contextual glow on hover keyed to status color.

```tsx
<Link href={`/clients/${client._id}`}
  className="group relative flex items-center gap-4
    border border-[rgb(var(--border-default))]
    bg-[rgb(var(--surface-raised))]
    px-4 py-3.5
    rounded-[var(--radius-md)]
    transition-all duration-200
    hover:border-[rgb(var(--border-hover))]
    hover:bg-[rgb(var(--surface-overlay))]
    hover:shadow-[0_8px_32px_-8px_rgb(0_0_0/0.4)]"
>
  {/* Left: Status indicator bar — 2px colored line on left edge */}
  <div className={`absolute left-0 top-3 bottom-3 w-0.5 rounded-full
    ${statusColor[client.status]}`} />

  {/* Avatar: initials in accent bg */}
  <div className="flex size-9 shrink-0 items-center justify-center
    rounded-[var(--radius-sm)]
    bg-[rgb(var(--accent-subtle))]
    text-[11px] font-semibold text-indigo-400
    font-mono tracking-tight">
    {initials(client.name)}
  </div>

  {/* Middle: Name + address */}
  <div className="min-w-0 flex-1">
    <div className="flex items-center gap-2 mb-0.5">
      <span className="text-[14px] font-semibold truncate
        text-[rgb(var(--text-primary))]">{client.name}</span>
      <StatusBadge status={client.status} />
    </div>
    <p className="text-xs truncate text-[rgb(var(--text-tertiary))]">
      {client.street}, {client.city}, {client.state} {client.zip}
    </p>
  </div>

  {/* Right: Amount + metadata */}
  <div className="hidden sm:flex shrink-0 items-center gap-5 text-right">
    <div>
      <p className="text-[14px] font-semibold font-mono tabular-nums
        text-[rgb(var(--text-primary))]">{formatCurrency(client.total)}</p>
      <p className="text-[11px] text-[rgb(var(--text-tertiary))]">
        {client.drawCount} draws
      </p>
    </div>
    <div>
      <p className="text-[11px] text-[rgb(var(--text-tertiary))]">Created</p>
      <p className="text-[11px] font-mono text-[rgb(var(--text-secondary))]">
        {formatDate(client.createdAt)}
      </p>
    </div>
    {/* Arrow — slides in on hover */}
    <motion.div
      initial={{ x: -4, opacity: 0 }}
      whileHover={{ x: 0, opacity: 1 }}
      className="group-hover:opacity-100 opacity-0 transition-opacity"
    >
      <ChevronRightIcon className="size-4 text-[rgb(var(--text-tertiary))]" />
    </motion.div>
  </div>
</Link>
```

### 3.4 Status Badge — Redesigned

```tsx
const CONFIG = {
  unsigned: {
    label: "Unsigned",
    dot: "bg-amber-400",
    bg: "bg-amber-400/10",
    text: "text-amber-400",
    ring: "ring-amber-400/20",
  },
  signed: {
    label: "Signed",
    dot: "bg-indigo-400",
    bg: "bg-indigo-400/10",
    text: "text-indigo-400",
    ring: "ring-indigo-400/20",
  },
  complete: {
    label: "Complete",
    dot: "bg-emerald-400",
    bg: "bg-emerald-400/10",
    text: "text-emerald-400",
    ring: "ring-emerald-400/20",
  },
};

export function StatusBadge({ status }: { status: ClientStatus }) {
  const c = CONFIG[status];
  return (
    <span className={`relative inline-flex items-center gap-1.5
      px-2 py-0.5 rounded-[var(--radius-sm)]
      text-[10px] font-medium font-mono tracking-wide uppercase
      ring-1 ${c.bg} ${c.text} ${c.ring}`}
    >
      <span className={`size-1.5 rounded-full shrink-0 ${c.dot}`} />
      {status === "unsigned" && (
        <motion.span
          className={`absolute inset-0 rounded-[var(--radius-sm)] ${c.bg}`}
          animate={{ opacity: [0.4, 0, 0.4] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: "easeInOut" }}
        />
      )}
      {c.label}
    </span>
  );
}
```

---

## 4. The Wizard — New Packet Flow

This is the most critical UX surface. A 4-step flow (Upload → Processing → Verify → Complete) that should feel like watching a machine solve a problem in real time.

### 4.1 Step Indicator — Timeline, Not Tabs

Replace any tab-style step indicator with a **vertical timeline** on the left for desktop, horizontal stepper for mobile.

```tsx
const STEPS = [
  { key: "upload",     label: "Upload Invoice",    icon: UploadIcon },
  { key: "processing", label: "AI Extraction",     icon: ZapIcon },
  { key: "verify",     label: "Verify Data",       icon: CheckSquareIcon },
  { key: "complete",   label: "Download Packet",   icon: DownloadIcon },
];

// Each step node: circle with icon
// Active: indigo fill + glow ring
// Complete: emerald fill + checkmark replaces icon
// Pending: surface-raised + dimmed icon
// Connecting line: animated fill from top → bottom as steps complete
```

### 4.2 Upload Step — Drop Zone Theater

```tsx
<motion.div
  onDragEnter={() => setDragging(true)}
  onDragLeave={() => setDragging(false)}
  onDrop={handleDrop}
  animate={dragging ? "active" : "idle"}
  variants={{
    idle: {
      borderColor: "rgb(var(--border-default))",
      backgroundColor: "rgb(var(--surface-raised))",
      scale: 1,
    },
    active: {
      borderColor: "rgb(var(--accent))",
      backgroundColor: "rgb(var(--accent-subtle))",
      scale: 1.012,
      transition: { type: "spring", stiffness: 400, damping: 30 },
    },
  }}
  className="relative flex flex-col items-center justify-center
    min-h-[240px] border-2 border-dashed rounded-[var(--radius-md)]
    cursor-pointer select-none"
>
  {/* Animated icon: bounces gently in idle, pulse-grows when dragging */}
  <motion.div
    animate={dragging ? { scale: 1.3, rotate: -8 } : { scale: 1, rotate: 0 }}
    transition={{ type: "spring", stiffness: 500, damping: 22 }}
    className="mb-4 flex size-14 items-center justify-center
      rounded-[var(--radius-md)]
      bg-[rgb(var(--accent-subtle))] text-indigo-400"
  >
    <UploadCloudIcon className="size-7" />
  </motion.div>

  <p className="text-sm font-medium text-[rgb(var(--text-primary))]">
    {dragging ? "Release to upload" : "Drop invoice PDF here"}
  </p>
  <p className="mt-1 text-xs text-[rgb(var(--text-tertiary))]">
    or <button className="text-indigo-400 hover:underline">browse files</button>
  </p>
  <p className="mt-3 text-[10px] font-mono text-[rgb(var(--text-disabled))]">
    PDF · max 20MB
  </p>

  {/* Corner accent lines — appear when dragging */}
  {dragging && <CornerAccents />}
</motion.div>
```

**CornerAccents:** Four L-shaped SVG brackets that animate in at the corners of the dropzone during drag-over. Pure cinema. 12 lines of CSS.

### 4.3 Processing Step — Live Activity Feed

When the AI is extracting data, do NOT show a spinner. Show a **live activity log**.

```tsx
const PROCESSING_STEPS = [
  { id: "parse",    label: "Parsing PDF structure",         duration: 800  },
  { id: "extract",  label: "Extracting client data",        duration: 2400 },
  { id: "validate", label: "Validating required fields",    duration: 600  },
  { id: "match",    label: "Matching draw count templates", duration: 400  },
];

// Each step appears sequentially with a typing/fade-in effect
// Completed steps get a ✓ icon in emerald
// Active step: pulsing dot + indigo text
// Future steps: dimmed

<div className="space-y-3 font-mono text-sm">
  {PROCESSING_STEPS.map((step, i) => (
    <ProcessingRow
      key={step.id}
      label={step.label}
      state={getStepState(i, currentStep)} // "pending" | "active" | "done"
    />
  ))}
</div>
```

```tsx
function ProcessingRow({ label, state }) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: state === "pending" ? 0.3 : 1, x: 0 }}
      className="flex items-center gap-3"
    >
      {state === "done"    && <CheckIcon className="size-4 text-emerald-400 shrink-0" />}
      {state === "active"  && <PulsingDot />}
      {state === "pending" && <span className="size-4 shrink-0" />}
      <span className={state === "active" ? "text-indigo-300" : "text-[rgb(var(--text-secondary))]"}>
        {label}
        {state === "active" && <BlinkingCursor />}
      </span>
    </motion.div>
  );
}
```

### 4.4 Verify Step — Field-Level Confidence Scoring

The AI extraction should return confidence scores per field. Display them:

```tsx
// Each extracted field shown as an editable row
// Low-confidence fields (< 0.85): amber border + warning icon
// High-confidence: default border
// On hover: show "AI confidence: 94%" tooltip

<div className={`
  relative flex items-center gap-3 px-3 py-2.5 rounded-[var(--radius-sm)]
  border transition-colors
  ${confidence < 0.85
    ? "border-amber-400/30 bg-amber-400/5"
    : "border-[rgb(var(--border-default))]"
  }
`}>
  {confidence < 0.85 && (
    <Tooltip content={`AI confidence: ${Math.round(confidence * 100)}%`}>
      <AlertTriangleIcon className="size-3.5 text-amber-400 shrink-0" />
    </Tooltip>
  )}
  <label className="w-28 shrink-0 text-[10px] font-medium tracking-widest uppercase
    text-[rgb(var(--text-tertiary))]">{fieldLabel}</label>
  <input
    defaultValue={value}
    className="flex-1 bg-transparent text-sm font-mono
      text-[rgb(var(--text-primary))] outline-none
      focus:text-white transition-colors"
  />
</div>
```

### 4.5 Complete Step — Celebration Moment

When the packet is ready, don't just show a download button. Make it a **moment**.

```tsx
// 1. Confetti burst (canvas-confetti — 4KB, zero deps)
// 2. Animated checkmark SVG (draw stroke path animation)
// 3. Packet thumbnail preview card with drop shadow
// 4. Download button with animated arrow-down icon

useEffect(() => {
  if (status === "complete") {
    confetti({ particleCount: 80, spread: 60, origin: { y: 0.6 },
               colors: ["#6366f1", "#34d399", "#f59e0b"] });
  }
}, [status]);

<motion.div
  variants={popIn}
  initial="hidden"
  animate="visible"
  className="flex flex-col items-center text-center py-8"
>
  <AnimatedCheckmark /> {/* SVG path stroke-dashoffset animation */}
  <h2 className="mt-4 text-xl font-semibold">Packet ready</h2>
  <p className="mt-1 text-sm text-[rgb(var(--text-secondary))]">
    {pageCount} pages · {client.drawCount} draws · {formatCurrency(client.total)}
  </p>
  <DownloadButton href={packetUrl} />
</motion.div>
```

---

## 5. Empty States

Empty states are **brand moments**. Each one should:
1. Have a unique illustrated icon (not the same generic FileText for everything)
2. Explain specifically WHY it's empty and WHAT to do
3. Include the primary CTA

| Page | Empty Reason | Icon | CTA |
|---|---|---|---|
| Dashboard (no clients) | First use | `FolderOpenIcon` + animated dashed border | "New Packet" |
| Dashboard (filtered) | No matches | `SearchXIcon` | "Clear filters" |
| Client detail (no packets) | Shouldn't happen — handle defensively | `AlertCircleIcon` | "Contact support" |

---

## 6. Settings Page

**Current:** Unknown, likely a basic form.

**Target:** Two-panel layout. Left: nav categories. Right: form. Like a macOS System Preferences panel.

```
┌─────────────────────────────────────────────────────┐
│  Settings                                           │
│ ─────────────────────────────────────────────────  │
│  [Contractor Info]    │  Company Name               │
│  [Preferences]        │  ─────────────────────────  │
│                       │  [  DBA / trade name      ] │
│                       │                             │
│                       │  License Number             │
│                       │  [  VA-XXXXX              ] │
│                       │                             │
│                       │  [ Save Changes ]           │
└─────────────────────────────────────────────────────┘
```

Fields save with an **optimistic inline confirmation** — no page reload, no toast. The save button transforms to a checkmark for 1.5s then resets.

```tsx
<motion.button
  onClick={handleSave}
  animate={saved ? "saved" : "idle"}
  variants={{
    idle: { width: "auto" },
    saved: { width: "auto" },
  }}
>
  <AnimatePresence mode="wait">
    {saved ? (
      <motion.span key="check" variants={popIn} initial="hidden" animate="visible">
        <CheckIcon className="size-4" /> Saved
      </motion.span>
    ) : (
      <motion.span key="save" variants={fadeUp} initial="hidden" animate="visible">
        Save Changes
      </motion.span>
    )}
  </AnimatePresence>
</motion.button>
```

---

## 7. Loading States

**Rule: Never show a full-page spinner.** Content loads in-place with skeleton shimmer.

### Skeleton Shimmer

```css
@keyframes shimmer {
  from { background-position: -200% 0; }
  to   { background-position:  200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    rgb(var(--surface-raised)) 25%,
    rgb(var(--surface-overlay)) 50%,
    rgb(var(--surface-raised)) 75%
  );
  background-size: 200% 100%;
  animation: shimmer 1.6s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
```

The skeleton layout should **match the exact shape** of the real content — not generic bars. A client row skeleton has the same left indicator, initials circle, two lines of text, and right-side numbers as the real card.

---

## 8. Toast / Notification System

Use **Sonner** (already common in shadcn setups) with a custom theme:

```tsx
<Toaster
  position="bottom-right"
  toastOptions={{
    classNames: {
      toast: "border border-[rgb(var(--border-default))] bg-[rgb(var(--surface-overlay))]
              text-[rgb(var(--text-primary))] font-sans text-sm shadow-xl",
      success: "border-emerald-400/20",
      error:   "border-red-400/20",
      warning: "border-amber-400/20",
    },
  }}
/>
```

**Rules:**
- Success: 3s auto-dismiss
- Error: 6s auto-dismiss + manual close
- Never show a toast for something the UI already reflects in-place (e.g. filter change)

---

## 9. Dark / Light Mode Strategy

**Default: dark.** This is a power-user professional tool. Dark is correct.

Light mode should be **warm cream, not harsh white**:
```css
/* Light mode overrides */
--surface-base:    250 249 247;  /* warm off-white */
--surface-raised:  255 255 253;
--border-default:  0 0 0 / 0.08;
--text-primary:    12 10 9 / 0.93;
```

The ModeToggle button animates the sun/moon icon with a rotation + scale spring on switch.

---

## 10. Scroll Behavior

- **Smooth scroll** globally (`scroll-behavior: smooth`)
- **Scroll-linked fade** on the header bottom border — opacity goes 0→1 as user scrolls past the first 40px (signals depth without a heavy shadow)
- **No scroll-jacking.** Ever.

```tsx
// hooks/use-scroll-opacity.ts
export function useScrollOpacity(threshold = 40) {
  const [opacity, setOpacity] = useState(0);
  useEffect(() => {
    const handler = () => setOpacity(Math.min(window.scrollY / threshold, 1));
    window.addEventListener("scroll", handler, { passive: true });
    return () => window.removeEventListener("scroll", handler);
  }, [threshold]);
  return opacity;
}
```

---

## 11. Keyboard Navigation

Every interactive element is keyboard-navigable. Custom components get:
- `role`, `aria-*` attributes
- Visible focus rings (not browser default — custom `ring-2 ring-indigo-500/60 ring-offset-2 ring-offset-[rgb(var(--surface-base))]`)
- `tabIndex` management in modals (focus trap)

The filter tabs support arrow-key navigation:
```tsx
onKeyDown={(e) => {
  if (e.key === "ArrowRight") setFilter(nextFilter);
  if (e.key === "ArrowLeft")  setFilter(prevFilter);
}}
```

---

## 12. Performance Targets

| Metric | Target |
|---|---|
| LCP | < 1.2s |
| FID/INP | < 50ms |
| CLS | 0 (no layout shift) |
| Bundle size | < 120KB gzipped |
| Animation FPS | Locked 60fps (GPU-composited only: transform + opacity) |

**Rules:**
- `will-change: transform` on anything that animates layout (cards, modals)
- No animation on `width`, `height`, `top`, `left` — only `transform: translate/scale`
- `loading="lazy"` on all images below the fold
- All Convex queries use skeleton loading — zero loading spinners

---

## 13. Implementation Priority

Execute in this order:

1. **Tokens** — replace color system, add font-mono rule for numbers
2. **Motion system** — create `lib/motion.ts`, apply `fadeUp` to all list renders
3. **Header** — add nav pill with `layoutId`, logo hover spring
4. **Dashboard stats row** — 3-stat strip above client list
5. **Client card redesign** — status indicator bar, avatar initials, hover glow
6. **Status badge** — unsigned pulse ring
7. **Wizard processing step** — activity log instead of spinner
8. **Skeleton shimmer** — replace generic Skeleton with content-shaped variants
9. **Complete step** — confetti + animated checkmark
10. **Settings page** — two-panel layout, inline save confirmation

---

## Reference Inspirations

These are the comparables to beat:

| Product | What to steal |
|---|---|
| **Linear** | Type scale, filter animation, card density |
| **Vercel Dashboard** | Stat cards, status dots, monospace numerics |
| **Stripe** | Table precision, empty states, skeleton fidelity |
| **Raycast** | Motion timing, keyboard-first, icon consistency |
| **Basement Studio** | Elevation / depth system, frosted glass |
| **Emil Kowalski** | Spring animation choreography |

---

*Design is not decoration. Every choice above has a reason. Ship it.*
