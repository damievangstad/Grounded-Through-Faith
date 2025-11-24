# Contributing Guide

If you are unable to open a pull request, follow these steps to troubleshoot and submit your changes safely.

## 1) Check your local changes
Run `git status` to confirm which files are staged or modified. Add any missing files with `git add <file>`.

## 2) Verify ignored files
If Git is trying to track assets that should be ignored, confirm `.gitignore` excludes binaries such as images. Remove already-tracked unwanted files with `git rm --cached <file>`.

## 3) Commit locally
Use a clear message that summarizes the change:

```
git commit -m "Describe the change"
```

## 4) Push your branch
Push to the remote branch used by your deployment (commonly `main`):

```
git push origin <branch-name>
```

## 5) Open the pull request
In GitHub, compare your branch against the default branch and open the PR. If the PR button is disabled, confirm you pushed the branch and have permission to open PRs in the repository.

## 6) Still blocked?
Double-check that no large binary files are pending, you have the correct remote URL, and your branch is up to date with `git pull --rebase`. If problems persist, capture the exact error message and retry after resolving conflicts.
