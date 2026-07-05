# Oracle fusioncoe Learning-Path Watch

Weekly check for **new content added** to two Oracle blog learning paths:

- https://blogs.oracle.com/fusioncoe/fusion-ai-agent-studio-learning-path
- https://blogs.oracle.com/fusioncoe/fusion-ai-agentic-apps-learning-path

## How this works

Each weekly run:

1. Re-runs web searches over `blogs.oracle.com/fusioncoe` for both learning paths.
2. Collects the set of returned fusioncoe post URLs.
3. Diffs that set against `known_post_urls` in `baseline.json`.
4. If new URLs appear, sends a push notification and appends them to the baseline (`last_checked` is bumped every run either way).

## Important limitation

The two target pages **cannot be fetched directly** — Oracle's blog platform
returns HTTP 403 to automated fetchers (direct fetch, reader proxies). So this
watch cannot read the exact ordered list of lessons *on* each landing page.
Instead it uses the **web-search index** for the fusioncoe blog as a proxy for
"new related content published." Consequences:

- It detects new fusioncoe blog posts, which is a good proxy for the paths
  growing, but it is **not** a byte-for-byte diff of the two pages.
- Search-index lag means a brand-new post may take days to surface.

### To make this exact instead of a proxy

Authorize the **Tavily** connector (it can extract/crawl the blocked pages).
Once authorized, the weekly run can pull the real page contents and diff the
actual lesson lists. Authorization is done from claude.ai connector settings /
`/mcp` in an interactive session — it can't be done from an unattended run.
