# Ugly Finance Tool - Insights loading safety timeout 8s -> 4s

Same stuck-loading fixes as before (auto-refresh no longer interrupts an in-progress
load; try/catch/finally always clears loading), with the hard safety timeout shortened
from 8s to 4s, so if anything ever stalls the page clears faster. Normal loads finish
well under 1s, so 4s leaves plenty of headroom.

No SQL this round.
