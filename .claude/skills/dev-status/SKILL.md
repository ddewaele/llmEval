---
name: dev-status
description: Show which llmEval processes and ports are in use, health of the API, and the last log lines
allowed-tools: Bash
---

1. `scripts/dev.sh status`: pids from the pidfiles, listeners on the API and Vite ports, health
   check, every process whose command line contains this repo path, last API log lines.
2. `scripts/dev.sh logs` (or `logs -f` to follow) when more log context is needed.
3. Summarise: what is running, on which ports, whether anything looks dangling (repo processes not
   recorded in `.dev/`), and whether a port is held by another project.
