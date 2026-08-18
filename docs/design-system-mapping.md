# Modern Notes Design System Mapping

## 1) Token Mapping (Code -> Intended Figma Variables)

| Semantic Role | CSS Variable | Intended Figma Variable |
|---|---|---|
| App Background | `--background` | `color/background/app` |
| Primary Text | `--foreground` | `color/text/primary` |
| Card Background | `--card` | `color/background/card` |
| Card Text | `--card-foreground` | `color/text/card` |
| Primary Brand | `--primary` | `color/brand/primary` |
| Primary On Color | `--primary-foreground` | `color/brand/on-primary` |
| Secondary Surface | `--secondary` | `color/background/secondary` |
| Secondary Text | `--secondary-foreground` | `color/text/secondary` |
| Muted Surface | `--muted` | `color/background/muted` |
| Muted Text | `--muted-foreground` | `color/text/muted` |
| Border Default | `--border` | `color/border/default` |
| Input Border | `--input` | `color/border/input` |
| Focus Ring | `--ring` | `color/border/focus` |
| Danger | `--destructive` | `color/feedback/danger` |
| Success | `--success` | `color/feedback/success` |
| Warning | `--warning` | `color/feedback/warning` |
| Info | `--info` | `color/feedback/info` |
| Radius Small | `--radius-sm` | `radius/sm` |
| Radius Medium | `--radius-md` | `radius/md` |
| Radius Large | `--radius-lg` | `radius/lg` |
| Shadow Small | `--shadow-sm` | `effect/shadow/sm` |
| Shadow Medium | `--shadow-md` | `effect/shadow/md` |
| Shadow Large | `--shadow-lg` | `effect/shadow/lg` |

## 2) Typography System

| Usage | Token |
|---|---|
| Body Base | `--text-md` |
| Body Small | `--text-sm` |
| Caption | `--text-xs` |
| Heading Small | `--text-lg` |
| Heading Medium | `--text-xl` |
| Heading Large | `--text-2xl` |

Font family:
- Primary: `Inter Variable`
- Code/Inline code: `JetBrains Mono`

## 3) Component Inventory and Variants

| Component | Variants / States | Props |
|---|---|---|
| Button | `default`, `secondary`, `outline`, `ghost`, `destructive`; `sm`, `default`, `lg`, `icon`; `hover/active/focus/disabled` | `variant`, `size`, `disabled` |
| Input | Default + `focus/error/disabled` | `placeholder`, `value`, `disabled` |
| Textarea | Default + `focus/disabled` | `placeholder`, `value`, `disabled` |
| NoteCard | `default`, `selected`, `hover`, `favorite` | `title`, `excerpt`, `tags`, `updatedAt` |
| TagChip | `default`, `active` | `name`, `color`, `active` |
| SaveStatusIndicator | `saving`, `saved`, `failed` | `status`, `error`, `onRetry` |
| DeleteConfirmDialog | `default`, `danger` | `open`, `title` |
| EmptyState | `default` | `icon`, `title`, `description`, `actionLabel` |

## 4) Interaction and State Matrix

| Area | Loading | Empty | Error | Success |
|---|---|---|---|---|
| Note List | Skeleton cards | Empty state card with CTA | Toast error | Notes rendered |
| Editor Save | `Saving` chip + spinner | N/A | `Failed` chip + retry | `Saved` chip |
| Search | Input editable | No-result empty state | N/A | Real-time filtered list |
| Delete | Dialog open | N/A | Error toast | Success toast + next note select |

## 5) Dark Mode Rules

- Dark mode uses dedicated semantic values, not inverted light values.
- Surfaces are layered (`--surface-soft`, `--surface-panel`) to preserve depth.
- Focus ring remains high contrast in both modes.
- Feedback colors are tuned separately for dark mode legibility.
- Muted text in dark mode stays above AA contrast threshold against card/background.
