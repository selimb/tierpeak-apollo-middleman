.PHONY: venv

requirements.txt: pyproject.toml poetry.lock
	poetry export --without-hashes --format requirements.txt > requirements.txt
