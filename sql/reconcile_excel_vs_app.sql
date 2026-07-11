-- ============================================================================
-- RECONCILE: Excel closing boards vs the app, every corporation, every month.
-- One query, one result set. Any row with status CHECK is a finding.
--
-- Excel baselines embedded below were extracted from the five Closing files
-- (2025-01 .. 2026-07; UMMA starts 2026-01). All boards passed an internal
-- consistency audit (board total = component sum, board = monthly tab,
-- formula references point at the right month tab) with ONE exception:
--
--   HQ 2026-02: the board column's formulas reference the '2026-03' tab
--   (7 cells), so the board displays March numbers for February.
--   The baseline below uses the TRUE February values rebuilt from the
--   2026-02 tab plus the board's own fixed rows and formulas:
--     sales    = 38,921.00 + 6,001.11 + 6,116.14                = 51,038.25
--     expenses = 6,006 + 100 + 7,846 + 10,000 + 19,294.08
--              + 5,035.74 + (10,000*13% + 6,001.11*3%)          = 49,761.85
--   Fix the Excel by pointing those 7 formulas at '2026-02'.
--
-- App-side computation below is identical to crosscheck_all.sql Block 1,
-- whose rules are proven equal to the app's computePL (tools/test_sql_parity.js).
--
--   d_sales / d_exp = app minus Excel. Positive = app too high.
--   2026-07 is in progress (the Excel July column carries prefilled fixed
--   costs for the whole month) so it is labeled, not judged.
-- ============================================================================
WITH excel(corp, month, x_sales, x_exp) AS (
  VALUES
    ('AD','2025-01',131177.13,114871.61),
    ('AD','2025-02',143995.34,123709.96),
    ('AD','2025-03',193882.20,159791.84),
    ('AD','2025-04',193030.35,160258.04),
    ('AD','2025-05',162495.76,147400.67),
    ('AD','2025-06',169963.47,154171.88),
    ('AD','2025-07',187024.47,164296.91),
    ('AD','2025-08',215594.15,184325.11),
    ('AD','2025-09',111328.81,117873.97),
    ('AD','2025-10',121320.78,120075.54),
    ('AD','2025-11',154102.39,131905.03),
    ('AD','2025-12',168659.17,147622.00),
    ('AD','2026-01',166740.71,154144.11),
    ('AD','2026-02',148676.39,134983.97),
    ('AD','2026-03',175074.56,143979.15),
    ('AD','2026-04',173301.49,145245.99),
    ('AD','2026-05',154619.68,148879.11),
    ('AD','2026-06',105135.99,114355.83),
    ('AD','2026-07',24366.14,47173.33),
    ('BW','2025-01',69172.65,71873.34),
    ('BW','2025-02',71238.75,75574.19),
    ('BW','2025-03',95121.93,87259.64),
    ('BW','2025-04',85492.96,82617.85),
    ('BW','2025-05',76928.35,84597.48),
    ('BW','2025-06',77561.55,86400.65),
    ('BW','2025-07',82464.95,84931.60),
    ('BW','2025-08',87433.95,86697.79),
    ('BW','2025-09',78972.52,80737.35),
    ('BW','2025-10',78383.18,77442.48),
    ('BW','2025-11',69897.21,84997.63),
    ('BW','2025-12',66828.81,78595.37),
    ('BW','2026-01',72053.10,68458.33),
    ('BW','2026-02',67704.53,69768.37),
    ('BW','2026-03',91719.75,84057.98),
    ('BW','2026-04',84619.79,90933.88),
    ('BW','2026-05',83788.49,94859.01),
    ('BW','2026-06',75501.85,86626.08),
    ('BW','2026-07',12406.67,22426.10),
    ('FH','2025-01',51928.58,52568.75),
    ('FH','2025-02',49894.84,56175.69),
    ('FH','2025-03',67843.77,64152.73),
    ('FH','2025-04',67026.50,64161.90),
    ('FH','2025-05',68478.89,63001.92),
    ('FH','2025-06',62637.24,64555.33),
    ('FH','2025-07',58838.23,62327.55),
    ('FH','2025-08',64748.00,66354.24),
    ('FH','2025-09',57777.08,61236.88),
    ('FH','2025-10',55729.18,56139.55),
    ('FH','2025-11',52251.88,56592.49),
    ('FH','2025-12',49879.96,53050.37),
    ('FH','2026-01',48973.19,56358.88),
    ('FH','2026-02',50424.60,52804.93),
    ('FH','2026-03',60684.30,58851.31),
    ('FH','2026-04',55816.74,57380.95),
    ('FH','2026-05',59292.00,61016.09),
    ('FH','2026-06',55011.83,52496.98),
    ('FH','2026-07',7938.60,15855.86),
    ('HQ','2025-01',50744.77,48978.19),
    ('HQ','2025-02',39057.05,56376.23),
    ('HQ','2025-03',76851.70,112359.94),
    ('HQ','2025-04',61669.63,68485.44),
    ('HQ','2025-05',60749.89,68686.70),
    ('HQ','2025-06',53567.61,58021.88),
    ('HQ','2025-07',65450.56,70068.83),
    ('HQ','2025-08',45161.16,59604.49),
    ('HQ','2025-09',48092.09,48879.18),
    ('HQ','2025-10',38432.46,54082.14),
    ('HQ','2025-11',28594.76,53524.58),
    ('HQ','2025-12',47478.53,60134.37),
    ('HQ','2026-01',48978.52,65941.62),
    ('HQ','2026-02',51038.25,49761.85),
    ('HQ','2026-03',50963.63,76996.89),
    ('HQ','2026-04',69434.33,83323.31),
    ('HQ','2026-05',46871.25,72427.50),
    ('HQ','2026-06',53158.77,62167.38),
    ('HQ','2026-07',5288.00,47845.20),
    ('UMMA','2026-01',3434.50,19587.65),
    ('UMMA','2026-02',3234.61,8860.00),
    ('UMMA','2026-03',4004.22,8770.09),
    ('UMMA','2026-04',3579.35,16154.08),
    ('UMMA','2026-05',4853.00,9323.31),
    ('UMMA','2026-06',6340.00,13885.10),
    ('UMMA','2026-07',0.00,9794.20)
),
ex AS (
  SELECT ex.corporation_id, co.code AS corp, to_char(ex.date,'YYYY-MM') AS month,
         ex.source, ex.amount, c.code AS cat_code
  FROM public.expenses ex
  JOIN public.corporations co ON co.id = ex.corporation_id
  LEFT JOIN public.expense_categories c
         ON c.id = ex.category_id AND c.corporation_id = ex.corporation_id
  WHERE ex.status = 'confirmed'
),
ex_flags AS (
  SELECT corp, month,
         bool_or(source = 'board') AS exp_locked,
         bool_or(source = 'board' AND cat_code IN ('payroll','payroll_tax')) AS excel_has_payroll
  FROM ex GROUP BY corp, month
),
exp_total AS (
  SELECT e.corp, e.month,
         sum(e.amount) FILTER (
           WHERE e.cat_code IS NOT NULL
             AND NOT (
               f.exp_locked AND e.source <> 'board' AND (
                 e.source IN ('slack','toast','inventory','recurring')
                 OR (e.source = 'payroll_bot' AND f.excel_has_payroll)
               )
             )
         ) AS app_expenses
  FROM ex e JOIN ex_flags f USING (corp, month)
  GROUP BY e.corp, e.month
),
rv AS (
  SELECT co.code AS corp, to_char(r.date,'YYYY-MM') AS month,
         r.source, r.amount, ch.counts_in_total, ch.total_multiplier, ch.id AS ch_id
  FROM public.daily_revenue r
  JOIN public.corporations co ON co.id = r.corporation_id
  LEFT JOIN public.revenue_channels ch
         ON ch.id = r.channel_id AND ch.corporation_id = r.corporation_id
),
rv_flags AS (SELECT corp, month, bool_or(source='board') AS rev_locked FROM rv GROUP BY corp, month),
rev_total AS (
  SELECT r.corp, r.month,
         sum(r.amount * COALESCE(r.total_multiplier,1)) FILTER (
           WHERE r.ch_id IS NOT NULL AND r.counts_in_total
             AND NOT (f.rev_locked AND r.source <> 'board')
         ) AS app_revenue
  FROM rv r JOIN rv_flags f USING (corp, month)
  GROUP BY r.corp, r.month
),
app AS (
  SELECT COALESCE(r.corp, e.corp)   AS corp,
         COALESCE(r.month, e.month) AS month,
         ROUND(COALESCE(r.app_revenue,0), 2)  AS a_sales,
         ROUND(COALESCE(e.app_expenses,0), 2) AS a_exp
  FROM rev_total r
  FULL OUTER JOIN exp_total e ON r.corp = e.corp AND r.month = e.month
  WHERE COALESCE(r.month, e.month) >= '2025-01'
)
SELECT COALESCE(x.corp, a.corp)   AS corp,
       COALESCE(x.month, a.month) AS month,
       x.x_sales,
       COALESCE(a.a_sales,0)                          AS a_sales,
       ROUND(COALESCE(a.a_sales,0) - COALESCE(x.x_sales,0), 2) AS d_sales,
       x.x_exp,
       COALESCE(a.a_exp,0)                            AS a_exp,
       ROUND(COALESCE(a.a_exp,0) - COALESCE(x.x_exp,0), 2)     AS d_exp,
       CASE
         WHEN COALESCE(x.month, a.month) = '2026-07' THEN 'IN PROGRESS'
         WHEN x.corp IS NULL THEN 'NOT IN EXCEL BASELINE'
         WHEN abs(COALESCE(a.a_sales,0) - x.x_sales) < 0.005
          AND abs(COALESCE(a.a_exp,0)   - x.x_exp)   < 0.005 THEN 'OK'
         ELSE 'CHECK'
       END AS status
FROM excel x
FULL OUTER JOIN app a ON a.corp = x.corp AND a.month = x.month
ORDER BY 1, 2;
