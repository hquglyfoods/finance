-- How much history does each corp actually have? If BW/FH have far more rows than
-- AD, a paging/limit problem in the app is the likely cause of "No history yet."
SELECT co.code AS corp,
       count(*) FILTER (WHERE t = 'rev') AS revenue_rows,
       count(*) FILTER (WHERE t = 'exp') AS expense_rows,
       min(d) AS first_date, max(d) AS last_date
FROM (
  SELECT corporation_id, 'rev' AS t, date AS d FROM public.daily_revenue
  UNION ALL
  SELECT corporation_id, 'exp', date FROM public.expenses
) x
JOIN public.corporations co ON co.id = x.corporation_id
GROUP BY co.code ORDER BY co.code;
