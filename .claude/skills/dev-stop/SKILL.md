---
name: dev-stop
description: Gracefully stop the llmEval API and Vite servers started by scripts/dev.sh
allowed-tools: Bash
---

1. `scripts/dev.sh stop` sends SIGTERM to the processes recorded in `.dev/*.pid` (and their
   children), escalating to SIGKILL after 3 seconds, and stops any listener on the managed ports
   whose command line belongs to this repository.
2. `scripts/dev.sh status` to confirm the ports are free.
3. If something from this repo is still alive (e.g. started by another session without the
   script), run `dev-kill-all`.

Always run this at the end of a task that started servers.
