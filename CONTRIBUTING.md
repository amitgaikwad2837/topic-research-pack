# Contributing

```bash
npm install
npm run check    # typecheck, lint, tests, build: must pass before a change is done
```

Ground rules:

- **Tests never touch the network.** `fetch` is injected. New sources need a fixture and a parser test; see `test/fixtures/README.md` for how fixtures are made and what may be committed.
- **Verify a source before writing its parser.** Call the real endpoint, save a response, then build the parser from it. If that is impossible, say so in the code and the tests (see the GDELT adapter).
- **Sources fail soft.** One failing source must be reported in `errors`, never fail the run.
- **Do not weaken the safety defaults** (robots.txt, SSRF guard, Google sources off by default) and do not make them agent-controlled tool arguments.
- Keep the README, `.actor/input_schema.json`, `.actor/dataset_schema.json` and the zod schemas in sync; tests check this.
