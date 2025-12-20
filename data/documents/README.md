# Documents Folder

Add your own documents here to include them in the search demo!

## File Format

Each document should be a `.md` (Markdown) file with YAML frontmatter:

```markdown
---
title: Your Document Title
category: your-category
---

Your document content goes here. This is what will be searched
and indexed using Native PostgreSQL, BM25, and Vector search.
```

## Required Fields

- **title** (required): The document title. This is displayed in search results and is included in the searchable text.
- **category** (optional): A category tag for the document (e.g., `tutorial`, `reference`, `security`). Defaults to `general` if not specified.

## Example

Create a file called `my-document.md`:

```markdown
---
title: Getting Started with PostgreSQL
category: tutorial
---

PostgreSQL is a powerful open-source relational database. This guide covers 
installation, basic configuration, and your first queries. PostgreSQL supports 
advanced features like JSON, full-text search, and extensions.
```

## Tips for Good Search Demos

1. **Vary document lengths** - Include both short tips and longer reference docs to demonstrate length normalization
2. **Include similar topics** - Add multiple documents about related topics to show ranking differences
3. **Use natural language** - Write content as you would for real documentation
4. **Include technical terms** - Mix common and rare terms to demonstrate IDF weighting

## Reloading Documents

After adding or modifying documents, run the setup script to reload everything:

```bash
npm run setup
```

This will:
1. Drop the existing documents table
2. Reload all `.md` files from this folder
3. Generate new embeddings via OpenAI
4. Recreate all search indexes

