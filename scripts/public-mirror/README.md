# Public mirror tooling

Creates `I-R0N/omnispace`, a public mirror of this repo's `main` branch.

Nothing here is active in this repository. `preview.yml` is deliberately kept
outside `.github/workflows/` so it only takes effect once copied into the
mirror; the script does that copy.

## What the script does

1. Clones `main` only — full history, no other branches.
2. Rewrites `rhenegha@gmail.com` out of every author and committer field,
   replacing it with the GitHub noreply address so commits stay attributed to
   the account. All 420 commits are preserved; nothing is squashed.
3. Aborts if the commit count changes or if the address survives anywhere.
4. Removes `pr-preview.yml` and `publish-standalone.yml`, which push to the
   private `i-r0n/omni-standalone` repo using a secret the mirror will not
   have, and installs `preview.yml` in their place.

## Running it

```sh
brew install git-filter-repo

./scripts/public-mirror/create-public-mirror.sh          # prepare, do not push
./scripts/public-mirror/create-public-mirror.sh --push   # prepare and push
```

Without `--push` the script stops before publishing and prints the push
command, so the history can be inspected first.

Create <https://github.com/I-R0N/omnispace> as an empty public repository —
no README, no `.gitignore`, no license — before pushing.

## The preview workflow

`preview.yml` builds the single-file standalone game and publishes it to the
mirror's own `gh-pages` branch:

| Trigger | URL | Where the link is posted |
| --- | --- | --- |
| push to `main` | `https://i-r0n.github.io/omnispace/` | commit comment + job summary |
| pull request | `https://i-r0n.github.io/omnispace/pr-<N>/` | PR comment, updated in place |

Closing a PR deletes its directory and updates the comment.

It needs **no repository secrets** — the built-in `GITHUB_TOKEN` can push to
`gh-pages` in the same repository, which is why this replaces the old
cross-repo mirroring setup rather than porting it.

After the first successful run creates the `gh-pages` branch, enable serving
once under **Settings → Pages → Source: "Deploy from a branch" → `gh-pages` →
`/ (root)`**.

### Notes

- Pull requests from forks are skipped. A fork PR gets a read-only token and
  cannot publish; the job would fail rather than produce a link.
- Because previews run on `pull_request` with `contents: write`, only
  collaborators can trigger them — which the fork guard already enforces.
- Pages may take a minute to serve the very first deploy.
