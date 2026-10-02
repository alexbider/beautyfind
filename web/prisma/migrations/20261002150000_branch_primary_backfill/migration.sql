-- Every listing with categories gets exactly one primary category row. Listings that already have a
-- flagged primary are untouched. For the rest the primary is the category the site already used for the
-- canonical address (catalog order, src/lib/catalog.ts), so no public URL changes. Additive data fix:
-- reversing it means clearing is_primary on the rows this statement flags.
WITH ranked AS (
  SELECT bc.branch_id, bc.category_slug,
         row_number() OVER (
           PARTITION BY bc.branch_id
           ORDER BY CASE bc.category_slug
             WHEN 'facials' THEN 0
             WHEN 'medical-aesthetics' THEN 1
             WHEN 'plastic-surgery' THEN 2
             WHEN 'dental-aesthetics' THEN 3
             WHEN 'hair-restoration' THEN 4
             WHEN 'hair-salons' THEN 5
             WHEN 'hair-removal' THEN 6
             WHEN 'brows-lashes' THEN 7
             WHEN 'makeup' THEN 8
             WHEN 'permanent-makeup' THEN 9
             WHEN 'nails' THEN 10
             WHEN 'spa-massage' THEN 11
             WHEN 'body-contouring' THEN 12
             WHEN 'tanning' THEN 13
             ELSE 99 END
         ) AS rn
  FROM branch_categories bc
  WHERE NOT EXISTS (SELECT 1 FROM branch_categories p WHERE p.branch_id = bc.branch_id AND p.is_primary)
)
UPDATE branch_categories bc
SET is_primary = true
FROM ranked r
WHERE r.rn = 1 AND bc.branch_id = r.branch_id AND bc.category_slug = r.category_slug;

-- Listings that ended up with more than one primary (older editors) keep the first in catalog order.
WITH dup AS (
  SELECT bc.branch_id, bc.category_slug,
         row_number() OVER (
           PARTITION BY bc.branch_id
           ORDER BY CASE bc.category_slug
             WHEN 'facials' THEN 0
             WHEN 'medical-aesthetics' THEN 1
             WHEN 'plastic-surgery' THEN 2
             WHEN 'dental-aesthetics' THEN 3
             WHEN 'hair-restoration' THEN 4
             WHEN 'hair-salons' THEN 5
             WHEN 'hair-removal' THEN 6
             WHEN 'brows-lashes' THEN 7
             WHEN 'makeup' THEN 8
             WHEN 'permanent-makeup' THEN 9
             WHEN 'nails' THEN 10
             WHEN 'spa-massage' THEN 11
             WHEN 'body-contouring' THEN 12
             WHEN 'tanning' THEN 13
             ELSE 99 END
         ) AS rn
  FROM branch_categories bc
  WHERE bc.is_primary
)
UPDATE branch_categories bc
SET is_primary = false
FROM dup d
WHERE d.rn > 1 AND bc.branch_id = d.branch_id AND bc.category_slug = d.category_slug;
