# Output Patterns

Use these patterns when skills need to produce consistent, high-quality output.

## Template Pattern

Provide templates for output format. Match the level of strictness to your needs.

**For strict requirements (like API responses or data formats):**

```markdown
## Report structure

ALWAYS use this exact template structure:

# [Analysis Title]

## Executive summary
[One-paragraph overview of key findings]

## Key findings
- Finding 1 with supporting data
- Finding 2 with supporting data
- Finding 3 with supporting data

## Recommendations
1. Specific actionable recommendation
2. Specific actionable recommendation
```

**For flexible guidance (when adaptation is useful):**

```markdown
## Report structure

Here is a sensible default format, but use your best judgment:

# [Analysis Title]

## Executive summary
[Overview]

## Key findings
[Adapt sections based on what you discover]

## Recommendations
[Tailor to the specific context]

Adjust sections as needed for the specific analysis type.
```

## Examples Pattern

For skills where output quality depends on seeing examples, provide input/output pairs:

```markdown
## Commit message format

Generate commit messages following these examples:

**Example 1:**
Input: Added user authentication with JWT tokens
Output:
```
feat(auth): implement JWT-based authentication

Add login endpoint and token validation middleware
```

**Example 2:**
Input: Fixed bug where dates displayed incorrectly in reports
Output:
```
fix(reports): correct date formatting in timezone conversion

Use UTC timestamps consistently across report generation
```

Follow this style: type(scope): brief description, then detailed explanation.
```

Examples help Claude understand the desired style and level of detail more clearly than descriptions alone.

## Channel-Aware Formatting Pattern

When skills produce chat responses, they must adapt to the platform. Include a formatting decision step in the skill's workflow:

```markdown
## Formatting

Before composing the response, determine the active platform from the conversation context and format accordingly:

- **Slack**: Use mrkdwn — `*bold*` (not `**`), `<url|label>` for links, `*Section Title*` on its own line instead of `#` headers. No markdown tables.
- **Discord**: Standard markdown — `**bold**`, `# headers`, max 2000 chars per message. Use code blocks for tabular data.
- **WhatsApp**: Plain text — `*bold*` for emphasis, no headers or tables, keep messages short.
- **Unknown**: Default to plain text with minimal formatting.

See AGENTS.md → "Platform Formatting" for the full reference.
```

This prevents broken rendering (e.g. `**bold**` showing as literal asterisks in Slack) and ensures responses look native on each platform.
