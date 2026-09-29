# The standalone exit

No npm, no CDN, no build step, no server of ours.

```
index.html   the page, carrying the library in its own script
exit.mjs     the library: the Solana bits, written out rather than imported
```

`index.html` is the whole page: save that one file and open it from disk, or
host it anywhere. It needs a Solana RPC endpoint and a wallet extension, and
nothing else. If useagentclash.xyz is down, or gone, this still works. It is also
published from this folder to https://pyco404.github.io/oxude/
(`.github/workflows/exit-pages.yml`), a different provider from the one behind
useagentclash.xyz.

The page carries `exit.mjs` inside its own script rather than importing it,
because a browser will not load a module from a `file://` URL. `exit.mjs` is
the source - the web app's exit panel imports it - and
`scripts/inline-exit.ts` copies it into the page between two marker lines:

```bash
npm run exit:inline            # after any change to exit.mjs
npm run exit:inline -- --check # what the tests enforce
```

`test/standalone-exit.test.ts` runs its checks against the copy inside
`index.html`, the code the page actually executes, and fails if that copy is
not `exit.mjs` byte for byte.

## Why it repeats code the repo already has

An exit that only works while our web app is up is not a non-custodial exit.
A dependency — npm, a CDN, a bundler, our API — is a thing that can be missing
on the day it is needed, so this page has none.

The cost is that base58, the ed25519 curve check, address derivation and
transaction serialization are written out here a second time. That is only
tolerable because `test/standalone-exit.test.ts` holds every one of them
against `@solana/web3.js` and against the built IDL, byte for byte. The copy
cannot drift from the original without the suite failing.

It has already earned that: the first version of this file got base58 wrong
for all-zero input, which is exactly the System Program's id, so every
`request_exit` it built was a byte too long. Nothing but a byte-for-byte
comparison would have found it, and it would have failed only in the hands of
someone trying to leave.

## What it does

Three instructions on `HTs42VFpHS4XT9Cr8xH7cJEMgqPL9uuzZn6QHGwtvkdy`, each
signed by the owner's wallet alone:

| | |
| --- | --- |
| `request_exit` | starts the window. Moves nothing. |
| `claim_exit` | after the window, pays out to the owner's own token account. |
| `close_exit` | cancels an unclaimed exit, or clears a claimed record for its rent. |

It finds a wallet's agents by asking the program for its `AgentOwner` records,
not by asking us — so it works for an agent we have never heard of, and it
cannot be given a list that leaves one out.

The window and the reasoning behind it are in
[the design notes](../../../docs/non-custodial-exit.md).

## Rebuilding a transaction by hand

`exit.mjs` is plain JavaScript and is meant to be read. The account order, the
Anchor discriminators and the argument layout for each instruction are all in
it, so a transaction can be assembled from that file alone with any Solana
library, or none.

## Why it sits in `web/public/`

So that it is also served at `/exit/`, and so the in-app panel can build its
transactions from this exact file rather than a second copy. Neither of those
is the guarantee. The guarantee is that these two files need no server of
ours: copy them anywhere, or open `index.html` from disk, and they work the
same. Somewhere that is not our hosting is still the right home for a copy.
