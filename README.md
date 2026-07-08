# Ugly Finance Tool - cash count ignores sub-dollar (coin) shortfalls

Coins under a dollar stay in the register, so a count that's short by less than $1 is now
treated as fine (green), not short (red). Example: expected $310.50, counted $310 -> green
(the 50c is in the drawer). A shortfall of $1 or more still shows red.

Applied consistently in all three places the check appears: the calendar day coloring,
the "Count Envelopes" table, and the day detail popup.

Verified: $310.50 expected / $310 counted shows green; $500 expected / $400 counted still
shows red.
