# TreeGPT native prompt caching

The main chat and legacy web-chat paths now send TreeGPT Claude requests to
`POST https://api.treegpt.cc/v1/messages`. Other providers retain their existing
Chat Completions transport. `SYZYGY_TREE_TRANSPORT=chat` restores the previous
TreeGPT transport; it is an explicit operational rollback, never a paid retry.

## Reference design

Based on the user-supplied `mcp-cache-breakdown.md`:

- BP1: fixed persona and fixed output rules in native `system[0]`.
- BP2: original older conversation in `system[1]`, updated every eight completed
  user turns, retaining at least the latest four history messages. It is quoted
  as reference data, not elevated into new instructions.
- BP3: the latest historical user/tool block, before the current dynamic user
  message. Tools have no separate breakpoint. Every marker has `ttl: "1h"`.
- Dynamic time, state, recalls and the current question remain after the cached
  history. Live data is not frozen or replaced with stale snapshots.
- No metadata user ID is supplied.
- Native TreeGPT sends a stable catalogue of enabled tool definitions on both
  chat paths. Current-turn selection remains separate: an uncached permission
  hint lists permitted tools, and the server refuses calls outside that list.
  Disabled device/health tools are excluded. Configuration or definition changes
  still legitimately change the catalogue; changing the topic alone does not.
- Fixed output rules are added before dynamic state/recall reads. A failed read
  cannot remove the rules or change the fixed system prefix.

Freezing changes placement, not token count. The first native request and each
eight-turn freeze transition may write a large new history block. BP1 remains
separately reusable. No hourly keeper or extra summarization model is called.
There is no promise of a cache hit or of lower actual billing until upstream
usage confirms it.

## Original history and continuity

The browser uses existing synced messages, IDs and revision proofs instead of a
second localStorage copy of frozen text. `data/frozen-context/` privately archives
original revisions with atomic 0600 files using the existing continuity store's
`rawOnly` mode. This mode never invokes a summarizer. Restoration after a browser
history trim requires its existing prefix proof; missing messages alone do not
authorize restoration. Editing/deleting visible history immediately rebuilds
the frozen projection from current source. Multimodal or tool-containing segments
are retained as structured messages, never flattened or silently discarded.

## Transport and compatibility

`anthropic-cache.js` converts image blocks, tool schemas, tool results and tool
calls. Both response formats retain native cache usage fields, including 5m/1h
creation counters. Streaming thinking signatures are retained privately through
tool rounds. Network cancellation and upstream errors stop the request without
automatically calling the model again.

Opus 5.5 uses adaptive thinking, with legacy sampling parameters removed. Forced
tool choices become supported `auto` selection plus a current-turn instruction;
the model cannot guarantee a forced call through this API. The end-of-tool-round
request retains tool schemas and signed tool context with `tool_choice: none`.

The reference's extended-TTL beta header is retained for relay compatibility,
alongside `anthropic-version: 2023-06-01`. Do not infer cache behavior from a header
or local self-check: inspect the actual native usage from normal conversation.
The older manual paid probe script still tests the legacy Chat Completions path;
its earlier successful result does not validate this native implementation.

## Validation

Tests cover native endpoint/body serialization on both server paths, three
breakpoints, eight-turn freezing, source edits/deletes, verified resume beyond
200 browser messages, images, tool pairs, fragmented UTF-8 SSE, signed thinking,
usage merging, truncation, errors and no automatic retries. Tests use synthetic
fixtures without real model calls.

Official references:
- https://platform.claude.com/docs/en/build-with-claude/prompt-caching
- https://platform.claude.com/docs/en/models/opus-5-5/migration-guide
- https://platform.claude.com/docs/en/models/opus-5-5/whats-new-opus-5-5
- https://platform.claude.com/docs/en/api/messages/create
