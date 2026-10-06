# Contributing

Thanks for contributing.

## Local setup

```bash
python -m venv .venv
source .venv/bin/activate
pip install -e '.[all,dev]'
```

## Before opening a change

- keep local config, SQLite data, and captured cloud payloads out of git
- never commit real `userId` or `passToken` values
- keep README and examples aligned with actual supported data types

## Checks

```bash
ruff check src tests
pytest
node --test tests/test_dashboard.cjs
python -m build
```
