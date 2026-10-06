# The magazine: articles at /magazine/{slug} and the MCP tools that write them

The magazine is a set of database articles rendered at `/magazine/<slug>` (slug: Hebrew letters and digits, or lowercase Latin letters and digits, single hyphens between words). The index at `/magazine` lists published articles newest first with a category filter (`/magazine?category=<slug>`) and keeps the old "coming soon" cards until the first article is published. Everything about an article is written through the MCP server (or any client of the same server actions); `/ops/magazine` is where a person sees, publishes, takes down and deletes, and flips the approvals switch.

## Data

- `articles` (`Article`): slug (unique), title (the page's only H1), status `draft | scheduled | published | unpublished`, publishedAt, scheduledFor, updatedAt, sanitized `bodyHtml`, excerpt, `summary` (the "בקצרה" list), `faq` (`[{q,a}]`, rendered as the visible FAQ), author, medical review (`reviewRequired`, `reviewerId`, `reviewedAt`, `reviewStatus`), category, tags, featured image, `parentPagePath`, `relatedArticleIds`, `readingTimeMinutes` and `wordCount` (computed on save), `internalNotes` (never rendered), SEO (`seoTitle`, `metaDescription`, `focusKeyword`, `canonicalUrl` defaulting to the permalink, `robots` defaulting to `index,follow`, `ogTitle`, `ogDescription`, `ogImageId`, `twitterTitle`, `twitterDescription`), `jsonLdExtra` (extra graph nodes), soft delete (`deletedAt`).
- `authors` (`Author`): writers and medical reviewers (`isMedicalReviewer` with `licenseKind` doctor | dentist | nurse and `licenseNumber`), avatar, `sameAs`, active flag. Not a login.
- `article_categories`, `article_tags` (implicit many-to-many with articles).
- `media_files` gained `width`, `height`, `title`, `caption`, a unique `filename` and `kind` (`article`). Magazine images are served from `/media/<id>/<filename>.webp` with a one-year immutable cache (`/media/<id>` still works).
- `mcp_tokens.scope` and `mcp_auth_codes.scope`: null (everything the role allows) or `magazine`.
- Platform setting `magazinePublishApproval`.

Migration `20261006090000_magazine` is additive.

## Body HTML rules (`src/lib/articleHtml.ts`)

Allowed tags: h2, h3, p, ul, ol, li, table, thead, tbody, tr, th, td, strong, em, a, figure, img, figcaption, blockquote, br, hr. An h1 in the body becomes an h2. External links get `rel="nofollow noopener noreferrer" target="_blank"`; internal links (site paths or `https://beautyfind.co.il/...`) keep neither. Images keep src, alt, width, height and `loading="lazy"`; a missing alt becomes `alt=""` and the validator flags it. Every h2 and h3 gets a stable id (used by the table of contents). `<script type="application/ld+json">` blocks are parsed and stored apart in `jsonLdExtra`; any other script is dropped and reported. Sanitizing is idempotent.

## Publish rules (`validateArticleRow`)

Blocking: no title, body under 50 words, an H1 in the body, an image without alt, no author, a broken internal link (a site path that does not exist: fixed pages, region, city, city+category, category, live listing or article), a link that is neither a site path nor http(s), medical review required without reviewer and review date (or not approved), an incomplete FAQ item, an invalid slug. Warnings: no featured image, featured image without alt, empty or out-of-range meta description, no excerpt, tags the parser had to close, images not uploaded through `upload_media`, self links. `validate_article` returns both lists; `publish_article` and `schedule_article` refuse on the blocking list with the reasons.

## Rendering

`src/app/magazine/[slug]/page.tsx` renders published articles only (404 otherwise), revalidating every 5 minutes and on every write. Server-rendered title (`seoTitle` or title, `| BeautyFind`), description (`metaDescription`, else excerpt, else body text), canonical (`canonicalUrl` or the permalink, Hebrew slugs percent-encoded), robots (the article's `robots` plus the indexing policy: articles follow the `content` section switch), Open Graph `type=article` with published/modified times, author and section, Twitter card. One JSON-LD graph per page: WebPage, Article (BlogPosting when the piece has neither category nor reviewer), BreadcrumbList, FAQPage only when a visible FAQ exists, plus the stored extra nodes. The publisher is `{ "@id": "https://beautyfind.co.il/#organization" }`, never a second Organization. The template (`src/components/magazine/ArticleTemplate.tsx`): breadcrumb, category kicker and reading time, H1, excerpt, byline (author with avatar and role, "נבדק רפואית" reviewer, published and updated dates), featured image, summary list, table of contents from the h2s (3 or more), the body, FAQ, related reading (the related ids, else two newest in the category), the editorial note.

Scheduled articles: `schedule_article` takes Jerusalem wall time (`2026-10-20T09:30`) or a zoned ISO string. When the time passes the article is published by the next render of the magazine index, an article page, the sitemap or a `list_articles` call (there is no cron), so it appears within the 5 minute revalidation window after someone asks for a page.

Revalidation on create, update, publish, unpublish, schedule and delete: the article path, `/magazine`, `/sitemap.xml`, `/ops/magazine` and the article's `parentPagePath`. `revalidate_pages` accepts any of these paths. The sitemap (`src/lib/server/sitemapEntries.ts`, shared with `get_sitemap_urls`) lists published, indexable articles with `lastmod = updatedAt` and the magazine index once it has articles.

## MCP

- Tools live in the `magazine` admin area (`src/components/ops/roles.ts`); ops is full, other roles get it through the team matrix. Reads need view, writes need edit, the approvals switch needs full.
- Writes call the server actions in `src/app/ops/magazine/actions.ts`, which check the area and run the service (`src/lib/server/articles.ts`, `src/lib/server/articleMedia.ts`). Every write leaves its own audit row (`article_create`, `article_update`, `article_publish`, `article_publish_proposed`, `article_unpublish`, `article_schedule`, `article_delete`, `article_replace`, `author_create`, `author_update`, `article_category_create`, `article_category_update`, `article_tag_create`, `media_upload`, `media_update`) on top of the `mcp_call` row the server writes for every call.
- Scope: a personal token created with "מגזין בלבד" on `/ops/ai`, or an OAuth authorization that asked for `mcp:magazine` alone, is offered the magazine tools plus `list_pages`, `revalidate_pages`, `list_branches`, `search_businesses` and `get_indexing`. No business card, billing, client or moderation tools. The role matrix still applies on top.
- Rate limit: per token, per server instance, 240 calls and 90 writes a minute (`RATE_LIMIT` in `src/lib/server/mcp.ts`); a refused call returns `code: rate_limited` with `retryAfterSec`.
- Conflicts and concurrency: `create_article` with an existing slug returns `code: conflict`; `update_article` and `replace_in_article` accept `expected_updated_at` (the `updatedAt` from `get_article`) and return `code: stale` with the current value when it moved. Every create, update and publish response carries `canonicalUrl`.
- Approvals: with `magazinePublishApproval` on, `publish_article` files a `publish_article` proposal (`ai_actions`, subject type `article`) and returns `queued: true` with the Q-ref; approving on `/ops/ai` (or `decide_ai_action`) publishes with the same checks.

### Tool list

Reads: `list_authors`, `get_author`, `list_medical_reviewers`, `list_categories`, `list_tags`, `list_media`, `list_articles`, `get_article`, `get_article_links`, `validate_article`, `get_sitemap_urls`, `get_site_settings`, and `list_pages` (now also returns the magazine index and the article URL pattern).

Writes: `upsert_author`, `upsert_category`, `create_tag`, `upload_media`, `update_media`, `create_article`, `update_article`, `publish_article`, `unpublish_article`, `schedule_article`, `delete_article`, `replace_in_article`.

The schemas below are generated from the registry (`z.toJSONSchema`); ids are UUIDs, field names inside patches are camelCase, top-level ids are snake_case like the rest of the server.

### list_pages (read)

העמודים הציבוריים הקבועים (בית, אזורים, תחומים, תוכן, משפטי) עם הכותרת, התיאור, מילת המפתח, מצב האינדקס וציון ה־SEO של כל אחד, וכן אינדקס המגזין (/magazine) ותבנית כתובת המאמרים (/magazine/{slug}).

```json
{
  "type": "object",
  "properties": {}
}
```

### list_authors (read)

כותבי המגזין והסוקרים הרפואיים: מזהה, slug, שם, תפקיד, ביו, תמונה, האם סוקר רפואי, סוג ומספר רישיון, מספר המאמרים.

```json
{
  "type": "object",
  "properties": {
    "include_inactive": {
      "type": "boolean"
    },
    "reviewers_only": {
      "description": "רק סוקרים רפואיים",
      "type": "boolean"
    }
  },
  "additionalProperties": false
}
```

### get_author (read)

כרטיס כותב או סוקר אחד.

```json
{
  "type": "object",
  "properties": {
    "author": {
      "type": "string",
      "maxLength": 80,
      "description": "מזהה או slug"
    }
  },
  "required": [
    "author"
  ],
  "additionalProperties": false
}
```

### list_medical_reviewers (read)

הסוקרים הרפואיים הפעילים (רופא, רופא שיניים או אחות עם רישיון רשום). מאמר עם medicalReview.required חייב סוקר מהרשימה ותאריך סקירה לפני פרסום.

```json
{
  "type": "object",
  "properties": {}
}
```

### upsert_author (write)

יצירה או עדכון של כותב או סוקר רפואי (שם, תפקיד, ביו, תמונה מ־upload_media, סימון סוקר, רישיון, קישורי sameAs, פעיל).

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "slug": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80
    },
    "name": {
      "type": "string",
      "minLength": 2,
      "maxLength": 120
    },
    "title": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 160
        },
        {
          "type": "null"
        }
      ]
    },
    "bio": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 2000
        },
        {
          "type": "null"
        }
      ]
    },
    "avatarId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        {
          "type": "null"
        }
      ]
    },
    "isMedicalReviewer": {
      "type": "boolean"
    },
    "licenseKind": {
      "anyOf": [
        {
          "type": "string",
          "enum": [
            "doctor",
            "dentist",
            "nurse"
          ]
        },
        {
          "type": "null"
        }
      ]
    },
    "licenseNumber": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 40
        },
        {
          "type": "null"
        }
      ]
    },
    "sameAs": {
      "maxItems": 10,
      "type": "array",
      "items": {
        "type": "string",
        "maxLength": 300,
        "format": "uri"
      }
    },
    "userId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        {
          "type": "null"
        }
      ]
    },
    "active": {
      "type": "boolean"
    }
  },
  "required": [
    "name"
  ],
  "additionalProperties": false,
  "description": "עם id מעדכן, בלי id יוצר. סוקר רפואי חייב licenseKind"
}
```

### list_categories (read)

קטגוריות המגזין: מזהה, slug, שם, תיאור, מספר מאמרים מפורסמים וכתובת הסינון.

```json
{
  "type": "object",
  "properties": {}
}
```

### upsert_category (write)

יצירה או עדכון של קטגוריה במגזין (slug, שם, תיאור). בלי id ועם slug קיים מעדכן את הקיימת.

```json
{
  "type": "object",
  "properties": {
    "id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "slug": {
      "type": "string",
      "minLength": 1,
      "maxLength": 80
    },
    "name": {
      "type": "string",
      "minLength": 2,
      "maxLength": 80
    },
    "description": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 500
        },
        {
          "type": "null"
        }
      ]
    }
  },
  "required": [
    "name"
  ],
  "additionalProperties": false
}
```

### list_tags (read)

תגיות המגזין עם מספר המאמרים המפורסמים בכל אחת.

```json
{
  "type": "object",
  "properties": {}
}
```

### create_tag (write)

יצירת תגית (slug נגזר מהשם כשלא נשלח). תגית קיימת מוחזרת כפי שהיא.

```json
{
  "type": "object",
  "properties": {
    "name": {
      "type": "string",
      "minLength": 2,
      "maxLength": 60
    },
    "slug": {
      "type": "string",
      "maxLength": 60
    }
  },
  "required": [
    "name"
  ],
  "additionalProperties": false
}
```

### upload_media (write)

העלאת תמונה למגזין מכתובת ציבורית או מ־base64: נבדקת (JPEG/PNG/WebP, עד 8MB, לפחות 200px), מומרת ל־WebP עד 1600px ונשמרת. חובה alt בעברית; אפשר title, caption ושם קובץ (אותיות לטיניות קטנות ומקפים). מחזיר מזהה, כתובת, רוחב וגובה.

```json
{
  "type": "object",
  "properties": {
    "alt": {
      "type": "string",
      "minLength": 4,
      "maxLength": 200
    },
    "title": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 160
        },
        {
          "type": "null"
        }
      ]
    },
    "caption": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 500
        },
        {
          "type": "null"
        }
      ]
    },
    "filename": {
      "type": "string",
      "maxLength": 80,
      "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
    },
    "url": {
      "description": "public https URL of the image",
      "type": "string",
      "maxLength": 2000,
      "format": "uri"
    },
    "base64": {
      "description": "the image bytes as base64 (a data: URL is accepted)",
      "type": "string",
      "maxLength": 11744052
    }
  },
  "required": [
    "alt"
  ],
  "additionalProperties": false
}
```

### update_media (write)

עדכון alt, title, caption או שם הקובץ של תמונה שהועלתה.

```json
{
  "type": "object",
  "properties": {
    "media_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "patch": {
      "type": "object",
      "properties": {
        "alt": {
          "type": "string",
          "minLength": 4,
          "maxLength": 200
        },
        "title": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 160
            },
            {
              "type": "null"
            }
          ]
        },
        "caption": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 500
            },
            {
              "type": "null"
            }
          ]
        },
        "filename": {
          "type": "string",
          "maxLength": 80,
          "pattern": "^[a-z0-9]+(?:-[a-z0-9]+)*$"
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "media_id",
    "patch"
  ],
  "additionalProperties": false
}
```

### list_media (read)

תמונות המגזין שהועלו, עם כתובת, alt, מידות ומשקל.

```json
{
  "type": "object",
  "properties": {
    "q": {
      "description": "חיפוש ב־alt, בכותרת ובשם הקובץ",
      "type": "string",
      "maxLength": 120
    },
    "kind": {
      "description": "ברירת מחדל article; null לכל התמונות הציבוריות",
      "anyOf": [
        {
          "type": "string",
          "maxLength": 20
        },
        {
          "type": "null"
        }
      ]
    },
    "page": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "page_size": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    }
  },
  "additionalProperties": false
}
```

### list_articles (read)

רשימת המאמרים עם סינון לפי מצב, קטגוריה, כותב, טקסט וטווח תאריכים, בעימוד. כל שורה: מזהה, כותרת, slug, כתובת קנונית, מצב, תאריכים, מספר מילים, עמוד אב ומילת מפתח.

```json
{
  "type": "object",
  "properties": {
    "status": {
      "type": "string",
      "enum": [
        "draft",
        "scheduled",
        "published",
        "unpublished",
        "all"
      ]
    },
    "category": {
      "description": "מזהה או slug",
      "type": "string",
      "maxLength": 80
    },
    "author": {
      "description": "מזהה או slug",
      "type": "string",
      "maxLength": 80
    },
    "search": {
      "type": "string",
      "maxLength": 120
    },
    "from": {
      "description": "ISO; לפי updatedAt",
      "type": "string",
      "maxLength": 40
    },
    "to": {
      "type": "string",
      "maxLength": 40
    },
    "include_deleted": {
      "type": "boolean"
    },
    "page": {
      "type": "integer",
      "minimum": 1,
      "maximum": 9007199254740991
    },
    "page_size": {
      "type": "integer",
      "minimum": 1,
      "maximum": 100
    }
  },
  "additionalProperties": false
}
```

### get_article (read)

המאמר המלא: כל השדות, ה־HTML המסונן, המחבר והסוקר, הקטגוריה והתגיות, התמונה הראשית, שדות ה־SEO, JSON-LD נוסף ו־updatedAt לעדכון בטוח.

```json
{
  "type": "object",
  "properties": {
    "article": {
      "type": "string",
      "maxLength": 140,
      "description": "מזהה או slug"
    }
  },
  "required": [
    "article"
  ],
  "additionalProperties": false
}
```

### create_article (write)

יצירת מאמר (טיוטה). חובה title; slug נגזר מהכותרת כשלא נשלח (עברית או לטינית קטנה עם מקפים); slug תפוס מחזיר conflict. bodyHtml מסונן לתגיות המותרות (h2,h3,p,ul,ol,li,table,thead,tbody,tr,th,td,strong,em,a,figure,img,figcaption,blockquote,br,hr); סקריפטי JSON-LD נשמרים בנפרד. מחזיר את המאמר והכתובת הקנונית.

```json
{
  "type": "object",
  "properties": {
    "slug": {
      "type": "string",
      "minLength": 1,
      "maxLength": 120
    },
    "title": {
      "type": "string",
      "minLength": 2,
      "maxLength": 200
    },
    "bodyHtml": {
      "type": "string",
      "maxLength": 400000
    },
    "excerpt": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 500
        },
        {
          "type": "null"
        }
      ]
    },
    "summary": {
      "maxItems": 10,
      "type": "array",
      "items": {
        "type": "string",
        "minLength": 1,
        "maxLength": 240
      }
    },
    "faq": {
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "object",
        "properties": {
          "q": {
            "type": "string",
            "minLength": 3,
            "maxLength": 300
          },
          "a": {
            "type": "string",
            "minLength": 3,
            "maxLength": 2000
          }
        },
        "required": [
          "q",
          "a"
        ],
        "additionalProperties": false
      }
    },
    "authorId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        {
          "type": "null"
        }
      ]
    },
    "categoryId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        {
          "type": "null"
        }
      ]
    },
    "tagIds": {
      "maxItems": 20,
      "type": "array",
      "items": {
        "type": "string",
        "format": "uuid",
        "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
      }
    },
    "featuredImageId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        {
          "type": "null"
        }
      ]
    },
    "parentPagePath": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 200,
          "pattern": "^\\/[^\\s]*$"
        },
        {
          "type": "null"
        }
      ]
    },
    "relatedArticleIds": {
      "maxItems": 10,
      "type": "array",
      "items": {
        "type": "string",
        "format": "uuid",
        "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
      }
    },
    "internalNotes": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 5000
        },
        {
          "type": "null"
        }
      ]
    },
    "medicalReview": {
      "type": "object",
      "properties": {
        "required": {
          "type": "boolean"
        },
        "reviewerId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "reviewedAt": {
          "description": "ISO date or date-time",
          "type": [
            "string",
            "null"
          ]
        },
        "status": {
          "anyOf": [
            {
              "type": "string",
              "enum": [
                "pending",
                "approved",
                "changes_requested"
              ]
            },
            {
              "type": "null"
            }
          ]
        }
      },
      "additionalProperties": false
    },
    "seoTitle": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 120
        },
        {
          "type": "null"
        }
      ]
    },
    "metaDescription": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 320
        },
        {
          "type": "null"
        }
      ]
    },
    "focusKeyword": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 80
        },
        {
          "type": "null"
        }
      ]
    },
    "canonicalUrl": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 500,
          "format": "uri"
        },
        {
          "type": "null"
        }
      ]
    },
    "robots": {
      "type": "string",
      "pattern": "^(index|noindex),\\s?(follow|nofollow)$"
    },
    "ogTitle": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 120
        },
        {
          "type": "null"
        }
      ]
    },
    "ogDescription": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 320
        },
        {
          "type": "null"
        }
      ]
    },
    "ogImageId": {
      "anyOf": [
        {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        {
          "type": "null"
        }
      ]
    },
    "twitterTitle": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 120
        },
        {
          "type": "null"
        }
      ]
    },
    "twitterDescription": {
      "anyOf": [
        {
          "type": "string",
          "maxLength": 320
        },
        {
          "type": "null"
        }
      ]
    },
    "jsonLd": {
      "maxItems": 10,
      "type": "array",
      "items": {
        "type": "object",
        "propertyNames": {
          "type": "string"
        },
        "additionalProperties": {}
      },
      "description": "extra JSON-LD nodes for the page graph"
    }
  },
  "required": [
    "title"
  ],
  "additionalProperties": false
}
```

### update_article (write)

עדכון חלקי של מאמר: רק השדות שנשלחו משתנים. expected_updated_at מגן מפני דריסה. מאמר מפורסם מתרענן באתר. מחזיר את המאמר והכתובת הקנונית.

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "patch": {
      "type": "object",
      "properties": {
        "slug": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "title": {
          "type": "string",
          "minLength": 2,
          "maxLength": 200
        },
        "bodyHtml": {
          "type": "string",
          "maxLength": 400000
        },
        "excerpt": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 500
            },
            {
              "type": "null"
            }
          ]
        },
        "summary": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 240
          }
        },
        "faq": {
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "q": {
                "type": "string",
                "minLength": 3,
                "maxLength": 300
              },
              "a": {
                "type": "string",
                "minLength": 3,
                "maxLength": 2000
              }
            },
            "required": [
              "q",
              "a"
            ],
            "additionalProperties": false
          }
        },
        "authorId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "categoryId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "tagIds": {
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "featuredImageId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "parentPagePath": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 200,
              "pattern": "^\\/[^\\s]*$"
            },
            {
              "type": "null"
            }
          ]
        },
        "relatedArticleIds": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "internalNotes": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 5000
            },
            {
              "type": "null"
            }
          ]
        },
        "medicalReview": {
          "type": "object",
          "properties": {
            "required": {
              "type": "boolean"
            },
            "reviewerId": {
              "anyOf": [
                {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                {
                  "type": "null"
                }
              ]
            },
            "reviewedAt": {
              "description": "ISO date or date-time",
              "type": [
                "string",
                "null"
              ]
            },
            "status": {
              "anyOf": [
                {
                  "type": "string",
                  "enum": [
                    "pending",
                    "approved",
                    "changes_requested"
                  ]
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "additionalProperties": false
        },
        "seoTitle": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "metaDescription": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 320
            },
            {
              "type": "null"
            }
          ]
        },
        "focusKeyword": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 80
            },
            {
              "type": "null"
            }
          ]
        },
        "canonicalUrl": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 500,
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "robots": {
          "type": "string",
          "pattern": "^(index|noindex),\\s?(follow|nofollow)$"
        },
        "ogTitle": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "ogDescription": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 320
            },
            {
              "type": "null"
            }
          ]
        },
        "ogImageId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "twitterTitle": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "twitterDescription": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 320
            },
            {
              "type": "null"
            }
          ]
        },
        "jsonLd": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "description": "extra JSON-LD nodes for the page graph"
        }
      },
      "additionalProperties": false
    },
    "expected_updated_at": {
      "description": "updatedAt מ־get_article; ערך ישן מחזיר stale",
      "type": "string",
      "maxLength": 40
    }
  },
  "required": [
    "article_id",
    "patch"
  ],
  "additionalProperties": false
}
```

### publish_article (write)

פרסום מאמר: נבדק קודם (כותרת, גוף, מחבר, alt לתמונות, קישורים פנימיים, סקירה רפואית כשנדרשת) ונדחה עם שגיאה ברורה כשלא עובר. כשההגדרה ״פרסום דרך תור האישורים״ דלוקה, נפתחת בקשה בתור במקום פרסום. העמוד, /magazine, מפת האתר ועמוד האב מתרעננים. מחזיר את הכתובת הקנונית.

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "note": {
      "type": "string",
      "maxLength": 300
    }
  },
  "required": [
    "article_id"
  ],
  "additionalProperties": false
}
```

### unpublish_article (write)

הורדת מאמר מהאתר (unpublished): העמוד מחזיר 404 ויוצא ממפת האתר; התוכן נשמר.

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reason": {
      "type": "string",
      "maxLength": 300
    }
  },
  "required": [
    "article_id"
  ],
  "additionalProperties": false
}
```

### schedule_article (write)

תזמון פרסום לזמן עתידי בשעון ישראל. המאמר נבדק כמו בפרסום; בהגיע הזמן הוא מתפרסם ברינדור הבא של המגזין או מפת האתר.

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "scheduled_for": {
      "type": "string",
      "maxLength": 40,
      "description": "YYYY-MM-DDTHH:mm בשעון ישראל (Asia/Jerusalem), או ISO עם אזור זמן"
    }
  },
  "required": [
    "article_id",
    "scheduled_for"
  ],
  "additionalProperties": false
}
```

### delete_article (write)

מחיקה רכה: המאמר יורד מהאתר ונעלם מהרשימות (include_deleted מראה אותו), השורה נשמרת.

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "reason": {
      "type": "string",
      "maxLength": 300
    }
  },
  "required": [
    "article_id"
  ],
  "additionalProperties": false
}
```

### replace_in_article (write)

החלפה ממוקדת בגוף המאמר (למשל הוספת קישור פנימי לפסקה קיימת). התוצאה מסוננת מחדש ונשמרת; המאמר מתרענן.

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "find": {
      "type": "string",
      "minLength": 1,
      "maxLength": 5000,
      "description": "טקסט או HTML מדויק מתוך bodyHtml"
    },
    "replace": {
      "type": "string",
      "maxLength": 20000
    },
    "all": {
      "description": "להחליף כל מופע; בלי זה טקסט שמופיע יותר מפעם אחת נדחה",
      "type": "boolean"
    },
    "expected_updated_at": {
      "type": "string",
      "maxLength": 40
    }
  },
  "required": [
    "article_id",
    "find",
    "replace"
  ],
  "additionalProperties": false
}
```

### get_article_links (read)

הקישורים של מאמר: יוצאים פנימיים (עם בדיקה שהנתיב קיים) וחיצוניים, ונכנסים ממאמרים אחרים (כולל ״קריאה נוספת״).

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    }
  },
  "required": [
    "article_id"
  ],
  "additionalProperties": false
}
```

### validate_article (read)

בדיקה יבשה בלי שמירה: alt חסר, H1 בגוף, קישורים פנימיים שבורים, נתיבים שלא קיימים, מחבר או תמונה ראשית חסרים, מטא ריק או ארוך, תגיות לא סגורות, סקירה רפואית. מחזיר publishable ורשימת ממצאים לפי חומרה.

```json
{
  "type": "object",
  "properties": {
    "article_id": {
      "type": "string",
      "format": "uuid",
      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
    },
    "patch": {
      "description": "לבדוק שינוי לפני שמירה",
      "type": "object",
      "properties": {
        "slug": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "title": {
          "type": "string",
          "minLength": 2,
          "maxLength": 200
        },
        "bodyHtml": {
          "type": "string",
          "maxLength": 400000
        },
        "excerpt": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 500
            },
            {
              "type": "null"
            }
          ]
        },
        "summary": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "minLength": 1,
            "maxLength": 240
          }
        },
        "faq": {
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "q": {
                "type": "string",
                "minLength": 3,
                "maxLength": 300
              },
              "a": {
                "type": "string",
                "minLength": 3,
                "maxLength": 2000
              }
            },
            "required": [
              "q",
              "a"
            ],
            "additionalProperties": false
          }
        },
        "authorId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "categoryId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "tagIds": {
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "featuredImageId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "parentPagePath": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 200,
              "pattern": "^\\/[^\\s]*$"
            },
            {
              "type": "null"
            }
          ]
        },
        "relatedArticleIds": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "internalNotes": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 5000
            },
            {
              "type": "null"
            }
          ]
        },
        "medicalReview": {
          "type": "object",
          "properties": {
            "required": {
              "type": "boolean"
            },
            "reviewerId": {
              "anyOf": [
                {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                {
                  "type": "null"
                }
              ]
            },
            "reviewedAt": {
              "description": "ISO date or date-time",
              "type": [
                "string",
                "null"
              ]
            },
            "status": {
              "anyOf": [
                {
                  "type": "string",
                  "enum": [
                    "pending",
                    "approved",
                    "changes_requested"
                  ]
                },
                {
                  "type": "null"
                }
              ]
            }
          },
          "additionalProperties": false
        },
        "seoTitle": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "metaDescription": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 320
            },
            {
              "type": "null"
            }
          ]
        },
        "focusKeyword": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 80
            },
            {
              "type": "null"
            }
          ]
        },
        "canonicalUrl": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 500,
              "format": "uri"
            },
            {
              "type": "null"
            }
          ]
        },
        "robots": {
          "type": "string",
          "pattern": "^(index|noindex),\\s?(follow|nofollow)$"
        },
        "ogTitle": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "ogDescription": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 320
            },
            {
              "type": "null"
            }
          ]
        },
        "ogImageId": {
          "anyOf": [
            {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            {
              "type": "null"
            }
          ]
        },
        "twitterTitle": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 120
            },
            {
              "type": "null"
            }
          ]
        },
        "twitterDescription": {
          "anyOf": [
            {
              "type": "string",
              "maxLength": 320
            },
            {
              "type": "null"
            }
          ]
        },
        "jsonLd": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "object",
            "propertyNames": {
              "type": "string"
            },
            "additionalProperties": {}
          },
          "description": "extra JSON-LD nodes for the page graph"
        }
      },
      "additionalProperties": false
    }
  },
  "required": [
    "article_id"
  ],
  "additionalProperties": false
}
```

### get_sitemap_urls (read)

כל הכתובות החיות במפת האתר (אותו מקור כמו /sitemap.xml) עם סוג, כותרת ו־lastmod; לסינון לפי סוג.

```json
{
  "type": "object",
  "properties": {
    "type": {
      "type": "string",
      "enum": [
        "home",
        "treatments",
        "regions",
        "category",
        "region",
        "city",
        "cityCategory",
        "profile",
        "content",
        "legal",
        "magazine",
        "article"
      ]
    },
    "limit": {
      "type": "integer",
      "minimum": 1,
      "maximum": 5000
    }
  },
  "additionalProperties": false
}
```

### get_site_settings (read)

נתוני האתר לכותבים: שם האתר, כתובת, תמונת שיתוף ברירת מחדל, @id של הארגון ב־JSON-LD, שם ולוגו המפרסם, שפה (he-IL), אזור זמן, תבנית כתובת המאמרים ומצב מתג האישורים.

```json
{
  "type": "object",
  "properties": {}
}
```
