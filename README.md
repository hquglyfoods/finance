# Ugly Finance Tool - mobile fixes: home cards, cash envelopes, entry forms

1) HOME CARDS were oversized on mobile. The recent equal-height work pushed the base
   (desktop) sizing to win over the mobile rules due to CSS source order. Moved the
   mobile card-tightening into the late-cascade mobile block so it applies: card
   height on a 390px phone drops from 256px to ~176px. Desktop is unchanged.

2) CASH tab - Count Envelopes:
   - Removed the long description paragraph under the heading.
   - The table now fits the screen width with no horizontal scroll: lower-priority
     columns (Sales, Spent, Diff) are hidden on mobile, leaving Day / Expected /
     Counted / check. The full columns still show on desktop. table-layout:fixed keeps
     it inside the card.

3) ENTRY tab - income and expense forms no longer scroll sideways on mobile:
   - The expense Amount/Payee pair used inline flex:1 which overrode the mobile
     stacking rule; switched to a class so they stack full-width on phones.
   - The income (Revenue) table is now table-layout:fixed with a wrapping name column
     and a fixed narrow amount column, so long channel names no longer force a scroll.

Verified at 390px: no page or in-card horizontal scroll on Home, Cash, or Entry; home
card height reduced; desktop layout unchanged.

No SQL this round.
