-- Removes the secondary "facials" tag (קוסמטיקה וטיפולי פנים) that the import attached to listings with no
-- facial evidence: no published facial or skin treatment and no cosmetics, beauty, skin or clinic wording in
-- the name. Primary categories and claimed listings are never touched. Every removed row is copied to
-- branch_categories_facials_backup first.
--
-- Undo:
--   INSERT INTO branch_categories SELECT branch_id, category_slug, is_primary FROM branch_categories_facials_backup
--   ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS branch_categories_facials_backup AS
SELECT bc.branch_id, bc.category_slug, bc.is_primary, now() AS removed_at FROM branch_categories bc WHERE false;

WITH doomed AS (
  SELECT bc.branch_id, bc.category_slug, bc.is_primary
  FROM branch_categories bc
  JOIN branches b ON b.id = bc.branch_id
  WHERE bc.category_slug = 'facials'
    AND bc.is_primary = false
    AND b.is_claimed = false
    AND b.name !~* '(קוסמטיק|cosmet|kosmet|פנים|facial|skin|עור|beauty|ביוטי|יופי|טיפוח|אסתטיק|esthet|aesthet|clinic|קליניק|רפואי|derm)'
    AND NOT EXISTS (
      SELECT 1 FROM treatments t
      WHERE t.branch_id = bc.branch_id
        AND t.is_published = true
        AND (
          t.category_slug = 'facials'
          OR t.name ~* '(פנים|קוסמטיק|פילינג|אקנה|ניקוי|עור|הידרה|מיקרונידלינג|מזותרפיה|פיגמנט|facial|peel|acne|cosmet|skin|hydra)'
        )
    )
),
saved AS (
  INSERT INTO branch_categories_facials_backup (branch_id, category_slug, is_primary, removed_at)
  SELECT branch_id, category_slug, is_primary, now() FROM doomed
  RETURNING branch_id, category_slug
)
DELETE FROM branch_categories bc
USING saved s
WHERE bc.branch_id = s.branch_id AND bc.category_slug = s.category_slug;
