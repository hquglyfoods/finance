# Ugly Finance Tool - fix the root cause of Insights getting stuck on "Loading..."

Two real root causes found and fixed (beyond the earlier safety-timeout band-aids):

1) EMPTY STORE SELECTION = permanent spinner. On first render, if the corp list hadn't
   loaded yet, the selected store id was undefined. The loader bailed out with an early
   `return` WITHOUT clearing the loading flag, so the page sat on "Loading..." forever
   (the store id never got set afterward because it was only computed once). Now: if no
   store is selected the loader clears loading instead of hanging, AND a new effect picks
   the first available store as soon as the list loads.

2) RACE BETWEEN RELOADS. Rapidly changing store/month/view (or a background refresh
   landing mid-load) could supersede an in-flight load. The old per-run "dead" flag could
   leave loading set if runs overlapped just so. Replaced with a generation counter:
   only the LATEST run controls the loading flag, and the latest run ALWAYS clears it -
   on success, on error, or via the 4s safety timeout. Same fix applied to the Compare
   Stores loader.

Verified: normal load clears; rapid store switching clears; rapid month switching
clears; no stuck spinner in any case.

No SQL this round.
