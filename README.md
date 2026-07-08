# Ugly Finance Tool - mobile Daily rounds cents properly

On the mobile Daily table the whole-dollar display was truncating the cents ($23.50 showed
as $23) instead of rounding. It now rounds to the nearest dollar, so $23.50 shows as $24
and $23.49 as $23. Desktop still shows the exact value ($23.50), and all underlying math
stays 1-cent exact - this only affects how the compact mobile figure is displayed.
