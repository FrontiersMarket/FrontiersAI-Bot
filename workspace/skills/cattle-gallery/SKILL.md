---
name: cattle-gallery
description: >
  Fetch and display cattle images from the gallery. Use when the user asks to "show me", "see", "view", or "get images/photos/pictures" of a specific animal (by tag or name) or ranch.
  Returns markdown-formatted image links.
---

# Cattle Gallery Skill

## Purpose

Retrieve and display visual media (photos) for livestock from the `public_gallery_item` table in BigQuery. This skill allows users to see the animals they are asking about.

## Core Query Logic

1.  **Identify the Animal:**
    -   Resolve the animal's UUID using `public_livestock` (by `ear_tag_id` or `name`).
    -   If the user asks for a ranch's images, resolve the `ranch_uuid`.

2.  **Fetch Images:**
    -   Query `alloydb_sync.public_gallery_item`
    -   Filter by `livestock_uuid` (or `ranch_uuid` via join)
    -   Filter `type LIKE 'image%'` (to exclude videos)
    -   Filter `is_deleted = false` (soft deletes)
    -   Order by `priority` ASC (primary images first) or `created_at` DESC (newest first).

## SQL Pattern

### For a specific animal (by Tag):

```sql
SELECT
  l.ear_tag_id,
  l.name as animal_name,
  g.url as image_url,
  g.type,
  g.created_at
FROM `alloydb_sync.public_livestock` l
JOIN `alloydb_sync.public_gallery_item` g ON g.livestock_uuid = l.uuid
WHERE
  l.ranch_uuid = 'RANCH_UUID' -- Optional context
  AND (l.ear_tag_id = 'TAG' OR l.name LIKE '%NAME%')
  AND l.is_deleted = false
  AND g.is_deleted = false
  AND g.type LIKE 'image%'
ORDER BY g.created_at DESC
LIMIT 5
```

### For a ranch (recent uploads):

```sql
SELECT
  l.ear_tag_id,
  g.url as image_url,
  g.created_at
FROM `alloydb_sync.public_gallery_item` g
JOIN `alloydb_sync.public_livestock` l ON g.livestock_uuid = l.uuid
WHERE
  l.ranch_uuid = 'RANCH_UUID'
  AND g.is_deleted = false
  AND l.is_deleted = false
  AND g.type LIKE 'image%'
ORDER BY g.created_at DESC
LIMIT 10
```

## Response Format

Present the images using Markdown syntax so they render in the chat interface.

**Format:**
```markdown
### Photos for [Animal Name/Tag]

![[Date]] [Title/Description](URL)
![[Date]] [Title/Description](URL)
...
```

**Example Output:**
> **Photos for Tag #1042 (Bella)**
>
> ![2024-01-15](https://storage.googleapis.com/.../image.jpg)
> *Uploaded Jan 15, 2024*

## Constraints

-   **Limit:** Always limit results to 5-10 images to avoid flooding the chat.
-   **Videos:** Currently filters for `type LIKE 'image%'`. Videos may not render inline.
-   **Privacy:** Ensure URLs are signed or public (AlloyDB sync usually provides accessible GCS URLs).
